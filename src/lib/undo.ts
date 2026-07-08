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

export interface UndoEntry {
  problemId: number
  /** True when this rating was the first completion (Mark Done / Today · New). */
  wasFirstCompletion: boolean
  /** True when the problem was in the bootstrap pool before this rating. */
  wasBootstrap: boolean
  before: ProblemUndoSnapshot
  assignmentId: number | null
  topic: string
  rating: Rating
}

let lastUndo: UndoEntry | null = null

export function clearUndo(): void {
  lastUndo = null
}

export function hasUndo(): boolean {
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

export function recordUndo(entry: UndoEntry): void {
  lastUndo = entry
}

/** Attach the Today assignment id after checkAssignment (Dashboard path). */
export function setLastUndoAssignmentId(assignmentId: number): void {
  if (lastUndo) lastUndo.assignmentId = assignmentId
}

/**
 * Revert the most recent rating / mark-done in this session.
 * Restores problem fields, deletes the last review_log row, unchecks Today
 * assignment if it was checked by that action, and rolls topic_stats back one step.
 */
export function undoLastRating(): { ok: boolean; message: string } {
  if (!lastUndo) {
    return { ok: false, message: 'Nothing to undo' }
  }
  const entry = lastUndo
  lastUndo = null

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

    // If this rating emptied the bootstrap pool, restore active flags.
    if (entry.wasBootstrap && getSetting('bootstrap_active') !== '1') {
      setSetting('bootstrap_active', '1')
      setSetting('bootstrap_complete', '0')
    }

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
  })
  tx()

  return { ok: true, message: 'Last rating undone' }
}
