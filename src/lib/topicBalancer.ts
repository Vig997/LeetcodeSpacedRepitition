import { db } from './db'
import { todayStr, daysBetween } from './dates'
import { getSetting, getGoalDate } from './settings'
import { TOPICS } from './topics'
import type { Problem, TopicStats } from './types'

/** topic_weight = coverage_gap*0.35 + struggle_boost*0.40 + undervisited*0.25 */
function topicWeights(): Map<string, number> {
  const stats = db.prepare('SELECT * FROM topic_stats').all() as TopicStats[]
  const today = todayStr()
  const startDate = getSetting('start_date') ?? today
  const totalDays = Math.max(daysBetween(startDate, getGoalDate()), 1)
  const rotation = totalDays / TOPICS.length
  const maxVisits = Math.max(...stats.map((s) => s.visit_count), 1)

  const weights = new Map<string, number>()
  for (const s of stats) {
    const daysSince = s.last_visited_at
      ? Math.max(daysBetween(s.last_visited_at, today), 0)
      : rotation * 2 // never visited → strong coverage gap
    const coverageGap = Math.min(daysSince / rotation, 3)
    const struggleBoost = Math.min(Math.max(s.struggle_score / 4, 0), 1)
    const undervisited = 1 - s.visit_count / maxVisits
    weights.set(
      s.topic,
      coverageGap * 0.35 + struggleBoost * 0.4 + undervisited * 0.25,
    )
  }
  return weights
}

/** Stable hash of YYYY-MM-DD → seed so the same calendar day always fills the same slots. */
function daySeed(date: string): number {
  let h = 2166136261
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Mulberry32 PRNG — deterministic given seed; not crypto. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedPick<T>(
  items: T[],
  weightOf: (item: T) => number,
  rand: () => number,
): T | null {
  if (items.length === 0) return null
  const weights = items.map((i) => Math.max(weightOf(i), 0.01))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Pick review problems from the due pool: topic-weighted selection with a
 * difficulty mix (≤25% Hard, ≥30% Easy where possible) and max 2 per topic.
 * Fill slots are deterministic for a given calendar day (seeded by todayStr).
 */
export function pickReviews(candidates: Problem[], targetSize: number): Problem[] {
  if (candidates.length <= targetSize) {
    return prioritizeDue(candidates)
  }

  // Stable input order so DB row order cannot reshuffle the fill.
  const stable = [...candidates].sort(
    (a, b) =>
      (a.next_review_at ?? '').localeCompare(b.next_review_at ?? '') ||
      (a.neetcode_order ?? 9999) - (b.neetcode_order ?? 9999) ||
      a.id - b.id,
  )

  const weights = topicWeights()
  const maxHard = Math.ceil(targetSize * 0.25)
  const minEasy = Math.floor(targetSize * 0.3)
  const rand = mulberry32(daySeed(todayStr()))

  const picked: Problem[] = []
  const pickedIds = new Set<number>()
  const topicCount = new Map<string, number>()

  const canTake = (p: Problem): boolean => {
    if (pickedIds.has(p.id)) return false
    if ((topicCount.get(p.topic) ?? 0) >= 2) return false
    if (p.difficulty === 'Hard') {
      const hardCount = picked.filter((x) => x.difficulty === 'Hard').length
      if (hardCount >= maxHard) return false
    }
    return true
  }

  const take = (p: Problem): void => {
    picked.push(p)
    pickedIds.add(p.id)
    topicCount.set(p.topic, (topicCount.get(p.topic) ?? 0) + 1)
  }

  // Priority pass: Forgot/overdue and bootstrap first (up to target)
  const prioritized = prioritizeDue(stable)
  const urgent = prioritized.filter(
    (p) => p.last_rating === 'forgot' || isOverdue(p) || p.status === 'bootstrap',
  )
  for (const p of urgent) {
    if (picked.length >= targetSize) break
    if (canTake(p)) take(p)
  }

  // Weighted fill with difficulty mix (day-seeded — same day → same picks)
  let guard = 500
  while (picked.length < targetSize && guard-- > 0) {
    const remaining = stable.filter(canTake)
    if (remaining.length === 0) break
    const easyCount = picked.filter((x) => x.difficulty === 'Easy').length
    const pool =
      easyCount < minEasy && remaining.some((p) => p.difficulty === 'Easy')
        ? remaining.filter((p) => p.difficulty === 'Easy')
        : remaining
    const p = weightedPick(pool, (x) => weights.get(x.topic) ?? 0.5, rand)
    if (!p) break
    take(p)
  }

  // Relax constraints if the mix rules left slots unfilled
  if (picked.length < targetSize) {
    for (const p of prioritized) {
      if (picked.length >= targetSize) break
      if (!pickedIds.has(p.id)) {
        picked.push(p)
        pickedIds.add(p.id)
      }
    }
  }
  return picked
}

function isOverdue(p: Problem): boolean {
  return p.next_review_at !== null && p.next_review_at < todayStr()
}

/** Forgot → oldest overdue → bootstrap → maintenance. */
function prioritizeDue(pool: Problem[]): Problem[] {
  const rank = (p: Problem): number => {
    if (p.last_rating === 'forgot') return 0
    if (isOverdue(p)) return 1
    if (p.status === 'bootstrap') return 2
    return 3
  }
  return [...pool].sort(
    (a, b) => rank(a) - rank(b) || (a.next_review_at ?? '').localeCompare(b.next_review_at ?? ''),
  )
}

/** NeetCode roadmap order; custom (null order) sorts last. */
export function roadmapSort(problems: Problem[]): Problem[] {
  return [...problems].sort(
    (a, b) =>
      (a.neetcode_order === null ? 1 : 0) - (b.neetcode_order === null ? 1 : 0) ||
      (a.neetcode_order ?? 0) - (b.neetcode_order ?? 0) ||
      a.id - b.id,
  )
}

/**
 * Bootstrap baseline reviews: strict roadmap order (no topic randomization).
 */
export function pickBootstrapReviews(candidates: Problem[], targetSize: number): Problem[] {
  if (targetSize <= 0) return []
  return roadmapSort(candidates).slice(0, targetSize)
}

/**
 * Pick N new problems (Kept · Undone) in strict NeetCode roadmap order.
 * Custom problems (null neetcode_order) sort last. Reviews use pickReviews instead.
 */
export function pickNew(n: number, excludeIds: Set<number>): Problem[] {
  if (n <= 0) return []
  const undone = db
    .prepare(
      `SELECT * FROM problems WHERE is_excluded = 0 AND is_custom = 0 AND first_completed_at IS NULL
       ORDER BY (neetcode_order IS NULL), neetcode_order ASC, id ASC`,
    )
    .all() as Problem[]
  const candidates = undone.filter((p) => !excludeIds.has(p.id))
  return candidates.slice(0, n)
}
