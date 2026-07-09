import type { GoalReachability, PacingResult } from '../lib/pacing'
import type { PaceAdvice } from '../lib/paceAdvice'
import { settingLabel } from '../lib/paceAdvice'
import type { TodayLoadSummary } from '../lib/todayAssignments'

interface Props {
  goal: GoalReachability
  pacing: PacingResult
  advice: PaceAdvice
  todayLoad: TodayLoadSummary
}

type Tone = 'ok' | 'warn' | 'bad' | 'bootstrap'

const TONE: Record<Tone, { border: string; bg: string; title: string; body: string; badge: string }> = {
  ok: {
    border: 'border-emerald-800/60',
    bg: 'bg-emerald-950/30',
    title: 'text-emerald-100',
    body: 'text-emerald-300/90',
    badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50',
  },
  warn: {
    border: 'border-amber-800/60',
    bg: 'bg-amber-950/30',
    title: 'text-amber-100',
    body: 'text-amber-300/90',
    badge: 'bg-amber-900/60 text-amber-300 border-amber-700/50',
  },
  bad: {
    border: 'border-red-800/60',
    bg: 'bg-red-950/30',
    title: 'text-red-100',
    body: 'text-red-300/90',
    badge: 'bg-red-900/60 text-red-300 border-red-700/50',
  },
  bootstrap: {
    border: 'border-sky-800/60',
    bg: 'bg-sky-950/30',
    title: 'text-sky-100',
    body: 'text-sky-300/90',
    badge: 'bg-sky-900/60 text-sky-300 border-sky-700/50',
  },
}

function formatSettingValue(
  setting: PaceAdvice['suggestions'][0]['setting'],
  v: number,
): string {
  if (setting === 'new_per_day' && v === 0) return 'Auto'
  return String(v)
}

function formatGoalDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function headline(
  goal: GoalReachability,
  advice: PaceAdvice,
  pacing: PacingResult,
): { tone: Tone; title: string; subtitle: string } {
  if (goal.remainingUndone <= 0) {
    return { tone: 'ok', title: 'All Kept Problems Done', subtitle: goal.reason }
  }
  if (goal.reason.startsWith('Past Goal')) {
    return { tone: 'warn', title: 'Past Goal Date', subtitle: goal.reason }
  }
  if (!pacing.bootstrapActive && !goal.onTrack) {
    return {
      tone: 'bad',
      title: `Behind Schedule For ${formatGoalDate(goal.goalDate)}`,
      subtitle: goal.reason,
    }
  }

  const paceLabel =
    advice.status === 'ahead'
      ? 'Ahead of Schedule'
      : advice.status === 'overloaded'
        ? 'Overloaded — Lighten Daily Caps'
        : 'On Pace'

  return {
    tone: advice.status === 'overloaded' ? 'warn' : 'ok',
    title: `${paceLabel} for ${formatGoalDate(goal.goalDate)}`,
    subtitle: goal.reason,
  }
}

function BootstrapHeader({
  goal,
  pacing,
  todayLoad,
  styles,
}: {
  goal: GoalReachability
  pacing: PacingResult
  todayLoad: TodayLoadSummary
  styles: (typeof TONE)[Tone]
}) {
  const progressPct =
    pacing.bootstrapPoolTotal > 0
      ? Math.round((pacing.bootstrapBaselineDone / pacing.bootstrapPoolTotal) * 100)
      : 0
  const onTrack = goal.onTrack
  const neededNew = Math.ceil(goal.neededNewPerDay)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-sky-100">Bootstrap Phase</span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${styles.badge}`}
            >
              {onTrack ? 'On Track' : 'Behind Goal'}
            </span>
          </div>
          <p className="mt-1 text-sm text-sky-300/80">
            Goal · {formatGoalDate(goal.goalDate)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-sky-100">
            {pacing.bootstrapRemaining}
          </div>
          <div className="text-[10px] tracking-wide text-sky-400/70 uppercase">
            Bootstrap Left
          </div>
        </div>
      </div>

      {pacing.bootstrapPoolTotal > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-sky-300/70">
            <span>
              {pacing.bootstrapBaselineDone} of {pacing.bootstrapPoolTotal} Bootstrapped
            </span>
            <span>~{pacing.bootstrapDaysRemaining} Days Left</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sky-950/80 ring-1 ring-sky-800/40">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-500"
              style={{ width: `${Math.max(progressPct, 2)}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-sky-800/40 bg-sky-950/50 px-3 py-2.5">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-sky-400 uppercase">
            Right Now
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-lg font-semibold text-gray-100">{todayLoad.reviewCount}</div>
              <div className="text-[10px] text-gray-500">Reviews Today</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-100">{todayLoad.newCount}</div>
              <div className="text-[10px] text-gray-500">
                New{pacing.bootstrapNewPerDay > 0 ? ` · ${pacing.bootstrapNewPerDay}/Day` : ''}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gray-800/60 bg-gray-950/40 px-3 py-2.5">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
            After Bootstrap
          </div>
          {goal.remainingUndone > 0 ? (
            <div className="flex gap-6">
              <div>
                <div className="text-lg font-semibold text-gray-100">{goal.remainingUndone}</div>
                <div className="text-[10px] text-gray-500">Undone Kept</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-100">{goal.daysLeftAfterBootstrap}</div>
                <div className="text-[10px] text-gray-500">Days To Goal</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-100">~{neededNew}</div>
                <div className="text-[10px] text-gray-500">New/Day Needed</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">All Kept Problems Done</p>
          )}
        </div>
      </div>
    </>
  )
}

export default function PaceOverview({ goal, pacing, advice, todayLoad }: Props) {
  const styles = TONE[pacing.bootstrapActive ? 'bootstrap' : headline(goal, advice, pacing).tone]
  const { title, subtitle } = headline(goal, advice, pacing)

  const actionable = advice.suggestions.filter((s) => s.action !== 'keep')
  const showAdviceDetail =
    !pacing.bootstrapActive &&
    advice.status !== 'on_pace' &&
    advice.detail.length > 0 &&
    !advice.detail.startsWith(subtitle)

  return (
    <div className={`rounded-xl border px-4 py-4 ${styles.border} ${styles.bg}`}>
      {pacing.bootstrapActive ? (
        <BootstrapHeader goal={goal} pacing={pacing} todayLoad={todayLoad} styles={styles} />
      ) : (
        <>
          <div className={`text-sm font-semibold ${styles.title}`}>{title}</div>
          <p className={`mt-1 text-sm ${styles.body}`}>{subtitle}</p>
        </>
      )}

      {!pacing.bootstrapActive && pacing.behindNew && (
        <p className="mt-2 text-xs text-amber-400">Catch-Up: Extra New Slot Today</p>
      )}

      {showAdviceDetail && (
        <p className="mt-2 text-xs text-gray-400">{advice.detail}</p>
      )}

      {actionable.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-300">
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
