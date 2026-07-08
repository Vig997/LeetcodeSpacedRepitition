// One-off seed tool: reassigns neetcode_order in data/neetcode150.json by topic block.
// Not used at runtime — kept for reference if the roadmap order ever needs rebuilding.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const jsonPath = path.join(__dirname, '..', 'data', 'neetcode150.json')

const TOPIC_ORDER = [
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
]

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
const byTopic = new Map()
for (const p of data.problems) {
  const arr = byTopic.get(p.topic) ?? []
  arr.push(p)
  byTopic.set(p.topic, arr)
}

let order = 1
const reordered = []
const table = []
for (const topic of TOPIC_ORDER) {
  const list = (byTopic.get(topic) ?? []).sort((a, b) => a.order - b.order)
  const start = order
  for (const p of list) {
    reordered.push({ ...p, order })
    order++
  }
  if (list.length > 0) {
    table.push({ topic, count: list.length, start, end: order - 1 })
  }
}

if (reordered.length !== 150) throw new Error(`expected 150 problems, got ${reordered.length}`)
fs.writeFileSync(jsonPath, JSON.stringify({ problems: reordered }, null, 2) + '\n')

console.log('Topic order table:')
for (const row of table) {
  console.log(`${row.topic}: ${row.count} problems, orders ${row.start}–${row.end}`)
}
const gp = reordered.find((p) => p.slug === 'generate-parentheses')
console.log(`\ngenerate-parentheses: order=${gp.order}, topic=${gp.topic}`)
