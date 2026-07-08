import { db } from './db'
import { getAppSettings, getNumberSetting, getSetting, SETTINGS_MAX } from './settings'
import { todayStr, addDays, daysBetween } from './dates'
import {
  computePacing,
  goalReachability,
  MAX_NEW,
  REVIEW_FLOOR,
  type GoalReachability,
  type PacingResult,
} from './pacing'
import { isBootstrapActive } from './scheduler'
import type { AppSettings } from './types'

export const ADVICE_WINDOW_DAYS = 14
const MIN_HISTORY_DAYS = 3
const REVIEW_FINISH_THRESHOLD = 0.75
const UNFINISHED_DAYS_RATIO = 0.4

export type PaceAdviceStatus =
  | 'ahead'
  | 'on_pace'
  | 'behind'
  | 'overloaded'
  | 'past_goal'
  | 'bootstrap'

export type PaceAdviceSetting =
  | 'new_per_day'
  | 'review_daily_target'
  | 'bootstrap_daily_cap'

export interface PaceAdviceSuggestion {
  setting: PaceAdviceSetting
  action: 'increase' | 'decrease' | 'keep'
  from: number
  to: number
  why: string
}

export interface PaceAdviceMetrics {
  reviewFinishRate: number
  newFinishRate: number
  avgReviewsDonePerDay: number
  avgNewDonePerDay: number
  unfinishedReviewDays: number
  overdueNow: number
  daysLeft: number
  remainingUndone: number
  neededNewPerDay: number
  effectiveNewPerDay: number
  linearGap: number
}

export interface PaceAdvice {
  status: PaceAdviceStatus
  headline: string
  detail: string
  windowDays: number
  metrics: PaceAdviceMetrics
  suggestions: PaceAdviceSuggestion[]
}

interface DayKindStats {
  assigned: number
  done: number
}

interface HistoryDay {
  date: string
  review: DayKindStats
  new: DayKindStats
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

function linearGap(pacing: PacingResult, goalDate: string): number {
  const startDate = getSetting('start_date') ?? todayStr()
  const startDone = getNumberSetting('start_done', 0)
  const totalSpan = Math.max(daysBetween(startDate, goalDate), 1)
  const elapsedRatio = Math.min(Math.max(1 - pacing.daysLeft / totalSpan, 0), 1)
  const targetDone = Math.round(startDone + (pacing.keptTotal - startDone) * elapsedRatio)
  return pacing.doneKept - targetDone
}

function effectiveNewFromSettings(
  settings: AppSettings,
  remainingUndone: number,
  daysLeft: number,
): number {
  if (settings.new_per_day > 0) return settings.new_per_day
  const ideal = remainingUndone / Math.max(daysLeft, 1)
  return Math.min(Math.max(Math.ceil(ideal), 1), MAX_NEW)
}

function loadHistory(windowDays: number): HistoryDay[] {
  const today = todayStr()
  const start = addDays(today, -windowDays)
  const rows = db
    .prepare(
      `SELECT assignment_date, kind,
        COUNT(*) AS assigned,
        SUM(checked) AS done
      FROM today_assignments
      WHERE assignment_date >= ? AND assignment_date < ?
        AND is_extra = 0
        AND kind IN ('review', 'new')
      GROUP BY assignment_date, kind`,
    )
    .all(start, today) as Array<{
    assignment_date: string
    kind: 'review' | 'new'
    assigned: number
    done: number
  }>

  const byDate = new Map<string, HistoryDay>()
  for (let i = 1; i <= windowDays; i++) {
    const d = addDays(today, -i)
    byDate.set(d, { date: d, review: { assigned: 0, done: 0 }, new: { assigned: 0, done: 0 } })
  }
  for (const row of rows) {
    const day = byDate.get(row.assignment_date)
    if (!day) continue
    day[row.kind] = { assigned: row.assigned, done: row.done }
  }
  return [...byDate.values()]
}

function aggregateHistory(history: HistoryDay[]): {
  reviewAssigned: number
  reviewDone: number
  newAssigned: number
  newDone: number
  daysWithReviews: number
  unfinishedReviewDays: number
  avgReviewsDonePerDay: number
  avgNewDonePerDay: number
} {
  let reviewAssigned = 0
  let reviewDone = 0
  let newAssigned = 0
  let newDone = 0
  let daysWithReviews = 0
  let unfinishedReviewDays = 0

  for (const day of history) {
    reviewAssigned += day.review.assigned
    reviewDone += day.review.done
    newAssigned += day.new.assigned
    newDone += day.new.done
    if (day.review.assigned > 0) {
      daysWithReviews++
      if (day.review.done < day.review.assigned) unfinishedReviewDays++
    }
  }

  const activeDays = history.length || 1
  return {
    reviewAssigned,
    reviewDone,
    newAssigned,
    newDone,
    daysWithReviews,
    unfinishedReviewDays,
    avgReviewsDonePerDay: reviewDone / activeDays,
    avgNewDonePerDay: newDone / activeDays,
  }
}

function uncheckedYesterday(kind: 'review' | 'new'): number {
  const yesterday = addDays(todayStr(), -1)
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM today_assignments WHERE assignment_date = ? AND kind = ? AND checked = 0 AND is_extra = 0",
    )
    .get(yesterday, kind) as { c: number }
  return row.c
}

function settingLabel(key: PaceAdviceSetting): string {
  switch (key) {
    case 'new_per_day':
      return 'New/day'
    case 'review_daily_target':
      return 'Reviews/day'
    case 'bootstrap_daily_cap':
      return 'Bootstrap reviews/day'
  }
}

function makeSuggestion(
  setting: PaceAdviceSetting,
  action: 'increase' | 'decrease' | 'keep',
  from: number,
  to: number,
  why: string,
): PaceAdviceSuggestion {
  return { setting, action, from, to, why }
}

function baseSuggestions(settings: AppSettings): PaceAdviceSuggestion[] {
  return [
    makeSuggestion('new_per_day', 'keep', settings.new_per_day, settings.new_per_day, ''),
    makeSuggestion(
      'review_daily_target',
      'keep',
      settings.review_daily_target,
      settings.review_daily_target,
      '',
    ),
    makeSuggestion(
      'bootstrap_daily_cap',
      'keep',
      settings.bootstrap_daily_cap,
      settings.bootstrap_daily_cap,
      '',
    ),
  ]
}

function isOverloaded(
  agg: ReturnType<typeof aggregateHistory>,
  pacing: PacingResult,
): boolean {
  const reviewFinishRate =
    agg.reviewAssigned > 0 ? agg.reviewDone / agg.reviewAssigned : 1
  const unfinishedRatio =
    agg.daysWithReviews > 0 ? agg.unfinishedReviewDays / agg.daysWithReviews : 0
  const yesterdayReviewsLeft = uncheckedYesterday('review')
  const overdueGrowing =
    pacing.reviewsOverdue > 0 &&
    (yesterdayReviewsLeft > 0 || unfinishedRatio >= UNFINISHED_DAYS_RATIO)

  return (
    (agg.reviewAssigned >= 3 && reviewFinishRate < REVIEW_FINISH_THRESHOLD) ||
    unfinishedRatio >= UNFINISHED_DAYS_RATIO ||
    overdueGrowing
  )
}

function buildBootstrapAdvice(
  settings: AppSettings,
  pacing: PacingResult,
  goal: GoalReachability,
  agg: ReturnType<typeof aggregateHistory>,
  metrics: PaceAdviceMetrics,
  coldStart: boolean,
): PaceAdvice {
  const reviewFinishRate =
    agg.reviewAssigned > 0 ? agg.reviewDone / agg.reviewAssigned : 1
  const suggestions = baseSuggestions(settings)
  const capIdx = suggestions.findIndex((s) => s.setting === 'bootstrap_daily_cap')!
  const currentCap = settings.bootstrap_daily_cap

  let headline = 'Bootstrap in progress'
  let detail = goal.reason

  if (coldStart) {
    detail += ' Advice will sharpen after a few days of baseline reviews.'
  } else if (reviewFinishRate < REVIEW_FINISH_THRESHOLD) {
    const sustainable = clamp(
      Math.ceil(agg.avgReviewsDonePerDay) || REVIEW_FLOOR,
      REVIEW_FLOOR,
      SETTINGS_MAX,
    )
    if (sustainable < currentCap) {
      suggestions[capIdx] = makeSuggestion(
        'bootstrap_daily_cap',
        'decrease',
        currentCap,
        sustainable,
        `You finish ~${agg.avgReviewsDonePerDay.toFixed(1)} baseline reviews/day — lower the cap to match.`,
      )
      headline = 'Baseline load looks heavy'
      detail = `Review finish rate ${Math.round(reviewFinishRate * 100)}% over the last ${ADVICE_WINDOW_DAYS} days. ${goal.reason}`
    } else {
      suggestions[capIdx].why =
        'Cap matches what you usually finish during bootstrap.'
      headline = 'Baseline pace is tight but doable'
    }
  } else if (reviewFinishRate >= 0.9 && currentCap < SETTINGS_MAX && pacing.bootstrapRemaining > 0) {
    const bump = Math.min(currentCap + 1, SETTINGS_MAX)
    suggestions[capIdx] = makeSuggestion(
      'bootstrap_daily_cap',
      'increase',
      currentCap,
      bump,
      'Strong finish rate — you can clear the baseline queue faster.',
    )
    headline = 'Room to speed up bootstrap'
    detail = `Finishing ${Math.round(reviewFinishRate * 100)}% of assigned baseline reviews. After bootstrap you need ~${Math.ceil(goal.neededNewPerDay)} new/day for ${goal.goalDate}.`
  } else {
    suggestions[capIdx].why = 'Bootstrap cap matches your recent finish rate.'
    headline = 'Bootstrap on track'
    detail = `${goal.reason} After bootstrap: ~${Math.ceil(goal.neededNewPerDay)} new/day needed for ${goal.remainingUndone} undone Kept.`
  }

  if (goal.neededNewPerDay > metrics.effectiveNewPerDay + 0.5) {
    const newIdx = suggestions.findIndex((s) => s.setting === 'new_per_day')!
    const target = clamp(Math.ceil(goal.neededNewPerDay), 1, MAX_NEW)
    suggestions[newIdx] = makeSuggestion(
      'new_per_day',
      settings.new_per_day === 0 ? 'increase' : target > settings.new_per_day ? 'increase' : 'keep',
      settings.new_per_day,
      settings.new_per_day === 0 ? target : Math.max(settings.new_per_day, target),
      `Plan ~${Math.ceil(goal.neededNewPerDay)} new/day after baseline for ${goal.goalDate}.`,
    )
  }

  return {
    status: 'bootstrap',
    headline,
    detail,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions: suggestions.filter((s) => s.action !== 'keep' || s.setting === 'bootstrap_daily_cap'),
  }
}

function buildOverloadedAdvice(
  settings: AppSettings,
  pacing: PacingResult,
  goal: GoalReachability,
  agg: ReturnType<typeof aggregateHistory>,
  metrics: PaceAdviceMetrics,
): PaceAdvice {
  const suggestions = baseSuggestions(settings)
  const reviewFinishRate =
    agg.reviewAssigned > 0 ? agg.reviewDone / agg.reviewAssigned : 1
  const newFinishRate = agg.newAssigned > 0 ? agg.newDone / agg.newAssigned : 1

  const sustainableReviews = clamp(
    Math.ceil(agg.avgReviewsDonePerDay) || REVIEW_FLOOR,
    REVIEW_FLOOR,
    SETTINGS_MAX,
  )
  const reviewIdx = suggestions.findIndex((s) => s.setting === 'review_daily_target')!
  if (sustainableReviews < settings.review_daily_target) {
    suggestions[reviewIdx] = makeSuggestion(
      'review_daily_target',
      'decrease',
      settings.review_daily_target,
      sustainableReviews,
      `You finish ~${agg.avgReviewsDonePerDay.toFixed(1)} reviews/day — lower the target so Today lists match reality.`,
    )
  }

  const newIdx = suggestions.findIndex((s) => s.setting === 'new_per_day')!
  if (newFinishRate < REVIEW_FINISH_THRESHOLD && settings.new_per_day > 0) {
    const sustainableNew = clamp(Math.ceil(agg.avgNewDonePerDay) || 1, 1, MAX_NEW)
    if (sustainableNew < settings.new_per_day) {
      suggestions[newIdx] = makeSuggestion(
        'new_per_day',
        'decrease',
        settings.new_per_day,
        sustainableNew,
        `New finish rate ${Math.round(newFinishRate * 100)}% — reduce new/day to what you actually complete.`,
      )
    }
  }

  let detail = `Review finish rate ${Math.round(reviewFinishRate * 100)}% over the last ${ADVICE_WINDOW_DAYS} days`
  if (metrics.unfinishedReviewDays > 0) {
    detail += ` · ${metrics.unfinishedReviewDays} days left reviews unfinished`
  }
  if (pacing.reviewsOverdue > 0) {
    detail += ` · ${pacing.reviewsOverdue} overdue waiting`
  }
  detail += '. Lower daily caps to a sustainable level, then rebuild consistency.'

  const sustainableNew = Math.max(Math.ceil(agg.avgNewDonePerDay), 1)
  if (sustainableNew * goal.daysLeftAfterBootstrap < goal.remainingUndone && goal.remainingUndone > 0) {
    detail += ` At your current new pace (~${sustainableNew}/day) you won't reach ${goal.goalDate} — you'll need higher finish rates or a later goal date.`
  }

  return {
    status: 'overloaded',
    headline: 'Today load looks unsustainable',
    detail,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions: suggestions.filter((s) => s.action !== 'keep'),
  }
}

function buildBehindAdvice(
  settings: AppSettings,
  pacing: PacingResult,
  goal: GoalReachability,
  agg: ReturnType<typeof aggregateHistory>,
  metrics: PaceAdviceMetrics,
  coldStart: boolean,
): PaceAdvice {
  const suggestions = baseSuggestions(settings)
  const targetNew = clamp(Math.ceil(goal.neededNewPerDay), 1, MAX_NEW)
  const newIdx = suggestions.findIndex((s) => s.setting === 'new_per_day')!
  const effective = metrics.effectiveNewPerDay

  if (targetNew > effective) {
    suggestions[newIdx] = makeSuggestion(
      'new_per_day',
      'increase',
      settings.new_per_day,
      settings.new_per_day === 0 ? targetNew : Math.max(settings.new_per_day, targetNew),
      settings.new_per_day === 0
        ? `Switch from Auto to ${targetNew} new/day — need ~${Math.ceil(goal.neededNewPerDay)} for ${goal.remainingUndone} undone by ${goal.goalDate}.`
        : `Raise to ${Math.max(settings.new_per_day, targetNew)} — goal needs ~${Math.ceil(goal.neededNewPerDay)} new/day.`,
    )
  }

  const reviewFinishRate =
    agg.reviewAssigned > 0 ? agg.reviewDone / agg.reviewAssigned : 1
  const reviewIdx = suggestions.findIndex((s) => s.setting === 'review_daily_target')!
  if (
    pacing.reviewsOverdue >= 5 &&
    reviewFinishRate >= REVIEW_FINISH_THRESHOLD &&
    settings.review_daily_target < SETTINGS_MAX
  ) {
    const bump = Math.min(settings.review_daily_target + 1, SETTINGS_MAX)
    suggestions[reviewIdx] = makeSuggestion(
      'review_daily_target',
      'increase',
      settings.review_daily_target,
      bump,
      `${pacing.reviewsOverdue} overdue — you finish reviews reliably, so a slightly higher cap helps catch up.`,
    )
  }

  const gapText =
    metrics.linearGap < 0
      ? `${Math.abs(metrics.linearGap)} problems behind the linear schedule`
      : `${goal.remainingUndone} undone Kept with ${metrics.daysLeft} days left`

  let detail = coldStart
    ? `${gapText}. ${goal.reason} Advice will sharpen after a few more days.`
    : `${gapText}. ${goal.reason}`

  if (!coldStart && agg.avgNewDonePerDay > 0) {
    detail += ` You're completing ~${agg.avgNewDonePerDay.toFixed(1)} new/day — need ~${Math.ceil(goal.neededNewPerDay)}.`
  }

  return {
    status: 'behind',
    headline: `Behind schedule for ${goal.goalDate}`,
    detail,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions: suggestions.filter((s) => s.action !== 'keep'),
  }
}

function buildAheadAdvice(
  settings: AppSettings,
  pacing: PacingResult,
  goal: GoalReachability,
  metrics: PaceAdviceMetrics,
): PaceAdvice {
  const suggestions = baseSuggestions(settings)
  const idealNew = clamp(Math.ceil(pacing.idealNewPerDay), 1, MAX_NEW)

  const newIdx = suggestions.findIndex((s) => s.setting === 'new_per_day')!
  if (settings.new_per_day > 0 && settings.new_per_day > idealNew + 0.5) {
    suggestions[newIdx] = makeSuggestion(
      'new_per_day',
      'decrease',
      settings.new_per_day,
      idealNew,
      `You're ahead — ${idealNew} new/day still reaches ${goal.goalDate} with less daily load.`,
    )
  } else if (settings.new_per_day === 0 && metrics.effectiveNewPerDay > idealNew + 0.5) {
    suggestions[newIdx] = makeSuggestion(
      'new_per_day',
      'decrease',
      0,
      idealNew,
      `Auto is assigning ${metrics.effectiveNewPerDay}/day — set ${idealNew} manually to avoid burnout while staying on track.`,
    )
  }

  const reviewIdx = suggestions.findIndex((s) => s.setting === 'review_daily_target')!
  if (
    pacing.reviewsOverdue === 0 &&
    settings.review_daily_target > REVIEW_FLOOR + 1 &&
    metrics.reviewFinishRate >= 0.9
  ) {
    const lower = Math.max(Math.ceil(metrics.avgReviewsDonePerDay), REVIEW_FLOOR)
    if (lower < settings.review_daily_target) {
      suggestions[reviewIdx] = makeSuggestion(
        'review_daily_target',
        'decrease',
        settings.review_daily_target,
        lower,
        'No overdue backlog — you can trim reviews/day and stay ahead.',
      )
    }
  }

  return {
    status: 'ahead',
    headline: `Ahead of schedule for ${goal.goalDate}`,
    detail: `${metrics.linearGap} problems ahead of the linear ramp · ${goal.reason}`,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions: suggestions.filter((s) => s.action !== 'keep'),
  }
}

function buildOnPaceAdvice(
  settings: AppSettings,
  goal: GoalReachability,
  metrics: PaceAdviceMetrics,
  agg: ReturnType<typeof aggregateHistory>,
): PaceAdvice {
  const suggestions = baseSuggestions(settings)
  for (const s of suggestions) {
    s.why = 'Current settings match your goal and recent completion rate.'
  }

  const detail = `Finishing ${Math.round(metrics.reviewFinishRate * 100)}% of reviews and ${Math.round(metrics.newFinishRate * 100)}% of new slots · ~${agg.avgNewDonePerDay.toFixed(1)} new/day · ${goal.reason}`

  return {
    status: 'on_pace',
    headline: `On pace for ${goal.goalDate}`,
    detail,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions,
  }
}

function buildPastGoalAdvice(
  settings: AppSettings,
  goal: GoalReachability,
  metrics: PaceAdviceMetrics,
): PaceAdvice {
  const suggestions = baseSuggestions(settings)
  return {
    status: 'past_goal',
    headline: `Past goal date (${goal.goalDate})`,
    detail: `${goal.remainingUndone} undone Kept remain. Extend the goal date in Settings or raise new/day and finish reviews consistently.`,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions: suggestions.filter((s) => s.action !== 'keep'),
  }
}

function buildColdStartAdvice(
  settings: AppSettings,
  goal: GoalReachability,
  pacing: PacingResult,
  metrics: PaceAdviceMetrics,
): PaceAdvice {
  if (!goal.onTrack) {
    return buildBehindAdvice(settings, pacing, goal, aggregateHistory([]), metrics, true)
  }
  return {
    status: goal.onTrack ? 'on_pace' : 'behind',
    headline: goal.onTrack ? `On pace for ${goal.goalDate}` : `Behind schedule for ${goal.goalDate}`,
    detail: `${goal.reason} Keep working a few days — pace advice adapts from your finish rates.`,
    windowDays: ADVICE_WINDOW_DAYS,
    metrics,
    suggestions: baseSuggestions(settings).map((s) => ({
      ...s,
      why: 'Not enough history yet — settings look reasonable for now.',
    })),
  }
}

/** Adaptive pace coach: compares settings + goal against recent completion history. */
export function computePaceAdvice(): PaceAdvice {
  const settings = getAppSettings()
  const pacing = computePacing()
  const goal = goalReachability()
  const history = loadHistory(ADVICE_WINDOW_DAYS)
  const agg = aggregateHistory(history)
  const daysWithAnyData = history.filter(
    (d) => d.review.assigned > 0 || d.new.assigned > 0,
  ).length
  const coldStart = daysWithAnyData < MIN_HISTORY_DAYS

  const daysLeftForNew =
    goal.daysLeftAfterBootstrap > 0 ? goal.daysLeftAfterBootstrap : pacing.daysLeft

  const metrics: PaceAdviceMetrics = {
    reviewFinishRate:
      agg.reviewAssigned > 0 ? agg.reviewDone / agg.reviewAssigned : 1,
    newFinishRate: agg.newAssigned > 0 ? agg.newDone / agg.newAssigned : 1,
    avgReviewsDonePerDay: agg.avgReviewsDonePerDay,
    avgNewDonePerDay: agg.avgNewDonePerDay,
    unfinishedReviewDays: agg.unfinishedReviewDays,
    overdueNow: pacing.reviewsOverdue,
    daysLeft: pacing.daysLeft,
    remainingUndone: goal.remainingUndone,
    neededNewPerDay: goal.neededNewPerDay,
    effectiveNewPerDay: effectiveNewFromSettings(
      settings,
      goal.remainingUndone,
      daysLeftForNew,
    ),
    linearGap: linearGap(pacing, settings.goal_date),
  }

  if (goal.remainingUndone <= 0) {
    return {
      status: 'on_pace',
      headline: 'All Kept problems done',
      detail: 'No pacing changes needed — enjoy maintenance reviews.',
      windowDays: ADVICE_WINDOW_DAYS,
      metrics,
      suggestions: baseSuggestions(settings),
    }
  }

  if (pacing.daysLeft <= 0 || goal.reason.startsWith('Past goal')) {
    return buildPastGoalAdvice(settings, goal, metrics)
  }

  if (isBootstrapActive()) {
    return buildBootstrapAdvice(settings, pacing, goal, agg, metrics, coldStart)
  }

  if (coldStart) {
    return buildColdStartAdvice(settings, goal, pacing, metrics)
  }

  if (isOverloaded(agg, pacing)) {
    return buildOverloadedAdvice(settings, pacing, goal, agg, metrics)
  }

  const clearlyBehind =
    !goal.onTrack ||
    metrics.linearGap < -2 ||
    goal.neededNewPerDay > metrics.effectiveNewPerDay + 0.5

  if (clearlyBehind) {
    return buildBehindAdvice(settings, pacing, goal, agg, metrics, false)
  }

  const clearlyAhead =
    goal.onTrack && metrics.linearGap >= 3 && metrics.reviewFinishRate >= REVIEW_FINISH_THRESHOLD

  if (clearlyAhead) {
    return buildAheadAdvice(settings, pacing, goal, metrics)
  }

  return buildOnPaceAdvice(settings, goal, metrics, agg)
}

export { settingLabel }
