import { addDays } from './dates'

export const MAX_INTERVAL_DAYS = 365

export function capIntervalDays(interval: number): number {
  if (!Number.isFinite(interval) || interval < 1) return 1
  return Math.min(Math.round(interval), MAX_INTERVAL_DAYS)
}

/** Spread post-bootstrap-deferral clumps by 0–2 days per problem. */
export function bootstrapSpreadJitter(problemId: number, applyJitter: boolean): number {
  if (!applyJitter) return 0
  return problemId % 3
}

/** Next review date from a rating day, SR interval, and optional bootstrap deferral. */
export function computeNextReviewAt(
  fromDay: string,
  srInterval: number,
  problemId: number,
  bootstrapDeferralDays: number,
): string {
  const sr = capIntervalDays(srInterval)
  const deferral = Math.max(0, Math.round(bootstrapDeferralDays))
  const jitter = bootstrapSpreadJitter(problemId, deferral > 0)
  return addDays(fromDay, sr + deferral + jitter)
}
