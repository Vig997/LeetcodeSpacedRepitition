// One-off debug tool: prints a readonly summary of the real AppData DB.
// Not used at runtime — kept for local inspection only.
import Database from 'better-sqlite3'
import path from 'node:path'
import os from 'node:os'

const dbPath = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
  'leetcode-sr',
  'data.db',
)
const db = new Database(dbPath, { readonly: true })
const today = new Date().toISOString().slice(0, 10)

const q = (sql, ...params) => db.prepare(sql).get(...params)

const out = {
  dbPath,
  today,
  total: q('SELECT COUNT(*) AS c FROM problems').c,
  removed: q('SELECT COUNT(*) AS c FROM problems WHERE is_excluded = 1').c,
  kept: q('SELECT COUNT(*) AS c FROM problems WHERE is_custom = 0 AND is_excluded = 0').c,
  done: q(
    'SELECT COUNT(*) AS c FROM problems WHERE is_custom = 0 AND is_excluded = 0 AND first_completed_at IS NOT NULL',
  ).c,
  custom: q('SELECT COUNT(*) AS c FROM problems WHERE is_custom = 1').c,
  reviewsToday: q(
    "SELECT COUNT(*) AS c FROM today_assignments WHERE assignment_date = ? AND kind = 'review'",
    today,
  ).c,
  newToday: q(
    "SELECT COUNT(*) AS c FROM today_assignments WHERE assignment_date = ? AND kind = 'new'",
    today,
  ).c,
  bootstrapActive: q("SELECT value FROM settings WHERE key = 'bootstrap_active'")?.value,
  bootstrapRemaining: q(
    "SELECT COUNT(*) AS c FROM problems WHERE status = 'bootstrap' AND is_excluded = 0",
  ).c,
  firstUndone: q(
    `SELECT slug, topic, neetcode_order FROM problems
     WHERE is_excluded = 0 AND is_custom = 0 AND first_completed_at IS NULL
     ORDER BY (neetcode_order IS NULL), neetcode_order ASC, id ASC LIMIT 1`,
  ),
}

console.log(JSON.stringify(out, null, 2))
db.close()
