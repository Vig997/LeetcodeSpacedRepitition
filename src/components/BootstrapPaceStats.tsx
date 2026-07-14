import type { GoalReachability, PacingResult } from '../lib/pacing'
import type { TodayLoadSummary } from '../lib/todayAssignments'

interface Props {
  goal: GoalReachability
  pacing: PacingResult
  todayLoad: TodayLoadSummary
}

export default function BootstrapPaceStats({ goal, pacing, todayLoad }: Props) {
  const neededNew = Math.ceil(goal.neededNewPerDay)

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-sky-800/40 bg-sky-950/50 px-4 py-3">
        <div className="mb-2 text-[10px] font-semibold tracking-wide text-sky-400 uppercase">
          Right Now
        </div>
        <div className="flex gap-8">
          <div>
            <div className="text-xl font-semibold tabular-nums text-gray-100">
              {todayLoad.reviewCount}
            </div>
            <div className="text-[10px] text-gray-500">Reviews Today</div>
          </div>
          <div>
            <div className="text-xl font-semibold tabular-nums text-gray-100">
              {todayLoad.newCount}
            </div>
            <div className="text-[10px] text-gray-500">
              New{pacing.bootstrapNewPerDay > 0 ? ` · ${pacing.bootstrapNewPerDay}/Day` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800/60 bg-gray-950/40 px-4 py-3">
        <div className="mb-2 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
          After Bootstrap
        </div>
        {goal.remainingUndone > 0 ? (
          <div className="flex gap-8">
            <div>
              <div className="text-xl font-semibold tabular-nums text-gray-100">
                {goal.remainingUndone}
              </div>
              <div className="text-[10px] text-gray-500">Undone Kept</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums text-gray-100">
                {goal.daysLeftAfterBootstrap}
              </div>
              <div className="text-[10px] text-gray-500">Days To Goal</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums text-gray-100">~{neededNew}</div>
              <div className="text-[10px] text-gray-500">New/Day Needed</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">All Kept Problems Done</p>
        )}
      </div>
    </div>
  )
}
