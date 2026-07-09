interface Props {
  done: number
  total: number
  label: string
  easy: number
  medium: number
  hard: number
}

/** NeetCode main ring — arc split by completed Easy / Medium / Hard. */
export default function ProgressRing({ done, total, label, easy, medium, hard }: Props) {
  const r = 52
  const c = 2 * Math.PI * r
  const pct = total > 0 ? done / total : 0

  const segs =
    done > 0
      ? [
          { count: easy, color: '#34d399' },
          { count: medium, color: '#fbbf24' },
          { count: hard, color: '#f87171' },
        ].filter((s) => s.count > 0)
      : []

  let offset = 0
  const arcs = segs.map((s, i) => {
    const len = (s.count / total) * c
    const el = (
      <circle
        key={i}
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 70 70)"
        style={{ transition: 'stroke-dasharray 0.4s, stroke-dashoffset 0.4s' }}
      />
    )
    offset += len
    return el
  })

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#1f2430" strokeWidth="12" />
          {done > 0 && segs.length === 0 && (
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke="#eab308"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - pct)}
              transform="rotate(-90 70 70)"
              style={{ transition: 'stroke-dashoffset 0.4s' }}
            />
          )}
          {arcs}
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
