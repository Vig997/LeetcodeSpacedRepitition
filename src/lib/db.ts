import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
// Import process as a module binding — Vite statically replaces the global
// `process.env` with {} in renderer builds, which would bake env to undefined.
import proc from 'node:process'

const appData =
  proc.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
// LEETCODE_SR_DATA_DIR is a test-only override
const dataDir = proc.env.LEETCODE_SR_DATA_DIR ?? path.join(appData, 'leetcode-sr')
fs.mkdirSync(dataDir, { recursive: true })

export const DB_PATH = path.join(dataDir, 'data.db')

/**
 * Rolling copy of the previous session's DB (before this launch opens it).
 * Skipped under LEETCODE_SR_DATA_DIR so stress tests never touch AppData backups.
 * Restore: close the app, copy data.backup.db → data.db.
 */
function backupUserDb(): void {
  if (proc.env.LEETCODE_SR_DATA_DIR) return
  if (!fs.existsSync(DB_PATH)) return
  try {
    fs.copyFileSync(DB_PATH, path.join(dataDir, 'data.backup.db'))
  } catch {
    /* best-effort; never block launch */
  }
}
backupUserDb()

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leetcode_id INTEGER,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  topic TEXT NOT NULL,
  neetcode_order INTEGER,
  is_custom INTEGER NOT NULL DEFAULT 0,
  is_excluded INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'undone',
  first_completed_at TEXT,
  last_reviewed_at TEXT,
  next_review_at TEXT,
  last_rating TEXT,
  last_hints INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL REFERENCES problems(id),
  reviewed_at TEXT NOT NULL,
  rating TEXT NOT NULL,
  hints INTEGER NOT NULL DEFAULT 0,
  interval_after INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_stats (
  topic TEXT PRIMARY KEY,
  last_visited_at TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  struggle_score REAL NOT NULL DEFAULT 0,
  easy_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  hard_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS today_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_date TEXT NOT NULL,
  problem_id INTEGER NOT NULL REFERENCES problems(id),
  kind TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  rated_at TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_assign_date ON today_assignments(assignment_date);
CREATE INDEX IF NOT EXISTS idx_problems_next ON problems(next_review_at);
`)
