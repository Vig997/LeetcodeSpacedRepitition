export type Difficulty = 'Easy' | 'Medium' | 'Hard'
export type Status = 'undone' | 'bootstrap' | 'sr' | 'mastered'
export type Rating = 'easy' | 'medium' | 'hard' | 'forgot'
export type AssignmentKind = 'review' | 'new'

export interface Problem {
  id: number
  leetcode_id: number | null
  slug: string
  title: string
  difficulty: Difficulty
  topic: string
  neetcode_order: number | null
  is_custom: 0 | 1
  is_excluded: 0 | 1
  url: string
  status: Status
  first_completed_at: string | null
  last_reviewed_at: string | null
  next_review_at: string | null
  last_rating: Rating | null
  last_hints: number
  ease: number
  interval_days: number
  repetitions: number
  notes: string | null
}

export interface TopicStats {
  topic: string
  last_visited_at: string | null
  visit_count: number
  struggle_score: number
  easy_count: number
  medium_count: number
  hard_count: number
  forgot_count: number
}

export interface TodayAssignment {
  id: number
  assignment_date: string
  problem_id: number
  kind: AssignmentKind
  position: number
  checked: 0 | 1
  rated_at: string | null
  reconciled: 0 | 1
  /** 1 = user-added same-day extra (ignored by paced trim / day-lock). */
  is_extra: 0 | 1
}

export interface AppSettings {
  /** Mastery goal date (YYYY-MM-DD) — drives all pacing math. */
  goal_date: string
  bootstrap_daily_cap: number
  /** Normal daily review target / cap. */
  review_daily_target: number
  /** New problems per day; 0 = Auto (remaining ÷ days left). */
  new_per_day: number
}
