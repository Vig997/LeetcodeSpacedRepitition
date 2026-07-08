import { db } from './db'
import { DEFAULT_GOAL_DATE } from './dates'
import type { AppSettings } from './types'

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)

export function getSetting(key: string): string | null {
  const row = getStmt.get(key) as { value: string | null } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string | number | null): void {
  setStmt.run(key, value === null ? null : String(value))
}

export function getNumberSetting(key: string, fallback: number): number {
  const v = getSetting(key)
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const SETTINGS_MAX = 10

export const DEFAULT_SETTINGS: AppSettings = {
  goal_date: DEFAULT_GOAL_DATE,
  bootstrap_daily_cap: 6,
  review_daily_target: 6,
  new_per_day: 0, // 0 = Auto (derived from remaining ÷ days to goal)
}

/** The user's mastery goal date (Settings tab). */
export function getGoalDate(): string {
  const v = getSetting('goal_date')
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DEFAULT_GOAL_DATE
}

export function getAppSettings(): AppSettings {
  const cap = SETTINGS_MAX
  return {
    goal_date: getGoalDate(),
    bootstrap_daily_cap: Math.min(
      Math.max(getNumberSetting('bootstrap_daily_cap', DEFAULT_SETTINGS.bootstrap_daily_cap), 1),
      cap,
    ),
    review_daily_target: Math.min(
      Math.max(getNumberSetting('review_daily_target', DEFAULT_SETTINGS.review_daily_target), 1),
      cap,
    ),
    new_per_day: Math.min(
      Math.max(getNumberSetting('new_per_day', DEFAULT_SETTINGS.new_per_day), 0),
      cap,
    ),
  }
}
