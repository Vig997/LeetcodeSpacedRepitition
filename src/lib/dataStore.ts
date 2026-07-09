import { db } from './db'
import { seedIfNeeded } from './seed'
import {
  ensureToday,
  checkAssignment,
  checkAssignmentForProblem,
  dropUncheckedAssignmentsFor,
  reassignUncheckedToday,
  rebuildUncheckedToday,
  getTodayAssignments,
  addExtraReview as insertExtraReview,
  addExtraNew as insertExtraNew,
  removeExtraAssignment as deleteExtraAssignment,
  getTodayLoadSummary,
  buildAssignmentRatingMeta,
  editAssignmentRating as updateAssignmentRating,
  uncheckAssignment as revertAssignmentCheck,
} from './todayAssignments'
import {
  applyReview,
  markDone,
  isBootstrapActive,
  wasBootstrapCompleted,
  startBootstrap as schedulerStartBootstrap,
  cancelBootstrap as schedulerCancelBootstrap,
} from './scheduler'
import { computePacing, goalReachability } from './pacing'
import { computePaceAdvice } from './paceAdvice'
import { getAppSettings, setSetting, getSetting } from './settings'
import { todayStr } from './dates'
import {
  undoLastRating as revertLastRating,
  hasUndo,
  clearUndo,
  setLastUndoAssignmentId,
} from './undo'
import { getDbOpenError } from './db'
import type { AppSettings, Problem, Rating } from './types'
import type { AssignmentWithProblem, TodayLoadSummary } from './todayAssignments'
import type { GoalReachability, PacingResult } from './pacing'
import type { PaceAdvice } from './paceAdvice'

// ---- init on module load (skip if DB failed to open) ----
if (!getDbOpenError()) {
  seedIfNeeded()
  ensureToday()
}

// ---- subscription (all tabs re-render on any mutation) ----
let version = 0
const listeners = new Set<() => void>()

function notify(): void {
  version++
  cache = null
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** useSyncExternalStore version bump (hooks/useProblems). */
export function getVersion(): number {
  return version
}

/**
 * Called on an interval by the UI: when the local calendar day changes while
 * the app is open, run EOD reconcile + fresh assignment and re-render.
 */
export function checkDayRollover(): void {
  if (todayStr() !== cacheDay) {
    clearUndo()
    notify()
  }
}

// ---- snapshot reads ----
export interface Snapshot {
  problems: Problem[]
  assignments: AssignmentWithProblem[]
  /** Actual Today list counts (DB); updates when extras are added or removed. */
  todayLoad: TodayLoadSummary
  pacing: PacingResult
  goal: GoalReachability
  advice: PaceAdvice
  settings: AppSettings
  bootstrapActive: boolean
  bootstrapCompleted: boolean
  bootstrapCompletedOn: string | null
  /** Done Kept problems eligible for a (new) bootstrap pool. */
  bootstrapCandidates: Problem[]
  customTotal: number
  customDone: number
  customEasy: number
  customMedium: number
  customHard: number
  keptEasy: number
  keptMedium: number
  keptHard: number
  /** True when the last rating/mark-done today can be undone (same calendar day). */
  canUndo: boolean
}

let cache: Snapshot | null = null
let cacheDay = todayStr()

export function getSnapshot(): Snapshot {
  // Day rollover check — first read of a new day triggers EOD + fresh assign.
  const day = todayStr()
  if (day !== cacheDay) {
    cacheDay = day
    clearUndo()
    ensureToday()
    cache = null
  }
  if (cache) return cache

  const problems = db
    .prepare('SELECT * FROM problems ORDER BY neetcode_order, id')
    .all() as Problem[]

  const custom = problems.filter((p) => p.is_custom === 1)
  const keptDone = problems.filter(
    (p) => p.is_custom === 0 && p.is_excluded === 0 && p.first_completed_at !== null,
  )

  cache = {
    problems,
    assignments: getTodayAssignments(),
    todayLoad: getTodayLoadSummary(),
    pacing: computePacing(),
    goal: goalReachability(),
    advice: computePaceAdvice(),
    settings: getAppSettings(),
    bootstrapActive: isBootstrapActive(),
    bootstrapCompleted: wasBootstrapCompleted(),
    bootstrapCompletedOn: getSetting('bootstrap_completed_on') || null,
    bootstrapCandidates: problems.filter(
      (p) =>
        p.is_custom === 0 &&
        p.is_excluded === 0 &&
        p.first_completed_at !== null &&
        p.status !== 'bootstrap',
    ),
    customTotal: custom.length,
    customDone: custom.filter((p) => p.first_completed_at !== null).length,
    customEasy: custom.filter(
      (p) => p.first_completed_at !== null && p.difficulty === 'Easy',
    ).length,
    customMedium: custom.filter(
      (p) => p.first_completed_at !== null && p.difficulty === 'Medium',
    ).length,
    customHard: custom.filter(
      (p) => p.first_completed_at !== null && p.difficulty === 'Hard',
    ).length,
    keptEasy: keptDone.filter((p) => p.difficulty === 'Easy').length,
    keptMedium: keptDone.filter((p) => p.difficulty === 'Medium').length,
    keptHard: keptDone.filter((p) => p.difficulty === 'Hard').length,
    canUndo: hasUndo(),
  }
  return cache
}

// ---- mutations ----

/** Rate a due review (Dashboard check or Problems tab Log Review). */
export function rateReview(problemId: number, rating: Rating, hints: number): void {
  const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as Problem
  const meta = buildAssignmentRatingMeta(p, rating, hints)
  applyReview(problemId, rating, hints)
  checkAssignmentForProblem(problemId, meta)
  notify()
}

/** Rate a review from a specific Today row. */
export function rateReviewAssignment(
  assignmentId: number,
  problemId: number,
  rating: Rating,
  hints: number,
): { ok: boolean; message: string } {
  try {
    const today = todayStr()
    const row = db
      .prepare('SELECT * FROM today_assignments WHERE id = ? AND assignment_date = ?')
      .get(assignmentId, today) as { id: number; problem_id: number; checked: number } | undefined
    if (!row) return { ok: false, message: 'Not on Today anymore' }
    if (row.problem_id !== problemId) return { ok: false, message: 'Assignment mismatch' }
    if (row.checked === 1) return { ok: false, message: 'Already checked off' }

    const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as Problem | undefined
    if (!p) return { ok: false, message: 'Problem no longer exists' }

    const meta = buildAssignmentRatingMeta(p, rating, hints)
    applyReview(problemId, rating, hints)
    checkAssignment(assignmentId, meta)
    setLastUndoAssignmentId(assignmentId)

    const after = db
      .prepare('SELECT checked FROM today_assignments WHERE id = ?')
      .get(assignmentId) as { checked: number } | undefined
    if (!after || after.checked !== 1) {
      return { ok: false, message: 'Could not check off — try again' }
    }

    notify()
    return { ok: true, message: 'Review saved' }
  } catch {
    return { ok: false, message: 'Could not save rating — try again' }
  }
}

/** First completion (Today · New check or Problems tab Mark Done). */
export function completeProblem(problemId: number, rating: Rating, hints: number): void {
  const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as Problem
  const meta = buildAssignmentRatingMeta(p, rating, hints)
  markDone(problemId, rating, hints)
  checkAssignmentForProblem(problemId, meta)
  notify()
}

export function completeProblemAssignment(
  assignmentId: number,
  problemId: number,
  rating: Rating,
  hints: number,
): { ok: boolean; message: string } {
  try {
    const today = todayStr()
    const row = db
      .prepare('SELECT * FROM today_assignments WHERE id = ? AND assignment_date = ?')
      .get(assignmentId, today) as { id: number; problem_id: number; checked: number } | undefined
    if (!row) return { ok: false, message: 'Not on Today anymore' }
    if (row.problem_id !== problemId) return { ok: false, message: 'Assignment mismatch' }
    if (row.checked === 1) return { ok: false, message: 'Already checked off' }

    const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as Problem | undefined
    if (!p) return { ok: false, message: 'Problem no longer exists' }

    const meta = buildAssignmentRatingMeta(p, rating, hints)
    markDone(problemId, rating, hints)
    checkAssignment(assignmentId, meta)
    setLastUndoAssignmentId(assignmentId)

    const after = db
      .prepare('SELECT checked FROM today_assignments WHERE id = ?')
      .get(assignmentId) as { checked: number } | undefined
    if (!after || after.checked !== 1) {
      return { ok: false, message: 'Could not check off — try again' }
    }

    notify()
    return { ok: true, message: 'Marked done' }
  } catch {
    return { ok: false, message: 'Could not save rating — try again' }
  }
}

/** Update rating + hints for a completed Today assignment (same calendar day). */
export function editAssignmentRating(
  assignmentId: number,
  rating: Rating,
  hints: number,
): { ok: boolean; message: string } {
  const result = updateAssignmentRating(assignmentId, rating, hints)
  if (result.ok) notify()
  return result
}

/** Revert a completed Today assignment to unchecked (same calendar day). */
export function uncheckAssignment(assignmentId: number): { ok: boolean; message: string } {
  const result = revertAssignmentCheck(assignmentId)
  if (result.ok) notify()
  return result
}

/** Undo the most recent rating / mark-done (same calendar day). */
export function undoLastRating(): { ok: boolean; message: string } {
  const result = revertLastRating()
  if (result.ok) notify()
  return result
}

/** Same-day extra review slot (bypasses daily review cap; resets next calendar day). */
export function addExtraReview(): { ok: boolean; message: string } {
  const result = insertExtraReview()
  if (result.ok) notify()
  return result
}

/** Same-day extra new slot (bypasses day-lock + new/day cap; resets next calendar day). */
export function addExtraNew(): { ok: boolean; message: string } {
  const result = insertExtraNew()
  if (result.ok) notify()
  return result
}

/** Remove an unchecked extra the user added today (+ Extra review/new only). */
export function removeExtraAssignment(assignmentId: number): { ok: boolean; message: string } {
  const result = deleteExtraAssignment(assignmentId)
  if (result.ok) notify()
  return result
}

/** Removed → Kept. Ring denominator updates immediately; SR resumes from last state. */
export function reEnableProblem(problemId: number): void {
  clearUndo()
  db.prepare('UPDATE problems SET is_excluded = 0 WHERE id = ?').run(problemId)
  notify()
}

/** Kept → Removed. Leaves history; drops any unchecked Today rows. */
export function moveToRemoved(problemId: number): void {
  clearUndo()
  db.prepare('UPDATE problems SET is_excluded = 1 WHERE id = ?').run(problemId)
  dropUncheckedAssignmentsFor(problemId)
  notify()
}

/** Add a problem; matching LeetCode ID on a Removed row re-enables it, else bonus custom. */
export function addProblem(input: {
  title: string
  slug: string
  difficulty: string
  topic: string
  url?: string
}): { added: boolean; message: string } {
  const slug = input.slug.trim().toLowerCase()
  const existing = db
    .prepare('SELECT * FROM problems WHERE slug = ?')
    .get(slug) as Problem | undefined

  if (existing) {
    if (existing.is_excluded === 1) {
      clearUndo()
      db.prepare('UPDATE problems SET is_excluded = 0 WHERE id = ?').run(existing.id)
      notify()
      return { added: true, message: `"${existing.title}" was Removed — re-enabled to Kept.` }
    }
    return { added: false, message: `"${existing.title}" already exists in Kept.` }
  }

  clearUndo()
  db.prepare(
    `INSERT INTO problems (leetcode_id, slug, title, difficulty, topic, neetcode_order, is_custom, is_excluded, url, status)
     VALUES (NULL, ?, ?, ?, ?, NULL, 1, 0, ?, 'undone')`,
  ).run(
    slug,
    input.title.trim(),
    input.difficulty,
    input.topic,
    input.url?.trim() || `https://leetcode.com/problems/${slug}/`,
  )
  notify()
  return { added: true, message: 'Custom problem added (bonus ring).' }
}

/** Persist a pacing setting; re-assigns only unchecked Today slots. stress-test only — UI uses saveSettings. */
export function updateSetting(
  key: keyof AppSettings,
  value: number | string,
): void {
  setSetting(key, value)
  reassignUncheckedToday()
  notify()
}

/** Apply all Settings-tab draft values in one transaction. */
export function saveSettings(settings: AppSettings): void {
  const current = getAppSettings()
  let changed = false
  for (const key of Object.keys(settings) as (keyof AppSettings)[]) {
    if (settings[key] !== current[key]) {
      setSetting(key, settings[key])
      changed = true
    }
  }
  if (changed) {
    reassignUncheckedToday()
    notify()
  }
}

/**
 * User-initiated bootstrap: selected done Kept problems get staggered
 * baseline reviews at `dailyCap`/day; optional `newPerDay` during bootstrap.
 */
export function startBootstrap(
  problemIds: number[],
  dailyCap: number,
  newPerDay = 0,
): void {
  clearUndo()
  schedulerStartBootstrap(problemIds, dailyCap, newPerDay)
  rebuildUncheckedToday()
  notify()
}

/** Abort an active bootstrap — remaining pool returns to normal SR. */
export function cancelBootstrap(): void {
  clearUndo()
  schedulerCancelBootstrap()
  rebuildUncheckedToday()
  notify()
}

/** Live preview for Settings sliders (no persistence). */
export function previewGoal(overrides: Partial<AppSettings>): GoalReachability {
  return goalReachability(overrides)
}
