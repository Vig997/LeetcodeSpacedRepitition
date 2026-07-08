import { db } from './db'
import { todayStr, nowISO, addDays } from './dates'
import { computePacing } from './pacing'
import { isBootstrapActive, getBootstrapNewPerDay } from './scheduler'
import { pickReviews, pickNew, pickBootstrapReviews, roadmapSort } from './topicBalancer'
import type { Problem, TodayAssignment, AssignmentKind } from './types'

export interface AssignmentWithProblem extends TodayAssignment {
  problem: Problem
}

const insertAssignment = db.prepare(
  'INSERT INTO today_assignments (assignment_date, problem_id, kind, position, is_extra) VALUES (?, ?, ?, ?, 0)',
)
const insertExtraAssignment = db.prepare(
  'INSERT INTO today_assignments (assignment_date, problem_id, kind, position, is_extra) VALUES (?, ?, ?, ?, 1)',
)
const deleteAssignmentById = db.prepare('DELETE FROM today_assignments WHERE id = ?')

function carryoverIds(kind: AssignmentKind): Set<number> {
  const yesterday = addDays(todayStr(), -1)
  const rows = db
    .prepare(
      'SELECT problem_id FROM today_assignments WHERE assignment_date = ? AND kind = ? AND checked = 0',
    )
    .all(yesterday, kind) as { problem_id: number }[]
  return new Set(rows.map((r) => r.problem_id))
}

function pickReviewsWithCarryover(due: Problem[], target: number): Problem[] {
  if (target <= 0) return []
  const carry = carryoverIds('review')
  const priority = roadmapSort(due.filter((p) => carry.has(p.id)))
  const rest = due.filter((p) => !carry.has(p.id))
  const picked = [...priority]
  if (picked.length < target) {
    const fill = isBootstrapActive()
      ? pickBootstrapReviews(rest, target - picked.length)
      : pickReviews(rest, target - picked.length)
    picked.push(...fill)
  }
  return picked.slice(0, target)
}

/** Pick today's new slots in strict roadmap order. */
function pickNewForToday(target: number, excludeIds: Set<number>): Problem[] {
  return pickNew(target, excludeIds)
}

/** Move yesterday's open bootstrap new slots to today (same problems, no extra quota). */
function rolloverBootstrapNewSlots(): void {
  if (!isBootstrapActive() || getBootstrapNewPerDay() === 0) return
  const today = todayStr()
  const yesterday = addDays(today, -1)
  db.prepare(
    'UPDATE today_assignments SET assignment_date = ? WHERE assignment_date = ? AND kind = ? AND checked = 0',
  ).run(today, yesterday, 'new')
}

function dueReviewsForToday(today: string): Problem[] {
  if (isBootstrapActive()) {
    return db
      .prepare(
        `SELECT * FROM problems WHERE is_excluded = 0 AND status = 'bootstrap'
         AND next_review_at <= ?
         ORDER BY (neetcode_order IS NULL), neetcode_order ASC, id ASC`,
      )
      .all(today) as Problem[]
  }
  return db
    .prepare(
      `SELECT * FROM problems WHERE is_excluded = 0 AND first_completed_at IS NOT NULL
       AND status != 'bootstrap' AND next_review_at <= ? ORDER BY next_review_at`,
    )
    .all(today) as Problem[]
}

/** Bootstrap extras: next roadmap problem still in the bootstrap pool (due or not). */
function bootstrapPoolNotOnToday(excludeIds: Set<number>): Problem[] {
  const rows = db
    .prepare(
      `SELECT * FROM problems WHERE is_excluded = 0 AND status = 'bootstrap'
       ORDER BY (neetcode_order IS NULL), neetcode_order ASC, id ASC`,
    )
    .all() as Problem[]
  return rows.filter((p) => !excludeIds.has(p.id))
}

/** Normal extras when nothing is due: remaining done SR problems not already on Today. */
function srPoolNotOnToday(excludeIds: Set<number>): Problem[] {
  const rows = db
    .prepare(
      `SELECT * FROM problems WHERE is_excluded = 0 AND first_completed_at IS NOT NULL
       AND status != 'bootstrap'
       ORDER BY next_review_at ASC, id ASC`,
    )
    .all() as Problem[]
  return rows.filter((p) => !excludeIds.has(p.id))
}

function todayAssignmentCounts(): { reviews: number; news: number } {
  const row = db
    .prepare(
      `SELECT
        SUM(CASE WHEN kind = 'review' THEN 1 ELSE 0 END) AS reviews,
        SUM(CASE WHEN kind = 'new' THEN 1 ELSE 0 END) AS news
       FROM today_assignments WHERE assignment_date = ?`,
    )
    .get(todayStr()) as { reviews: number | null; news: number | null }
  return { reviews: row.reviews ?? 0, news: row.news ?? 0 }
}

export function ensureToday(): void {
  const today = todayStr()

  db.prepare(
    'UPDATE today_assignments SET reconciled = 1 WHERE assignment_date < ? AND reconciled = 0',
  ).run(today)

  // Orphan assignment rows (problem deleted) would crash the Today lists.
  db.prepare(
    `DELETE FROM today_assignments WHERE problem_id NOT IN (SELECT id FROM problems)`,
  ).run()

  rolloverBootstrapNewSlots()

  if (todayAssignmentCounts().reviews === 0) {
    assignReviewsForToday()
  }
  refreshTodayNewSlots()
}

function assignReviewsForToday(): void {
  const today = todayStr()
  const pacing = computePacing()
  const due = dueReviewsForToday(today)
  const reviews = pickReviewsWithCarryover(due, pacing.reviewsToday)
  const tx = db.transaction(() => {
    reviews.forEach((p, i) => insertAssignment.run(today, p.id, 'review', i))
  })
  tx()
}

/**
 * Day-lock Today · New:
 * - First assign of the day (no new rows yet) → pick roadmap head up to pacing.newToday.
 * - Once any new rows exist for today → keep that set; finishing one does NOT pull the next.
 * - May trim if over cap (settings lowered); never grow mid-day.
 * Next calendar day starts empty → next roadmap problems.
 */
export function refreshTodayNewSlots(): void {
  const today = todayStr()
  const pacing = computePacing()
  const rows = db
    .prepare('SELECT * FROM today_assignments WHERE assignment_date = ?')
    .all(today) as TodayAssignment[]

  const newRows = rows.filter((r) => r.kind === 'new')
  const pacedNew = newRows.filter((r) => r.is_extra !== 1)
  const cap = Math.max(pacing.newToday, 0)

  // Day already has a paced new set — keep those IDs; only trim paced rows if over cap.
  // User-added extras (is_extra=1) are never trimmed by day-lock.
  // If only extras exist (no paced rows yet), still fall through to first paced assign.
  if (pacedNew.length > 0) {
    if (pacedNew.length > cap) {
      const keepIds = new Set(pacedNew.slice(0, cap).map((r) => r.id))
      const excess = pacedNew.filter((r) => !keepIds.has(r.id) && r.checked === 0)
      if (excess.length > 0) {
        const tx = db.transaction(() => {
          for (const r of excess) deleteAssignmentById.run(r.id)
        })
        tx()
      }
    }
    return
  }

  // First assign today — empty new list.
  if (cap <= 0) return

  const excludeIds = new Set(rows.map((r) => r.problem_id))
  const picks = pickNewForToday(cap, excludeIds)
  const tx = db.transaction(() => {
    picks.forEach((p, i) => insertAssignment.run(today, p.id, 'new', i))
  })
  tx()
}

/**
 * Explicit same-day "do one more" — bypasses pacing caps and Today · New day-lock.
 * Next calendar day still starts from the normal paced set.
 *
 * Reviews:
 * - Bootstrap: next NeetCode-order problem still in the bootstrap pool (not already Today).
 * - Normal: one due review (day-seeded topic pick); if none due, a remaining done SR problem.
 *
 * New (bootstrap or not): next Kept · Undone in NeetCode roadmap order.
 */
export function addExtraReview(): { ok: boolean; message: string } {
  const today = todayStr()
  const rows = getTodayAssignments()
  const assignedIds = new Set(rows.map((r) => r.problem_id))

  let pick: Problem | undefined
  if (isBootstrapActive()) {
    pick = pickBootstrapReviews(bootstrapPoolNotOnToday(assignedIds), 1)[0]
  } else {
    const due = dueReviewsForToday(today).filter((p) => !assignedIds.has(p.id))
    pick = pickReviews(due, 1)[0] ?? pickReviews(srPoolNotOnToday(assignedIds), 1)[0]
  }

  if (!pick) {
    return {
      ok: false,
      message: isBootstrapActive()
        ? 'No more bootstrap problems left to add'
        : 'No more reviews available to add',
    }
  }

  const maxPos = Math.max(
    -1,
    ...rows.filter((r) => r.kind === 'review').map((r) => r.position),
  )
  insertExtraAssignment.run(today, pick.id, 'review', maxPos + 1)
  return { ok: true, message: `Added ${pick.title}` }
}

export function addExtraNew(): { ok: boolean; message: string } {
  const today = todayStr()
  const rows = getTodayAssignments()
  const excludeIds = new Set(rows.map((r) => r.problem_id))
  const pick = pickNew(1, excludeIds)[0]
  if (!pick) {
    return { ok: false, message: 'No more undone Kept problems to add' }
  }
  const maxPos = Math.max(-1, ...rows.filter((r) => r.kind === 'new').map((r) => r.position))
  insertExtraAssignment.run(today, pick.id, 'new', maxPos + 1)
  return { ok: true, message: `Added ${pick.title}` }
}

/** Remove a same-day extra slot the user added (+ Extra review/new). Paced assignments cannot be removed. */
export function removeExtraAssignment(assignmentId: number): { ok: boolean; message: string } {
  const row = db
    .prepare('SELECT * FROM today_assignments WHERE id = ? AND assignment_date = ?')
    .get(assignmentId, todayStr()) as TodayAssignment | undefined

  if (!row) return { ok: false, message: 'Not on Today anymore' }
  if (row.is_extra !== 1) return { ok: false, message: 'Only extras you added can be removed' }
  if (row.checked === 1) return { ok: false, message: 'Already completed — cannot remove' }

  deleteAssignmentById.run(assignmentId)
  return { ok: true, message: 'Removed from Today' }
}

export function getTodayAssignments(): AssignmentWithProblem[] {
  const rows = db
    .prepare(
      'SELECT * FROM today_assignments WHERE assignment_date = ? ORDER BY kind DESC, position',
    )
    .all(todayStr()) as TodayAssignment[]
  if (rows.length === 0) return []

  const ids = [...new Set(rows.map((r) => r.problem_id))]
  const problems = db
    .prepare(
      `SELECT * FROM problems WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as Problem[]
  const byId = new Map(problems.map((p) => [p.id, p]))

  const orphanIds: number[] = []
  const out: AssignmentWithProblem[] = []
  for (const r of rows) {
    const problem = byId.get(r.problem_id)
    if (!problem) {
      orphanIds.push(r.id)
      continue
    }
    out.push({ ...r, problem })
  }
  if (orphanIds.length > 0) {
    const del = db.prepare('DELETE FROM today_assignments WHERE id = ?')
    const tx = db.transaction(() => {
      for (const id of orphanIds) del.run(id)
    })
    tx()
  }
  return out
}

/** Mark an assignment row checked after its rating was saved. */
export function checkAssignment(assignmentId: number): void {
  db.prepare(
    'UPDATE today_assignments SET checked = 1, rated_at = ? WHERE id = ?',
  ).run(nowISO(), assignmentId)
}

/** If this problem is on today's list (unchecked), mark it checked (Problems-tab path). */
export function checkAssignmentForProblem(problemId: number): void {
  db.prepare(
    'UPDATE today_assignments SET checked = 1, rated_at = ? WHERE assignment_date = ? AND problem_id = ? AND checked = 0',
  ).run(nowISO(), todayStr(), problemId)
}

/** Remove unchecked assignments referencing a problem (e.g. moved to Removed). */
export function dropUncheckedAssignmentsFor(problemId: number): void {
  db.prepare(
    'DELETE FROM today_assignments WHERE assignment_date = ? AND problem_id = ? AND checked = 0',
  ).run(todayStr(), problemId)
}

/**
 * Bootstrap started/cancelled mid-day: throw away every unchecked slot and
 * re-pick from scratch (checked rows are kept), so the Today list reflects
 * the new phase immediately.
 */
export function rebuildUncheckedToday(): void {
  db.prepare(
    'DELETE FROM today_assignments WHERE assignment_date = ? AND checked = 0',
  ).run(todayStr())
  reassignUncheckedToday()
}

/**
 * Settings / phase change mid-day:
 * - Reviews: trim or grow to the new cap (checked kept).
 * - New: day-locked — never grow; only trim if over the new cap.
 */
export function reassignUncheckedToday(): void {
  const today = todayStr()
  const pacing = computePacing()
  const rows = getTodayAssignments()

  const adjustReviews = (target: number): void => {
    const checked = rows.filter((r) => r.kind === 'review' && r.checked === 1)
    // Extras are user-added for today — never trim them when the paced cap drops.
    const uncheckedPaced = rows.filter(
      (r) => r.kind === 'review' && r.checked === 0 && r.is_extra !== 1,
    )
    const wantUnchecked = Math.max(target - checked.length, 0)

    if (uncheckedPaced.length > wantUnchecked) {
      for (const r of uncheckedPaced.slice(wantUnchecked)) deleteAssignmentById.run(r.id)
    } else if (uncheckedPaced.length < wantUnchecked) {
      const needed = wantUnchecked - uncheckedPaced.length
      const assignedIds = new Set(rows.map((r) => r.problem_id))
      const due = dueReviewsForToday(today).filter((p) => !assignedIds.has(p.id))
      const picks = pickReviewsWithCarryover(due, needed)
      const maxPos = Math.max(-1, ...rows.filter((r) => r.kind === 'review').map((r) => r.position))
      picks.forEach((p, i) => insertAssignment.run(today, p.id, 'review', maxPos + 1 + i))
    }
  }

  const adjustNewDayLocked = (target: number): void => {
    const newRows = rows.filter((r) => r.kind === 'new')
    const pacedNew = newRows.filter((r) => r.is_extra !== 1)
    if (pacedNew.length === 0) {
      // No paced set yet — first assign (extras may already exist from + Extra new).
      if (target <= 0) return
      const assignedIds = new Set(rows.map((r) => r.problem_id))
      const picks = pickNewForToday(target, assignedIds)
      picks.forEach((p, i) => insertAssignment.run(today, p.id, 'new', i))
      return
    }
    // Day-locked: never grow paced set; trim paced unchecked excess only (keep extras).
    if (pacedNew.length > target) {
      const keep = new Set(
        [...pacedNew].sort((a, b) => a.position - b.position).slice(0, target).map((r) => r.id),
      )
      for (const r of pacedNew) {
        if (!keep.has(r.id) && r.checked === 0) deleteAssignmentById.run(r.id)
      }
    }
  }

  const tx = db.transaction(() => {
    adjustReviews(pacing.reviewsToday)
    adjustNewDayLocked(pacing.newToday)
  })
  tx()
}
