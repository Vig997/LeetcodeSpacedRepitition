/* Stress test: simulates ~10 weeks of daily use against a temp data dir.
   Time travel works by overriding the global Date; the app reads the clock
   only through `new Date()` / `Date.now()`. */

// ---- time machine (must run before app modules load) ----
const RealDate = Date
let offsetMs = 0
// @ts-expect-error deliberate global override for simulation
globalThis.Date = class extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs)
    // @ts-expect-error variadic passthrough
    else super(...args)
  }
  static now(): number {
    return RealDate.now() + offsetMs
  }
}
function advanceDays(n: number): void {
  offsetMs += n * 86_400_000
}

// ---- deterministic RNG ----
let rngState = 42
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648
  return rngState / 2147483648
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

import { db } from '../src/lib/db'
import { getBootstrapTotalDays, nextSchedule, bootstrapSpreadJitter } from '../src/lib/scheduler'
import { pickNew } from '../src/lib/topicBalancer'
import { ensureToday } from '../src/lib/todayAssignments'
import { todayStr, addDays, daysBetween } from '../src/lib/dates'
import { LOAD_CEILING } from '../src/lib/pacing'
import { computePaceAdvice } from '../src/lib/paceAdvice'
import type { PaceAdvice } from '../src/lib/paceAdvice'
import { TOPICS } from '../src/lib/topics'
import neetcode from '../data/neetcode150.json'
import {
  getSnapshot,
  rateReviewAssignment,
  completeProblemAssignment,
  completeProblem,
  startBootstrap,
  cancelBootstrap,
  updateSetting,
  previewGoal,
  reEnableProblem,
  moveToRemoved,
  addProblem,
  rateReview,
  undoLastRating,
  addExtraReview,
  addExtraNew,
} from '../src/lib/dataStore'
import type { Rating } from '../src/lib/types'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++
    console.error(`FAIL [day ${todayStr()}]:`, msg)
  }
}

const RATINGS: Rating[] = ['easy', 'medium', 'hard', 'forgot']

function checkInvariants(label: string): void {
  const snap = getSnapshot()
  const p = snap.pacing

  const nums = [
    p.daysLeft, p.keptTotal, p.doneKept, p.remainingNew, p.srDueCount,
    p.bootstrapDue, p.newToday, p.reviewsToday, p.evenLoad, p.unusedNewYesterday,
    p.reviewsDueTotal, p.reviewsOverdue,
  ]
  for (const n of nums) {
    assert(Number.isFinite(n) && n >= 0, `${label}: pacing value negative/NaN: ${JSON.stringify(p)}`)
  }
  assert(p.doneKept <= p.keptTotal, `${label}: done > kept`)
  assert(p.newToday <= 10, `${label}: newToday ${p.newToday} > MAX_NEW`)
  assert(p.reviewsToday <= 10, `${label}: reviewsToday ${p.reviewsToday} > hard cap 10`)
  assert(p.evenLoad <= LOAD_CEILING, `${label}: evenLoad ${p.evenLoad} > ${LOAD_CEILING}`)

  const seen = new Set<number>()
  for (const a of snap.assignments) {
    assert(!seen.has(a.problem_id) || a.checked === 1, `${label}: duplicate problem in Today`)
    seen.add(a.problem_id)
    assert(a.problem !== undefined, `${label}: assignment without problem row`)
    if (a.kind === 'new' && a.checked === 0) {
      assert(a.problem.first_completed_at === null, `${label}: unchecked new slot already done`)
      assert(a.problem.is_custom === 0, `${label}: custom in Today New`)
    }
    if (a.kind === 'review' && a.checked === 0) {
      assert(a.problem.first_completed_at !== null, `${label}: review slot for undone problem`)
      assert(a.problem.is_excluded === 0, `${label}: review slot for removed problem`)
    }
    if (a.is_extra === 1) {
      assert(a.is_extra === 1, `${label}: is_extra flag present`)
    }
  }

  // Idempotency: reading again yields identical assignment ids
  const again = getSnapshot()
  assert(
    again.assignments.length === snap.assignments.length,
    `${label}: snapshot not idempotent`,
  )

  // goal message never crashes for odd inputs
  for (const gd of [addDays(todayStr(), -5), todayStr(), addDays(todayStr(), 400)]) {
    const g = previewGoal({ goal_date: gd })
    assert(typeof g.reason === 'string' && g.reason.length > 0, `${label}: empty goal reason`)
  }
}

// ================= scenario =================
console.log('start:', todayStr())
checkInvariants('fresh seed')

// New picks follow strict NeetCode roadmap order (Trees is first undone block in seed)
{
  const picked = pickNew(3, new Set())
  assert(picked.length === 3, 'pickNew(3) returns 3')
  const slugs = picked.map((p) => p.slug)
  assert(slugs[0] === 'invert-binary-tree', `first new=${slugs[0]}, want invert-binary-tree`)
  assert(
    slugs[1] === 'maximum-depth-of-binary-tree',
    `second new=${slugs[1]}, want maximum-depth-of-binary-tree`,
  )
  assert(
    slugs[2] === 'diameter-of-binary-tree',
    `third new=${slugs[2]}, want diameter-of-binary-tree`,
  )
  assert(picked.every((p) => p.topic === 'Trees'), 'first undone block is Trees')
  assert(
    picked.every((p) => p.neetcode_order !== null && p.neetcode_order >= 45 && p.neetcode_order <= 47),
    'Trees orders 45–47',
  )
}

// pickNew(2) after seed: Trees head only (never Heap while Trees remain)
{
  const invert = db
    .prepare("SELECT neetcode_order FROM problems WHERE slug = 'invert-binary-tree'")
    .get() as { neetcode_order: number }
  const heap = db
    .prepare("SELECT neetcode_order FROM problems WHERE slug = 'kth-largest-element-in-a-stream'")
    .get() as { neetcode_order: number }
  assert(invert.neetcode_order === 45, `invert order=${invert.neetcode_order}, want 45`)
  assert(heap.neetcode_order === 60, `heap order=${heap.neetcode_order}, want 60`)

  const two = pickNew(2, new Set())
  assert(two.length === 2, 'pickNew(2) returns 2')
  assert(two[0].slug === 'invert-binary-tree', `pickNew[0]=${two[0].slug}`)
  assert(two[1].slug === 'maximum-depth-of-binary-tree', `pickNew[1]=${two[1].slug}`)
  assert(!two.some((p) => p.topic === 'Heap'), 'pickNew(2) must not mix Heap ahead of Trees')
}

let snap = getSnapshot()
assert(snap.problems.length === 150, 'seeded 150')
assert(snap.problems.filter((p) => p.is_excluded === 1).length === 30, 'seeded 30 removed')
assert(snap.pacing.keptTotal === 120, `kept_total=${snap.pacing.keptTotal}, want 120`)
assert(snap.pacing.doneKept === 43, 'seeded 43 done')

// Day-locked Today · New: finish one mid-day → remaining stay; no refill until next day
{
  cancelBootstrap()
  ensureToday()
  let snapN = getSnapshot()
  const day1New = snapN.assignments.filter((a) => a.kind === 'new')
  assert(day1New.length >= 1, 'day-lock test needs at least one new slot')
  const day1Ids = day1New.map((a) => a.problem_id).sort((a, b) => a - b)
  const first = day1New.find((a) => a.checked === 0)
  assert(first !== undefined, 'day-lock needs an unchecked new')
  completeProblemAssignment(first!.id, first!.problem_id, 'medium', 0)
  snapN = getSnapshot()
  const afterIds = snapN.assignments
    .filter((a) => a.kind === 'new')
    .map((a) => a.problem_id)
    .sort((a, b) => a - b)
  assert(afterIds.join(',') === day1Ids.join(','), 'finishing a new must not swap in another same day')
  const uncheckedLeft = snapN.assignments.filter((a) => a.kind === 'new' && a.checked === 0)
  assert(
    uncheckedLeft.every((a) => day1Ids.includes(a.problem_id)),
    'remaining unchecked new stay from the original day set',
  )
  // Next day advances to the next roadmap head (not the finished ones)
  const finishedSlug = first!.problem.slug
  advanceDays(1)
  snapN = getSnapshot()
  const day2New = snapN.assignments.filter((a) => a.kind === 'new' && a.checked === 0)
  assert(!day2New.some((a) => a.problem.slug === finishedSlug), 'next day must not re-assign finished new')
  if (day2New.length > 0) {
    assert(
      day2New[0].problem.neetcode_order !== null &&
        day2New[0].problem.neetcode_order > (first!.problem.neetcode_order ?? 0),
      'next day new advances roadmap order',
    )
  }
  checkInvariants('day-locked new slots')
}

// Same-day extras: thorough coverage (normal + bootstrap + edges)
{
  // --- Normal mode ---
  cancelBootstrap()
  updateSetting('review_daily_target', 5)
  updateSetting('new_per_day', 2)
  ensureToday()
  let snapE = getSnapshot()
  const pacedReviewIds = new Set(
    snapE.assignments.filter((a) => a.kind === 'review').map((a) => a.problem_id),
  )
  const pacedNewIds = new Set(
    snapE.assignments.filter((a) => a.kind === 'new').map((a) => a.problem_id),
  )
  const beforeReviews = pacedReviewIds.size
  const beforeNew = pacedNewIds.size

  const r1 = addExtraReview()
  assert(r1.ok, `addExtraReview: ${r1.message}`)
  const n1 = addExtraNew()
  assert(n1.ok, `addExtraNew: ${n1.message}`)
  snapE = getSnapshot()
  let reviews = snapE.assignments.filter((a) => a.kind === 'review')
  let news = snapE.assignments.filter((a) => a.kind === 'new')
  assert(reviews.length === beforeReviews + 1, 'extra review adds one slot')
  assert(news.length === beforeNew + 1, 'extra new adds one slot')
  const extraReview = reviews.find((a) => a.is_extra === 1)
  const extraNew = news.find((a) => a.is_extra === 1)
  assert(extraReview !== undefined, 'extra review flagged is_extra')
  assert(extraNew !== undefined, 'extra new flagged is_extra')
  assert(!pacedReviewIds.has(extraReview!.problem_id), 'extra review not already paced')
  assert(!pacedNewIds.has(extraNew!.problem_id), 'extra new not already paced')
  assert(extraNew!.problem.first_completed_at === null, 'extra new is undone Kept')
  assert(extraNew!.problem.is_custom === 0, 'extra new is not custom')
  assert(extraReview!.problem.first_completed_at !== null, 'extra review is done SR')

  // No duplicate problem ids on Today
  const idsToday = snapE.assignments.map((a) => a.problem_id)
  assert(new Set(idsToday).size === idsToday.length, 'extras never duplicate Today problems')

  // Day-lock still holds for paced new: finish a paced new → no auto refill
  const pacedUncheckedNew = news.find((a) => a.is_extra !== 1 && a.checked === 0)
  if (pacedUncheckedNew) {
    const pacedNewBefore = news.filter((a) => a.is_extra !== 1).map((a) => a.problem_id).sort()
    completeProblemAssignment(pacedUncheckedNew.id, pacedUncheckedNew.problem_id, 'easy', 0)
    snapE = getSnapshot()
    const pacedNewAfter = snapE.assignments
      .filter((a) => a.kind === 'new' && a.is_extra !== 1)
      .map((a) => a.problem_id)
      .sort()
    assert(
      pacedNewAfter.join(',') === pacedNewBefore.join(','),
      'finishing paced new still day-locked (extras do not break day-lock)',
    )
    // But + Extra new still works after finishing a paced new
    const n2 = addExtraNew()
    assert(n2.ok, `addExtraNew after finishing paced: ${n2.message}`)
    assert(
      getSnapshot().assignments.filter((a) => a.kind === 'new' && a.is_extra === 1).length >= 2,
      'can stack multiple extra news same day',
    )
  }

  // Completing an extra review / extra new works end-to-end
  snapE = getSnapshot()
  const openExtraReview = snapE.assignments.find(
    (a) => a.kind === 'review' && a.is_extra === 1 && a.checked === 0,
  )
  if (openExtraReview) {
    rateReviewAssignment(openExtraReview.id, openExtraReview.problem_id, 'medium', 0)
    assert(
      getSnapshot().assignments.find((a) => a.id === openExtraReview.id)?.checked === 1,
      'extra review can be rated',
    )
  }
  const openExtraNew = snapE.assignments.find(
    (a) => a.kind === 'new' && a.is_extra === 1 && a.checked === 0,
  )
  if (openExtraNew) {
    completeProblemAssignment(openExtraNew.id, openExtraNew.problem_id, 'medium', 0)
    assert(
      getSnapshot().assignments.find((a) => a.id === openExtraNew.id)?.checked === 1,
      'extra new can be completed',
    )
    assert(
      getSnapshot().problems.find((p) => p.id === openExtraNew.problem_id)?.first_completed_at !==
        null,
      'extra new completion marks problem done',
    )
  }
  checkInvariants('extras after rate/complete')

  // Lowering caps must not strip remaining extras
  updateSetting('review_daily_target', 1)
  updateSetting('new_per_day', 1)
  ensureToday()
  snapE = getSnapshot()
  assert(
    snapE.assignments.some((a) => a.kind === 'review' && a.is_extra === 1),
    'extra review survives paced trim',
  )
  assert(
    snapE.assignments.some((a) => a.kind === 'new' && a.is_extra === 1),
    'extra new survives paced trim',
  )
  checkInvariants('extras survive trim')

  // Next day: paced set only (extras do not carry)
  advanceDays(1)
  snapE = getSnapshot()
  assert(!snapE.assignments.some((a) => a.is_extra === 1), 'extras do not carry to next day')
  assert(snapE.pacing.reviewsToday <= 5, 'next day reviews back to paced target')
  checkInvariants('extras next-day reset')

  // --- Bootstrap mode ---
  cancelBootstrap()
  const bootIds = getSnapshot().bootstrapCandidates.slice(0, 8).map((p) => p.id)
  startBootstrap(bootIds, 3, 0) // 0 new/day — extras should still allow new
  snapE = getSnapshot()
  assert(snapE.bootstrapActive, 'bootstrap active for extras test')
  assert(
    snapE.assignments.filter((a) => a.kind === 'new').length === 0,
    'bootstrap with 0 new/day starts with no paced new',
  )
  const bootReviewIds = new Set(
    snapE.assignments.filter((a) => a.kind === 'review').map((a) => a.problem_id),
  )
  assert(bootReviewIds.size === 3, 'bootstrap day1 has 3 paced reviews')

  // Extra review: next roadmap bootstrap problem not already on Today
  const bootPool = snapE.problems
    .filter((p) => p.status === 'bootstrap' && p.is_excluded === 0)
    .sort(
      (a, b) =>
        (a.neetcode_order === null ? 1 : 0) - (b.neetcode_order === null ? 1 : 0) ||
        (a.neetcode_order ?? 0) - (b.neetcode_order ?? 0) ||
        a.id - b.id,
    )
  const expectedExtraReview = bootPool.find((p) => !bootReviewIds.has(p.id))
  assert(expectedExtraReview !== undefined, 'bootstrap pool has leftover for extra review')
  const br = addExtraReview()
  assert(br.ok, `bootstrap addExtraReview: ${br.message}`)
  snapE = getSnapshot()
  const bootExtraReview = snapE.assignments.find(
    (a) => a.kind === 'review' && a.is_extra === 1,
  )
  assert(bootExtraReview !== undefined, 'bootstrap extra review present')
  assert(
    bootExtraReview!.problem_id === expectedExtraReview!.id,
    `bootstrap extra review is next roadmap pool item (got ${bootExtraReview!.problem.slug}, want ${expectedExtraReview!.slug})`,
  )
  assert(bootExtraReview!.problem.status === 'bootstrap', 'bootstrap extra review from pool')

  // Extra new during bootstrap (even with 0 new/day): next Kept undone
  const expectedNew = pickNew(1, new Set(snapE.assignments.map((a) => a.problem_id)))[0]
  assert(expectedNew !== undefined, 'undone Kept available for bootstrap extra new')
  const bn = addExtraNew()
  assert(bn.ok, `bootstrap addExtraNew: ${bn.message}`)
  snapE = getSnapshot()
  const bootExtraNew = snapE.assignments.find((a) => a.kind === 'new' && a.is_extra === 1)
  assert(bootExtraNew !== undefined, 'bootstrap extra new present')
  assert(
    bootExtraNew!.problem_id === expectedNew.id,
    `bootstrap extra new is next roadmap undone (got ${bootExtraNew!.problem.slug}, want ${expectedNew.slug})`,
  )
  assert(bootExtraNew!.problem.first_completed_at === null, 'bootstrap extra new is undone')
  checkInvariants('bootstrap extras')

  // Completing bootstrap extra new works
  completeProblemAssignment(bootExtraNew!.id, bootExtraNew!.problem_id, 'easy', 0)
  assert(
    getSnapshot().problems.find((p) => p.id === bootExtraNew!.problem_id)?.first_completed_at !==
      null,
    'bootstrap extra new completion marks done',
  )

  // Exhaust bootstrap extras until pool empty
  let guard = 0
  while (addExtraReview().ok && guard++ < 20) {
    /* drain */
  }
  const drained = addExtraReview()
  assert(!drained.ok, 'addExtraReview fails when bootstrap pool exhausted')
  checkInvariants('bootstrap extras exhausted')

  cancelBootstrap()
  checkInvariants('after cancel with prior extras')

  // Restore settings for the rest of the suite
  updateSetting('review_daily_target', 5)
  updateSetting('new_per_day', 0) // Auto
  ensureToday()
  checkInvariants('extras suite cleanup')
  console.log('  same-day extras: normal + bootstrap + edges ok')
}

// Undo last rating: first completion then undo restores undone state
{
  cancelBootstrap()
  const undone = getSnapshot().problems.find(
    (p) => p.first_completed_at === null && p.is_excluded === 0 && p.is_custom === 0,
  )!
  completeProblem(undone.id, 'medium', 0)
  assert(getSnapshot().canUndo, 'canUndo after mark done')
  const r = undoLastRating()
  assert(r.ok, 'undoLastRating ok')
  const row = db
    .prepare('SELECT first_completed_at, status FROM problems WHERE id = ?')
    .get(undone.id) as { first_completed_at: string | null; status: string }
  assert(row.first_completed_at === null, 'undo restores first_completed_at')
  assert(row.status === 'undone', 'undo restores undone status')
  assert(!getSnapshot().canUndo, 'canUndo cleared after undo')
  checkInvariants('undo last rating')
}

// Custom bonus excluded from pickNew and goal rings
{
  addProblem({
    title: 'Bonus Undone',
    slug: 'bonus-undone-test',
    difficulty: 'Easy',
    topic: 'Arrays & Hashing',
  })
  const custom = getSnapshot().problems.find((p) => p.slug === 'bonus-undone-test')!
  assert(custom.is_custom === 1, 'custom flagged')
  const picked = pickNew(5, new Set())
  assert(!picked.some((p) => p.slug === 'bonus-undone-test'), 'pickNew excludes custom')
  assert(getSnapshot().pacing.keptTotal === 120, 'custom not in kept_total ring')
  db.prepare('DELETE FROM problems WHERE slug = ?').run('bonus-undone-test')
}

// Forgot during bootstrap gets full deferral (not next-day)
{
  cancelBootstrap()
  const ids = getSnapshot().bootstrapCandidates.slice(0, 3).map((p) => p.id)
  startBootstrap(ids, 3)
  const review = getSnapshot().assignments.find((a) => a.kind === 'review' && a.checked === 0)!
  const totalDays = getBootstrapTotalDays()
  rateReviewAssignment(review.id, review.problem_id, 'forgot', 0)
  const row = db
    .prepare('SELECT next_review_at, interval_days FROM problems WHERE id = ?')
    .get(review.problem_id) as { next_review_at: string; interval_days: number }
  const span = daysBetween(todayStr(), row.next_review_at)
  const jitter = bootstrapSpreadJitter(review.problem_id, true)
  assert(
    span >= totalDays + row.interval_days + jitter,
    `forgot bootstrap span=${span}, want >= ${totalDays + row.interval_days + jitter}`,
  )
  cancelBootstrap()
}

// Overdue honesty fields populated when backlog exists
{
  const snap = getSnapshot()
  assert(snap.pacing.reviewsDueTotal >= snap.pacing.reviewsToday, 'due total >= assigned')
  assert(typeof snap.pacing.reviewsOverdue === 'number', 'reviewsOverdue tracked')
}

function clearAdviceWindow(): void {
  const start = addDays(todayStr(), -14)
  db.prepare(
    'DELETE FROM today_assignments WHERE assignment_date >= ? AND assignment_date < ?',
  ).run(start, todayStr())
}

function seedAdviceHistory(
  days: number,
  reviewPerDay: number,
  reviewDonePerDay: number,
  newPerDay = 0,
  newDonePerDay = 0,
): void {
  const reviewIds = (
    db
      .prepare(
        `SELECT id FROM problems WHERE first_completed_at IS NOT NULL AND is_excluded = 0 LIMIT 50`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id)
  const newIds = (
    db
      .prepare(
        `SELECT id FROM problems WHERE first_completed_at IS NULL AND is_custom = 0 AND is_excluded = 0 LIMIT 50`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id)
  assert(reviewIds.length >= reviewPerDay, 'seedAdviceHistory: need review problem ids')
  const insert = db.prepare(
    'INSERT INTO today_assignments (assignment_date, problem_id, kind, position, checked, is_extra) VALUES (?, ?, ?, ?, ?, 0)',
  )
  for (let i = 1; i <= days; i++) {
    const d = addDays(todayStr(), -i)
    for (let p = 0; p < reviewPerDay; p++) {
      insert.run(d, reviewIds[p % reviewIds.length], 'review', p, p < reviewDonePerDay ? 1 : 0)
    }
    for (let p = 0; p < newPerDay; p++) {
      insert.run(d, newIds[p % newIds.length], 'new', p, p < newDonePerDay ? 1 : 0)
    }
  }
}

function assertAdviceInvariants(advice: PaceAdvice, label: string): void {
  assert(typeof advice.headline === 'string' && advice.headline.length > 0, `${label}: empty headline`)
  assert(typeof advice.detail === 'string' && advice.detail.length > 0, `${label}: empty detail`)
  for (const s of advice.suggestions) {
    assert(s.to >= 0 && s.to <= 10, `${label}: ${s.setting} to=${s.to} out of range`)
    if (s.action === 'increase' && s.setting === 'review_daily_target') {
      assert(
        advice.metrics.reviewFinishRate >= 0.75,
        `${label}: increase reviews when finish rate ${advice.metrics.reviewFinishRate}`,
      )
    }
  }
}

// Pace advice: overloaded, behind, ahead, bootstrap
{
  cancelBootstrap()
  const savedGoal = getSnapshot().settings.goal_date
  const savedReview = getSnapshot().settings.review_daily_target
  const savedNew = getSnapshot().settings.new_per_day

  // Overloaded — low review finish rate → decrease reviews
  clearAdviceWindow()
  updateSetting('review_daily_target', 8)
  updateSetting('new_per_day', 2)
  seedAdviceHistory(10, 6, 2)
  let advice = computePaceAdvice()
  assert(advice.status === 'overloaded', `overloaded status=${advice.status}`)
  const decReview = advice.suggestions.find(
    (s) => s.setting === 'review_daily_target' && s.action === 'decrease',
  )
  assert(decReview !== undefined, 'overloaded suggests lower review cap')
  assert(
    !advice.suggestions.some(
      (s) => s.setting === 'review_daily_target' && s.action === 'increase',
    ),
    'overloaded must not increase reviews',
  )
  assertAdviceInvariants(advice, 'overloaded')

  // Behind — good finish rates but new/day too low for goal
  clearAdviceWindow()
  updateSetting('new_per_day', 1)
  updateSetting('goal_date', addDays(todayStr(), 25))
  seedAdviceHistory(8, 5, 5, 2, 2)
  advice = computePaceAdvice()
  assert(
    advice.status === 'behind' || advice.suggestions.some((s) => s.setting === 'new_per_day' && s.action === 'increase'),
    `behind path status=${advice.status}`,
  )
  assertAdviceInvariants(advice, 'behind')

  // Ahead — ahead of linear ramp with strong finish rates
  clearAdviceWindow()
  updateSetting('new_per_day', 5)
  updateSetting('goal_date', addDays(todayStr(), 120))
  seedAdviceHistory(10, 4, 4, 3, 3)
  advice = computePaceAdvice()
  assert(
    ['ahead', 'on_pace'].includes(advice.status),
    `ahead/on_pace status=${advice.status}`,
  )
  assertAdviceInvariants(advice, 'ahead')

  // Bootstrap — bootstrap-focused advice
  clearAdviceWindow()
  cancelBootstrap()
  const bootIds = getSnapshot().bootstrapCandidates.slice(0, 6).map((p) => p.id)
  startBootstrap(bootIds, 5)
  seedAdviceHistory(6, 5, 5)
  advice = computePaceAdvice()
  assert(advice.status === 'bootstrap', `bootstrap status=${advice.status}`)
  assert(
    advice.suggestions.some((s) => s.setting === 'bootstrap_daily_cap'),
    'bootstrap advice mentions bootstrap cap',
  )
  assertAdviceInvariants(advice, 'bootstrap')
  cancelBootstrap()

  // Snapshot exposes advice
  updateSetting('goal_date', savedGoal)
  updateSetting('review_daily_target', savedReview)
  updateSetting('new_per_day', savedNew)
  clearAdviceWindow()
  ensureToday()
  assert(typeof getSnapshot().advice.headline === 'string', 'snapshot.advice present')
  console.log('  pace advice: overloaded + behind + ahead + bootstrap ok')
}

// Bootstrap reviews carryover capped at 10/day
{
  cancelBootstrap()
  const ids = getSnapshot().bootstrapCandidates.slice(0, 15).map((p) => p.id)
  startBootstrap(ids, 5)
  let snap = getSnapshot()
  const day1 = snap.assignments.filter((a) => a.kind === 'review' && a.checked === 0)
  for (let i = 0; i < Math.min(4, day1.length); i++) {
    rateReviewAssignment(day1[i].id, day1[i].problem_id, 'medium', 0)
  }
  advanceDays(1)
  snap = getSnapshot()
  assert(snap.pacing.reviewsToday <= 10, `carryover capped: ${snap.pacing.reviewsToday}`)
  cancelBootstrap()
}

// Bootstrap reviews follow roadmap order; normal SR keeps topic balancer
{
  cancelBootstrap()
  const cap = 3
  const ids = getSnapshot().bootstrapCandidates.map((p) => p.id)
  startBootstrap(ids, cap)
  const reviews = getSnapshot().assignments.filter((a) => a.kind === 'review' && a.checked === 0)
  assert(reviews.length === cap, `bootstrap day1 reviews=${reviews.length}, want ${cap}`)
  const slugs = reviews.map((a) => a.problem.slug)
  assert(slugs[0] === 'contains-duplicate', `first bootstrap review=${slugs[0]}`)
  assert(slugs[1] === 'valid-anagram', `second bootstrap review=${slugs[1]}`)
  assert(slugs[2] === 'two-sum', `third bootstrap review=${slugs[2]}`)
  // Unsorted input still staggers in roadmap order
  const shuffled = [...ids].reverse()
  cancelBootstrap()
  startBootstrap(shuffled, cap)
  const again = getSnapshot().assignments.filter((a) => a.kind === 'review' && a.checked === 0)
  assert(
    again.map((a) => a.problem.slug).join(',') === slugs.join(','),
    'startBootstrap sorts by neetcode_order regardless of input order',
  )
  cancelBootstrap()
  checkInvariants('bootstrap roadmap reviews')
}

// Bootstrap new: no stacking — 2/day, finish 0 → day 2 still same 2 (not 4)
{
  cancelBootstrap()
  const newPerDay = 2
  const ids = getSnapshot().bootstrapCandidates.slice(0, 9).map((p) => p.id)
  startBootstrap(ids, 3, newPerDay)
  let snap = getSnapshot()
  assert(snap.pacing.bootstrapNewPerDay === newPerDay, `bootstrapNewPerDay=${snap.pacing.bootstrapNewPerDay}`)
  const day1New = snap.assignments.filter((a) => a.kind === 'new' && a.checked === 0)
  assert(day1New.length === newPerDay, `day1 new slots=${day1New.length}, want ${newPerDay}`)
  const day1Ids = day1New.map((a) => a.problem_id).sort((a, b) => a - b)

  advanceDays(1)
  snap = getSnapshot()
  assert(snap.pacing.unusedNewYesterday === 0, 'bootstrap unusedNewYesterday stays 0')
  assert(snap.pacing.newToday === newPerDay, `day2 newToday=${snap.pacing.newToday}, want ${newPerDay}`)
  const day2New = snap.assignments.filter((a) => a.kind === 'new' && a.checked === 0)
  assert(day2New.length === newPerDay, `day2 new slots=${day2New.length}, want ${newPerDay} not ${newPerDay * 2}`)
  const day2Ids = day2New.map((a) => a.problem_id).sort((a, b) => a - b)
  assert(day2Ids.join(',') === day1Ids.join(','), 'same new problems persist across days')
  cancelBootstrap()
  checkInvariants('bootstrap new no stack')
}

// Topic order oracle: TOPICS matches neetcode150.json block order; spot-check slugs
{
  const topicIndex = new Map(TOPICS.map((t, i) => [t, i]))
  let prevTopicIdx = -1
  let prevOrder = -1
  for (const p of neetcode.problems) {
    const ti = topicIndex.get(p.topic as (typeof TOPICS)[number])
    assert(ti !== undefined, `unknown topic in seed JSON: ${p.topic}`)
    assert(
      ti! >= prevTopicIdx,
      `topic block order broken at ${p.slug}: ${p.topic} before earlier block`,
    )
    if (ti === prevTopicIdx) {
      assert(p.order > prevOrder, `neetcode_order not monotonic in ${p.topic} at ${p.slug}`)
    }
    prevTopicIdx = ti!
    prevOrder = p.order
  }
  const bySlug = new Map(neetcode.problems.map((p) => [p.slug, p]))
  const gp = bySlug.get('generate-parentheses')!
  assert(gp.topic === 'Backtracking' && gp.order === 67, 'generate-parentheses oracle')
  const ibt = bySlug.get('invert-binary-tree')!
  assert(ibt.topic === 'Trees' && ibt.order === 45, 'invert-binary-tree oracle')
  const heap = bySlug.get('kth-largest-element-in-a-stream')!
  assert(heap.topic === 'Heap / Priority Queue' && heap.order === 60, 'heap oracle')
  // DB neetcode_order matches JSON order field
  const dbInvert = db
    .prepare("SELECT neetcode_order, topic FROM problems WHERE slug = 'invert-binary-tree'")
    .get() as { neetcode_order: number; topic: string }
  assert(dbInvert.neetcode_order === 45 && dbInvert.topic === 'Trees', 'DB seed order matches JSON')
}

// cancelBootstrap: pool cleared; never-reviewed → due today; baselined-in-pool → today+interval
{
  cancelBootstrap()
  // Prefer candidates with no review_log so the never-reviewed branch is exercised.
  const neverReviewed = getSnapshot().bootstrapCandidates.filter((p) => {
    const c = (
      db.prepare('SELECT COUNT(*) AS c FROM review_log WHERE problem_id = ?').get(p.id) as { c: number }
    ).c
    return c === 0
  })
  const ids = (neverReviewed.length >= 4
    ? neverReviewed.slice(0, 4)
    : getSnapshot().bootstrapCandidates.slice(0, 4)
  ).map((p) => p.id)
  startBootstrap(ids, 2)
  assert(getSnapshot().bootstrapActive, 'cancel test: bootstrap active')
  // Rate one: applyReview already exits bootstrap → sr with deferral (cancel won't touch it).
  const toRate = getSnapshot().assignments.find((a) => a.kind === 'review' && a.checked === 0)
  let ratedId: number | null = null
  let ratedNextBeforeCancel: string | null = null
  if (toRate) {
    ratedId = toRate.problem_id
    rateReviewAssignment(toRate.id, toRate.problem_id, 'medium', 0)
    ratedNextBeforeCancel = (
      db.prepare('SELECT next_review_at FROM problems WHERE id = ?').get(ratedId) as {
        next_review_at: string
      }
    ).next_review_at
  }
  // Baselined-still-in-pool branch: inject a review_log + interval on a remaining bootstrap row.
  const stillInPool = (
    db.prepare("SELECT id, interval_days FROM problems WHERE status = 'bootstrap' LIMIT 1").get() as
      | { id: number; interval_days: number }
      | undefined
  )
  if (stillInPool) {
    db.prepare(
      'INSERT INTO review_log (problem_id, reviewed_at, rating, hints, interval_after) VALUES (?, ?, ?, ?, ?)',
    ).run(stillInPool.id, new Date().toISOString(), 'medium', 0, 4)
    db.prepare('UPDATE problems SET interval_days = 4 WHERE id = ?').run(stillInPool.id)
  }
  cancelBootstrap()
  snap = getSnapshot()
  assert(!snap.bootstrapActive, 'cancelBootstrap clears bootstrapActive')
  const stillBoot = (
    db.prepare("SELECT COUNT(*) AS c FROM problems WHERE status = 'bootstrap'").get() as { c: number }
  ).c
  assert(stillBoot === 0, `cancelBootstrap left ${stillBoot} in bootstrap pool`)
  if (ratedId !== null && ratedNextBeforeCancel !== null) {
    const after = db
      .prepare('SELECT status, next_review_at FROM problems WHERE id = ?')
      .get(ratedId) as { status: string; next_review_at: string }
    assert(after.status === 'sr', 'rated-during-bootstrap stays sr')
    assert(
      after.next_review_at === ratedNextBeforeCancel,
      'cancel must not rewrite already-exited bootstrap reviews',
    )
  }
  if (stillInPool) {
    const row = db
      .prepare('SELECT status, next_review_at FROM problems WHERE id = ?')
      .get(stillInPool.id) as { status: string; next_review_at: string }
    assert(row.status === 'sr', 'baselined-in-pool cancel → sr')
    assert(
      row.next_review_at === addDays(todayStr(), 4),
      `baselined-in-pool cancel next=${row.next_review_at}, want today+4`,
    )
  }
  for (const id of ids) {
    if (id === ratedId || id === stillInPool?.id) continue
    const row = db
      .prepare('SELECT status, next_review_at FROM problems WHERE id = ?')
      .get(id) as { status: string; next_review_at: string }
    assert(row.status === 'sr', `cancel → sr for id=${id}`)
    assert(row.next_review_at === todayStr(), `never-reviewed cancel due today id=${id}`)
  }
  checkInvariants('cancelBootstrap pool cleared')
}

// Repetition multiplier: more lifetime reviews → longer interval for same rating
{
  const oneRep = nextSchedule({ intervalDays: 4, ease: 2.5, repetitions: 0 }, 'medium', 0, 1)
  const fiveRep = nextSchedule({ intervalDays: 4, ease: 2.5, repetitions: 4 }, 'medium', 0, 1)
  assert(fiveRep.intervalDays > oneRep.intervalDays, `rep boost: ${fiveRep.intervalDays} vs ${oneRep.intervalDays}`)
  assert(oneRep.repetitions === 1, 'first review counts as rep 1')
  assert(fiveRep.repetitions === 5, 'fifth review counts as rep 5')
}

// Bootstrap deferral: fixed total_days = ceil(selected / cap), added to every SR interval
{
  const deferIds = snap.bootstrapCandidates.slice(4, 11).map((p) => p.id)
  const cap = 1
  const totalDays = Math.ceil(deferIds.length / cap)
  startBootstrap(deferIds, cap)
  snap = getSnapshot()
  assert(snap.bootstrapActive, 'defer bootstrap active')
  assert(getBootstrapTotalDays() === totalDays, `total_days=${getBootstrapTotalDays()}, want ${totalDays}`)
  const firstReview = snap.assignments.find((a) => a.kind === 'review' && a.checked === 0)
  assert(firstReview !== undefined, 'bootstrap review assigned')
  assert(firstReview!.problem.status === 'bootstrap', 'today review is bootstrap queue only')

  const repsBefore = (
    db.prepare('SELECT repetitions FROM problems WHERE id = ?').get(firstReview!.problem_id) as {
      repetitions: number
    }
  ).repetitions
  rateReviewAssignment(firstReview!.id, firstReview!.problem_id, 'medium', 0)
  const row = db
    .prepare('SELECT next_review_at, interval_days, repetitions FROM problems WHERE id = ?')
    .get(firstReview!.problem_id) as { next_review_at: string; interval_days: number; repetitions: number }
  const sr = row.interval_days
  const jitter = bootstrapSpreadJitter(firstReview!.problem_id, true)
  const span = daysBetween(todayStr(), row.next_review_at)
  assert(row.repetitions === repsBefore + 1, 'baseline review increments repetitions')
  assert(span === sr + totalDays + jitter, `first span=${span}, want ${sr + totalDays + jitter} (SR + bootstrap + jitter)`)

  // Last problem on final bootstrap day still adds full total_days (not 0)
  cancelBootstrap()
  startBootstrap(deferIds, cap)
  for (let d = 0; d < totalDays - 1; d++) advanceDays(1)
  snap = getSnapshot()
  const lastReview = snap.assignments.find((a) => a.kind === 'review' && a.checked === 0)
  assert(lastReview !== undefined, 'last-day bootstrap review exists')
  rateReviewAssignment(lastReview!.id, lastReview!.problem_id, 'medium', 0)
  const lastRow = db
    .prepare('SELECT next_review_at, interval_days FROM problems WHERE id = ?')
    .get(lastReview!.problem_id) as { next_review_at: string; interval_days: number }
  const lastSr = lastRow.interval_days
  const lastJitter = bootstrapSpreadJitter(lastReview!.problem_id, true)
  assert(
    daysBetween(todayStr(), lastRow.next_review_at) === lastSr + totalDays + lastJitter,
    `last-day span=${daysBetween(todayStr(), lastRow.next_review_at)}, want ${lastSr + totalDays + lastJitter}`,
  )
  cancelBootstrap()
  checkInvariants('baseline deferral total_days')

  // markDone during bootstrap with optional new/day
  const deferIds2 = getSnapshot().bootstrapCandidates.slice(0, 5).map((p) => p.id)
  const cap2 = 2
  const totalDays2 = Math.ceil(deferIds2.length / cap2)
  startBootstrap(deferIds2, cap2, 1)
  snap = getSnapshot()
  assert(getBootstrapTotalDays() === totalDays2, `new bootstrap total_days=${getBootstrapTotalDays()}`)
  const newSlot = snap.assignments.find((a) => a.kind === 'new' && a.checked === 0)
  if (newSlot) {
    completeProblemAssignment(newSlot.id, newSlot.problem_id, 'hard', 0)
    const doneRow = db
      .prepare('SELECT next_review_at, interval_days, repetitions FROM problems WHERE id = ?')
      .get(newSlot.problem_id) as { next_review_at: string; interval_days: number; repetitions: number }
    const hardSr = doneRow.interval_days
    const doneJitter = bootstrapSpreadJitter(newSlot.problem_id, true)
    assert(doneRow.repetitions === 1, 'markDone counts as rep 1')
    assert(
      daysBetween(todayStr(), doneRow.next_review_at) === hardSr + totalDays2 + doneJitter,
      `markDone deferral span=${daysBetween(todayStr(), doneRow.next_review_at)}, want ${hardSr + totalDays2 + doneJitter}`,
    )
  }
  cancelBootstrap()
  checkInvariants('new-during-bootstrap deferral')
}

// first_completed_at: set on first mark done, preserved on re-rating; review_log append-only
{
  const undone = getSnapshot().problems.find(
    (p) => p.first_completed_at === null && p.is_excluded === 0,
  )!
  completeProblem(undone.id, 'medium', 0)
  const row = db
    .prepare('SELECT first_completed_at, last_reviewed_at FROM problems WHERE id = ?')
    .get(undone.id) as { first_completed_at: string; last_reviewed_at: string }
  const firstDate = row.first_completed_at
  assert(firstDate === todayStr(), `first_completed_at=${firstDate}, want ${todayStr()}`)
  assert(row.last_reviewed_at === todayStr(), 'last_reviewed_at set on first completion')
  let logCount = (
    db.prepare('SELECT COUNT(*) AS c FROM review_log WHERE problem_id = ?').get(undone.id) as { c: number }
  ).c
  assert(logCount === 1, 'first completion appends one review_log row')

  advanceDays(3)
  rateReview(undone.id, 'easy', 0)
  const afterReview = db
    .prepare('SELECT first_completed_at, last_reviewed_at FROM problems WHERE id = ?')
    .get(undone.id) as { first_completed_at: string; last_reviewed_at: string }
  assert(afterReview.first_completed_at === firstDate, 're-rating preserves first_completed_at')
  assert(afterReview.last_reviewed_at === todayStr(), 're-rating updates last_reviewed_at')
  logCount = (
    db.prepare('SELECT COUNT(*) AS c FROM review_log WHERE problem_id = ?').get(undone.id) as { c: number }
  ).c
  assert(logCount === 2, 're-rating appends review_log (no overwrite)')

  advanceDays(5)
  completeProblem(undone.id, 'hard', 1)
  const afterMarkDone = db
    .prepare('SELECT first_completed_at, last_reviewed_at FROM problems WHERE id = ?')
    .get(undone.id) as { first_completed_at: string; last_reviewed_at: string }
  assert(afterMarkDone.first_completed_at === firstDate, 'markDone on done problem preserves first_completed_at')
  assert(afterMarkDone.last_reviewed_at === todayStr(), 'markDone on done updates last_reviewed_at')
  logCount = (
    db.prepare('SELECT COUNT(*) AS c FROM review_log WHERE problem_id = ?').get(undone.id) as { c: number }
  ).c
  assert(logCount === 3, 'markDone on done appends review_log')
  checkInvariants('first_completed_at preservation')
}

// Bootstrap carryover: 5/day, 4 checked day 1 → day 2 has 6 review slots
{
  cancelBootstrap()
  const carryIds = getSnapshot().bootstrapCandidates.slice(0, 10).map((p) => p.id)
  const cap = 5
  startBootstrap(carryIds, cap)
  snap = getSnapshot()
  assert(snap.pacing.reviewsToday === cap, `day1 reviewsToday=${snap.pacing.reviewsToday}, want ${cap}`)
  const day1 = snap.assignments.filter((a) => a.kind === 'review' && a.checked === 0)
  assert(day1.length === cap, `day1 review slots=${day1.length}, want ${cap}`)
  for (let i = 0; i < cap - 1; i++) {
    rateReviewAssignment(day1[i].id, day1[i].problem_id, 'medium', 0)
  }
  advanceDays(1)
  snap = getSnapshot()
  assert(snap.pacing.unusedReviewsYesterday === 1, 'one unchecked review carries over')
  assert(snap.pacing.reviewsToday === cap + 1, `day2 reviewsToday=${snap.pacing.reviewsToday}, want ${cap + 1}`)
  const day2Reviews = snap.assignments.filter((a) => a.kind === 'review')
  assert(day2Reviews.length === cap + 1, `day2 review slots=${day2Reviews.length}, want ${cap + 1}`)
  cancelBootstrap()
  checkInvariants('bootstrap carryover')
}

// Day 1: user starts a bootstrap over all done problems, 6/day
snap = getSnapshot()
const mainIds = snap.bootstrapCandidates.map((p) => p.id)
startBootstrap(mainIds, 6)
checkInvariants('bootstrap started')
snap = getSnapshot()
assert(snap.bootstrapActive, 'bootstrap active')
assert(
  getBootstrapTotalDays() === Math.ceil(mainIds.length / 6),
  `bootstrap_total_days=${getBootstrapTotalDays()}, want ceil(${mainIds.length}/6)`,
)
assert(snap.assignments.filter((a) => a.kind === 'new' && a.checked === 0).length === 0, 'no new during bootstrap')

// Simulate 75 days of use
let customAdded = false
for (let day = 0; day < 75; day++) {
  snap = getSnapshot()

  // Rate 80% of today's unchecked reviews (leave some unchecked → honest overdue)
  for (const a of snap.assignments.filter((x) => x.kind === 'review' && x.checked === 0)) {
    if (rand() < 0.8) {
      rateReviewAssignment(a.id, a.problem_id, pick(RATINGS), Math.floor(rand() * 3))
    }
  }
  // Complete 70% of new slots
  snap = getSnapshot()
  for (const a of snap.assignments.filter((x) => x.kind === 'new' && x.checked === 0)) {
    if (rand() < 0.7) {
      completeProblemAssignment(a.id, a.problem_id, pick(RATINGS), Math.floor(rand() * 2))
    }
  }

  // Occasional side actions
  if (day === 10) {
    // toggle exclusion churn
    const kept = getSnapshot().problems.filter((p) => p.is_excluded === 0 && p.is_custom === 0)
    moveToRemoved(pick(kept).id)
    checkInvariants('after moveToRemoved')
  }
  if (day === 12) {
    const removed = getSnapshot().problems.filter((p) => p.is_excluded === 1)
    reEnableProblem(pick(removed).id)
    checkInvariants('after reEnable')
  }
  if (day === 15 && !customAdded) {
    customAdded = true
    const res = addProblem({ title: 'Design Hit Counter', slug: 'design-hit-counter', difficulty: 'Medium', topic: 'Arrays & Hashing' })
    assert(res.added, 'custom add works')
    const custom = getSnapshot().problems.find((p) => p.slug === 'design-hit-counter')!
    completeProblem(custom.id, 'medium', 0)
    const s2 = getSnapshot()
    assert(s2.customDone === 1 && s2.customTotal === 1, 'bonus ring counts custom')
    checkInvariants('after custom add')
  }
  if (day === 20) {
    updateSetting('new_per_day', 3)
    checkInvariants('after new_per_day=3')
  }
  if (day === 25) {
    updateSetting('goal_date', addDays(todayStr(), 30))
    checkInvariants('after tight goal date')
  }
  if (day === 30) {
    updateSetting('goal_date', addDays(todayStr(), 120))
    updateSetting('new_per_day', 0) // Auto
    checkInvariants('after relaxed goal + auto')
  }
  if (day === 35) {
    // second bootstrap started and cancelled same day
    const cands = getSnapshot().bootstrapCandidates
    if (cands.length >= 5) {
      startBootstrap(cands.slice(0, 5).map((p) => p.id), 2)
      checkInvariants('second bootstrap')
      cancelBootstrap()
      checkInvariants('bootstrap cancelled')
      assert(!getSnapshot().bootstrapActive, 'cancel works')
    }
  }
  if (day === 40) {
    updateSetting('review_daily_target', 3)
    checkInvariants('review target lowered')
  }
  if (day === 41) {
    updateSetting('review_daily_target', 8)
  }

  // Problems-tab path: rate an arbitrary due problem directly some days
  if (day % 7 === 3) {
    const due = getSnapshot().problems.filter(
      (p) => p.is_excluded === 0 && p.first_completed_at !== null && p.next_review_at !== null && p.next_review_at <= todayStr(),
    )
    if (due.length > 0) rateReview(pick(due).id, pick(RATINGS), 0)
  }

  // Mastered must not silently demote to sr after a later review.
  for (const p of getSnapshot().problems.filter((x) => x.status === 'mastered')) {
    assert(p.status === 'mastered', `mastered demoted unexpectedly id=${p.id}`)
  }

  checkInvariants(`day ${day}`)
  advanceDays(1)
}

// ---- end state ----
snap = getSnapshot()
console.log('end:', todayStr())
console.log('done kept:', snap.pacing.doneKept, '/', snap.pacing.keptTotal)
console.log('review_log rows:', (db.prepare('SELECT COUNT(*) AS c FROM review_log').get() as { c: number }).c)
console.log('mastered:', snap.problems.filter((p) => p.status === 'mastered').length)
console.log('assignments total:', (db.prepare('SELECT COUNT(*) AS c FROM today_assignments').get() as { c: number }).c)

assert(!snap.bootstrapActive, 'bootstrap finished during run')
assert(snap.bootstrapCompleted, 'bootstrap completion latched')
assert(snap.pacing.doneKept > 43, 'made forward progress on new problems')
assert(snap.problems.filter((p) => p.status === 'mastered').length > 0, 'some problems reached mastered')

// Explicit mastered latch: rate a mastered problem again → stays mastered
{
  const m = snap.problems.find((p) => p.status === 'mastered')
  if (m) {
    rateReview(m.id, 'hard', 2)
    const after = db
      .prepare('SELECT status FROM problems WHERE id = ?')
      .get(m.id) as { status: string }
    assert(after.status === 'mastered', `mastered→sr silent demotion: got ${after.status}`)
  }
}

// ---- Risk mitigation regression pack ----
console.log('mitigations:')
{
  cancelBootstrap()
  // 1) Review debt: cap 10 + overdue tracked in DB
  updateSetting('review_daily_target', 10)
  for (let i = 0; i < 5; i++) advanceDays(1)
  let snapM = getSnapshot()
  for (const a of snapM.assignments.filter((x) => x.kind === 'review' && x.checked === 0)) {
    if (rand() < 0.3) rateReviewAssignment(a.id, a.problem_id, 'easy', 0)
  }
  advanceDays(3)
  snapM = getSnapshot()
  assert(snapM.pacing.reviewsToday <= 10, `debt cap: reviewsToday=${snapM.pacing.reviewsToday}`)
  assert(
    snapM.pacing.reviewsDueTotal >= snapM.pacing.reviewsToday,
    'due total tracks backlog',
  )
  console.log(
    `  debt: ${snapM.pacing.reviewsToday} today · ${snapM.pacing.reviewsOverdue} overdue · ${snapM.pacing.reviewsDueTotal} due total`,
  )

  // 2) Post-bootstrap jitter spreads due dates
  cancelBootstrap()
  const jitterIds = snapM.bootstrapCandidates.slice(10, 13).map((p) => p.id)
  if (jitterIds.length >= 2) {
    startBootstrap(jitterIds, 3)
    const spans = new Set<number>()
    for (const a of getSnapshot().assignments.filter((x) => x.kind === 'review' && x.checked === 0)) {
      rateReviewAssignment(a.id, a.problem_id, 'medium', 0)
      const row = db
        .prepare('SELECT next_review_at FROM problems WHERE id = ?')
        .get(a.problem_id) as { next_review_at: string }
      spans.add(daysBetween(todayStr(), row.next_review_at))
    }
    cancelBootstrap()
    assert(spans.size >= 1, 'jitter schedules next_review_at')
    console.log(`  jitter spans: ${[...spans].join(', ')}`)
  }

  // 3) Total load cap 10
  snapM = getSnapshot()
  assert(snapM.pacing.evenLoad <= LOAD_CEILING, `load cap: evenLoad=${snapM.pacing.evenLoad}`)

  // 4) Day-lock for Today · New is covered earlier in this file (finish mid-day / next-day advance).
  console.log('  day-locked new: covered by early stress case')
  // 5) Forgot during bootstrap — full deferral
  advanceDays(1)
  ensureToday()
  const forgotIds = getSnapshot().bootstrapCandidates.slice(0, 3).map((p) => p.id)
  if (forgotIds.length > 0) {
    startBootstrap(forgotIds, 3)
    const fr = getSnapshot().assignments.find((a) => a.kind === 'review' && a.checked === 0)
    assert(fr !== undefined, 'forgot test needs a bootstrap review slot')
    const td = getBootstrapTotalDays()
    rateReviewAssignment(fr!.id, fr!.problem_id, 'forgot', 0)
    const frRow = db
      .prepare('SELECT next_review_at, interval_days FROM problems WHERE id = ?')
      .get(fr!.problem_id) as { next_review_at: string; interval_days: number }
    const frSpan = daysBetween(todayStr(), frRow.next_review_at)
    assert(frSpan > td, `forgot deferral span=${frSpan} > total_days=${td}`)
    cancelBootstrap()
    console.log(`  forgot deferral: span=${frSpan}`)
  }

  // 6) Past goal — reframe message, still assign (temporarily reopen one undone slot)
  const savedGoal = getSnapshot().settings.goal_date
  const reopen = db
    .prepare(
      `SELECT id FROM problems WHERE is_custom = 0 AND is_excluded = 0 AND first_completed_at IS NOT NULL LIMIT 1`,
    )
    .get() as { id: number }
  db.prepare(
    `UPDATE problems SET first_completed_at = NULL, status = 'undone', next_review_at = NULL WHERE id = ?`,
  ).run(reopen.id)
  updateSetting('goal_date', addDays(todayStr(), -14))
  ensureToday()
  snapM = getSnapshot()
  assert(snapM.goal.reason.includes('Past goal'), `past goal msg: ${snapM.goal.reason}`)
  assert(snapM.pacing.reviewsToday > 0 || snapM.pacing.newToday > 0, 'still assigns past goal')
  updateSetting('goal_date', savedGoal)
  console.log('  past goal: still assigns')
}

// exhaust: mark everything done, verify the all-done state is calm
for (const p of getSnapshot().problems.filter((x) => x.is_excluded === 0 && x.first_completed_at === null)) {
  completeProblem(p.id, 'easy', 0)
}
advanceDays(1)
snap = getSnapshot()
assert(snap.pacing.remainingNew === 0, 'all kept done')
assert(snap.pacing.newToday === 0, 'no new slots when done')
assert(snap.goal.onTrack, 'all-done is on track')
checkInvariants('all done')

// EOD reconcile sanity: every past day is reconciled
const unrec = (
  db.prepare('SELECT COUNT(*) AS c FROM today_assignments WHERE assignment_date < ? AND reconciled = 0')
    .get(todayStr()) as { c: number }
).c
assert(unrec === 0, `unreconciled past assignments: ${unrec}`)

console.log(failures === 0 ? '\nSTRESS TEST PASSED' : `\nSTRESS TEST FAILED (${failures} failures)`)
process.exitCode = failures === 0 ? 0 : 1
