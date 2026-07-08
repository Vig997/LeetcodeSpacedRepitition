import { DifficultyBadge, TopicBadge, OpenLink } from './Badges'
import type { AssignmentWithProblem } from '../lib/todayAssignments'

interface Props {
  assignments: AssignmentWithProblem[]
  /** When > 0, bootstrap has optional new/day enabled (empty state copy differs). */
  bootstrapNewPerDay?: number
  onCheck: (a: AssignmentWithProblem) => void
  onAddExtra?: () => void
  canAddExtra?: boolean
}

export default function TodayNewList({
  assignments,
  bootstrapNewPerDay = 0,
  onCheck,
  onAddExtra,
  canAddExtra = true,
}: Props) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-gray-400 uppercase">
          Today · New ({assignments.length})
        </h2>
        {onAddExtra && (
          <button
            type="button"
            onClick={onAddExtra}
            disabled={!canAddExtra}
            className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:border-sky-700 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
            title="Add the next undone Kept problem for today only (resets tomorrow)"
          >
            + Extra new
          </button>
        )}
      </div>
      {assignments.length === 0 ? (
        <p className="text-sm text-gray-500">
          {bootstrapNewPerDay > 0
            ? `Bootstrap new pace: ${bootstrapNewPerDay}/day — use + Extra new if you want more today`
            : 'On pace — use + Extra new if you want one more today'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-800/70">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                checked={a.checked === 1}
                disabled={a.checked === 1}
                onChange={() => onCheck(a)}
                className="h-4 w-4 cursor-pointer accent-sky-500 disabled:cursor-default"
              />
              <span
                className={`flex-1 text-sm ${
                  a.checked ? 'text-gray-600 line-through' : 'text-gray-200'
                }`}
              >
                {a.problem.title}
              </span>
              <DifficultyBadge difficulty={a.problem.difficulty} />
              <TopicBadge topic={a.problem.topic} />
              <OpenLink url={a.problem.url} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
