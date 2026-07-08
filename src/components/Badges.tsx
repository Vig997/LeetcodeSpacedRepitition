import { topicColor } from '../lib/topics'
import type { Difficulty } from '../lib/types'

const DIFF_CLS: Record<Difficulty, string> = {
  Easy: 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
  Medium: 'bg-yellow-900/50 text-yellow-300 border-yellow-800',
  Hard: 'bg-red-900/50 text-red-300 border-red-800',
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span
      className={`inline-block w-14 rounded-md border px-1.5 py-0.5 text-center text-[11px] font-medium ${DIFF_CLS[difficulty]}`}
    >
      {difficulty === 'Medium' ? 'Med' : difficulty}
    </span>
  )
}

export function TopicBadge({ topic }: { topic: string }) {
  const color = topicColor(topic)
  return (
    <span
      className="inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color, borderColor: `${color}55`, background: `${color}18` }}
    >
      {topic}
    </span>
  )
}

export function OpenLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:border-sky-600 hover:text-sky-300"
    >
      Open
    </a>
  )
}
