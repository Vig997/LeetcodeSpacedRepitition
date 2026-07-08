# LeetCode - Spaced Repetition

I built this for myself while grinding the NeetCode 150. I wanted something that
actually schedules reviews instead of me guessing what to redo, and I didn't want
another website account. So it's a small Windows desktop app — pick a goal date,
get a daily list, rate problems, and it spaces the next review for you. Everything
stays on your PC in SQLite. No cloud, no login.

## Download (Windows)

**Recommended (faster every day):** download the zip, unzip once, run the exe inside.  
**[⬇ LeetCode-Spaced-Repetition-win-x64.zip](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition-win-x64.zip)**

**One-file portable** (simpler, but unpacks on every launch so it feels slower):  
**[⬇ LeetCode-Spaced-Repetition.exe](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition.exe)**

Progress lives in `%APPDATA%\leetcode-sr\` (not next to the exe), so
re-downloading won't wipe anything. Closing the app refreshes `data.backup.db`
in that folder (SQLite backup API — safe with WAL).

**If something goes wrong — restore:**

1. Close the app completely.
2. In `%APPDATA%\leetcode-sr\`, delete `data.db`, `data.db-wal`, and `data.db-shm`
   (sidecars matter — leaving them can undo a good restore).
3. Copy `data.backup.db` to `data.db`.
4. Reopen the app.

Windows may warn about an unknown publisher (unsigned personal build) — that's expected.

## What you can do

- **Dashboard** — rings for Kept NeetCode + custom bonus problems, a "are you
  on track for your goal?" message, adaptive **pace advice** (which settings to
  raise or lower from your recent finish rates), and Today · Reviews / Today · New. Check a
  row, rate it (Easy / Medium / Hard / Forgot + hints), done. There's an
  **Undo rating** button if you misclick (saved for the same calendar day even if you close the app).
- **Bootstrap (optional)** — if you already finished a bunch of problems, you
  can baseline-review them at a daily cap before adding new ones. Or skip it
  and just start from scratch.
- **Problems** — Kept list in NeetCode topic order, Removed section, search /
  filters, Mark Done, Log Review, move stuff in/out of Removed, add customs.
- **Settings** — goal date, new/day (or Auto), review cap, bootstrap cap.
  Sliders don't save until you hit **Save settings**.

I also capped daily load at 10 so you don't get buried, and Today · New stays
locked for the day (finishing one doesn't instantly pull the next until
tomorrow). If you finish early and want more, use **+ Extra review** /
**+ Extra new** on the Dashboard — same-day only; tomorrow goes back to your
normal paced set.

## Run from source

```bash
npm install
npm run rebuild   # better-sqlite3 for Electron 42.6.1
npm run dev
```

Other scripts: `npm run lint`, `npm run stress` (fake ~75 days in a temp folder,
not your real AppData), `npm run dist` (rebuilds native + builds the exe — close the app first).

Stack is Electron 42.6.1, Vite, React 19, TypeScript, better-sqlite3, Tailwind 4.
Electron is pinned because better-sqlite3 didn't have a Windows prebuild for 43
when I shipped this.

## Folder layout

```
data/            seed JSON (150 problems, completed + removed lists)
electron/        window + open LeetCode links in the browser
src/lib/         db, scheduler, pacing, today lists, etc.
src/pages/       Dashboard / Problems / Settings
scripts/         stress-test.ts
```

First launch seeds the DB. Delete `%APPDATA%\leetcode-sr\data.db` (and the
`-wal` / `-shm` sidecars) if you want a clean slate. Tests use
`LEETCODE_SR_DATA_DIR` so they never touch your real data.

## Shipping a new exe

```bash
npm run lint
npm run stress
npm run dist
```

Then on GitHub: **Releases → Create a new release → tag it (e.g. v1.0.1) →
upload both `release/LeetCode-Spaced-Repetition.exe` and
`release/LeetCode-Spaced-Repetition-win-x64.zip` → Publish**. Don't commit the
`release/` folder into the repo.

Checklist: zip first in README, Electron still 42.6.1, smoke-open the unpacked
exe once, confirm `%APPDATA%\leetcode-sr\data.backup.db` refreshes after quit.

## Don't commit these

`node_modules/`, `dist/`, `dist-electron/`, `release/`, `.tmp-*`, `shots/`,
`scripts/*.cjs`, `*.log`, or your personal `data.db`. Do keep `build/icon.ico`.
