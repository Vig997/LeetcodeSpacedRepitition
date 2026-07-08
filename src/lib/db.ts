import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import proc from 'node:process'

const SCHEMA_VERSION = 1

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
  reconciled INTEGER NOT NULL DEFAULT 0
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
  const current = row ? Number(row.value) : 0
  if (!Number.isFinite(current) || current < SCHEMA_VERSION) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(SCHEMA_VERSION))
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
