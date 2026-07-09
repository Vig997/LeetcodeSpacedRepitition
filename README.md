# LeetCode - Spaced Repetition

I made this while doing the NeetCode 150 because I kept forgetting problems I
thought I knew. Anki felt like overkill and I didn't want another account on
some website — I just wanted a daily list that tells me what to review and
when to do new ones.

So this is a small Windows app. Pick a goal date, do your reviews, rate how
hard it felt, and it schedules the next time you see each problem. Everything
saves locally on your computer (SQLite). No cloud, no login, no subscription.

---

## Get the app (Windows)

**Easiest way (recommended):** download the **Setup** installer and run it once.
After that the app can update itself when I push new releases.

**[⬇ Download latest Setup installer](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest)**

Look for a file named something like `LeetCode-Spaced-Repetition-Setup-1.1.2.exe`.

**Other options:**

- **[Zip folder](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition-win-x64.zip)** — unzip it, run the exe inside. Works fine, but no auto-update.
- **[Single portable exe](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest/download/LeetCode-Spaced-Repetition.exe)** — one file, but slower to open and no auto-update.

### Download acting weird?

- Check your **Downloads** folder (Ctrl+J in Chrome/Edge if you're not sure where it went).
- If Windows says the file is blocked, click **Keep** / **Allow**.
- For the zip: right-click → **Extract All**, then run `LeetCode - Spaced Repetition.exe` inside the folder. Don't try to run the zip itself.
- The zip should be ~150 MB. If it's tiny, the download failed — grab it again from the [Releases page](https://github.com/Vig997/LeetcodeSpacedRepitition/releases/latest).

Windows might warn "unknown publisher." That's normal — I didn't pay for code signing. It's just my personal project.

---

## Daily use

1. Open **LeetCode SR** from your Desktop shortcut (or Start menu).
2. Do **Today · Reviews** and **Today · New** on the Dashboard.
3. Check off a problem → rate it (Easy / Medium / Hard / Forgot).
4. Close the app when you're done.

That's it. Your progress is saved automatically.

**Good to know:**

- The app "day" resets at **3:00 AM**, not midnight — so if you're grinding at 1am you're still on yesterday's list.
- You get a fixed number of new problems per day (based on your goal date). Finishing one doesn't instantly give you another — use **+ Extra new** if you want more today.
- Same idea for reviews — **+ Extra review** if you're feeling ambitious.
- Mis-clicked a rating? **Undo rating** works for the rest of that day.

---

## What's in the app

**Dashboard** — progress rings, a "are you on track?" message, pace tips if you're falling behind or ahead, and today's review/new lists.

**Problems** — full NeetCode 150 list (in topic order), search/filter, mark done, log a review, add custom problems, move stuff to Removed if you don't care about it.

**Settings** — goal date, how many new problems per day, review cap, optional bootstrap mode. Hit **Save settings** when you change sliders.

**Bootstrap (optional)** — if you already solved a bunch of NeetCode before using this, bootstrap lets you review them on a schedule before adding new ones. You can skip it and start fresh too.

---

## Where your data lives

Everything is in:

`%APPDATA%\leetcode-sr\`

That's separate from wherever you installed the app, so re-downloading or updating won't wipe your progress.

If something breaks, there's a backup file `data.backup.db` in that same folder. To restore:

1. Close the app completely.
2. In `%APPDATA%\leetcode-sr\`, delete `data.db`, `data.db-wal`, and `data.db-shm`.
3. Copy `data.backup.db` → rename the copy to `data.db`.
4. Reopen the app.

---

## If you're editing the code yourself

You'll need Node.js installed.

```bash
npm install
npm run rebuild
npm run dev
```

**Update your local install after changing code:** double-click **`Update LeetCode SR.bat`** in the repo folder. First time only, use **`Install LeetCode SR.bat`**.

**Ship a new release** (so Setup users get auto-updates):

1. Bump `"version"` in `package.json` (e.g. `1.1.3`).
2. Push to GitHub.
3. GitHub → **Releases** → **Draft a new release** → tag `v1.1.3` → **Publish**.
4. Wait for the green check in **Actions**, then the installer shows up on the release page.

The tag version and `package.json` version need to match or the build won't attach files (learned that the hard way).

---

## Tech stuff (if you care)

Electron + React + TypeScript + SQLite (better-sqlite3) + Tailwind. Built with Vite.

Stress tests live in `scripts/stress-test.ts` (`npm run stress`) — they use a temp folder, not your real data.

---

Made for my own interview prep. Hope it helps someone else grinding too.
