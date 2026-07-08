interface Props {
  done: number
  total: number
  label: string
}

/** NeetCode main ring — fill = done/total, color red→yellow→green. */
export default function ProgressRing({ done, total, label }: Props) {
  const pct = total > 0 ? done / total : 0
  const r = 52
  const c = 2 * Math.PI * r
  // red → yellow → green
  const hue = Math.round(pct * 120)
  const color = `hsl(${hue}, 75%, 55%)`

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#1f2430" strokeWidth="12" />
          <circle
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 70 70)"
            style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-gray-100">
            {done}
            <span className="text-gray-500">/{total}</span>
          </span>
        </div>
      </div>
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  )
}
