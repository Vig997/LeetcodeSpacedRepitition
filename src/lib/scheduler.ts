import { db } from './db'
import { getSetting, setSetting, getNumberSetting, getGoalDate } from './settings'
import { todayStr, addDays, daysUntil, nowISO, daysBetween } from './dates'
import { capIntervalDays, computeNextReviewAt } from './reviewSchedule'
import { recordUndo, snapshotProblem, snapshotTopicStats } from './undo'
import type { Problem, Rating } from './types'

const BASE_SCORE: Record<Rating, number> = {
  easy: 4,
  medium: 3,
  hard: 2,
  forgot: 0,
}

/** Rating + hints → 0..4 score used by nextSchedule / topic struggle. */
export function effectiveScore(rating: Rating, hints: number): number {
  return Math.min(Math.max(BASE_SCORE[rating] - hints * 0.5, 0), 4)
}

/** Cap SR intervals so runaway compounding cannot blow up dates. */
export { MAX_INTERVAL_DAYS, capIntervalDays } from './reviewSchedule'

/** First interval when a problem is marked done (enters SR). */
export function firstInterval(rating: Rating): number {
  switch (rating) {
    case 'forgot':
      return 1
    case 'hard':
      return 2
    case 'medium':
      return 4
    case 'easy':
      return 7
  }
}

/** Sublinear boost: more lifetime reviews → longer gaps (rep 1 = no boost). */
export function repetitionMultiplier(repetitions: number): number {
  if (repetitions <= 1) return 1
  return Math.min(1 + Math.sqrt(repetitions - 1) * 0.35, 2.5)
}

// ---- Goal-date pressure ----------------------------------------------------

interface GoalPressureInputs {
  doneKept: number
  keptTotal: number
  masteredCount: number
  daysLeft: number
  totalSpan: number
  startDone: number
}

export function goalPressure(i: GoalPressureInputs): number {
  const elapsedRatio =
    i.totalSpan > 0 ? 1 - i.daysLeft / i.totalSpan : 1
  const targetDone = Math.round(
    i.startDone + (i.keptTotal - i.startDone) * Math.min(Math.max(elapsedRatio, 0), 1),
  )
  const targetMastered = Math.round(i.keptTotal * Math.min(Math.max(elapsedRatio, 0), 1) * 0.8)

  const doneRatio = i.doneKept / Math.max(targetDone, 1)
  const masteryRatio = i.masteredCount / Math.max(targetMastered, 1)
  const behind = doneRatio < 0.9 || masteryRatio < 0.85 || i.daysLeft < 14

  if (!behind) return 1.0
  if (i.daysLeft < 14 && masteryRatio < 0.7) return 0.7
  return 0.85
}

function currentGoalPressure(): number {
  const agg = db
    .prepare(
      `SELECT
        SUM(CASE WHEN is_custom = 0 AND is_excluded = 0 THEN 1 ELSE 0 END) AS kept_total,
        SUM(CASE WHEN is_custom = 0 AND is_excluded = 0 AND first_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done_kept,
        SUM(CASE WHEN is_custom = 0 AND is_excluded = 0 AND status = 'mastered' THEN 1 ELSE 0 END) AS mastered
      FROM problems`,
    )
    .get() as { kept_total: number; done_kept: number; mastered: number }

  const goalDate = getGoalDate()
  const startDate = getSetting('start_date') ?? todayStr()
  const totalSpan = Math.max(daysBetween(startDate, goalDate), 1)
  return goalPressure({
    doneKept: agg.done_kept ?? 0,
    keptTotal: agg.kept_total ?? 0,
    masteredCount: agg.mastered ?? 0,
    daysLeft: daysUntil(goalDate),
    totalSpan,
    startDone: getNumberSetting('start_done', 0),
  })
}

// ---- Interval computation -------------------------------------------------

export interface NextSchedule {
  intervalDays: number
  ease: number
  repetitions: number
}

export function nextSchedule(
  prev: { intervalDays: number; ease: number; repetitions: number },
  rating: Rating,
  hints: number,
  pressure: number,
): NextSchedule {
  const score = effectiveScore(rating, hints)
  let ease = prev.ease
  let interval: number
  let repetitions = prev.repetitions + 1

  const base = Math.max(prev.intervalDays, 1)
  if (score < 1.0) {
    interval = 1
    repetitions = 0
    ease = Math.max(ease - 0.3, 1.3)
  } else if (score < 2.0) {
    interval = Math.max(1, base * 1.2)
    ease = Math.max(ease - 0.15, 1.3)
  } else if (score < 3.5) {
    interval = base * ease
  } else {
    interval = base * ease * 1.3
    ease = ease + 0.1
  }

  interval = capIntervalDays(
    Math.max(1, Math.round(interval * repetitionMultiplier(repetitions) * pressure)),
  )
  return { intervalDays: interval, ease, repetitions }
}

// ---- Manual bootstrap (opt-in) ----------------------------------------------

function bootstrapRemaining(): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM problems WHERE status = 'bootstrap' AND is_excluded = 0",
      )
      .get() as { c: number }
  ).c
}

/**
 * True while a user-started bootstrap has unfinished baseline reviews.
 * The New list / new-problem pacing is locked only during this window.
 * Finishing the pool latches `bootstrap_complete` (Dashboard badge).
 */
export function isBootstrapActive(): boolean {
  if (getSetting('bootstrap_active') !== '1') return false
  if (bootstrapRemaining() > 0) return true
  const totalDays = getNumberSetting('bootstrap_total_days', 0)
  if (totalDays > 0) setSetting('bootstrap_last_total_days', totalDays)
  setSetting('bootstrap_active', '0')
  setSetting('bootstrap_new_per_day', 0)
  setSetting('bootstrap_pool_total', 0)
  setSetting('bootstrap_total_days', 0)
  setSetting('bootstrap_complete', '1')
  setSetting('bootstrap_completed_on', todayStr())
  return false
}

export function wasBootstrapCompleted(): boolean {
  return getSetting('bootstrap_complete') === '1'
}

/**
 * User pressed “Start Bootstrap”: put the selected done Kept problems into
 * the bootstrap pool with baseline reviews staggered at `dailyCap`/day.
 * `newPerDay` > 0 also assigns new Kept problems each day during bootstrap.
 */
export function startBootstrap(
  problemIds: number[],
  dailyCap: number,
  newPerDay = 0,
): void {
  if (problemIds.length === 0) return
  const cap = Math.max(dailyCap, 1)
  const newCap = newPerDay > 0 ? Math.min(Math.max(newPerDay, 1), 10) : 0
  const today = todayStr()
  const placeholders = problemIds.map(() => '?').join(',')
  const ordered = db
    .prepare(
      `SELECT id FROM problems WHERE id IN (${placeholders})
       ORDER BY (neetcode_order IS NULL), neetcode_order ASC, id ASC`,
    )
    .all(...problemIds) as { id: number }[]
  const orderedIds = ordered.map((r) => r.id)
  const stmt = db.prepare(
    `UPDATE problems SET status = 'bootstrap', next_review_at = ?
     WHERE id = ? AND is_excluded = 0 AND first_completed_at IS NOT NULL`,
  )
  const totalDays = Math.ceil(orderedIds.length / cap)
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => {
      stmt.run(addDays(today, Math.floor(i / cap)), id)
    })
    setSetting('bootstrap_active', '1')
    setSetting('bootstrap_complete', '0')
    setSetting('bootstrap_daily_cap', cap)
    setSetting('bootstrap_new_per_day', newCap)
    setSetting('bootstrap_pool_total', orderedIds.length)
    setSetting('bootstrap_total_days', totalDays)
  })
  tx()
}

/** Stored bootstrap period: ceil(selected ÷ reviews/day), fixed at start. */
export function getBootstrapTotalDays(): number {
  if (getSetting('bootstrap_active') !== '1') return 0
  return getNumberSetting('bootstrap_total_days', 0)
}

/** New problems/day while bootstrap is active; 0 = locked (default). */
export function getBootstrapNewPerDay(): number {
  if (getSetting('bootstrap_active') !== '1') return 0
  const n = getNumberSetting('bootstrap_new_per_day', 0)
  return n > 0 ? Math.min(n, 10) : 0
}

/** Spread post-bootstrap-deferral clumps by 0–2 days per problem. */
export { bootstrapSpreadJitter } from './reviewSchedule'

function scheduleNextReviewAt(
  problemId: number,
  today: string,
  srInterval: number,
  duringBootstrap: boolean,
): string {
  const deferral = duringBootstrap ? getBootstrapTotalDays() : 0
  return computeNextReviewAt(today, srInterval, problemId, deferral)
}

/**
 * Abort bootstrap:
 * - Baselined (≥1 review_log row): resume normal SR from last interval.
 * - Never reviewed: due today (honest overdue).
 */
export function cancelBootstrap(): void {
  const today = todayStr()
  const pool = db
    .prepare("SELECT * FROM problems WHERE status = 'bootstrap'")
    .all() as Problem[]
  const reviewed = db.prepare(
    'SELECT COUNT(*) AS c FROM review_log WHERE problem_id = ?',
  )
  const toSr = db.prepare(
    "UPDATE problems SET status = 'sr', next_review_at = ? WHERE id = ?",
  )
  const tx = db.transaction(() => {
    for (const p of pool) {
      const logs = reviewed.get(p.id) as { c: number }
      if (logs.c > 0 && p.interval_days > 0) {
        toSr.run(addDays(today, Math.max(p.interval_days, 1)), p.id)
      } else {
        toSr.run(today, p.id)
      }
    }
    setSetting('bootstrap_active', '0')
    setSetting('bootstrap_new_per_day', 0)
    setSetting('bootstrap_pool_total', 0)
    setSetting('bootstrap_total_days', 0)
    setSetting('bootstrap_complete', getSetting('bootstrap_completed_on') ? '1' : '0')
  })
  tx()
}

// ---- Mutations: rate a review / mark done ----------------------------------

function updateTopicStats(topic: string, rating: Rating, hints: number): void {
  const score = effectiveScore(rating, hints)
  const row = db
    .prepare('SELECT * FROM topic_stats WHERE topic = ?')
    .get(topic) as
    | { struggle_score: number; visit_count: number }
    | undefined
  const prev = row?.struggle_score ?? 0
  const newStruggle =
    row && row.visit_count > 0
      ? prev + ((4 - score) - prev) / Math.min(row.visit_count + 1, 10)
      : 4 - score

  const col =
    rating === 'easy'
      ? 'easy_count'
      : rating === 'medium'
        ? 'medium_count'
        : rating === 'hard'
          ? 'hard_count'
          : 'forgot_count'

  db.prepare(
    `UPDATE topic_stats SET last_visited_at = ?, visit_count = visit_count + 1,
      struggle_score = ?, ${col} = ${col} + 1 WHERE topic = ?`,
  ).run(todayStr(), newStruggle, topic)
}

function maybeMaster(problemId: number, intervalDays: number): boolean {
  if (intervalDays < 21) return false
  const last2 = db
    .prepare(
      'SELECT rating, hints FROM review_log WHERE problem_id = ? ORDER BY id DESC LIMIT 2',
    )
    .all(problemId) as { rating: Rating; hints: number }[]
  if (last2.length < 2) return false
  return last2.every(
    (r) => (r.rating === 'medium' || r.rating === 'easy') && r.hints <= 1,
  )
}

/**
 * Log a review rating for a done problem (bootstrap baseline or SR cycle).
 * Returns the new interval in days.
 */
export function applyReview(
  problemId: number,
  rating: Rating,
  hints: number,
  opts?: { recordUndo?: boolean },
): number {
  const p = db
    .prepare('SELECT * FROM problems WHERE id = ?')
    .get(problemId) as Problem

  const lastLog = db
    .prepare('SELECT reviewed_at FROM review_log WHERE problem_id = ? ORDER BY id DESC LIMIT 1')
    .get(problemId) as { reviewed_at: string } | undefined
  if (lastLog) {
    const ms = Date.now() - new Date(lastLog.reviewed_at).getTime()
    if (ms >= 0 && ms < 5000) return capIntervalDays(p.interval_days)
  }

  const before = snapshotProblem(p)
  const wasBootstrap = p.status === 'bootstrap'
  const pressure = currentGoalPressure()
  const isBaseline = wasBootstrap

  let srInterval: number
  let ease = p.ease
  let repetitions: number

  if (isBaseline) {
    repetitions = p.repetitions + 1
    srInterval = capIntervalDays(
      Math.max(
        1,
        Math.round(firstInterval(rating) * repetitionMultiplier(repetitions) * pressure),
      ),
    )
  } else {
    const next = nextSchedule(
      { intervalDays: p.interval_days, ease: p.ease, repetitions: p.repetitions },
      rating,
      hints,
      pressure,
    )
    srInterval = next.intervalDays
    ease = next.ease
    repetitions = next.repetitions
  }

  const duringBootstrap = getSetting('bootstrap_active') === '1'
  const today = todayStr()
  const topicBefore = p.is_excluded ? null : snapshotTopicStats(p.topic)
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO review_log (problem_id, reviewed_at, rating, hints, interval_after) VALUES (?, ?, ?, ?, ?)',
    ).run(problemId, nowISO(), rating, hints, srInterval)

    const mastered = maybeMaster(problemId, srInterval) || p.status === 'mastered'
    const newStatus = mastered ? 'mastered' : 'sr'
    const nextAt = scheduleNextReviewAt(problemId, today, srInterval, duringBootstrap)

    db.prepare(
      `UPDATE problems SET status = ?, last_reviewed_at = ?, next_review_at = ?,
        last_rating = ?, last_hints = ?, ease = ?, interval_days = ?, repetitions = ?
       WHERE id = ?`,
    ).run(
      newStatus,
      today,
      nextAt,
      rating,
      hints,
      ease,
      srInterval,
      repetitions,
      problemId,
    )

    if (!p.is_excluded) updateTopicStats(p.topic, rating, hints)
  })
  tx()

  if (opts?.recordUndo !== false) {
    recordUndo({
      problemId,
      wasFirstCompletion: false,
      wasBootstrap,
      before,
      assignmentId: null,
      topic: p.topic,
      rating,
      topicBefore,
    })
  }

  isBootstrapActive()
  return srInterval
}

/**
 * Mark an undone problem done for the first time (rating modal).
 * Enters SR directly with a first interval — never grows the bootstrap pool.
 */
export function markDone(
  problemId: number,
  rating: Rating,
  hints: number,
  opts?: { recordUndo?: boolean },
): number {
  const p = db
    .prepare('SELECT * FROM problems WHERE id = ?')
    .get(problemId) as Problem
  if (p.first_completed_at !== null) {
    return applyReview(problemId, rating, hints, opts)
  }
  const before = snapshotProblem(p)
  const pressure = currentGoalPressure()
  const repetitions = 1
  const srInterval = capIntervalDays(
    Math.max(
      1,
      Math.round(firstInterval(rating) * repetitionMultiplier(repetitions) * pressure),
    ),
  )
  const duringBootstrap = getSetting('bootstrap_active') === '1'
  const today = todayStr()
  const nextAt = scheduleNextReviewAt(problemId, today, srInterval, duringBootstrap)
  const topicBefore = p.is_excluded ? null : snapshotTopicStats(p.topic)

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO review_log (problem_id, reviewed_at, rating, hints, interval_after) VALUES (?, ?, ?, ?, ?)',
    ).run(problemId, nowISO(), rating, hints, srInterval)

    db.prepare(
      `UPDATE problems SET status = 'sr',
        first_completed_at = COALESCE(first_completed_at, ?),
        last_reviewed_at = ?, next_review_at = ?,
        last_rating = ?, last_hints = ?, interval_days = ?, repetitions = ?
       WHERE id = ?`,
    ).run(today, today, nextAt, rating, hints, srInterval, repetitions, problemId)

    if (!p.is_excluded) updateTopicStats(p.topic, rating, hints)
  })
  tx()

  if (opts?.recordUndo !== false) {
    recordUndo({
      problemId,
      wasFirstCompletion: true,
      wasBootstrap: false,
      before,
      assignmentId: null,
      topic: p.topic,
      rating,
      topicBefore,
    })
  }
  return srInterval
}
