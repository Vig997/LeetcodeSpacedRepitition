export const DEFAULT_GOAL_DATE = '2026-09-01'

/** Local calendar day as YYYY-MM-DD. */
export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Whole days from `from` to `to` (local midnights); negative if past. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = new Date(fy, fm - 1, fd).getTime()
  const b = new Date(ty, tm - 1, td).getTime()
  return Math.round((b - a) / 86_400_000)
}

export function daysUntil(dateStr: string): number {
  return Math.max(daysBetween(todayStr(), dateStr), 0)
}

/** Parse YYYY-MM-DD or MM/DD/YYYY into canonical YYYY-MM-DD, or null if invalid. */
export function parseGoalDateInput(raw: string): string | null {
  const trimmed = raw.trim()
  let y: number
  let m: number
  let d: number

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else {
    const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!us) return null
    m = Number(us[1])
    d = Number(us[2])
    y = Number(us[3])
  }

  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null

  const canonical = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (daysBetween(todayStr(), canonical) <= 0) return null
  return canonical
}

export function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${m}/${d}/${y}`
}

export function nowISO(): string {
  return new Date().toISOString()
}
