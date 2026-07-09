import { DifficultyBadge, TopicBadge, OpenLink } from './Badges'
import type { AssignmentWithProblem } from '../lib/todayAssignments'

interface Props {
  assignments: AssignmentWithProblem[]
  /** When > 0, bootstrap has optional new/day enabled (empty state copy differs). */
  bootstrapNewPerDay?: number
  onToggle: (a: AssignmentWithProblem) => void
  onEdit?: (a: AssignmentWithProblem) => void
  onAddExtra?: () => void
  onRemoveExtra?: (a: AssignmentWithProblem) => void
  canAddExtra?: boolean
}

export default function TodayNewList({
  assignments,
  bootstrapNewPerDay = 0,
  onToggle,
  onEdit,
  onAddExtra,
  onRemoveExtra,
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
            + Extra New
          </button>
        )}
      </div>
      {assignments.length === 0 ? (
        <p className="text-sm text-gray-500">
          {bootstrapNewPerDay > 0
            ? `Bootstrap New Pace: ${bootstrapNewPerDay}/Day — Use + Extra New If You Want More Today`
            : 'On Pace — Use + Extra New If You Want One More Today'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-800/70">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                checked={a.checked === 1}
                onChange={() => onToggle(a)}
                className="h-4 w-4 cursor-pointer accent-sky-500"
              />
              <span
                className={`flex-1 text-sm ${
                  a.checked === 1 ? 'text-gray-600 line-through' : 'text-gray-200'
                }`}
              >
                {a.problem.title}
                {a.is_extra === 1 && (
                  <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                    Extra
                  </span>
                )}
              </span>
              {a.checked === 1 && a.before_json && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(a)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 transition hover:bg-gray-800 hover:text-sky-300"
                  title="Edit rating and hints for today"
                >
                  Edit
                </button>
              )}
              <DifficultyBadge difficulty={a.problem.difficulty} />
              <TopicBadge topic={a.problem.topic} />
              {a.is_extra === 1 && a.checked === 0 && onRemoveExtra && (
                <button
                  type="button"
                  onClick={() => onRemoveExtra(a)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 transition hover:bg-gray-800 hover:text-red-300"
                  title="Remove this extra new from Today"
                >
                  Remove
                </button>
              )}
              <OpenLink url={a.problem.url} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
