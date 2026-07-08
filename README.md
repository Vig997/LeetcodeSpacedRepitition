# LeetCode - Spaced Repetition

I built this for myself while grinding the NeetCode 150. I wanted something that
actually schedules reviews instead of me guessing what to redo, and I didn't want
another website account. So it's a small Windows desktop app — pick a goal date,
get a daily list, rate problems, and it spaces the next review for you. Everything
stays on your PC in SQLite. No cloud, no login.

## Download (Windows)

**[⬇ Download LeetCode-Spaced-Repetition.exe](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition.exe)**

Just click that, run the exe, and you're in. First open can be a little slow
while it unpacks; after that it's fine. Your progress is saved under
`%APPDATA%\leetcode-sr\` (not next to the exe), so re-downloading won't wipe
anything. There's also a `data.backup.db` copy in that same folder.

If you're developing locally, `release/win-unpacked/` starts faster than the
portable single-file build.

## What you can do

- **Dashboard** — rings for Kept NeetCode + custom bonus problems, a "are you
  on track for your goal?" message, and Today · Reviews / Today · New. Check a
  row, rate it (Easy / Medium / Hard / Forgot + hints), done. There's an
  **Undo rating** button if you misclick (same session only).
- **Bootstrap (optional)** — if you already finished a bunch of problems, you
  can baseline-review them at a daily cap before adding new ones. Or skip it
  and just start from scratch.
- **Problems** — Kept list in NeetCode topic order, Removed section, search /
  filters, Mark Done, Log Review, move stuff in/out of Removed, add customs.
- **Settings** — goal date, new/day (or Auto), review cap, bootstrap cap.
  Sliders don't save until you hit **Save settings**.

I also capped daily load at 10 so you don't get buried, and Today · New stays
locked for the day (finishing one doesn't instantly pull the next until
tomorrow).

## Run from source

```bash
npm install
npm run rebuild   # better-sqlite3 for Electron 42.6.1
npm run dev
```

Other scripts: `npm run lint`, `npm run stress` (fake ~75 days in a temp folder,
not your real AppData), `npm run dist` (builds the exe — close the app first).

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

First launch seeds the DB. Delete `%APPDATA%\leetcode-sr\data.db` if you want a
clean slate. Tests use `LEETCODE_SR_DATA_DIR` so they never touch your real data.

## Shipping a new exe

```bash
npm run dist
```

Then on GitHub: **Releases → Create a new release → tag it (e.g. v1.0.0) →
upload `release/LeetCode-Spaced-Repetition.exe` → Publish**. Don't commit the
`release/` folder into the repo.

## Don't commit these

`node_modules/`, `dist/`, `dist-electron/`, `release/`, `.tmp-*`, `shots/`,
`scripts/*.cjs`, `*.log`, or your personal `data.db`. Do keep `build/icon.ico`.
