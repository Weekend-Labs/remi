<div align="center">

<img src="assets/icon.png" alt="Remi app icon — a pixel-art buddy holding a glass of water" width="160" />

# Remi 💧

**A little pixel dude who walks onto your screen and hands you a glass of water.**

Because a notification is easy to ignore — a character strolling across your desktop is not.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS%20(arm64)-black.svg?logo=apple)](#-platform-note)
[![Built with Electron](https://img.shields.io/badge/Built%20with-Electron-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)

</div>

> **📸 TODO — capture a hero GIF.** The real magic is watching the buddy *walk in*,
> offer water, cheer when you say "Had it", and stroll back off screen. That can't be
> screen-recorded headlessly, so drop a `docs/media/remi-demo.gif` here and swap this
> block for it. Until then, the app icon above is the character you'll meet, and
> [`docs/DESIGN-YOUR-OWN-BUDDY.md`](docs/DESIGN-YOUR-OWN-BUDDY.md) shows every frame.

---

## Why this exists

I miss recurring self-care reminders when I'm heads-down at work. A plain macOS
notification slides in, I glance past it, it's gone. **A notification is easy to
ignore. A character walking across your screen is not.**

So Remi is a menu-bar app that, every so often during your work hours, sends a
small pixel-art buddy walking in from the bottom-right corner holding a glass of
water. He waits, you tap **Had it 💧** (he cheers) or **Snooze 15m** (he waves and
wanders off), and your progress ticks up. That's the whole idea — make the nudge
*delightful* instead of nagging, and you'll actually drink the water.

## Features

- **💧 Water reminders** — on a timer, only inside your configured work hours.
- **🚶 A buddy who walks in** — 4-frame side-view walk cycle steps him into the
  corner; he arrives holding a glass, breathes with an idle bob, and walks back out.
  A soft two-note chime plays on entrance (synthesized, no audio file).
- **✅ Snooze / Had-it** — two buttons. "Had it" increments today's count and plays a
  cheer; "Snooze" (or a 30s no-answer auto-dismiss) sets a soft snooze and he leaves.
- **📅 Daily history** — every day's `{ had, goal }` is archived in `state.json`, so
  progress survives across days.
- **🔥 Streaks** — consecutive goal-met days show as `· 🔥5` in the menu-bar title,
  and the glass that *first* reaches today's goal fires a one-off "🔥 N-day streak!"
  celebration bubble.
- **🗓️ Calendar view** — the tray **View progress** item opens a month grid, each day
  tinted by how close you got: empty / partial / goal-met, with today outlined and
  prev/next month navigation.
- **⚙️ Live Settings submenu** — change interval (30/45/60/90m), work-hours window,
  daily goal, and snooze length right from the tray. Changes persist to `config.json`
  and apply immediately — no app restart, the reminder loop just re-arms.
- **🪶 Stays out of your way** — a frameless, transparent, always-on-top corner window
  that's hidden ~99% of the time, never steals focus, and lives in the menu bar with
  no dock icon.

## Quickstart

```bash
git clone https://github.com/Weekend-Labs/remi.git
cd remi
npm install          # pulls Electron (dev dependency)

npm start            # run the app — buddy appears on the reminder timer
npm run demo         # same, but the buddy walks in ~2.5s after launch so you
                     #   can see the whole animation without waiting an hour
npm test             # run the pure-logic unit tests (node --test, 34 tests)
npm run package      # build Remi.app into dist/ (macOS arm64, with the .icns icon)
```

`npm start` puts Remi in your **menu bar** (no dock icon, no window). Click the
`💧 0/8` title to open the tray menu — **Remind now**, **View progress**, **Pause**,
**Settings**, **Quit**. Use `npm run demo` the first time so you don't have to wait
for the interval to fire.

## A 30-second architecture tour

Remi is deliberately tiny: a timer, two JSON files, and some pixel sprites. No
database, no framework beyond Electron, no animation library.

```
┌─ main process (src/main.js) ──────────────────────────────┐
│  setInterval every 30s → rollover + shouldRemind?          │
│  Tray menu (title + Settings submenu + calendar/pause)     │
│  Owns two BrowserWindows:                                  │
│    • overlay  → transparent corner window (the buddy)      │
│    • calendar → framed month-grid window (View progress)   │
└──────────┬───────────────────────────────┬────────────────┘
           │ IPC (via src/preload.js)       │ IPC
           ▼                                ▼
  ┌─ overlay renderer ──────────┐   ┌─ calendar renderer ────────┐
  │ renderer/index.html + CSS   │   │ renderer/calendar.html     │
  │ renderer/overlay.js         │   │ renderer/calendar.js       │
  │   walk-in → idle+bubble →   │   │   month grid tinted by     │
  │   react → walk-out          │   │   history[date]            │
  │ sprites: walk.png,          │   └────────────────────────────┘
  │          buddy-hold.png     │
  └─────────────────────────────┘

  Pure, tested logic (no Electron, no I/O):
    src/reminder.js      rollover · shouldRemind · applyAction · streak · todayStr
    src/calendar-grid.js monthGrid · dayLevel
    src/state.js         load/save state.json + config.json · isValidConfig
    test/*.test.js       node --test  (reminder + settings + calendar grid)
```

The split that matters: **all the interesting logic is pure functions** in
`reminder.js`, `calendar-grid.js`, and `state.js`, tested with plain `node --test`
and zero Electron in the loop. `main.js` is just wiring — timer, tray, windows, IPC.
The renderer is HTML/CSS sprite animation. That's why the test suite runs in
milliseconds and stays green regardless of the UI.

### Where your data lives

State and config are plain JSON under Electron's per-app `userData` directory
(`app.getPath('userData')`). On macOS that's:

```
~/Library/Application Support/Remi/state.json    # date, glassesHad, goal, snooze, paused, history{}
~/Library/Application Support/Remi/config.json   # intervalMinutes, workHours, snoozeMinutes, autoDismissSeconds, goal
```

Both files are created with sane defaults on first run and migrate forward if a
field is missing — you can hand-edit them, but the **Settings** submenu covers
everything without touching a file. Delete them to reset.

## 🍎 Platform note

**macOS on Apple Silicon (arm64) only, for now.** The `npm run package` script builds
a `darwin/arm64` bundle (`Remi.app`) with a macOS `.icns` icon. Nothing in the code is
deeply macOS-specific — it's Electron — but the transparent, click-through,
always-on-top corner overlay is only exercised and tested on macOS, and the packaging
target is hard-coded to Apple Silicon. Intel-Mac / Windows / Linux builds would need a
tweak to the `package` script and a pass over the overlay window flags. PRs welcome.

## Make it *your* buddy

The character is me, rendered as Stardew-style pixel art from a few selfies. **You can
replace it with anyone** — a photo of you, your cat, a robot — using the same repeatable
art pipeline (AI image → magenta-keyed sprite sheet → walk strip + icon). The whole thing
is documented, copy-paste prompts and all, in:

### 👉 [**docs/DESIGN-YOUR-OWN-BUDDY.md**](docs/DESIGN-YOUR-OWN-BUDDY.md)

## More docs

- [**docs/DESIGN-YOUR-OWN-BUDDY.md**](docs/DESIGN-YOUR-OWN-BUDDY.md) — build your own character (AI prompts + the `tools/*.py` pipeline).
- [**SPEC.md**](SPEC.md) — the product story: goal, scope, stack decisions, roadmap.
- [**BACKLOG.md**](BACKLOG.md) — the code map and how the post-v0.1 features were scoped.

## License

[MIT](LICENSE) © 2026 Vijay Chhuttani. Free for any purpose — fork it, reskin it, ship it.
