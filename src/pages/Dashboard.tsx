import { useState } from 'react'
import { useProblems } from '../hooks/useProblems'
import {
  rateReviewAssignment,
  completeProblemAssignment,
  startBootstrap,
  cancelBootstrap,
} from '../lib/dataStore'
import ProgressRing from '../components/ProgressRing'
import BonusRing from '../components/BonusRing'
import PaceStrip from '../components/PaceStrip'
import GoalReachability from '../components/GoalReachability'
import TodayReviewsList from '../components/TodayReviewsList'
import TodayNewList from '../components/TodayNewList'
import RatingModal from '../components/RatingModal'
import StartBootstrapModal from '../components/StartBootstrapModal'
import type { AssignmentWithProblem } from '../lib/todayAssignments'
import type { Rating } from '../lib/types'

export default function Dashboard() {
  const snap = useProblems()
  const [rating, setRating] = useState<AssignmentWithProblem | null>(null)
  const [showBootstrapModal, setShowBootstrapModal] = useState(false)

  const doneKept = snap.pacing.doneKept
  const keptTotal = snap.pacing.keptTotal

  const reviews = snap.assignments.filter((a) => a.kind === 'review')
  const news = snap.assignments.filter((a) => a.kind === 'new')
  const showNewSection =
    !snap.bootstrapActive || snap.pacing.bootstrapNewPerDay > 0

  const saveRating = (r: Rating, hints: number): void => {
    if (!rating) return
    if (rating.kind === 'review') {
      rateReviewAssignment(rating.id, rating.problem_id, r, hints)
    } else {
      completeProblemAssignment(rating.id, rating.problem_id, r, hints)
    }
    setRating(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-12 py-2">
        <ProgressRing done={doneKept} total={keptTotal} label="NeetCode" />
        <BonusRing
          done={snap.customDone}
          total={snap.customTotal}
          easy={snap.customEasy}
          medium={snap.customMedium}
          hard={snap.customHard}
        />
      </div>

      <GoalReachability goal={snap.goal} />
      <PaceStrip pacing={snap.pacing} />

      {snap.bootstrapActive ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={cancelBootstrap}
            className="rounded-lg border border-sky-800 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-900/50"
          >
            Cancel bootstrap
          </button>
        </div>
      ) : (
        snap.bootstrapCandidates.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-2.5 text-sm text-gray-400">
            <span>
              Optional: baseline-review your {snap.bootstrapCandidates.length} done
              problems before adding new ones
            </span>
            <button
              type="button"
              onClick={() => setShowBootstrapModal(true)}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition hover:bg-sky-500"
            >
              Start Bootstrap
            </button>
          </div>
        )
      )}

      <TodayReviewsList assignments={reviews} onCheck={setRating} />
      {showNewSection && (
        <TodayNewList
          assignments={news}
          bootstrapNewPerDay={snap.bootstrapActive ? snap.pacing.bootstrapNewPerDay : 0}
          onCheck={setRating}
        />
      )}

      {rating && (
        <RatingModal
          problem={rating.problem}
          title={rating.kind === 'review' ? 'Rate this review' : 'Mark done — rate it'}
          onSave={saveRating}
          onCancel={() => setRating(null)}
        />
      )}
      {showBootstrapModal && (
        <StartBootstrapModal
          candidates={snap.bootstrapCandidates}
          defaultCap={snap.settings.bootstrap_daily_cap}
          onStart={(ids, cap, newPerDay) => {
            startBootstrap(ids, cap, newPerDay)
            setShowBootstrapModal(false)
          }}
          onClose={() => setShowBootstrapModal(false)}
        />
      )}
    </div>
  )
}
