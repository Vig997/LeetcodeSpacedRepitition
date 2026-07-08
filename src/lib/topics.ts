export const TOPICS = [
  'Arrays & Hashing',
  'Two Pointers',
  'Stack',
  'Binary Search',
  'Sliding Window',
  'Linked List',
  'Trees',
  'Heap / Priority Queue',
  'Backtracking',
  'Tries',
  'Graphs',
  '1-D DP',
  'Intervals',
  'Greedy',
  'Advanced Graphs',
  '2-D DP',
  'Bit Manipulation',
  'Math & Geometry',
] as const

export type Topic = (typeof TOPICS)[number]

/** Stable badge colors per topic (Tailwind-ish hex pairs: text / bg). */
const TOPIC_COLORS: Record<string, string> = {
  'Arrays & Hashing': '#60a5fa',
  'Two Pointers': '#34d399',
  Stack: '#f472b6',
  'Binary Search': '#a78bfa',
  'Sliding Window': '#fbbf24',
  'Linked List': '#22d3ee',
  Trees: '#4ade80',
  'Heap / Priority Queue': '#e879f9',
  Backtracking: '#f87171',
  Tries: '#fb923c',
  Graphs: '#38bdf8',
  '1-D DP': '#facc15',
  Intervals: '#c084fc',
  Greedy: '#2dd4bf',
  'Advanced Graphs': '#818cf8',
  '2-D DP': '#fb7185',
  'Bit Manipulation': '#a3e635',
  'Math & Geometry': '#94a3b8',
}

export function topicColor(topic: string): string {
  return TOPIC_COLORS[topic] ?? '#9ca3af'
}
