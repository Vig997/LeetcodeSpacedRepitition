import { DifficultyBadge, TopicBadge, OpenLink } from './Badges'
import type { AssignmentWithProblem } from '../lib/todayAssignments'

interface Props {
  assignments: AssignmentWithProblem[]
  /** When > 0, bootstrap has optional new/day enabled (empty state copy differs). */
  bootstrapNewPerDay?: number
  onCheck: (a: AssignmentWithProblem) => void
}

export default function TodayNewList({
  assignments,
  bootstrapNewPerDay = 0,
  onCheck,
}: Props) {
  if (assignments.length === 0) {
    return (
      <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-gray-400 uppercase">
          Today · New
        </h2>
        <p className="text-sm text-gray-500">
          {bootstrapNewPerDay > 0
            ? `Bootstrap new pace: ${bootstrapNewPerDay}/day — slots appear when daily load allows`
            : 'On pace — optional practice'}
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-gray-400 uppercase">
        Today · New ({assignments.length})
      </h2>
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
    </section>
  )
}
