import type { ReactNode } from 'react'
import type { PacingResult } from '../lib/pacing'
import { LOAD_CEILING } from '../lib/pacing'

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-gray-500 uppercase">{label}</div>
      <div className="text-base font-semibold text-gray-100">{value}</div>
    </div>
  )
}

function overdueLine(pacing: PacingResult): string {
  const waiting = Math.max(pacing.reviewsDueTotal - pacing.reviewsToday, 0)
  const overdue = pacing.reviewsOverdue
  if (overdue > 0 && waiting > 0) {
    return `${pacing.reviewsToday} today · ${overdue} overdue waiting`
  }
  if (overdue > 0) {
    return `${pacing.reviewsToday} today · ${overdue} overdue`
  }
  if (waiting > 0) {
    return `${pacing.reviewsToday} today · ${waiting} more due waiting`
  }
  return `${pacing.reviewsToday} assigned today`
}

export default function PaceStrip({ pacing }: { pacing: PacingResult }) {
  const loadOk = pacing.evenLoad <= LOAD_CEILING

  if (pacing.bootstrapActive) {
    const progressPct =
      pacing.bootstrapPoolTotal > 0
        ? Math.round((pacing.bootstrapBaselineDone / pacing.bootstrapPoolTotal) * 100)
        : 0
    const newLabel =
      pacing.bootstrapNewPerDay > 0
        ? `${pacing.newToday} new on Today · New (${pacing.bootstrapNewPerDay}/day)`
        : 'New problems paused during bootstrap'

    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-4">
          <div className="mb-3 text-xs font-semibold tracking-wide text-gray-400 uppercase">
            Today
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Reviews assigned" value={pacing.reviewsToday} />
            <Stat label="Reviews due" value={overdueLine(pacing)} />
            {pacing.bootstrapNewPerDay > 0 && (
              <Stat label="New today" value={pacing.newToday} />
            )}
            <Stat
              label="Total load"
              value={
                <span className={loadOk ? 'text-emerald-300' : 'text-amber-300'}>
                  {pacing.evenLoad}
                </span>
              }
            />
          </div>
          <div className="mt-2 text-sm text-gray-400">{newLabel}</div>
        </div>
        <div className="rounded-xl border border-sky-800/50 bg-sky-950/30 px-5 py-4">
          <div className="mb-3 text-xs font-semibold tracking-wide text-sky-400 uppercase">
            Bootstrap progress
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Bootstrap left" value={pacing.bootstrapRemaining} />
            <Stat label="Bootstrap period" value={`${pacing.bootstrapTotalDays} days`} />
            <Stat label="~Days left" value={pacing.bootstrapDaysRemaining} />
            <Stat label="Due today" value={pacing.bootstrapDue} />
          </div>
          {pacing.bootstrapPoolTotal > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>
                  {pacing.bootstrapBaselineDone} of {pacing.bootstrapPoolTotal} bootstrapped
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
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-4">
      <div className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        Today · Goal {pacing.goalDate}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Reviews" value={overdueLine(pacing)} />
        <Stat label="New today" value={pacing.newToday} />
        <Stat
          label="Total load"
          value={
            <span className={loadOk ? 'text-emerald-300' : 'text-amber-300'}>
              {pacing.evenLoad}
            </span>
          }
        />
        <Stat label="Days until goal" value={pacing.daysLeft} />
        <Stat label="Undone Kept" value={pacing.remainingNew} />
      </div>
      {pacing.behindNew && (
        <div className="mt-2 text-xs text-amber-400">Catch-up pace — extra new slot today</div>
      )}
    </div>
  )
}
