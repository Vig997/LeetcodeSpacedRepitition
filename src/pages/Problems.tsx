import { useMemo, useState } from 'react'
import { useProblems } from '../hooks/useProblems'
import {
  rateReview,
  completeProblem,
  reEnableProblem,
  moveToRemoved,
  addProblem,
} from '../lib/dataStore'
import ProblemRow from '../components/ProblemRow'
import RatingModal from '../components/RatingModal'
import AddEditProblemModal from '../components/AddEditProblemModal'
import { TOPICS, topicColor } from '../lib/topics'
import type { Difficulty, Problem, Rating } from '../lib/types'

type RatingTarget = { problem: Problem; mode: 'done' | 'review' }

export default function Problems() {
  const snap = useProblems()
  const [search, setSearch] = useState('')
  const [diffFilter, setDiffFilter] = useState<Difficulty | null>(null)
  const [topicFilter, setTopicFilter] = useState<string>('')
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return snap.problems.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q)) return false
      if (diffFilter && p.difficulty !== diffFilter) return false
      if (topicFilter && p.topic !== topicFilter) return false
      return true
    })
  }, [snap.problems, search, diffFilter, topicFilter])

  const kept = filtered.filter((p) => p.is_excluded === 0)
  const removed = filtered.filter((p) => p.is_excluded === 1)

  const keptByTopic = useMemo(() => {
    const map = new Map<string, Problem[]>()
    for (const t of TOPICS) map.set(t, [])
    for (const p of kept) {
      const arr = map.get(p.topic) ?? []
      arr.push(p)
      map.set(p.topic, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.neetcode_order ?? 9999) - (b.neetcode_order ?? 9999))
    }
    return [...map.entries()].filter(([, arr]) => arr.length > 0)
  }, [kept])

  const keptTotalAll = snap.problems.filter((p) => p.is_excluded === 0).length
  const removedTotalAll = snap.problems.filter((p) => p.is_excluded === 1).length

  const saveRating = (r: Rating, hints: number): void => {
    if (!ratingTarget) return
    if (ratingTarget.mode === 'done') {
      completeProblem(ratingTarget.problem.id, r, hints)
    } else {
      rateReview(ratingTarget.problem.id, r, hints)
    }
    setRatingTarget(null)
  }

  const rowHandlers = {
    onMarkDone: (p: Problem) => setRatingTarget({ problem: p, mode: 'done' }),
    onLogReview: (p: Problem) => setRatingTarget({ problem: p, mode: 'review' }),
    onReEnable: (p: Problem) => reEnableProblem(p.id),
    onMoveToRemoved: (p: Problem) => moveToRemoved(p.id),
  }

  const diffBtn = (d: Difficulty, cls: string) => (
    <button
      key={d}
      type="button"
      onClick={() => setDiffFilter(diffFilter === d ? null : d)}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        diffFilter === d ? cls : 'border-gray-700 text-gray-400 hover:bg-gray-800'
      }`}
    >
      {d}
    </button>
  )

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search..."
          className="w-56 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-sky-600"
        />
        {diffBtn('Easy', 'border-emerald-700 bg-emerald-900/50 text-emerald-300')}
        {diffBtn('Medium', 'border-yellow-700 bg-yellow-900/50 text-yellow-300')}
        {diffBtn('Hard', 'border-red-700 bg-red-900/50 text-red-300')}
        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-300 outline-none"
        >
          <option value="">All concepts</option>
          {TOPICS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-500"
        >
          + Add
        </button>
      </div>

      {/* Kept */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h2 className="mb-1 text-sm font-semibold tracking-wide text-gray-300 uppercase">
          Kept ({keptTotalAll})
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          Active goal · counts for ring + SR
        </p>
        {keptByTopic.length === 0 && (
          <p className="text-sm text-gray-500">No matches.</p>
        )}
        <div className="space-y-4">
          {keptByTopic.map(([topic, list]) => (
            <div key={topic}>
              <h3
                className="mb-1 text-xs font-semibold tracking-wide"
                style={{ color: topicColor(topic) }}
              >
                {topic}
              </h3>
              <ul className="divide-y divide-gray-800/60">
                {list.map((p) => (
                  <ProblemRow key={p.id} problem={p} {...rowHandlers} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Removed — always visible */}
      <section className="rounded-xl border border-gray-800/70 bg-gray-900/40 p-5">
        <h2 className="mb-1 text-sm font-semibold tracking-wide text-gray-500 uppercase">
          Removed ({removedTotalAll})
        </h2>
        <p className="mb-4 text-xs text-gray-600">
          Visible · not in SR · not in ring
        </p>
        {removed.length === 0 ? (
          <p className="text-sm text-gray-600">No removed problems match.</p>
        ) : (
          <ul className="divide-y divide-gray-800/50">
            {removed.map((p) => (
              <ProblemRow key={p.id} problem={p} removed {...rowHandlers} />
            ))}
          </ul>
        )}
      </section>

      {ratingTarget && (
        <RatingModal
          problem={ratingTarget.problem}
          title={ratingTarget.mode === 'done' ? 'Mark done — rate it' : 'Log review'}
          onSave={saveRating}
          onCancel={() => setRatingTarget(null)}
        />
      )}
      {showAdd && (
        <AddEditProblemModal onAdd={addProblem} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
