import { db } from './db'
import { todayStr, nowISO, addDays, localDayFromISO } from './dates'
import { computePacing } from './pacing'
import { isBootstrapActive, getBootstrapNewPerDay, applyReview, markDone } from './scheduler'
import { pickReviews, pickNew, pickBootstrapReviews, roadmapSort } from './topicBalancer'
import { getSetting, setSetting } from './settings'
import {
  snapshotProblem,
  snapshotTopicStats,
  clearUndo,
  undoMetaForAssignment,
  type ProblemUndoSnapshot,
  type TopicStatsUndoSnapshot,
} from './undo'
import type { Problem, TodayAssignment, AssignmentKind, Rating } from './types'

interface ReviewLogRow {
  id: number
  problem_id: number
  reviewed_at: string
  rating: Rating
  hints: number
  interval_after: number
}

export interface AssignmentWithProblem extends TodayAssignment {
  problem: Problem
}

/** Stored on assignment check — used to restore state for same-day rating edits. */
export interface AssignmentBeforeJson {
  before: ProblemUndoSnapshot
  topicBefore: TopicStatsUndoSnapshot | null
  wasFirstCompletion: boolean
  wasBootstrap: boolean
}

export interface AssignmentRatingMeta extends AssignmentBeforeJson {
  sessionRating: Rating
  sessionHints: number
}

export function buildAssignmentRatingMeta(
  p: Problem,
  rating: Rating,
  hints: number,
): AssignmentRatingMeta {
  return {
    before: snapshotProblem(p),
    topicBefore: p.is_excluded ? null : snapshotTopicStats(p.topic),
    wasFirstCompletion: p.first_completed_at === null,
    wasBootstrap: p.status === 'bootstrap',
    sessionRating: rating,
    sessionHints: hints,
  }
}

function beforeJsonPayload(meta: AssignmentBeforeJson): string {
  return JSON.stringify({
    before: meta.before,
    topicBefore: meta.topicBefore,
    wasFirstCompletion: meta.wasFirstCompletion,
    wasBootstrap: meta.wasBootstrap,
  })
}

function parseStoredMeta(raw: string): AssignmentBeforeJson | null {
  try {
    return JSON.parse(raw) as AssignmentBeforeJson
  } catch {
    return null
  }
}

function sessionDay(row: TodayAssignment): string {
  return row.rated_at ? localDayFromISO(row.rated_at) : todayStr()
}

/** Rebuild pre-rating snapshot from review_log when before_json was never stored. */
function reconstructMetaFromReviewLog(
  row: TodayAssignment,
  p: Problem,
): AssignmentBeforeJson | null {
  const logs = db
    .prepare('SELECT * FROM review_log WHERE problem_id = ? ORDER BY id ASC')
    .all(row.problem_id) as ReviewLogRow[]
  if (logs.length === 0) return null

  const lastLog = logs[logs.length - 1]
  const ratedDay = sessionDay(row)
  const lastLogDay = localDayFromISO(lastLog.reviewed_at)
  if (lastLogDay !== ratedDay && lastLogDay !== todayStr()) return null

  const priorLogs = logs.slice(0, -1)
  if (priorLogs.length === 0) {
    // Already done before today's rating — not a first completion (common for reviews / bootstrap).
    if (p.first_completed_at !== null) {
      const wasBootstrap =
        getSetting('bootstrap_active') === '1' &&
        p.repetitions <= 1 &&
        (p.status === 'sr' || p.status === 'mastered')
      return {
        before: {
          status: wasBootstrap ? 'bootstrap' : 'sr',
          first_completed_at: p.first_completed_at,
          last_reviewed_at: wasBootstrap ? null : p.first_completed_at,
          next_review_at: ratedDay,
          last_rating: null,
          last_hints: 0,
          ease: p.ease,
          interval_days: wasBootstrap ? 0 : Math.max(p.interval_days, 1),
          repetitions: Math.max(p.repetitions - 1, 0),
        },
        topicBefore: null,
        wasFirstCompletion: false,
        wasBootstrap,
      }
    }
    return {
      before: {
        status: 'undone',
        first_completed_at: null,
        last_reviewed_at: null,
        next_review_at: null,
        last_rating: null,
        last_hints: 0,
        ease: 2.5,
        interval_days: 0,
        repetitions: 0,
      },
      topicBefore: null,
      wasFirstCompletion: true,
      wasBootstrap: false,
    }
  }

  const prev = priorLogs[priorLogs.length - 1]
  const first = priorLogs[0]

  return {
    before: {
      status: 'sr',
      first_completed_at: first.reviewed_at.slice(0, 10),
      last_reviewed_at: prev.reviewed_at.slice(0, 10),
      next_review_at: ratedDay,
      last_rating: prev.rating,
      last_hints: prev.hints,
      ease: priorLogs.length === 1 ? 2.5 : p.ease,
      interval_days: prev.interval_after,
      repetitions: priorLogs.length,
    },
    topicBefore: null,
    wasFirstCompletion: false,
    wasBootstrap: false,
  }
}

function resolveAssignmentMeta(
  row: TodayAssignment,
  p: Problem,
): { meta: AssignmentBeforeJson | null; message: string } {
  if (row.before_json) {
    const meta = parseStoredMeta(row.before_json)
    if (meta) return { meta, message: '' }
    return { meta: null, message: 'Could not load saved rating' }
  }

  const undoMeta = undoMetaForAssignment(row.id)
  if (undoMeta) return { meta: undoMeta, message: '' }

  const reconstructed = reconstructMetaFromReviewLog(row, p)
  if (reconstructed) return { meta: reconstructed, message: '' }

  return {
    meta: null,
    message: 'Could not restore rating — no snapshot available',
  }
}

function restoreTopicStats(
  topic: string,
  topicBefore: TopicStatsUndoSnapshot | null,
  oldRating: Rating,
): void {
  if (topicBefore) {
    const t = topicBefore
    db.prepare(
      `UPDATE topic_stats SET
        last_visited_at = ?,
        visit_count = ?,
        struggle_score = ?,
        easy_count = ?,
        medium_count = ?,
        hard_count = ?,
        forgot_count = ?
       WHERE topic = ?`,
    ).run(
      t.last_visited_at,
      t.visit_count,
      t.struggle_score,
      t.easy_count,
      t.medium_count,
      t.hard_count,
      t.forgot_count,
      topic,
    )
    return
  }
  const col =
    oldRating === 'easy'
      ? 'easy_count'
      : oldRating === 'medium'
        ? 'medium_count'
        : oldRating === 'hard'
          ? 'hard_count'
          : 'forgot_count'
  db.prepare(
    `UPDATE topic_stats SET
      visit_count = MAX(visit_count - 1, 0),
      ${col} = MAX(${col} - 1, 0)
     WHERE topic = ?`,
  ).run(topic)
}

function restoreBeforeRating(
  problemId: number,
  topic: string,
  meta: AssignmentBeforeJson,
  oldRating: Rating,
): void {
  const lastLog = db
    .prepare(
      'SELECT id FROM review_log WHERE problem_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(problemId) as { id: number } | undefined
  if (lastLog) {
    db.prepare('DELETE FROM review_log WHERE id = ?').run(lastLog.id)
  }

  const b = meta.before
  db.prepare(
    `UPDATE problems SET
      status = ?,
      first_completed_at = ?,
      last_reviewed_at = ?,
      next_review_at = ?,
      last_rating = ?,
      last_hints = ?,
      ease = ?,
      interval_days = ?,
      repetitions = ?
     WHERE id = ?`,
  ).run(
    b.status,
    b.first_completed_at,
    b.last_reviewed_at,
    b.next_review_at,
    b.last_rating,
    b.last_hints,
    b.ease,
    b.interval_days,
    b.repetitions,
    problemId,
  )

  if (meta.wasBootstrap && getSetting('bootstrap_active') !== '1') {
    setSetting('bootstrap_active', '1')
    setSetting('bootstrap_complete', '0')
  }

  restoreTopicStats(topic, meta.topicBefore, oldRating)
}

/** Change rating + hints for a completed Today row (same calendar day only). */
export function editAssignmentRating(
  assignmentId: number,
  rating: Rating,
  hints: number,
): { ok: boolean; message: string } {
  const today = todayStr()
  const row = db
    .prepare('SELECT * FROM today_assignments WHERE id = ? AND assignment_date = ?')
    .get(assignmentId, today) as TodayAssignment | undefined

  if (!row) return { ok: false, message: 'Not on Today anymore' }
  if (row.checked !== 1) return { ok: false, message: 'Complete the problem first' }

  const p = db
    .prepare('SELECT * FROM problems WHERE id = ?')
    .get(row.problem_id) as Problem | undefined
  if (!p) return { ok: false, message: 'Problem no longer exists' }

  const { meta, message: metaMessage } = resolveAssignmentMeta(row, p)
  if (!meta) return { ok: false, message: metaMessage }

  const oldRating = (row.session_rating ?? p.last_rating) as Rating | null
  if (!oldRating) {
    return { ok: false, message: 'No rating to edit' }
  }

  try {
    const tx = db.transaction(() => {
      restoreBeforeRating(row.problem_id, p.topic, meta, oldRating)
      if (meta.wasFirstCompletion) {
        markDone(row.problem_id, rating, hints, { recordUndo: false })
      } else {
        applyReview(row.problem_id, rating, hints, { recordUndo: false })
      }
      db.prepare(
        `UPDATE today_assignments SET session_rating = ?, session_hints = ?, rated_at = ?
         WHERE id = ?`,
      ).run(rating, hints, nowISO(), assignmentId)
    })
    tx()
  } catch {
    return { ok: false, message: 'Could not update rating — try again' }
  }

  clearUndo()
  isBootstrapActive()
  return { ok: true, message: 'Rating updated' }
}

/** Revert a completed Today row to unchecked (same calendar day only). */
export function uncheckAssignment(assignmentId: number): { ok: boolean; message: string } {
  const today = todayStr()
  const row = db
    .prepare('SELECT * FROM today_assignments WHERE id = ? AND assignment_date = ?')
    .get(assignmentId, today) as TodayAssignment | undefined

  if (!row) return { ok: false, message: 'Not on Today anymore' }
  if (row.checked !== 1) return { ok: false, message: 'Not checked off yet' }

  const p = db
    .prepare('SELECT * FROM problems WHERE id = ?')
    .get(row.problem_id) as Problem | undefined
  if (!p) return { ok: false, message: 'Problem no longer exists' }

  const { meta, message: metaMessage } = resolveAssignmentMeta(row, p)
  if (!meta) return { ok: false, message: metaMessage }

  const lastLog = db
    .prepare(
      'SELECT rating FROM review_log WHERE problem_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(row.problem_id) as { rating: Rating } | undefined
  const oldRating = (row.session_rating ?? p.last_rating ?? lastLog?.rating) as Rating | null
  if (!oldRating) {
    return { ok: false, message: 'No rating to revert' }
  }

  try {
    const tx = db.transaction(() => {
      restoreBeforeRating(row.problem_id, p.topic, meta, oldRating)
      db.prepare(
        `UPDATE today_assignments SET checked = 0, rated_at = NULL, session_rating = NULL, session_hints = NULL, before_json = NULL
         WHERE id = ?`,
      ).run(assignmentId)
    })
    tx()
  } catch {
    return { ok: false, message: 'Could not uncheck — try again' }
  }

  clearUndo()
  isBootstrapActive()
  return { ok: true, message: 'Unchecked' }
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

/** Live Today list counts from DB — includes extras; used after add/remove to reflect real workload. */
export interface TodayLoadSummary {
  reviewCount: number
  newCount: number
  extraReviewCount: number
  extraNewCount: number
  pacedReviewCount: number
  pacedNewCount: number
  uncheckedCount: number
  /** Unchecked rows on Today (paced + extras). */
  openLoad: number
}

export function getTodayLoadSummary(): TodayLoadSummary {
  const rows = db
    .prepare('SELECT kind, is_extra, checked FROM today_assignments WHERE assignment_date = ?')
    .all(todayStr()) as Pick<TodayAssignment, 'kind' | 'is_extra' | 'checked'>[]

  let reviewCount = 0
  let newCount = 0
  let extraReviewCount = 0
  let extraNewCount = 0
  let uncheckedCount = 0

  for (const r of rows) {
    if (r.kind === 'review') {
      reviewCount++
      if (r.is_extra === 1) extraReviewCount++
    } else {
      newCount++
      if (r.is_extra === 1) extraNewCount++
    }
    if (r.checked === 0) uncheckedCount++
  }

  return {
    reviewCount,
    newCount,
    extraReviewCount,
    extraNewCount,
    pacedReviewCount: reviewCount - extraReviewCount,
    pacedNewCount: newCount - extraNewCount,
    uncheckedCount,
    openLoad: uncheckedCount,
  }
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

  refreshTodayReviewSlots()
  refreshTodayNewSlots()
}

/**
 * Day-lock Today · Reviews during bootstrap (same idea as paced new):
 * - First assign of the day → pick up to pacing.reviewsToday (carryover first).
 * - Once assigned → keep that set; finishing one does NOT pull the next.
 * - May trim unchecked if cap lowered; never grow mid-day. Use + Extra review for more.
 */
export function refreshTodayReviewSlots(): void {
  const today = todayStr()
  const pacing = computePacing()
  const rows = db
    .prepare('SELECT * FROM today_assignments WHERE assignment_date = ?')
    .all(today) as TodayAssignment[]

  const reviewRows = rows.filter((r) => r.kind === 'review')
  const pacedReviews = reviewRows.filter((r) => r.is_extra !== 1)
  const cap = Math.max(pacing.reviewsToday, 0)

  if (isBootstrapActive()) {
    if (pacedReviews.length > 0) {
      if (pacedReviews.length > cap) {
        const keepIds = new Set(pacedReviews.slice(0, cap).map((r) => r.id))
        const excess = pacedReviews.filter((r) => !keepIds.has(r.id) && r.checked === 0)
        if (excess.length > 0) {
          const tx = db.transaction(() => {
            for (const r of excess) deleteAssignmentById.run(r.id)
          })
          tx()
        }
      }
      return
    }

    if (cap <= 0) return

    const due = dueReviewsForToday(today)
    const picks = pickReviewsWithCarryover(due, cap)
    const tx = db.transaction(() => {
      picks.forEach((p, i) => insertAssignment.run(today, p.id, 'review', i))
    })
    tx()
    return
  }

  if (todayAssignmentCounts().reviews === 0) {
    assignReviewsForToday()
  }
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
 * Day-lock Today · New (same idea as paced reviews):
 * - First assign of the day (no paced new rows yet) → pick roadmap head up to pacing.newToday.
 * - Once assigned → keep that set; finishing one does NOT pull the next.
 * - May trim unchecked if cap lowered; never grow mid-day. Use + Extra new for more.
 * Next calendar day starts fresh → next roadmap problems.
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

  // First assign today — empty paced new list.
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
function commitExtraAssignment(
  kind: AssignmentKind,
  problemId: number,
  position: number,
  title: string,
): { ok: boolean; message: string } {
  const today = todayStr()
  const dup = db
    .prepare(
      'SELECT id FROM today_assignments WHERE assignment_date = ? AND problem_id = ?',
    )
    .get(today, problemId) as { id: number } | undefined
  if (dup) return { ok: false, message: 'Problem already on Today' }

  const tx = db.transaction(() => {
    const info = insertExtraAssignment.run(today, problemId, kind, position)
    const assignmentId = Number(info.lastInsertRowid)
    const row = db
      .prepare('SELECT kind, is_extra, checked FROM today_assignments WHERE id = ?')
      .get(assignmentId) as
      | Pick<TodayAssignment, 'kind' | 'is_extra' | 'checked'>
      | undefined
    if (!row || row.kind !== kind || row.is_extra !== 1 || row.checked !== 0) {
      throw new Error('extra insert verify failed')
    }
  })
  try {
    tx()
  } catch {
    return { ok: false, message: 'Could not add extra — try again' }
  }
  return { ok: true, message: `Added ${title}` }
}

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
        ? 'No More Bootstrap Problems Left to Add'
        : 'No More Reviews Available to Add',
    }
  }

  const maxPos = Math.max(
    -1,
    ...rows.filter((r) => r.kind === 'review').map((r) => r.position),
  )
  return commitExtraAssignment('review', pick.id, maxPos + 1, pick.title)
}

export function addExtraNew(): { ok: boolean; message: string } {
  const rows = getTodayAssignments()
  const excludeIds = new Set(rows.map((r) => r.problem_id))
  const pick = pickNew(1, excludeIds)[0]
  if (!pick) {
    return { ok: false, message: 'No More Undone Kept Problems to Add' }
  }
  const maxPos = Math.max(-1, ...rows.filter((r) => r.kind === 'new').map((r) => r.position))
  return commitExtraAssignment('new', pick.id, maxPos + 1, pick.title)
}

/** Remove a same-day extra slot the user added (+ Extra review/new). Paced assignments cannot be removed. */
export function removeExtraAssignment(assignmentId: number): { ok: boolean; message: string } {
  const today = todayStr()
  const row = db
    .prepare('SELECT * FROM today_assignments WHERE id = ? AND assignment_date = ?')
    .get(assignmentId, today) as TodayAssignment | undefined

  if (!row) return { ok: false, message: 'Not on Today anymore' }
  if (row.is_extra !== 1) return { ok: false, message: 'Only extras you added can be removed' }
  if (row.checked === 1) return { ok: false, message: 'Already completed — cannot remove' }

  const tx = db.transaction(() => {
    deleteAssignmentById.run(assignmentId)
    const still = db
      .prepare('SELECT id FROM today_assignments WHERE id = ?')
      .get(assignmentId) as { id: number } | undefined
    if (still) throw new Error('delete failed')
  })
  try {
    tx()
  } catch {
    return { ok: false, message: 'Could not remove — try again' }
  }

  // Problem is no longer on Today — add-extra / pick logic will see it as available again.
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
export function checkAssignment(assignmentId: number, meta?: AssignmentRatingMeta): void {
  if (meta) {
    db.prepare(
      `UPDATE today_assignments SET checked = 1, rated_at = ?, session_rating = ?, session_hints = ?, before_json = ?
       WHERE id = ?`,
    ).run(
      nowISO(),
      meta.sessionRating,
      meta.sessionHints,
      beforeJsonPayload(meta),
      assignmentId,
    )
    return
  }
  db.prepare(
    'UPDATE today_assignments SET checked = 1, rated_at = ? WHERE id = ?',
  ).run(nowISO(), assignmentId)
}

/** If this problem is on today's list (unchecked), mark it checked (Problems-tab path). */
export function checkAssignmentForProblem(problemId: number, meta?: AssignmentRatingMeta): void {
  if (meta) {
    db.prepare(
      `UPDATE today_assignments SET checked = 1, rated_at = ?, session_rating = ?, session_hints = ?, before_json = ?
       WHERE assignment_date = ? AND problem_id = ? AND checked = 0`,
    ).run(
      nowISO(),
      meta.sessionRating,
      meta.sessionHints,
      beforeJsonPayload(meta),
      todayStr(),
      problemId,
    )
    return
  }
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
