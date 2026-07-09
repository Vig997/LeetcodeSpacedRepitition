import { db } from './db'
import { todayStr } from './dates'
import { getSetting, setSetting } from './settings'
import type { Problem, Rating, Status } from './types'

/** Snapshot of problem SR fields before a rating mutation. */
export interface ProblemUndoSnapshot {
  status: Status
  first_completed_at: string | null
  last_reviewed_at: string | null
  next_review_at: string | null
  last_rating: Rating | null
  last_hints: number
  ease: number
  interval_days: number
  repetitions: number
}

export interface TopicStatsUndoSnapshot {
  last_visited_at: string | null
  visit_count: number
  struggle_score: number
  easy_count: number
  medium_count: number
  hard_count: number
  forgot_count: number
}

export interface UndoEntry {
  problemId: number
  /** True when this rating was the first completion (Mark Done / Today · New). */
  wasFirstCompletion: boolean
  /** True when the problem was in the bootstrap pool before this rating. */
  wasBootstrap: boolean
  before: ProblemUndoSnapshot
  /** Topic stats before the rating (null if problem was excluded / no stats row). */
  topicBefore: TopicStatsUndoSnapshot | null
  assignmentId: number | null
  topic: string
  rating: Rating
  /** Calendar day the undo was recorded (YYYY-MM-DD). */
  day: string
}

const UNDO_KEY = 'last_undo_json'

let lastUndo: UndoEntry | null = null
let hydrated = false

function persist(): void {
  if (lastUndo) setSetting(UNDO_KEY, JSON.stringify(lastUndo))
  else setSetting(UNDO_KEY, '')
}

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  const raw = getSetting(UNDO_KEY)
  if (!raw) return
  try {
    const entry = JSON.parse(raw) as Partial<UndoEntry>
    if (entry && entry.day === todayStr() && typeof entry.problemId === 'number') {
      // Older persisted undos may lack topicBefore — still allow problem rollback.
      lastUndo = {
        ...(entry as UndoEntry),
        topicBefore: entry.topicBefore ?? null,
      }
    } else {
      setSetting(UNDO_KEY, '')
    }
  } catch {
    setSetting(UNDO_KEY, '')
  }
}

export function clearUndo(): void {
  hydrate()
  lastUndo = null
  persist()
}

export function hasUndo(): boolean {
  hydrate()
  if (lastUndo && lastUndo.day !== todayStr()) {
    lastUndo = null
    persist()
  }
  return lastUndo !== null
}

export function snapshotProblem(p: Problem): ProblemUndoSnapshot {
  return {
    status: p.status,
    first_completed_at: p.first_completed_at,
    last_reviewed_at: p.last_reviewed_at,
    next_review_at: p.next_review_at,
    last_rating: p.last_rating,
    last_hints: p.last_hints,
    ease: p.ease,
    interval_days: p.interval_days,
    repetitions: p.repetitions,
  }
}

export function snapshotTopicStats(topic: string): TopicStatsUndoSnapshot | null {
  const row = db
    .prepare('SELECT * FROM topic_stats WHERE topic = ?')
    .get(topic) as TopicStatsUndoSnapshot | undefined
  if (!row) return null
  return {
    last_visited_at: row.last_visited_at,
    visit_count: row.visit_count,
    struggle_score: row.struggle_score,
    easy_count: row.easy_count,
    medium_count: row.medium_count,
    hard_count: row.hard_count,
    forgot_count: row.forgot_count,
  }
}

export function recordUndo(entry: Omit<UndoEntry, 'day'>): void {
  hydrate()
  lastUndo = { ...entry, day: todayStr() }
  persist()
}

/** Same-day undo snapshot for a specific Today row (if it was the last rated action). */
export function undoMetaForAssignment(
  assignmentId: number,
): Pick<UndoEntry, 'before' | 'topicBefore' | 'wasFirstCompletion' | 'wasBootstrap'> | null {
  hydrate()
  if (!lastUndo || lastUndo.day !== todayStr() || lastUndo.assignmentId !== assignmentId) {
    return null
  }
  return {
    before: lastUndo.before,
    topicBefore: lastUndo.topicBefore,
    wasFirstCompletion: lastUndo.wasFirstCompletion,
    wasBootstrap: lastUndo.wasBootstrap,
  }
}

/** Attach the Today assignment id after checkAssignment (Dashboard path). */
export function setLastUndoAssignmentId(assignmentId: number): void {
  hydrate()
  if (lastUndo) {
    lastUndo.assignmentId = assignmentId
    persist()
  }
}

/**
 * Revert the most recent rating / mark-done (same calendar day, survives restart).
 * Restores problem fields, deletes the last review_log row, unchecks Today
 * assignment if it was checked by that action, and restores topic_stats.
 */
export function undoLastRating(): { ok: boolean; message: string } {
  hydrate()
  if (!lastUndo || lastUndo.day !== todayStr()) {
    lastUndo = null
    persist()
    return { ok: false, message: 'Nothing to undo' }
  }
  const entry = lastUndo
  lastUndo = null
  persist()

  const p = db
    .prepare('SELECT * FROM problems WHERE id = ?')
    .get(entry.problemId) as Problem | undefined
  if (!p) {
    return { ok: false, message: 'Problem no longer exists' }
  }

  const lastLog = db
    .prepare(
      'SELECT id FROM review_log WHERE problem_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(entry.problemId) as { id: number } | undefined
  if (!lastLog) {
    return { ok: false, message: 'No review log to undo' }
  }

  const b = entry.before
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM review_log WHERE id = ?').run(lastLog.id)

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
      entry.problemId,
    )

    if (entry.assignmentId !== null) {
      db.prepare(
        'UPDATE today_assignments SET checked = 0, rated_at = NULL WHERE id = ?',
      ).run(entry.assignmentId)
    } else {
      db.prepare(
        `UPDATE today_assignments SET checked = 0, rated_at = NULL
         WHERE assignment_date = ? AND problem_id = ? AND checked = 1`,
      ).run(todayStr(), entry.problemId)
    }

    if (entry.wasBootstrap && getSetting('bootstrap_active') !== '1') {
      setSetting('bootstrap_active', '1')
      setSetting('bootstrap_complete', '0')
    }

    if (entry.topicBefore) {
      const t = entry.topicBefore
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
        entry.topic,
      )
    } else {
      // Legacy undo without topic snapshot — decrement counts only.
      const col =
        entry.rating === 'easy'
          ? 'easy_count'
          : entry.rating === 'medium'
            ? 'medium_count'
            : entry.rating === 'hard'
              ? 'hard_count'
              : 'forgot_count'
      db.prepare(
        `UPDATE topic_stats SET
          visit_count = MAX(visit_count - 1, 0),
          ${col} = MAX(${col} - 1, 0)
         WHERE topic = ?`,
      ).run(entry.topic)
    }
  })
  tx()

  return { ok: true, message: 'Last rating undone' }
}
