# LeetCode - Spaced Repetition

Windows desktop app for NeetCode 150 spaced repetition: daily reviews, goal-date pacing, offline SQLite progress — no cloud or account.

## Download (Windows)

**[⬇ Download LeetCode-Spaced-Repetition.exe](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition.exe)**

That link always points at the latest GitHub Release asset — click it to save
the portable exe (no installer). First launch may take a few seconds while it
unpacks; after that, double-click the same file to open the app.

Progress lives in `%APPDATA%\leetcode-sr\data.db` (not next to the exe), so
moving or re-downloading the exe never wipes your history. A rolling backup is
also written to `%APPDATA%\leetcode-sr\data.backup.db`. Only one app window is
allowed at a time.

### Local builds (developers)

- Daily / faster cold start: `release/win-unpacked/LeetCode - Spaced Repetition.exe`
- Portable (same file uploaded to Releases): `release/LeetCode-Spaced-Repetition.exe`

## How it works

- **Dashboard** — progress rings (NeetCode Kept + bonus customs), live
  on-track message for your goal date, pace strip, and Today lists. Check a
  row → rate it (Easy/Medium/Hard/Forgot + hints) → SR schedules the next
  review. Header **Undo rating** reverts the last rating in this session.

- **Goal-date pacing** — the algorithm looks at how many Kept problems are
  done vs. total and how many days remain until your goal date, then
  recommends the day's spaced reviews and new problems. "New per day" can be
  a fixed number or **Auto** (remaining ÷ days left, rounded up).
- **Optional bootstrap** — no forced bootstrap. If you have a backlog of
  already-done problems, press **Start Bootstrap** on the Dashboard, pick the
  problems and a daily review cap (typed, no spinner). Optionally enable
  **new/day during bootstrap** so Today · New appears with Trees-order
  problems while baseline reviews run. Skip bootstrap entirely if you're
  starting from scratch.
- **Problems** — Kept (grouped by NeetCode block in roadmap order) and Removed
  (visible but out of SR/rings). Search, difficulty/concept filters, Mark Done,
  Log Review, Re-enable, Move to Removed, + Add custom problems (bonus ring).
- **Settings** — goal date (typeable), new per day (or Auto), review daily cap,
  bootstrap daily cap. Edit values, then press **Save settings** to persist.
  An "Unsaved changes" hint appears when draft ≠ saved. Goal reachability
  previews from draft before Save.

Scheduling is 100% deterministic TypeScript (no LLM): rating-driven intervals
with ease factor, goal-date pressure, topic balancer + difficulty mixer
(day-seeded so Today · Reviews fill slots stay fixed for the calendar day),
per-day `today_assignments` with honest end-of-day reconcile.

### Risk mitigations

- **Review debt** — hard cap of 10 reviews assigned per day; pace strip shows
  "X today · Y overdue waiting" when backlog exceeds today's cap.
- **Load ceiling** — total Today load capped at 10; new slots trim first.
- **Past goal date** — amber reframe message; reviews and new still assign.
- **Bootstrap deferral** — ratings during bootstrap push `next_review_at` out
  by SR interval + full bootstrap period + small jitter (Forgot uses same rule).
- **Day-locked Today · New** — once the day's new set is assigned, finishing
  one does not refill another until the next calendar day (roadmap advances then).
- **Undo rating** — session-only; reverts the last Easy/Medium/Hard/Forgot
  (or Mark Done) including Today checkbox and review_log.

## Development

```bash
npm install
npm run rebuild   # fetch better-sqlite3 prebuild for Electron 42.6.1
npm run dev       # Vite + Electron with HMR
npm run build     # type-check + bundle renderer & main
npm run lint      # oxlint
npm run stress    # simulated ~75-day usage test (uses .tmp-stress/, not AppData)
npm run dist      # electron-builder → release/ (close all app instances first)
```

Stack: Electron 42.6.1 (pinned — better-sqlite3 has no prebuild for 43 yet),
Vite, React 19, TypeScript, better-sqlite3, Tailwind 4.

## Project layout

```
data/            seed JSON (150 problems, 43 completed, 30 removed)
electron/        main-process entry (window + external links)
src/lib/         db, seed, settings, scheduler, pacing, topicBalancer,
                 todayAssignments, dataStore, dates, topics, types
src/hooks/       useProblems — one shared snapshot hook
src/components/  rings, pace strip, today lists, modals, badges
src/pages/       Dashboard / Problems / Settings
scripts/         stress-test.ts
scripts/archive/ one-off seed tools (not used at runtime)
```

The database seeds itself on first launch; deleting
`%APPDATA%\leetcode-sr\data.db` gives a clean slate. Tests point the app at a
scratch folder via the `LEETCODE_SR_DATA_DIR` env var instead.

## Publishing a downloadable exe (GitHub Release)

The README download button works only after you attach the portable exe to a
Release (do **not** commit `release/` into the repo — GitHub has a ~100 MB
file warning and Releases are the right place for binaries).

```bash
npm run dist
# Upload: release/LeetCode-Spaced-Repetition.exe
# to a new Release tagged e.g. v1.0.0 → asset name must match the link above
```

On GitHub: **Releases → Create a new release → tag `v1.0.0` → attach the exe →
Publish**. The `/releases/latest/download/...` URL then serves that file.

## What not to commit

`node_modules/`, `dist/`, `dist-electron/`, `release/`, `.tmp-*`, `shots/`,
`scripts/*.cjs`, `*.log`, and any user `data.db`. Do commit `build/icon.ico`
(app icon for electron-builder).
