import { db } from './db'
import { getAppSettings, getNumberSetting, getSetting } from './settings'
import { todayStr, addDays, daysUntil, daysBetween } from './dates'
import { isBootstrapActive, getBootstrapNewPerDay, getBootstrapTotalDays } from './scheduler'
import type { AppSettings } from './types'

/** Soft floor: bump new by 1 when total load is light (post-bootstrap). */
export const LOAD_FLOOR = 5
export const LOAD_CEILING = 10
/** Extra new slot when behind the linear done-count ramp. */
export const MIN_NEW_WHEN_BEHIND = 1
export const MAX_NEW = 10
export const REVIEW_FLOOR = 3
export const REVIEW_HARD_CAP = 10

export interface PacingResult {
  /** True while a user-started bootstrap is running. */
  bootstrapActive: boolean
  /** New/day cap chosen at bootstrap start; 0 = new locked during bootstrap. */
  bootstrapNewPerDay: number
  goalDate: string
  daysLeft: number
  keptTotal: number
  doneKept: number
  remainingNew: number
  srDueCount: number
  bootstrapDue: number
  /** Problems still in the baseline queue. */
  bootstrapRemaining: number
  /** Estimated calendar days to finish the baseline queue. */
  bootstrapDaysRemaining: number
  /** Fixed period length from Start Bootstrap (ceil selected ÷ cap). */
  bootstrapTotalDays: number
  /** Baseline reviews finished this bootstrap run. */
  bootstrapBaselineDone: number
  /** Total problems selected when bootstrap started. */
  bootstrapPoolTotal: number
  newToday: number
  /** The auto-computed ideal new/day for the goal date (before caps). */
  idealNewPerDay: number
  reviewsToday: number
  evenLoad: number
  behindNew: boolean
  unusedNewYesterday: number
  unusedReviewsYesterday: number
  /** All done problems due today (reviews + bootstrap baseline). */
  reviewsDueTotal: number
  /** Due before today — honest backlog not all assigned. */
  reviewsOverdue: number
}

interface Aggregates {
  keptTotal: number
  doneKept: number
  srDueCount: number
  bootstrapDue: number
  bootstrapRemaining: number
  reviewsDueTotal: number
  reviewsOverdue: number
}

function aggregates(): Aggregates {
  const today = todayStr()
  const row = db
    .prepare(
      `SELECT
        SUM(CASE WHEN is_custom = 0 AND is_excluded = 0 THEN 1 ELSE 0 END) AS kept_total,
        SUM(CASE WHEN is_custom = 0 AND is_excluded = 0 AND first_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done_kept,
        SUM(CASE WHEN is_excluded = 0 AND is_custom = 0 AND first_completed_at IS NOT NULL
          AND status != 'bootstrap' AND next_review_at <= ? THEN 1 ELSE 0 END) AS sr_due,
        SUM(CASE WHEN is_excluded = 0 AND status = 'bootstrap' AND next_review_at <= ? THEN 1 ELSE 0 END) AS bootstrap_due,
        SUM(CASE WHEN is_excluded = 0 AND status = 'bootstrap' THEN 1 ELSE 0 END) AS bootstrap_remaining,
        SUM(CASE WHEN is_excluded = 0 AND first_completed_at IS NOT NULL AND next_review_at <= ? THEN 1 ELSE 0 END) AS due_total,
        SUM(CASE WHEN is_excluded = 0 AND first_completed_at IS NOT NULL AND next_review_at < ? THEN 1 ELSE 0 END) AS overdue
      FROM problems`,
    )
    .get(today, today, today, today) as Record<string, number | null>

  return {
    keptTotal: row.kept_total ?? 0,
    doneKept: row.done_kept ?? 0,
    srDueCount: row.sr_due ?? 0,
    bootstrapDue: row.bootstrap_due ?? 0,
    bootstrapRemaining: row.bootstrap_remaining ?? 0,
    reviewsDueTotal: row.due_total ?? 0,
    reviewsOverdue: row.overdue ?? 0,
  }
}

function uncheckedYesterday(kind: 'review' | 'new'): number {
  const yesterday = addDays(todayStr(), -1)
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM today_assignments WHERE assignment_date = ? AND kind = ? AND checked = 0",
    )
    .get(yesterday, kind) as { c: number }
  return row.c
}

function unusedNewYesterday(bootstrapActive: boolean): number {
  if (bootstrapActive) return 0
  return uncheckedYesterday('new')
}

/** Unchecked bootstrap review slots from yesterday → added to today's cap. */
function unusedReviewsYesterday(bootstrapActive: boolean): number {
  if (!bootstrapActive) return 0
  return uncheckedYesterday('review')
}

/**
 * Effective new/day: user override, or auto from remaining ÷ days left.
 * Auto rounds UP so the derived pace always reaches the goal date.
 */
function effectiveNewPerDay(
  configured: number,
  remainingNew: number,
  daysLeft: number,
): { value: number; ideal: number } {
  const ideal = remainingNew / Math.max(daysLeft, 1)
  if (configured > 0) return { value: configured, ideal }
  return {
    value: Math.min(Math.max(Math.ceil(ideal), 1), MAX_NEW),
    ideal,
  }
}

/** Core daily numbers — recomputed on every dashboard render. */
export function computePacing(): PacingResult {
  const s = getAppSettings()
  const agg = aggregates()
  const bootstrapActive = isBootstrapActive()
  const bootstrapNewPerDay = bootstrapActive ? getBootstrapNewPerDay() : 0
  const daysLeft = daysUntil(s.goal_date)
  const remainingNew = agg.keptTotal - agg.doneKept

  // Linear done-count ramp toward the goal date (behind detection)
  const startDate = getSetting('start_date') ?? todayStr()
  const startDone = getNumberSetting('start_done', 0)
  const totalSpan = Math.max(daysBetween(startDate, s.goal_date), 1)
  const elapsedRatio = Math.min(Math.max(1 - daysLeft / totalSpan, 0), 1)
  const targetDone = Math.round(startDone + (agg.keptTotal - startDone) * elapsedRatio)

  const unusedNew = unusedNewYesterday(bootstrapActive)
  const unusedReviews = unusedReviewsYesterday(bootstrapActive)
  const behindNew =
    !bootstrapActive && (agg.doneKept < targetDone || unusedNew > 0)

  const { value: perDay, ideal } = effectiveNewPerDay(
    s.new_per_day,
    remainingNew,
    daysLeft,
  )

  // A — new problems today
  let newToday = 0
  if (bootstrapActive && bootstrapNewPerDay > 0 && remainingNew > 0) {
    const carried = uncheckedYesterday('new')
    // Bootstrap new does not stack: persist open slots, never cap + carried.
    if (carried >= bootstrapNewPerDay) {
      newToday = Math.min(carried, remainingNew, MAX_NEW)
    } else {
      newToday = Math.min(bootstrapNewPerDay, remainingNew, MAX_NEW)
    }
  } else if (!bootstrapActive && remainingNew > 0) {
    // Still assign new when past goal — Auto uses max(daysLeft, 1) internally.
    newToday = Math.min(Math.max(perDay, 1), MAX_NEW)
    if (behindNew) newToday = Math.min(newToday + MIN_NEW_WHEN_BEHIND, MAX_NEW)
  }

  // B — reviews today (bootstrap queue only while bootstrap is active)
  const reviewCeiling = Math.min(s.review_daily_target, REVIEW_HARD_CAP)
  let reviewsToday: number
  if (bootstrapActive) {
    reviewsToday = Math.min(s.bootstrap_daily_cap + unusedReviews, REVIEW_HARD_CAP)
  } else {
    let reviewsWanted = agg.srDueCount
    if (agg.bootstrapDue > 0) {
      reviewsWanted = Math.max(
        reviewsWanted,
        Math.min(agg.bootstrapDue, s.bootstrap_daily_cap),
      )
    }
    reviewsToday = Math.min(Math.max(reviewsWanted, 0), reviewCeiling, REVIEW_HARD_CAP)
    if (agg.srDueCount > 0) {
      reviewsToday = Math.max(reviewsToday, Math.min(agg.srDueCount, REVIEW_FLOOR))
    }
  }

  // C — soft total load cap: trim new first, never above LOAD_CEILING (10)
  if (!bootstrapActive || bootstrapNewPerDay > 0) {
    let combined = newToday + reviewsToday
    if (combined > LOAD_CEILING) {
      while (combined > LOAD_CEILING && newToday > 0) {
        newToday--
        combined--
      }
    } else if (
      !bootstrapActive &&
      combined < LOAD_FLOOR &&
      remainingNew > 0 &&
      newToday > 0 &&
      combined < LOAD_CEILING
    ) {
      newToday = Math.min(newToday + 1, MAX_NEW, LOAD_CEILING - reviewsToday)
    }
  }

  const bootstrapPoolTotal = bootstrapActive
    ? getNumberSetting('bootstrap_pool_total', agg.bootstrapRemaining)
    : 0
  const bootstrapBaselineDone = bootstrapActive
    ? Math.max(bootstrapPoolTotal - agg.bootstrapRemaining, 0)
    : 0
  const bootstrapDaysRemaining = bootstrapActive
    ? Math.ceil(agg.bootstrapRemaining / Math.max(s.bootstrap_daily_cap, 1))
    : 0

  return {
    bootstrapActive,
    bootstrapNewPerDay,
    goalDate: s.goal_date,
    daysLeft,
    keptTotal: agg.keptTotal,
    doneKept: agg.doneKept,
    remainingNew,
    srDueCount: agg.srDueCount,
    bootstrapDue: agg.bootstrapDue,
    bootstrapRemaining: agg.bootstrapRemaining,
    bootstrapDaysRemaining,
    bootstrapTotalDays: bootstrapActive ? getBootstrapTotalDays() : 0,
    bootstrapBaselineDone,
    bootstrapPoolTotal,
    newToday,
    idealNewPerDay: ideal,
    reviewsToday,
    evenLoad: newToday + reviewsToday,
    behindNew,
    unusedNewYesterday: unusedNew,
    unusedReviewsYesterday: unusedReviews,
    reviewsDueTotal: agg.reviewsDueTotal,
    reviewsOverdue: agg.reviewsOverdue,
  }
}

// ---- Goal reachability ------------------------------------------------------

export interface GoalReachability {
  onTrack: boolean
  reason: string
  goalDate: string
  neededNewPerDay: number
  daysLeftAfterBootstrap: number
  remainingUndone: number
  /** True while baseline bootstrap is running — copy should not imply active new/day pace. */
  bootstrapActive: boolean
  bootstrapRemaining: number
  bootstrapDaysRemaining: number
}

/**
 * On-track / Won't-reach the goal date. `overrides` lets Settings preview
 * live values (goal date, caps) before persisting.
 */
export function goalReachability(
  overrides?: Partial<AppSettings>,
): GoalReachability {
  const s = { ...getAppSettings(), ...overrides }
  const agg = aggregates()
  const daysLeft = daysUntil(s.goal_date)
  const remainingUndone = agg.keptTotal - agg.doneKept
  const bootstrapActive = isBootstrapActive()

  const daysInBootstrap = bootstrapActive
    ? Math.ceil(agg.bootstrapRemaining / Math.max(s.bootstrap_daily_cap, 1))
    : 0
  const daysLeftAfterBootstrap = Math.max(daysLeft - daysInBootstrap, 0)
  const neededNewPerDay =
    remainingUndone / Math.max(daysLeftAfterBootstrap, 1)

  const { value: perDay } = effectiveNewPerDay(
    s.new_per_day,
    remainingUndone,
    daysLeftAfterBootstrap,
  )
  const perDayLabel =
    s.new_per_day > 0 ? String(s.new_per_day) : `Auto (${perDay})`

  const base = {
    goalDate: s.goal_date,
    neededNewPerDay,
    daysLeftAfterBootstrap,
    remainingUndone,
    bootstrapActive,
    bootstrapRemaining: agg.bootstrapRemaining,
    bootstrapDaysRemaining: daysInBootstrap,
  }

  if (bootstrapActive) {
    const newNote =
      getBootstrapNewPerDay() > 0
        ? `${getBootstrapNewPerDay()} New/Day Enabled During Bootstrap`
        : 'New Problems Paused Until Bootstrap Finishes'
    return {
      ...base,
      onTrack: perDay * daysLeftAfterBootstrap >= remainingUndone || remainingUndone === 0,
      reason: `${agg.bootstrapRemaining} Bootstrap Left · ~${daysInBootstrap} Bootstrap Days · ${newNote}`,
    }
  }

  if (remainingUndone <= 0) {
    return { ...base, onTrack: true, reason: 'All Kept NeetCode Problems Are Done' }
  }
  if (daysLeft <= 0) {
    return {
      ...base,
      onTrack: false,
      reason: `Past Goal ${s.goal_date} — ${remainingUndone} Undone Kept; Update Goal Date in Settings`,
    }
  }
  if (daysLeftAfterBootstrap <= 0) {
    return {
      ...base,
      onTrack: false,
      reason: `No Days Left Before ${s.goal_date} for ${remainingUndone} Remaining Undone Kept Problems`,
    }
  }
  if (perDay * daysLeftAfterBootstrap < remainingUndone) {
    return {
      ...base,
      onTrack: false,
      reason: `Need ~${Math.ceil(neededNewPerDay)} New/Day for ${remainingUndone} Undone; You Set ${perDayLabel}`,
    }
  }
  return {
    ...base,
    onTrack: true,
    reason: `${perDayLabel} New/Day Covers ${remainingUndone} Undone in ${daysLeftAfterBootstrap} Days Until ${s.goal_date}`,
  }
}
