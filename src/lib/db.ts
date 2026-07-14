import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import proc from 'node:process'
import { addDays, dateOnly, localDayFromISO, todayStr } from './dates'
import { capIntervalDays, computeNextReviewAt } from './reviewSchedule'
import type { Problem, Rating } from './types'

const SCHEMA_VERSION = 6

const appData =
  proc.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
const dataDir = proc.env.LEETCODE_SR_DATA_DIR ?? path.join(appData, 'leetcode-sr')
fs.mkdirSync(dataDir, { recursive: true })

export const DB_PATH = path.join(dataDir, 'data.db')
export const BACKUP_PATH = path.join(dataDir, 'data.backup.db')

export type DbOpenError = { message: string; path: string }

let openError: DbOpenError | null = null

export function getDbOpenError(): DbOpenError | null {
  return openError
}

function openDatabase(): Database.Database {
  try {
    const database = new Database(DB_PATH)
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = NORMAL')
    database.pragma('foreign_keys = ON')
    return database
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    openError = { message: msg, path: DB_PATH }
    const stub = new Database(':memory:')
    stub.pragma('foreign_keys = ON')
    return stub
  }
}

export const db = openDatabase()

/**
 * Consistent online backup via SQLite backup API (safe with WAL).
 * Skipped under LEETCODE_SR_DATA_DIR (tests / temp DBs).
 */
export async function backupUserDb(
  database: Database.Database = db,
): Promise<void> {
  if (proc.env.LEETCODE_SR_DATA_DIR) return
  if (openError) return
  try {
    database.pragma('wal_checkpoint(PASSIVE)')
    await database.backup(BACKUP_PATH)
    for (const side of ['-wal', '-shm'] as const) {
      try {
        fs.unlinkSync(BACKUP_PATH + side)
      } catch {
        /* none */
      }
    }
  } catch {
    /* best-effort */
  }
}

/** Checkpoint, backup, then close — used on window close / quit. */
export async function closeAndBackupUserDb(): Promise<void> {
  if (openError) return
  try {
    await backupUserDb(db)
  } catch {
    /* ignore */
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
  try {
    db.close()
  } catch {
    /* ignore */
  }
}

if (!openError) {
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
  reconciled INTEGER NOT NULL DEFAULT 0,
  is_extra INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_assign_date ON today_assignments(assignment_date);
CREATE INDEX IF NOT EXISTS idx_problems_next ON problems(next_review_at);
CREATE INDEX IF NOT EXISTS idx_review_log_problem ON review_log(problem_id);
`)

  migrateSchema()
  pruneOldHistory()
  setImmediate(() => {
    void backupUserDb()
  })
}

function migrateSchema(): void {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'schema_version'")
    .get() as { value: string } | undefined
  let current = row ? Number(row.value) : 0
  if (!Number.isFinite(current)) current = 0

  // Idempotent column adds — run even if schema_version was bumped without columns (repair path).
  const cols = db.pragma('table_info(today_assignments)') as { name: string }[]
  const has = (name: string) => cols.some((c) => c.name === name)

  if (!has('is_extra')) {
    db.exec(
      'ALTER TABLE today_assignments ADD COLUMN is_extra INTEGER NOT NULL DEFAULT 0',
    )
    current = Math.max(current, 2)
  }
  if (!has('session_rating')) {
    db.exec('ALTER TABLE today_assignments ADD COLUMN session_rating TEXT')
    current = Math.max(current, 3)
  }
  if (!has('session_hints')) {
    db.exec('ALTER TABLE today_assignments ADD COLUMN session_hints INTEGER')
    current = Math.max(current, 3)
  }
  if (!has('before_json')) {
    db.exec('ALTER TABLE today_assignments ADD COLUMN before_json TEXT')
    current = Math.max(current, 3)
  }

  const repaired = db
    .prepare("SELECT value FROM settings WHERE key = 'repaired_problem_dates_v4'")
    .get() as { value: string } | undefined

  if (repaired?.value !== '1') {
    repairCorruptedProblemDates()
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('repaired_problem_dates_v4', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run()
    current = Math.max(current, 4)
  }

  const runaway = db
    .prepare("SELECT value FROM settings WHERE key = 'repaired_runaway_reviews_v5'")
    .get() as { value: string } | undefined

  if (runaway?.value !== '1') {
    repairRunawayReviewData()
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('repaired_runaway_reviews_v5', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run()
    current = Math.max(current, 5)
  }

  const resync = db
    .prepare("SELECT value FROM settings WHERE key = 'resynced_next_review_v6'")
    .get() as { value: string } | undefined

  if (resync?.value !== '1') {
    resyncAllNextReviewDates()
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('resynced_next_review_v6', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run()
    current = Math.max(current, 6)
  }

  current = Math.max(current, SCHEMA_VERSION)

  if (!row || Number(row.value) !== SCHEMA_VERSION) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(SCHEMA_VERSION))
  }
}

/** Fix invalid next_review_at values and align repetitions with review_log. */
function repairCorruptedProblemDates(): void {
  const countLogs = db.prepare('SELECT COUNT(*) AS c FROM review_log WHERE problem_id = ?')
  const update = db.prepare(`
    UPDATE problems
    SET first_completed_at = ?, last_reviewed_at = ?, next_review_at = ?, repetitions = ?
    WHERE id = ?
  `)

  const problems = db.prepare('SELECT * FROM problems').all() as Problem[]
  const today = todayStr()

  for (const p of problems) {
    const logCount = (countLogs.get(p.id) as { c: number }).c
    const first = dateOnly(p.first_completed_at)
    const last = dateOnly(p.last_reviewed_at)
    let next = dateOnly(p.next_review_at)

    if (!next) {
      const base = last ?? first ?? today
      const span = capInterval(Number.isFinite(p.interval_days) ? p.interval_days : 1)
      next = addDays(base, span)
    }

    let reps = p.repetitions
    if (logCount > 0) {
      if (reps > logCount || reps < 1 || !Number.isFinite(reps)) reps = logCount
    } else if (!Number.isFinite(reps) || reps < 0) {
      reps = 0
    }

    const changed =
      first !== dateOnly(p.first_completed_at) ||
      last !== dateOnly(p.last_reviewed_at) ||
      next !== dateOnly(p.next_review_at) ||
      reps !== p.repetitions

    if (changed) {
      update.run(first, last, next, reps, p.id)
    }
  }
}

interface ReviewLogRow {
  id: number
  problem_id: number
  reviewed_at: string
  rating: Rating
  hints: number
  interval_after: number
}

function capInterval(interval: number): number {
  return capIntervalDays(interval)
}

function getNumberSettingLocal(key: string, fallback: number): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row?.value) return fallback
  const n = Number(row.value)
  return Number.isFinite(n) ? n : fallback
}

function bootstrapDeferralDays(p: Problem, lastReviewDay: string): number {
  const bootstrapActive =
    (db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_active'").get() as
      | { value: string }
      | undefined)?.value === '1'

  if (bootstrapActive && p.status !== 'bootstrap') {
    return getNumberSettingLocal('bootstrap_total_days', 0)
  }

  const completedOn = (
    db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_completed_on'").get() as
      | { value: string }
      | undefined
  )?.value
  const lastTotal = getNumberSettingLocal('bootstrap_last_total_days', 0)
  if (completedOn && lastTotal > 0 && lastReviewDay <= completedOn) {
    return lastTotal
  }

  return 0
}

function resyncAllNextReviewDates(): void {
  const update = db.prepare(`
    UPDATE problems SET next_review_at = ?, interval_days = ? WHERE id = ?
  `)

  const problems = db
    .prepare('SELECT * FROM problems WHERE is_excluded = 0 AND first_completed_at IS NOT NULL')
    .all() as Problem[]

  for (const p of problems) {
    const logs = db
      .prepare('SELECT * FROM review_log WHERE problem_id = ? ORDER BY id')
      .all(p.id) as ReviewLogRow[]

    if (p.status === 'bootstrap' && logs.length === 0) {
      const stagger = dateOnly(p.next_review_at)
      if (!stagger) update.run(todayStr(), p.interval_days, p.id)
      continue
    }

    if (logs.length === 0) continue

    const last = logs[logs.length - 1]!
    const lastDay = localDayFromISO(last.reviewed_at)
    const sr = capInterval(last.interval_after)
    const deferral = bootstrapDeferralDays(p, lastDay)
    const next = computeNextReviewAt(lastDay, sr, p.id, deferral)

    if (dateOnly(p.next_review_at) !== next || p.interval_days !== sr) {
      update.run(next, sr, p.id)
    }
  }
}

function masteredFromLogs(logs: ReviewLogRow[], interval: number): boolean {
  if (interval < 21 || logs.length < 2) return false
  const last2 = logs.slice(-2)
  return last2.every(
    (r) => (r.rating === 'medium' || r.rating === 'easy') && r.hints <= 1,
  )
}

/** Collapse accidental same-day double-ratings and rebuild SR fields from review_log. */
function repairRunawayReviewData(): void {
  const logs = db
    .prepare('SELECT * FROM review_log ORDER BY problem_id, id')
    .all() as ReviewLogRow[]

  const byProblemDay = new Map<string, ReviewLogRow[]>()
  for (const row of logs) {
    const day = localDayFromISO(row.reviewed_at)
    const key = `${row.problem_id}:${day}`
    const arr = byProblemDay.get(key) ?? []
    arr.push(row)
    byProblemDay.set(key, arr)
  }

  const deleteLog = db.prepare('DELETE FROM review_log WHERE id = ?')
  for (const [, dayLogs] of byProblemDay) {
    if (dayLogs.length <= 1) continue
    for (let i = 1; i < dayLogs.length; i++) {
      deleteLog.run(dayLogs[i]!.id)
    }
  }

  const updateProblem = db.prepare(`
    UPDATE problems
    SET status = ?, first_completed_at = ?, last_reviewed_at = ?, next_review_at = ?,
      last_rating = ?, last_hints = ?, interval_days = ?, repetitions = ?
    WHERE id = ?
  `)

  const problems = db
    .prepare('SELECT id FROM problems WHERE first_completed_at IS NOT NULL')
    .all() as { id: number }[]

  for (const { id } of problems) {
    const remaining = db
      .prepare('SELECT * FROM review_log WHERE problem_id = ? ORDER BY id')
      .all(id) as ReviewLogRow[]
    if (remaining.length === 0) continue

    const first = remaining[0]!
    const last = remaining[remaining.length - 1]!
    const firstDay = localDayFromISO(first.reviewed_at)
    const lastDay = localDayFromISO(last.reviewed_at)
    const interval = capInterval(last.interval_after)
    const deferral = bootstrapDeferralDays(
      db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as Problem,
      lastDay,
    )
    const next = computeNextReviewAt(lastDay, interval, id, deferral)
    const mastered = masteredFromLogs(remaining, interval)

    updateProblem.run(
      mastered ? 'mastered' : 'sr',
      firstDay,
      lastDay,
      next,
      last.rating,
      last.hints,
      interval,
      remaining.length,
      id,
    )
  }
}

/** Drop old assignment rows and trim review_log growth. */
function pruneOldHistory(): void {
  try {
    db.prepare(
      `DELETE FROM today_assignments
       WHERE assignment_date < date('now', 'localtime', '-90 days')`,
    ).run()

    const logCount = (
      db.prepare('SELECT COUNT(*) AS c FROM review_log').get() as { c: number }
    ).c
    if (logCount > 50_000) {
      db.prepare(
        `DELETE FROM review_log WHERE id NOT IN (
          SELECT id FROM review_log ORDER BY id DESC LIMIT 40000
        )`,
      ).run()
    }
  } catch {
    /* best-effort */
  }
}
