# Remi — Feature Backlog (for Lane)

Next features after v0.1, written as self-contained tasks. Each is a candidate
**lane** (own worktree/branch off `main`). Gate every lane on `npm test` before
Review. Rebuild the app with `npm run package` when a lane touches runtime.

**Current code map** (so a picking agent has context):
- `src/state.js` — loads/saves `state.json` + `config.json` under `app.getPath('userData')`.
  - state: `{ date, glassesHad, goal, snoozeUntil, lastShownAt, paused }`
  - config: `{ intervalMinutes, workHours{start,end}, snoozeMinutes, autoDismissSeconds, goal }`
- `src/reminder.js` — **pure, tested** logic: `rollover`, `shouldRemind`, `markShown`, `applyAction`, `isWithinWorkHours`, `todayStr`.
- `src/main.js` — timer loop, tray menu (Remind now / Pause / Quit), `triggerReminder`, IPC `reminder:action` + `reminder:hide`.
- `src/renderer/` — `overlay.js` sequences walk-in → arrive → react → walk-out; `index.html` (pixel UI); sprites `walk.png`, `buddy-hold.png`.
- `test/reminder.test.js` — `node --test`.

**Lane layout (dependencies):**
```
Lane A (sequential):  #0 history  →  #1 streak  →  #2 calendar
Lane B (parallel):    #3 settings           (independent — run alongside Lane A)
```

---

## #0 — Foundation: daily history  ✅ Done
**Status:** Shipped — `history` in `state.json`, `rollover` writes finishing days.
**Why:** #1 and #2 both need per-day records; today-only state can't support them.
**Scope**
- Add `history: { "YYYY-MM-DD": { had, goal } }` to `state.json`.
- On day rollover (`reminder.js: rollover`), write the finishing day's `{had,goal}`
  into `history` before resetting the counter.
- `applyAction('had-it')` / increment updates `history[today].had` (and `today` mirrors it).
- Migrate gracefully: missing `history` → start `{}`; don't lose today's count.
**Acceptance**
- [ ] Simulating date changes retains prior days' `{had,goal}` in `history`.
- [ ] Today's count reads/writes `history[today]`.
- [ ] Existing tests pass; new tests cover rollover-into-history + migration.
**Files:** `src/state.js`, `src/reminder.js`, `test/reminder.test.js`
**Size:** S · **Depends on:** — · **Blocks:** #1, #2

---

## #1 — Streak days  ✅ Done
**Status:** Shipped — `streak()` + tray title `🔥N` + goal-reached bubble.
**Scope**
- Pure `streak(history, today, goal)` = count of consecutive days up to and
  including today (today counts only if `had >= goal`) where `had >= goal`.
- Show streak in the tray title (e.g. `💧 3/8 · 🔥5`).
- When today's goal is first reached, show a one-off **"🔥 N-day streak!"** bubble
  (reuse the existing bubble path; don't spam on later glasses same day).
**Acceptance**
- [ ] Streak increments across consecutive goal-met days; resets after a missed day.
- [ ] Tray shows current streak; celebratory bubble fires once when goal is hit.
- [ ] Unit tests for `streak()` incl. gaps, today-not-yet-met, empty history.
**Files:** `src/reminder.js` (calc), `src/main.js` (tray), `src/renderer/overlay.js` + `preload.js` (goal-reached bubble), `test/`
**Size:** S · **Depends on:** #0 · **Blocks:** —

---

## #2 — Calendar view  ✅ Done
**Status:** Shipped — `calendar.html` month grid via `getHistory()`, prev/next nav,
tinted by level. Enhanced in v0.2.2 to also show the glasses-achieved count per day.
**Scope**
- Tray item **"View progress"** opens a small window (`calendar.html`) with a
  month grid; each day tinted by `had/goal`: none / partial / full (goal met).
- Read `history` via IPC (`preload` exposes `getHistory()`; `main` handles it).
- Prev/next month navigation (nice-to-have); default = current month.
- Match the pixel/retro styling of the overlay for cohesion.
**Acceptance**
- [ ] Opening shows the current month with correct per-day colors from `history`.
- [ ] Days with no data render empty; goal-met days clearly distinct.
- [ ] Window is closable and doesn't disturb the reminder overlay.
**Files:** new `src/renderer/calendar.html` + `calendar.js`, `src/main.js` (window + IPC), `src/preload.js`
**Size:** M · **Depends on:** #0 · **Blocks:** —

---

## #3 — Settings: start/end time + frequency  (parallel lane)  ✅ Done
**Status:** Shipped — tray Settings submenu (interval / goal / snooze) applied live.
Note: the Work hours submenu was later hidden in v0.2.2 (see Shipped since, below).
**Scope**
- Let the user change `workHours.start`, `workHours.end`, `intervalMinutes`
  (and `goal`, `snoozeMinutes`) **without hand-editing `config.json`**.
- Start with a **tray submenu** of presets (interval: 30/45/60/90m; hours: a few
  common windows). Full settings *window* only if presets feel too limiting.
- Persist to `config.json` and **apply live** (restart the interval loop; no app restart).
- Validate: end > start; interval ≥ 5m.
**Acceptance**
- [ ] Changing interval/work-hours via the menu persists and takes effect immediately.
- [ ] Invalid combinations are rejected/prevented.
- [ ] Tray reflects the active settings.
**Files:** `src/main.js` (tray submenu + apply), `src/state.js` (save-config helper); optional `src/renderer/settings.*`
**Size:** M · **Depends on:** — (independent) · **Blocks:** —

---

## ✅ Shipped since this backlog (v0.2.x)

Beyond #0–#3, these landed lane-by-lane, PR-reviewed before merge:

- **Notification framework (F001)** — loopback HTTP API (`127.0.0.1:7777`, bearer token),
  `info` peeks + `action` replies, queue/lifecycle. See `docs/specs/001-notification-framework.md`.
- **Agent producers** — an **MCP server** (`mcp/`) and a **Claude skill** (`skill/`) so an AI
  agent can fire notifications; plus a client sample + test UI (`examples/`).
- **Expressive poses** — per-state sprites (sad / cheer / peek-wave / hands-folded).
- **Reminder reliability** — reliable walk-in (double-rAF), 1-minute interval option, louder chime.
- **Work hours disabled (v0.2.2)** — reminders fire at any hour; Work Hours tray item hidden
  (helper kept for easy re-enable).
- **Calendar glass count (v0.2.2)** — each day shows glasses achieved (`had/goal`).
- **Info peek chime (v0.2.3)** — `info` peeks now play the entrance chime like the other paths.
- **Slim bundle** — dev deps + `node_modules` excluded from the packaged app.

Releases: **v0.2.0 → v0.2.3** on [Weekend-Labs/remi](https://github.com/Weekend-Labs/remi/releases).

**Still open / parked:** Buddy V2 (Rive, F002) — paused pending export/plan. Smart triage
+ presence-aware delivery (F001 phases 5–6).

---

### Definition of done (every lane)
- `npm test` green · manual `npm run demo` sanity check · `npm run package` if runtime changed.
- Update `SPEC.md` status if the feature changes behavior.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
