/** Column labels for the Problems list (lg+ — matches ProblemRow date columns). */
export default function ProblemListHeader() {
  return (
    <div className="mb-2 hidden items-center gap-3 border-b border-gray-800/70 pb-2 lg:flex">
      <span className="w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-[10px] font-semibold tracking-wide text-gray-600 uppercase">
        Problem
      </span>
      <span className="w-24 shrink-0 text-right text-[10px] font-semibold tracking-wide text-gray-600 uppercase">
        First Done
      </span>
      <span className="w-28 shrink-0 text-right text-[10px] font-semibold tracking-wide text-gray-600 uppercase">
        Last Reviewed
      </span>
      <span className="w-24 shrink-0 text-right text-[10px] font-semibold tracking-wide text-gray-600 uppercase">
        Next Review
      </span>
      <span className="w-[11.5rem] shrink-0" aria-hidden />
    </div>
  )
}
