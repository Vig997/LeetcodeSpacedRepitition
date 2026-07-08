export default function BootstrapBadge({ completedOn }: { completedOn: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/60 bg-emerald-900/40 px-3 py-1 text-xs font-medium text-emerald-300"
      title={completedOn ? `Completed ${completedOn}` : undefined}
    >
      ✓ Bootstrap Complete
    </span>
  )
}
