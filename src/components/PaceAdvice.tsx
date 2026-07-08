import type { PaceAdvice, PaceAdviceStatus } from '../lib/paceAdvice'
import { settingLabel } from '../lib/paceAdvice'

const STATUS_STYLES: Record<
  PaceAdviceStatus,
  { border: string; bg: string; title: string; body: string }
> = {
  on_pace: {
    border: 'border-emerald-800/60',
    bg: 'bg-emerald-950/40',
    title: 'text-emerald-100',
    body: 'text-emerald-300/90',
  },
  ahead: {
    border: 'border-emerald-800/60',
    bg: 'bg-emerald-950/40',
    title: 'text-emerald-100',
    body: 'text-emerald-300/90',
  },
  behind: {
    border: 'border-red-800/60',
    bg: 'bg-red-950/40',
    title: 'text-red-100',
    body: 'text-red-300/90',
  },
  overloaded: {
    border: 'border-amber-800/60',
    bg: 'bg-amber-950/40',
    title: 'text-amber-100',
    body: 'text-amber-300/90',
  },
  past_goal: {
    border: 'border-amber-800/60',
    bg: 'bg-amber-950/40',
    title: 'text-amber-100',
    body: 'text-amber-300/90',
  },
  bootstrap: {
    border: 'border-sky-800/60',
    bg: 'bg-sky-950/40',
    title: 'text-sky-100',
    body: 'text-sky-300/90',
  },
}

function formatSettingValue(setting: PaceAdvice['suggestions'][0]['setting'], v: number): string {
  if (setting === 'new_per_day' && v === 0) return 'Auto'
  return String(v)
}

function actionLabel(action: 'increase' | 'decrease' | 'keep'): string {
  switch (action) {
    case 'increase':
      return 'Increase'
    case 'decrease':
      return 'Decrease'
    case 'keep':
      return 'Keep'
  }
}

export default function PaceAdvicePanel({ advice }: { advice: PaceAdvice }) {
  const styles = STATUS_STYLES[advice.status]
  const m = advice.metrics
  const actionable = advice.suggestions.filter((s) => s.action !== 'keep' || s.why.length > 0)

  return (
    <div className={`rounded-xl border px-4 py-3 ${styles.border} ${styles.bg}`}>
      <div className={`text-sm font-medium ${styles.title}`}>{advice.headline}</div>
      <p className={`mt-1 text-sm ${styles.body}`}>{advice.detail}</p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>
          Reviews finished: {Math.round(m.reviewFinishRate * 100)}%
        </span>
        <span>New finished: {Math.round(m.newFinishRate * 100)}%</span>
        {m.unfinishedReviewDays > 0 && (
          <span>{m.unfinishedReviewDays} days left reviews open</span>
        )}
        {m.linearGap !== 0 && (
          <span>
            Schedule gap: {m.linearGap > 0 ? '+' : ''}
            {m.linearGap}
          </span>
        )}
        {m.overdueNow > 0 && <span>{m.overdueNow} overdue</span>}
      </div>

      {actionable.length > 0 && (
        <ul className={`mt-3 space-y-1.5 text-sm ${styles.body}`}>
          {actionable.map((s) => (
            <li key={s.setting} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <span className="shrink-0 font-medium text-gray-200">
                {actionLabel(s.action)} {settingLabel(s.setting)}
                {s.action !== 'keep' && (
                  <span className="font-normal text-gray-400">
                    {' '}
                    {formatSettingValue(s.setting, s.from)} → {formatSettingValue(s.setting, s.to)}
                  </span>
                )}
              </span>
              {s.why && <span className="text-xs text-gray-400 sm:text-sm">{s.why}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-gray-500">
        Based on last {advice.windowDays} days · change values in Settings
      </p>
    </div>
  )
}
