interface Props {
  done: number
  total: number
  easy: number
  medium: number
  hard: number
}

/**
 * Bonus custom-problems ring — arc split into proportional difficulty
 * segments (green Easy / yellow Medium / red Hard), clockwise from top.
 */
export default function BonusRing({ done, total, easy, medium, hard }: Props) {
  const r = 52
  const c = 2 * Math.PI * r

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 opacity-40">
        <div className="relative">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={r} fill="none" stroke="#1f2430" strokeWidth="12" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-semibold text-gray-500">0</span>
          </div>
        </div>
        <span className="text-sm text-gray-500">Bonus</span>
      </div>
    )
  }

  const segs = [
    { count: easy, color: '#34d399' },
    { count: medium, color: '#fbbf24' },
    { count: hard, color: '#f87171' },
  ].filter((s) => s.count > 0)

  let offset = 0
  const arcs = segs.map((s, i) => {
    const frac = s.count / total
    const len = frac * c
    const el = (
      <circle
        key={i}
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth="12"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 70 70)"
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
          {arcs}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-semibold text-gray-100">
            {done}
            <span className="text-gray-500">/{total}</span>
          </span>
        </div>
      </div>
      <span className="text-sm text-gray-400">Bonus</span>
    </div>
  )
}
