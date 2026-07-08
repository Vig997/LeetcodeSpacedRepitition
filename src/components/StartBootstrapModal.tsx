import { useMemo, useState } from 'react'
import { DifficultyBadge, TopicBadge } from './Badges'
import { SETTINGS_MAX } from '../lib/settings'
import type { Problem } from '../lib/types'

interface Props {
  candidates: Problem[]
  defaultCap: number
  onStart: (problemIds: number[], dailyCap: number, newPerDay: number) => void
  onClose: () => void
}

/**
 * User-initiated bootstrap: choose which done Kept problems to baseline-review
 * and how many per day; the scheduler staggers them across days.
 */
export default function StartBootstrapModal({
  candidates,
  defaultCap,
  onStart,
  onClose,
}: Props) {
  const [capText, setCapText] = useState(String(defaultCap))
  const [assignNew, setAssignNew] = useState(false)
  const [newText, setNewText] = useState('1')
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(candidates.map((p) => p.id)),
  )

  const cap = Math.min(Math.max(parseInt(capText, 10) || 1, 1), SETTINGS_MAX)
  const newPerDay = assignNew
    ? Math.min(Math.max(parseInt(newText, 10) || 1, 1), SETTINGS_MAX)
    : 0
  const days = selected.size > 0 ? Math.ceil(selected.size / cap) : 0

  const byTopic = useMemo(() => {
    const map = new Map<string, Problem[]>()
    for (const p of candidates) {
      const arr = map.get(p.topic) ?? []
      arr.push(p)
      map.set(p.topic, arr)
    }
    return [...map.entries()]
  }, [candidates])

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected((prev) =>
      prev.size === candidates.length
        ? new Set()
        : new Set(candidates.map((p) => p.id)),
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold text-gray-100">Start Bootstrap</h3>
        <p className="mb-4 text-xs text-gray-500">
          Baseline-review the selected done problems.
          {assignNew
            ? ' New Kept problems will also be assigned each day during bootstrap.'
            : ' New problems stay locked until the bootstrap finishes.'}
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            Reviews/day
            <input
              type="text"
              inputMode="numeric"
              value={capText}
              onChange={(e) => setCapText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => setCapText(String(cap))}
              className="w-16 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:border-sky-600"
            />
          </label>
          <span className="text-xs text-gray-500">
            {selected.size} selected · ~{days} day{days === 1 ? '' : 's'}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            {selected.size === candidates.length ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={assignNew}
            onChange={(e) => setAssignNew(e.target.checked)}
            className="h-3.5 w-3.5 accent-sky-500"
          />
          Also assign new problems during bootstrap
        </label>
        {assignNew && (
          <label className="mb-4 flex items-center gap-2 pl-5 text-sm text-gray-300">
            New/day
            <input
              type="text"
              inputMode="numeric"
              value={newText}
              onChange={(e) => setNewText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => setNewText(String(newPerDay))}
              className="w-16 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:border-sky-600"
            />
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-800 p-3">
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No done Kept problems to bootstrap yet.
            </p>
          ) : (
            byTopic.map(([topic, list]) => (
              <div key={topic} className="mb-3">
                <div className="mb-1 text-xs font-semibold text-gray-500">{topic}</div>
                {list.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    <span className="flex-1 truncate text-sm text-gray-300">{p.title}</span>
                    <DifficultyBadge difficulty={p.difficulty} />
                    <TopicBadge topic={p.topic} />
                  </label>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onStart([...selected], cap, newPerDay)}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start Bootstrap
          </button>
        </div>
      </div>
    </div>
  )
}
