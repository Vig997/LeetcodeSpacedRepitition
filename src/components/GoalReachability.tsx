import type { GoalReachability as Goal } from '../lib/pacing'

export default function GoalReachability({ goal }: { goal: Goal }) {
  if (goal.bootstrapActive) {
    const postGoalLine =
      goal.remainingUndone > 0
        ? `After bootstrap: ${goal.daysLeftAfterBootstrap} days until ${goal.goalDate} for ${goal.remainingUndone} undone Kept`
        : `Goal ${goal.goalDate}: all Kept problems done`
    return (
      <div className="rounded-xl border border-sky-800/60 bg-sky-950/40 px-4 py-3 text-sm text-sky-200">
        <div className="font-medium text-sky-100">Bootstrap in progress</div>
        <div className="mt-1 text-sky-300/90">{goal.reason}</div>
        <div className="mt-1 text-xs text-sky-400/80">{postGoalLine}</div>
      </div>
    )
  }

  if (goal.onTrack) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-950/40 px-4 py-2.5 text-sm text-emerald-300">
        <span className="text-base leading-none">✓</span>
        <span>
          On track for {goal.goalDate}
          <span className="text-emerald-500/80"> · {goal.reason}</span>
        </span>
      </div>
    )
  }
  const pastGoal = goal.reason.startsWith('Past goal')
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
        pastGoal
          ? 'border-amber-800/60 bg-amber-950/40 text-amber-300'
          : 'border-red-800/60 bg-red-950/40 text-red-300'
      }`}
    >
      <span className="text-base leading-none">{pastGoal ? '⏱' : '⚠'}</span>
      <span>
        {pastGoal ? goal.reason : `Won't reach ${goal.goalDate} at this pace`}
        {!pastGoal && <span className="text-red-400/80"> · {goal.reason}</span>}
      </span>
    </div>
  )
}
