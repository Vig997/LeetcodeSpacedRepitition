# LeetCode - Spaced Repetition

I built this for myself while grinding the NeetCode 150. I wanted something that
actually schedules reviews instead of me guessing what to redo, and I didn't want
another website account. So it's a small Windows desktop app — pick a goal date,
get a daily list, rate problems, and it spaces the next review for you. Everything
stays on your PC in SQLite. No cloud, no login.

## Download (Windows)

**Auto-updates (recommended):** run the Setup installer once. The app checks GitHub
for new releases on launch and installs updates when you quit.  
**[⬇ LeetCode-Spaced-Repetition-Setup (latest release)](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest)**

**Manual install (no auto-update):** download the zip, unzip once, run the exe inside.  
**[⬇ LeetCode-Spaced-Repetition-win-x64.zip](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition-win-x64.zip)**

**One-file portable** (simpler, but unpacks on every launch so it feels slower; no auto-update):  
**[⬇ LeetCode-Spaced-Repetition.exe](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition.exe)**

**Download looks empty or won't open?**

1. Check your **Downloads** folder — browsers save there by default, not next to the link you clicked.
2. In Edge/Chrome, open the download list (Ctrl+J). If the file says **Blocked** or **Discarded**, click **Keep** or **Show in folder**.
3. Right-click the zip → **Extract All** — don't double-click the zip expecting an installer; unzip first, then run `LeetCode - Spaced Repetition.exe` inside the folder.
4. If the file is tiny (a few KB), the download failed — open the [Releases page](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest) and click the asset name directly (`LeetCode-Spaced-Repetition-win-x64.zip`, ~150 MB).

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
  can bootstrap-review them at a daily cap before adding new ones. Or skip it
  and just start from scratch.
- **Problems** — Kept list in NeetCode topic order, Removed section, search /
  filters, Mark Done, Log Review, move stuff in/out of Removed, add customs.
- **Settings** — goal date, new/day (or Auto), review cap, bootstrap cap.
  Sliders don't save until you hit **Save settings**.

I also capped daily load at 10 so you don't get buried, and Today · New stays
day-locked like reviews (you get your paced count each morning; finishing one
doesn't pull the next until tomorrow). If you want more same-day, use **+ Extra
review** / **+ Extra new** on the Dashboard — extras reset tomorrow.

The app day rolls at **3:00 AM** local time (not midnight), so late-night sessions
keep the same Today list until 3am.

## Run from source

```bash
npm install
npm run rebuild   # better-sqlite3 for Electron 42.6.1
npm run dev
```

Other scripts: `npm run lint`, `npm run stress` (fake ~75 days in a temp folder,
not your real AppData), `npm run dist` (rebuilds native + builds the exe — close the app first).

## Updating the app

**Daily use:** launch from the Desktop shortcut **LeetCode SR** (or Start menu).

**After you change code on this machine (local dev install):**

1. Close LeetCode SR if it is open.
2. Double-click **`Update LeetCode SR.bat`** in the repo root.
   - Pulls latest git changes (if this folder is a git repo).
   - Rebuilds and recopies to `%LOCALAPPDATA%\LeetCode-SR\`.
   - Refreshes Desktop / Start menu shortcuts.
3. Reopen from the Desktop shortcut.

First-time local install: double-click **`Install LeetCode SR.bat`** instead.

Your progress in `%APPDATA%\leetcode-sr\` is never touched by reinstall or update.

**After you publish a GitHub release (for Setup-install users):**

1. Bump `"version"` in `package.json` (must match the release tag, e.g. `1.2.0` → tag `v1.2.0`).
2. Commit, push, and create the tag: `git tag v1.2.0 && git push origin v1.2.0`.
3. GitHub Actions builds and publishes the release assets automatically.
4. Users who installed via **Setup** get a prompt on next launch; the update installs when they quit (or immediately if they choose **Restart now**).

Zip and portable downloads do **not** auto-update — those users re-download from Releases.

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

## Shipping a new release

```bash
npm run lint
npm run stress
# bump version in package.json first
git tag v1.2.0
git push origin v1.2.0
```

GitHub Actions (`.github/workflows/release.yml`) runs lint, build, and
`electron-builder --publish always` on tag push. It uploads:

- `LeetCode-Spaced-Repetition-Setup-<version>.exe` — **auto-update** (NSIS)
- `LeetCode-Spaced-Repetition-win-x64.zip` — manual install
- `LeetCode-Spaced-Repetition.exe` — portable, manual only

You can also trigger the workflow manually from the Actions tab.

Local-only build without publishing:

```bash
npm run dist
```

Checklist: tag matches `package.json` version, Electron still 42.6.1, smoke-open
the Setup or unpacked exe once, confirm `%APPDATA%\leetcode-sr\data.backup.db`
refreshes after quit.

## Don't commit these

`node_modules/`, `dist/`, `dist-electron/`, `release/`, `.tmp-*`, `shots/`,
`scripts/*.cjs`, `*.log`, or your personal `data.db`. Do keep `build/icon.ico`.
