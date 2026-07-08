import { useState } from 'react'
import type { Problem, Rating } from '../lib/types'

interface Props {
  problem: Problem
  title: string
  onSave: (rating: Rating, hints: number) => void
  onCancel: () => void
}

const RATINGS: { value: Rating; label: string; desc: string; cls: string }[] = [
  { value: 'easy', label: 'Easy', desc: 'Solved smoothly', cls: 'border-emerald-700 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/70' },
  { value: 'medium', label: 'Medium', desc: 'Some effort', cls: 'border-yellow-700 bg-yellow-900/40 text-yellow-300 hover:bg-yellow-900/70' },
  { value: 'hard', label: 'Hard', desc: 'Struggled through', cls: 'border-orange-700 bg-orange-900/40 text-orange-300 hover:bg-orange-900/70' },
  { value: 'forgot', label: 'Forgot', desc: "Couldn't solve", cls: 'border-red-700 bg-red-900/40 text-red-300 hover:bg-red-900/70' },
]

export default function RatingModal({ problem, title, onSave, onCancel }: Props) {
  const [rating, setRating] = useState<Rating | null>(null)
  const [hints, setHints] = useState(0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">{title}</div>
        <h3 className="mb-4 text-lg font-semibold text-gray-100">{problem.title}</h3>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {RATINGS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRating(r.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${r.cls} ${
                rating === r.value ? 'ring-2 ring-white/60' : ''
              }`}
            >
              <div className="font-semibold">{r.label}</div>
              <div className="text-xs opacity-70">{r.desc}</div>
            </button>
          ))}
        </div>

        <label className="mb-5 flex items-center gap-3 text-sm text-gray-300">
          Hints used:
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHints(h)}
                className={`h-8 w-8 rounded-lg border text-sm transition ${
                  hints === h
                    ? 'border-sky-500 bg-sky-900/60 text-sky-200'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={rating === null}
            onClick={() => rating && onSave(rating, hints)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
