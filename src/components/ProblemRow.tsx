import { DifficultyBadge, TopicBadge, OpenLink } from './Badges'
import { formatDisplayDate } from '../lib/dates'
import type { Problem } from '../lib/types'

interface Props {
  problem: Problem
  removed?: boolean
  onMarkDone: (p: Problem) => void
  onLogReview: (p: Problem) => void
  onReEnable: (p: Problem) => void
  onMoveToRemoved: (p: Problem) => void
}

export default function ProblemRow({
  problem: p,
  removed = false,
  onMarkDone,
  onLogReview,
  onReEnable,
  onMoveToRemoved,
}: Props) {
  const done = p.first_completed_at !== null
  return (
    <li
      className={`flex items-center gap-3 py-2 ${removed ? 'opacity-50' : ''}`}
    >
      <span className="w-5 text-center text-sm">
        {done ? (
          <span className="text-emerald-400">✓</span>
        ) : (
          <span className="text-gray-700">○</span>
        )}
      </span>
      <span className={`flex-1 truncate text-sm ${removed ? 'text-gray-500' : 'text-gray-200'}`}>
        {p.title}
        {p.is_custom === 1 && (
          <span className="ml-2 rounded bg-purple-900/60 px-1.5 py-0.5 text-[10px] text-purple-300">
            Bonus
          </span>
        )}
        {p.status === 'mastered' && (
          <span className="ml-2 rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
            Mastered
          </span>
        )}
      </span>
      <DifficultyBadge difficulty={p.difficulty} />
      <TopicBadge topic={p.topic} />
      <span className="hidden w-24 text-right text-xs text-gray-500 lg:inline">
        {done && !removed && p.first_completed_at ? formatDisplayDate(p.first_completed_at) : ''}
      </span>
      <span className="hidden w-24 text-right text-xs text-gray-500 lg:inline">
        {done && !removed ? (
          <>
            {p.last_reviewed_at ?? '—'}
            {p.repetitions > 0 && (
              <span className="ml-1 text-gray-600">· {p.repetitions}×</span>
            )}
          </>
        ) : (
          ''
        )}
      </span>
      <span className="hidden w-24 text-right text-xs text-gray-500 lg:inline">
        {done && !removed ? (p.next_review_at ?? '—') : ''}
      </span>
      {removed ? (
        <button
          type="button"
          onClick={() => onReEnable(p)}
          className="rounded-md border border-emerald-800 px-2.5 py-1 text-xs text-emerald-300 transition hover:bg-emerald-900/50"
        >
          Re-enable
        </button>
      ) : (
        <>
          {done ? (
            <button
              type="button"
              onClick={() => onLogReview(p)}
              className="rounded-md border border-gray-700 px-2.5 py-1 text-xs whitespace-nowrap text-gray-300 transition hover:border-sky-600 hover:text-sky-300"
            >
              Log Review
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onMarkDone(p)}
              className="rounded-md border border-gray-700 px-2.5 py-1 text-xs whitespace-nowrap text-gray-300 transition hover:border-emerald-600 hover:text-emerald-300"
            >
              Mark Done
            </button>
          )}
          <button
            type="button"
            onClick={() => onMoveToRemoved(p)}
            title="Move to Removed"
            className="rounded-md border border-gray-800 px-2 py-1 text-xs text-gray-500 transition hover:border-red-800 hover:text-red-400"
          >
            ✕
          </button>
        </>
      )}
      <OpenLink url={p.url} />
    </li>
  )
}
