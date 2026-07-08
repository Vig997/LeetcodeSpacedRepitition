import type { ReactNode } from 'react'
import type { GoalReachability, PacingResult } from '../lib/pacing'
import { LOAD_CEILING } from '../lib/pacing'
import type { PaceAdvice } from '../lib/paceAdvice'
import { settingLabel } from '../lib/paceAdvice'

interface Props {
  goal: GoalReachability
  pacing: PacingResult
  advice: PaceAdvice
}

type Tone = 'ok' | 'warn' | 'bad' | 'bootstrap'

const TONE: Record<Tone, { border: string; bg: string; title: string; body: string }> = {
  ok: {
    border: 'border-emerald-800/60',
    bg: 'bg-emerald-950/30',
    title: 'text-emerald-100',
    body: 'text-emerald-300/90',
  },
  warn: {
    border: 'border-amber-800/60',
    bg: 'bg-amber-950/30',
    title: 'text-amber-100',
    body: 'text-amber-300/90',
  },
  bad: {
    border: 'border-red-800/60',
    bg: 'bg-red-950/30',
    title: 'text-red-100',
    body: 'text-red-300/90',
  },
  bootstrap: {
    border: 'border-sky-800/60',
    bg: 'bg-sky-950/30',
    title: 'text-sky-100',
    body: 'text-sky-300/90',
  },
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-gray-500 uppercase">{label}</div>
      <div className="text-sm font-semibold text-gray-100">{value}</div>
    </div>
  )
}

function formatSettingValue(
  setting: PaceAdvice['suggestions'][0]['setting'],
  v: number,
): string {
  if (setting === 'new_per_day' && v === 0) return 'Auto'
  return String(v)
}

function headline(goal: GoalReachability, advice: PaceAdvice, pacing: PacingResult): {
  tone: Tone
  title: string
  subtitle: string
} {
  if (pacing.bootstrapActive) {
    const track = goal.onTrack ? 'On track' : "Won't reach goal"
    const after =
      goal.remainingUndone > 0
        ? `Then ${goal.remainingUndone} undone in ${goal.daysLeftAfterBootstrap} days (~${Math.ceil(goal.neededNewPerDay)} new/day for ${goal.goalDate})`
        : `Goal ${goal.goalDate}: all Kept done`
    return {
      tone: 'bootstrap',
      title: `Baseline phase · ${track} for ${goal.goalDate}`,
      subtitle: `${pacing.bootstrapRemaining} baseline left · ~${pacing.bootstrapDaysRemaining} days · ${after}`,
    }
  }

  if (goal.remainingUndone <= 0) {
    return { tone: 'ok', title: 'All Kept problems done', subtitle: goal.reason }
  }
  if (goal.reason.startsWith('Past goal')) {
    return { tone: 'warn', title: 'Past goal date', subtitle: goal.reason }
  }
  if (!goal.onTrack) {
    return {
      tone: 'bad',
      title: `Behind schedule for ${goal.goalDate}`,
      subtitle: goal.reason,
    }
  }

  const paceLabel =
    advice.status === 'ahead'
      ? 'Ahead of schedule'
      : advice.status === 'overloaded'
        ? 'Overloaded — lighten daily caps'
        : 'On pace'

  return {
    tone: advice.status === 'overloaded' ? 'warn' : 'ok',
    title: `${paceLabel} for ${goal.goalDate}`,
    subtitle: goal.reason,
  }
}

export default function PaceOverview({ goal, pacing, advice }: Props) {
  const { tone, title, subtitle } = headline(goal, advice, pacing)
  const styles = TONE[tone]
  const loadOk = pacing.evenLoad <= LOAD_CEILING
  const progressPct =
    pacing.bootstrapPoolTotal > 0
      ? Math.round((pacing.bootstrapBaselineDone / pacing.bootstrapPoolTotal) * 100)
      : 0

  const actionable = advice.suggestions.filter((s) => s.action !== 'keep')
  const showAdviceDetail =
    !pacing.bootstrapActive &&
    advice.status !== 'on_pace' &&
    advice.detail.length > 0 &&
    !advice.detail.startsWith(subtitle)

  return (
    <div className={`rounded-xl border px-4 py-3 ${styles.border} ${styles.bg}`}>
      <div className={`text-sm font-semibold ${styles.title}`}>{title}</div>
      <p className={`mt-1 text-sm ${styles.body}`}>{subtitle}</p>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-800/60 pt-3 sm:grid-cols-4">
        <Stat
          label="Today · reviews"
          value={
            pacing.reviewsOverdue > 0
              ? `${pacing.reviewsToday} (${pacing.reviewsOverdue} overdue)`
              : pacing.reviewsToday
          }
        />
        <Stat label="Today · new" value={pacing.newToday} />
        <Stat
          label="Load"
          value={
            <span className={loadOk ? 'text-emerald-300' : 'text-amber-300'}>
              {pacing.evenLoad}/{LOAD_CEILING}
            </span>
          }
        />
        {pacing.bootstrapActive ? (
          <Stat label="Baseline due" value={pacing.bootstrapDue} />
        ) : (
          <>
            <Stat label="Days left" value={pacing.daysLeft} />
            <Stat label="Undone Kept" value={pacing.remainingNew} />
          </>
        )}
      </div>

      {pacing.bootstrapActive && pacing.bootstrapPoolTotal > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>
              {pacing.bootstrapBaselineDone} of {pacing.bootstrapPoolTotal} baselined
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {!pacing.bootstrapActive && pacing.behindNew && (
        <p className="mt-2 text-xs text-amber-400">Catch-up: extra new slot today</p>
      )}

      {showAdviceDetail && (
        <p className="mt-2 text-xs text-gray-400">{advice.detail}</p>
      )}

      {actionable.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-300">
          {actionable.map((s) => (
            <li key={s.setting}>
              <span className="font-medium capitalize">{s.action}</span>{' '}
              {settingLabel(s.setting)}
              {s.action !== 'keep' && (
                <span className="text-gray-500">
                  {' '}
                  {formatSettingValue(s.setting, s.from)} →{' '}
                  {formatSettingValue(s.setting, s.to)}
                </span>
              )}
              {s.why && <span className="text-gray-500"> — {s.why}</span>}
            </li>
          ))}
          <li className="text-[11px] text-gray-500">Change in Settings</li>
        </ul>
      )}
    </div>
  )
}
