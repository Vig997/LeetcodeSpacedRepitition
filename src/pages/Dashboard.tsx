import { useState } from 'react'
import { useProblems } from '../hooks/useProblems'
import {
  rateReviewAssignment,
  completeProblemAssignment,
  startBootstrap,
  addExtraReview,
  addExtraNew,
  removeExtraAssignment,
  editAssignmentRating,
  uncheckAssignment,
} from '../lib/dataStore'
import ProgressRing from '../components/ProgressRing'
import BonusRing from '../components/BonusRing'
import PaceOverview from '../components/PaceOverview'
import BootstrapPaceStats from '../components/BootstrapPaceStats'
import TodayReviewsList from '../components/TodayReviewsList'
import TodayNewList from '../components/TodayNewList'
import RatingModal from '../components/RatingModal'
import StartBootstrapModal from '../components/StartBootstrapModal'
import type { AssignmentWithProblem } from '../lib/todayAssignments'
import type { Rating } from '../lib/types'

export default function Dashboard() {
  const snap = useProblems()
  const [rating, setRating] = useState<AssignmentWithProblem | null>(null)
  const [editingRating, setEditingRating] = useState(false)
  const [showBootstrapModal, setShowBootstrapModal] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const showActionMessage = (message: string): void => {
    setActionMessage(message)
    window.setTimeout(() => setActionMessage(null), 4000)
  }

  const handleUncheck = (a: AssignmentWithProblem): void => {
    const result = uncheckAssignment(a.id)
    if (!result.ok) showActionMessage(result.message)
  }

  const handleRowToggle = (a: AssignmentWithProblem): void => {
    if (a.checked === 1) handleUncheck(a)
    else openRating(a)
  }

  const doneKept = snap.pacing.doneKept
  const keptTotal = snap.pacing.keptTotal

  const reviews = snap.assignments.filter((a) => a.kind === 'review')
  const news = snap.assignments.filter((a) => a.kind === 'new')
  const onToday = new Set(snap.assignments.map((a) => a.problem_id))
  const canAddExtraReview = snap.bootstrapActive
    ? snap.problems.some((p) => p.is_excluded === 0 && p.status === 'bootstrap' && !onToday.has(p.id))
    : snap.problems.some(
        (p) =>
          p.is_excluded === 0 &&
          p.first_completed_at !== null &&
          p.status !== 'bootstrap' &&
          !onToday.has(p.id),
      )
  const canAddExtraNew = snap.problems.some(
    (p) =>
      p.is_excluded === 0 &&
      p.is_custom === 0 &&
      p.first_completed_at === null &&
      !onToday.has(p.id),
  )

  const saveRating = (r: Rating, hints: number): void => {
    if (!rating) return
    let result: { ok: boolean; message: string }
    if (editingRating) {
      result = editAssignmentRating(rating.id, r, hints)
    } else if (rating.kind === 'review') {
      result = rateReviewAssignment(rating.id, rating.problem_id, r, hints)
    } else {
      result = completeProblemAssignment(rating.id, rating.problem_id, r, hints)
    }
    if (!result.ok) {
      showActionMessage(result.message)
      return
    }
    setRating(null)
    setEditingRating(false)
  }

  const openRating = (a: AssignmentWithProblem): void => {
    setEditingRating(false)
    setRating(a)
  }

  const openEditRating = (a: AssignmentWithProblem): void => {
    setEditingRating(true)
    setRating(a)
  }

  const closeRating = (): void => {
    setRating(null)
    setEditingRating(false)
  }

  return (
    <div className="space-y-5">
      {actionMessage && (
        <p className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
          {actionMessage}
        </p>
      )}
      <div className="flex justify-center gap-12 py-2">
        <ProgressRing
          done={doneKept}
          total={keptTotal}
          label="NeetCode"
          easy={snap.keptEasy}
          medium={snap.keptMedium}
          hard={snap.keptHard}
        />
        <BonusRing
          done={snap.customDone}
          total={snap.customTotal}
          easy={snap.customEasy}
          medium={snap.customMedium}
          hard={snap.customHard}
        />
      </div>

      <PaceOverview goal={snap.goal} pacing={snap.pacing} advice={snap.advice} />

      {snap.bootstrapActive && (
        <BootstrapPaceStats
          goal={snap.goal}
          pacing={snap.pacing}
          todayLoad={snap.todayLoad}
        />
      )}

      {!snap.bootstrapActive && snap.bootstrapCandidates.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-2.5 text-sm text-gray-400">
          <span>
            Optional: Bootstrap-Review Your {snap.bootstrapCandidates.length} Done
            Problems Before Adding New Ones
          </span>
          <button
            type="button"
            onClick={() => setShowBootstrapModal(true)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition hover:bg-sky-500"
          >
            Start Bootstrap
          </button>
        </div>
      )}

      <TodayReviewsList
        assignments={reviews}
        onToggle={handleRowToggle}
        onEdit={openEditRating}
        onAddExtra={() => addExtraReview()}
        onRemoveExtra={(a) => removeExtraAssignment(a.id)}
        canAddExtra={canAddExtraReview}
      />
      <TodayNewList
        assignments={news}
        bootstrapNewPerDay={snap.bootstrapActive ? snap.pacing.bootstrapNewPerDay : 0}
        onToggle={handleRowToggle}
        onEdit={openEditRating}
        onAddExtra={() => addExtraNew()}
        onRemoveExtra={(a) => removeExtraAssignment(a.id)}
        canAddExtra={canAddExtraNew}
      />

      {rating && (
        <RatingModal
          problem={rating.problem}
          title={
            editingRating
              ? 'Edit Rating'
              : rating.kind === 'review'
                ? 'Rate This Review'
                : 'Mark Done — Rate It'
          }
          initialRating={editingRating ? rating.session_rating ?? rating.problem.last_rating : null}
          initialHints={
            editingRating ? (rating.session_hints ?? rating.problem.last_hints) : 0
          }
          saveLabel={editingRating ? 'Update' : 'Save'}
          onSave={saveRating}
          onCancel={closeRating}
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
