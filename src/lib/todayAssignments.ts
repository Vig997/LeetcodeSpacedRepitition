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
  'INSERT INTO today_assignments (assignment_date, problem_id, kind, position) VALUES (?, ?, ?, ?)',
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
  const cap = Math.max(pacing.newToday, 0)

  // Day already has a new set — keep problem IDs; only trim if over cap.
  if (newRows.length > 0) {
    if (newRows.length > cap) {
      const keepIds = new Set(newRows.slice(0, cap).map((r) => r.id))
      const excess = newRows.filter((r) => !keepIds.has(r.id) && r.checked === 0)
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
    const unchecked = rows.filter((r) => r.kind === 'review' && r.checked === 0)
    const wantUnchecked = Math.max(target - checked.length, 0)

    if (unchecked.length > wantUnchecked) {
      for (const r of unchecked.slice(wantUnchecked)) deleteAssignmentById.run(r.id)
    } else if (unchecked.length < wantUnchecked) {
      const needed = wantUnchecked - unchecked.length
      const assignedIds = new Set(rows.map((r) => r.problem_id))
      const due = dueReviewsForToday(today).filter((p) => !assignedIds.has(p.id))
      const picks = pickReviewsWithCarryover(due, needed)
      const maxPos = Math.max(-1, ...rows.filter((r) => r.kind === 'review').map((r) => r.position))
      picks.forEach((p, i) => insertAssignment.run(today, p.id, 'review', maxPos + 1 + i))
    }
  }

  const adjustNewDayLocked = (target: number): void => {
    const newRows = rows.filter((r) => r.kind === 'new')
    if (newRows.length === 0) {
      // No set yet today — first assign (e.g. after rebuildUnchecked wiped them).
      if (target <= 0) return
      const assignedIds = new Set(rows.map((r) => r.problem_id))
      const picks = pickNewForToday(target, assignedIds)
      picks.forEach((p, i) => insertAssignment.run(today, p.id, 'new', i))
      return
    }
    // Day-locked: never grow; trim unchecked excess only.
    if (newRows.length > target) {
      const unchecked = newRows.filter((r) => r.checked === 0)
      const excess = unchecked.slice(Math.max(target - (newRows.length - unchecked.length), 0))
      // Keep first `target` rows by position; drop later unchecked.
      const keep = new Set(
        [...newRows].sort((a, b) => a.position - b.position).slice(0, target).map((r) => r.id),
      )
      for (const r of newRows) {
        if (!keep.has(r.id) && r.checked === 0) deleteAssignmentById.run(r.id)
      }
      void excess
    }
  }

  const tx = db.transaction(() => {
    adjustReviews(pacing.reviewsToday)
    adjustNewDayLocked(pacing.newToday)
  })
  tx()
}
