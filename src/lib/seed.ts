import { db } from './db'
import { setSetting, getSetting, DEFAULT_SETTINGS } from './settings'
import { TOPICS } from './topics'
import { todayStr, DEFAULT_GOAL_DATE } from './dates'
import neetcode from '../../data/neetcode150.json'
import completed from '../../data/completed_problems.json'
import removed from '../../data/removed_problems.json'

/**
 * Idempotent first-launch seed: 150 problems, 30 Removed, 43 done.
 * No automatic bootstrap — completed problems enter SR as due-today backlog;
 * the user may optionally start a bootstrap from the Dashboard.
 */
export function seedIfNeeded(): void {
  const count = (
    db.prepare('SELECT COUNT(*) AS c FROM problems').get() as { c: number }
  ).c
  if (count > 0) {
    ensureSettingsDefaults()
    migrateLegacyAutoBootstrap()
    return
  }

  const today = todayStr()
  const removedSet = new Set(removed.removed_slugs)

  const insert = db.prepare(`
    INSERT INTO problems (leetcode_id, slug, title, difficulty, topic, neetcode_order,
      is_custom, is_excluded, url, status, first_completed_at, next_review_at, ease, interval_days, repetitions)
    VALUES (@leetcode_id, @slug, @title, @difficulty, @topic, @neetcode_order,
      0, @is_excluded, @url, @status, @first_completed_at, @next_review_at, 2.5, 0, 0)
  `)

  const tx = db.transaction(() => {
    // 1) all 150 seeded problems
    for (const p of neetcode.problems) {
      insert.run({
        leetcode_id: p.leetcode_id,
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        topic: p.topic,
        neetcode_order: p.order,
        is_excluded: removedSet.has(p.slug) ? 1 : 0,
        url: `https://leetcode.com/problems/${p.slug}/`,
        status: 'undone',
        first_completed_at: null,
        next_review_at: null,
      })
    }

    // 2) active completed → done, in SR, due today (repetitions=0 = no baseline yet)
    let i = 0
    const markDone = db.prepare(`
      UPDATE problems SET status = 'sr', first_completed_at = ?, next_review_at = ?
      WHERE slug = ? AND is_excluded = 0
    `)
    for (const slug of completed.completed_slugs) {
      if (removedSet.has(slug)) continue
      markDone.run(today, today, slug)
      i++
    }

    // 3) topic_stats rows
    const ts = db.prepare(
      'INSERT OR IGNORE INTO topic_stats (topic) VALUES (?)',
    )
    for (const t of TOPICS) ts.run(t)

    // 4) settings defaults + launch anchors for the goal ramp
    ensureSettingsDefaults()
    if (getSetting('start_date') === null) setSetting('start_date', today)
    if (getSetting('start_done') === null) setSetting('start_done', i)
  })
  tx()
}

function ensureSettingsDefaults(): void {
  const defaults: Record<string, string> = {
    goal_date: DEFAULT_GOAL_DATE,
    bootstrap_active: '0',
    bootstrap_complete: '0',
    bootstrap_completed_on: '',
    bootstrap_new_per_day: '0',
    bootstrap_pool_total: '0',
    bootstrap_total_days: '0',
    bootstrap_daily_cap: String(DEFAULT_SETTINGS.bootstrap_daily_cap),
    review_daily_target: String(DEFAULT_SETTINGS.review_daily_target),
    new_per_day: String(DEFAULT_SETTINGS.new_per_day),
  }
  for (const [k, v] of Object.entries(defaults)) {
    if (getSetting(k) === null) setSetting(k, v)
  }
}

/**
 * One-time migration from the old automatic-bootstrap model: any problems the
 * old seeder left in status='bootstrap' become normal SR (due immediately if
 * their scheduled date already passed). Bootstrap is opt-in from now on.
 */
function migrateLegacyAutoBootstrap(): void {
  if (getSetting('migrated_manual_bootstrap') === '1') return
  const today = todayStr()
  db.prepare(
    `UPDATE problems SET status = 'sr',
       next_review_at = CASE WHEN next_review_at IS NULL OR next_review_at < ? THEN ? ELSE next_review_at END
     WHERE status = 'bootstrap'`,
  ).run(today, today)
  setSetting('bootstrap_active', '0')
  setSetting('migrated_manual_bootstrap', '1')
}
