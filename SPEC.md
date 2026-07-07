# Reminder Buddy — Spec (v0.1)

An animated desktop character that walks onto the screen during office hours and
reminds me to do important things. **V1 = water reminders only.** Later modules
(Calendar, pending Slack replies) plug into the same avatar and event loop.

Owner: Vijay · Platform: macOS · Status: DRAFT for review

---

## 1. Goal

I miss recurring self-care and task reminders while heads-down at work. A plain
notification is easy to ignore. A charming animated buddy that *walks in*, offers
a glass of water, and reacts to my answer is hard to ignore and pleasant to have
around. It also tracks my progress (glasses/day).

**V1 success = I actually drink more water on workdays because the buddy nudges me,
and the nudge feels delightful, not annoying.**

---

## 2. Scope

### In scope (V1)
- One recurring reminder type: **drink water**.
- Buddy walks in from a screen edge holding a glass, shows a speech bubble.
- Two actions: **"Had it 💧"** (increment progress) and **"Snooze 15m"**.
- Progress tracking: glasses had today vs a daily goal (default 8).
- Configurable interval + work-hours window (default: every 60 min, 9:00–18:00).
- New day resets the counter. Menu-bar (tray) icon: pause / quit / see progress.

### Explicitly NOT in scope (V1) — YAGNI
- Calendar module, Slack-reply module — *later*, but see §4 for the seam.
- Accounts, cloud sync, multi-device, history charts, streaks/gamification.
- Windows/Linux builds. macOS only for now.
- Settings UI — a JSON config file + sane defaults is enough for V1.
- Multiple characters / skins.

---

## 3. UX flow

```
timer fires (inside work-hours, not snoozed)
        │
        ▼
buddy WALKS IN from bottom-right edge, holding glass  ── overlay becomes click-catching
        │
        ▼
IDLE + speech bubble "Time for water 💧 (3/8 today)"
        │
   ┌────┴─────────────┐
   ▼                  ▼
[Had it 💧]        [Snooze 15m]
   │                  │
 happy anim        wave anim
 glasses++         snoozeUntil = now+15m
   │                  │
   └────────┬─────────┘
            ▼
buddy WALKS OUT, overlay goes click-through + hidden again
```

- Overlay is invisible and click-through except while the buttons are showing.
- Auto-dismiss: if I don't respond within ~30s, treat as a soft snooze (walk out,
  retry in 15m) so it never sits blocking my screen. `# tune this`

---

## 4. Architecture

### 4.1 Chosen stack (V1): **Electron + Rive**

- **Shell:** Electron app.
  - `main` process: the reminder timer, JSON state on disk, tray icon.
  - Renderer: a transparent, frameless, `alwaysOnTop` overlay `BrowserWindow`
    spanning the screen. Click-through by default via
    `setIgnoreMouseEvents(true, { forward: true })`, toggled off only while the
    action buttons are visible.
- **Avatar:** **Rive** character driven by a **state machine** (see §5), rendered
  with the `@rive-app/canvas` web runtime inside the renderer.

Why this pairing for V1: it is the **shortest, lowest-risk path to a transparent
walking-character overlay on macOS.** Electron's transparent + click-through
window APIs are mature and are exactly what existing desktop pets rely on; the
Rive web runtime "just works" in any webview and its state-machine triggers map
cleanly onto snooze/had-it. Fastest route to a working, delightful V1.

### 4.2 Alternatives considered (fresh-eyes pass)

| Option | Footprint (idle) | Overlay maturity on macOS | Effort | Verdict |
|---|---|---|---|---|
| **Electron + Rive** | ~150–300 MB RAM, ~1–2s start | **Mature** — battle-tested transparent + `setIgnoreMouseEvents(forward)` | Low (JS) | ✅ **V1** |
| **Tauri + Rive** | ~30–50 MB RAM, <0.5s start | **Rough today** — transparency needs `macos-private-api` (blocks App Store), open `setIgnoreCursorEvents` bugs, reports of transparent-window glitches on Sonoma, and mouseenter/leave not firing when transparent+ignore-cursor | Medium (Rust) | ⏳ Footprint upgrade *after* V1, once click-through bugs settle |
| **Native SwiftUI/AppKit + Rive Apple runtime** | Lightest + most robust overlay (`NSWindow` level, borderless transparent, `ignoresMouseEvents`) | **Best** — first-class OS support | High (Swift + less-trodden Rive Apple runtime) | ⏳ The "ultimate" version if this becomes a daily driver |

Community signal: real-world desktop pets ship on varied stacks — **VPet** (C#/WPF,
open source, on Steam), **Shimeji-ee** (Java, XML-defined actions). There is no
single dominant framework; the constant is a transparent always-on-top window +
sprite/vector animation. For *interactive, state-driven* characters specifically,
**Rive + its state machine** is the current community sweet spot (used for app
mascots), and there's a working **Rive-viewer-on-Tauri** reference project proving
the Rive-in-webview path.

**Footprint caveat (the main knock on Electron):** this is an all-day, always-on
app, so idle RAM matters. Mitigation: the buddy is hidden ~99% of the time (shown
only ~10s/hour), and the overlay window stays hidden between reminders — so render
cost is near-zero; only Electron's baseline idle footprint remains. Acceptable for
personal use on one Mac (App Store irrelevant). If it ever feels heavy, migrate the
shell to Tauri or native — **the avatar + reminder logic port unchanged** (Rive
file is stack-agnostic; the engine is plain JS/TS).

### 4.3 The seam for future modules

The reminder engine emits generic `ReminderEvent`s; the avatar just renders
whatever event it's handed. A Calendar or Slack-reply module later is *just another
producer* of `ReminderEvent`s + its own speech-bubble text and action buttons.
Don't build the bus abstraction now — but keep the water flow shaped as
`event → show buddy → collect action → persist`, so the seam exists for free.

```ts
type ReminderEvent = {
  kind: 'water'                 // later: 'calendar' | 'slack'
  message: string               // speech bubble text
  actions: { label: string; result: string }[]  // buttons
}
```

---

## 5. Avatar system (Rive)

A stylized 2D cartoon character (styled to look like me), rigged in the free Rive
editor. One `.riv` file, one state machine, GPU-accelerated, tiny, 60fps.

### States / animations
- `walk-in` — enters from screen edge holding a glass
- `idle` — gentle breathing loop while waiting for my answer
- `happy` — plays on "Had it" (cheer / thumbs-up)
- `wave` — plays on "Snooze" (friendly wave)
- `walk-out` — exits the screen

### State-machine inputs (fired from JS)
- `trigOffer` (trigger) → walk-in → idle
- `trigHadIt` (trigger) → happy → walk-out
- `trigSnooze` (trigger) → wave → walk-out
- optional `numGlasses` (number) → drive a small visual (e.g., how full the glass
  is / a mood) `# nice-to-have`

### Getting the art
Two paths, decide during Phase 1:
1. **DIY in Rive editor** — cheapest, full control, some learning curve.
2. **Commission** a Rive artist (~$100–300) for a polished, on-brand character.

**Phase 0 uses a throwaway placeholder** (a single Lottie/sprite or a rough Rive
doodle) so all the plumbing is proven before spending on art.

---

## 6. Reminder engine

Deliberately tiny. A timer + a JSON file. No database.

### State (JSON on disk, e.g. `app.getPath('userData')/state.json`)
```json
{
  "date": "2026-07-07",
  "glassesHad": 3,
  "goal": 8,
  "snoozeUntil": null,
  "paused": false
}
```

### Config (JSON, editable by hand in V1)
```json
{
  "intervalMinutes": 60,
  "workHours": { "start": "09:00", "end": "18:00" },
  "snoozeMinutes": 15,
  "autoDismissSeconds": 30
}
```

### Logic
- Single interval check (every minute, cheap): if within work-hours, not paused,
  now ≥ last-shown + interval, and now ≥ snoozeUntil → emit a `water` event.
- "Had it" → `glassesHad++`, save, buddy happy → out.
- "Snooze" / auto-dismiss → set `snoozeUntil = now + snoozeMinutes`, buddy out.
- On launch / first tick of a new calendar day → reset `glassesHad`, `date`.

> ponytail: skipped cron libs, a scheduler abstraction, and a settings UI — a
> `setInterval` + a JSON file cover every V1 requirement. Add a settings panel when
> I actually want to change the interval without editing a file. One self-check on
> the "is it time to remind?" predicate is the only logic worth a test.

---

## 7. Project structure (V1, minimal)

```
reminder-buddy/
├── package.json
├── SPEC.md
├── src/
│   ├── main.ts          # Electron main: timer, state, tray, window mgmt
│   ├── reminder.ts      # pure logic: shouldRemind(), applyAction()  ← the testable bit
│   ├── state.ts         # load/save JSON state + config
│   └── renderer/
│       ├── index.html   # transparent overlay
│       ├── overlay.ts   # Rive load + fire inputs + button handling
│       └── buddy.riv    # the character (placeholder first)
└── test/
    └── reminder.test.ts # asserts shouldRemind()/day-reset edge cases
```

Fewest files that work. Split more only when a file actually gets unwieldy.

---

## 8. Roadmap

- **Phase 0 — Prove the loop (~1–2 days).** Electron transparent overlay + timer +
  JSON progress + placeholder character walks in, buttons work, snooze works,
  counter persists and resets daily. De-risks *all* plumbing. **No art spend yet.**
- **Phase 1 — The amazing avatar.** Build/commission the Rive character + state
  machine, wire `trigOffer/trigHadIt/trigSnooze`, swap out the placeholder.
- **Phase 2 — Polish.** Work-hours window, tray progress readout, entrance easing,
  optional soft sound, auto-dismiss tuning.
- **Later.** Calendar module, Slack-reply module — new `ReminderEvent` producers on
  the same avatar + loop. (Not now.)

### Status (as of ship)
Phases 0–2 effectively done: pixel character (walk-in → offer water → cheer/sulk
reaction → walk-out), snooze/progress persistence, work-hours, chime, packaged as
**Remi.app** with a macOS icon. Rive character deferred to a future version.

### Next features (planned, in build order)
0. **Foundation — daily history.** Change `state.json` from today-only to a
   `history: { "YYYY-MM-DD": { had, goal } }` map. Unlocks streak + calendar cheaply.
   (reminder.js/state.js change; keep `shouldRemind` untouched.)
1. **Streak days.** On hitting the daily goal, if yesterday also hit → `streak++`.
   Show in tray title + a one-off "🔥 N-day streak!" bubble. Small, sits on history.
2. **Calendar view.** A tray "View progress" opens a small window with a month grid
   coloured by goal completion (habit-tracker style), read from `history`. Medium.
3. **Settings (start/end time + frequency).** A small form window (or tray submenu)
   to edit `workHours` + `intervalMinutes` without hand-editing config.json. Medium,
   independent of the others. `# ponytail: tray submenu first; full window only if needed`

---

## 9. Fresh-eyes review — risks, decisions, open questions

**Decisions locked**
- Avatar tech: **Rive 2D** (chosen over 3D avatar-of-me: more consistently
  polished, far lighter for an always-on app, state triggers map perfectly).
- V1 shell: **Electron** (lowest-risk mature overlay), *not* Tauri — because the
  one feature this app lives or dies on (transparent click-through overlay on
  macOS) is currently Tauri's weak spot.
- Character look: **high-clarity pixel art of me** (Stardew-style), generated from
  selfies via GPT/Gemini image models, on flat magenta → keyed transparent.
- **Rendering: pixel sprite sheets, NOT Rive, for V1.** Pixel art is raster/
  frame-based; Rive is vector. Walk = a 4-frame side-view strip stepped with CSS
  `steps(4)`; front idle = a separate sprite; buttons on arrival. Zero animation deps.
- **Rive deferred to V2** (user call). When we scale to many interactive states/
  reminder types, a Rive state machine is the clean way to orchestrate them — but
  that likely means a vector redraw of the character. For V1, sprite sheets ship.
- Overlay simplification: V1 uses a **small bottom-right corner window that's
  hidden between reminders**, not a fullscreen click-through overlay. Sidesteps the
  whole mouse-forwarding/click-through problem. Full walk-across-the-desktop is a
  Phase 2 nice-to-have. `# ponytail: corner window, go fullscreen if it ever needs to`
- Art pipeline (repeatable): generate on magenta bg → `tools/cutout.py` (flood-fill
  key + trim) for single sprites, `tools/segment_sheet.py` + `tools/assemble_walk.py`
  for multi-pose sheets → equal-cell strip aligned to a foot baseline.

**Risks / watch-items**
- ⚠️ **Electron idle footprint** on an all-day app. Mitigate by keeping the overlay
  hidden between reminders; revisit stack (Tauri/native) only if it feels heavy.
- ⚠️ **Transparent + click-through correctness** (buttons must be clickable *only*
  when shown; rest must pass clicks through). This is the trickiest plumbing —
  prove it first thing in Phase 0.
- ⚠️ **Annoyance risk.** A blocking buddy is worse than no buddy. Auto-dismiss +
  snooze + a small, edge-of-screen entrance (not center-screen takeover) matter.
- ⚠️ **Art is the long pole for "amazing."** Placeholder-first keeps it off the
  critical path; budget/decide DIY-vs-commission at Phase 1.

**Open questions (for me, not blocking Phase 0)**
1. Where should the buddy enter from — bottom-right corner (least intrusive) or
   walk across the taskbar area? *Default: bottom-right.*
2. Sound on entrance — yes/no/subtle? *Default: off in V1.*
3. Daily goal — fixed 8, or let me set it? *Default: 8, config file.*
4. DIY the Rive art or commission it? *Decide at Phase 1.*

---

## 10. Sources

- [Electron vs. Tauri — DoltHub](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/) · [Tauri vs Electron footprint](https://tech-insider.org/tauri-vs-electron-2026/)
- [Tauri Window Customization (transparency, macos-private-api)](https://v2.tauri.app/learn/window-customization/) · [setIgnoreCursorEvents bug #11461](https://github.com/tauri-apps/tauri/issues/11461) · [transparent click-through feat #13070](https://github.com/tauri-apps/tauri/issues/13070) · [Sonoma transparent glitch #8255](https://github.com/tauri-apps/tauri/issues/8255)
- [Rive — interactive engine](https://rive.app/) · [Rive State Machine guide](https://rive.app/blog/how-state-machines-work-in-rive) · [Engineering interactive mascots with Rive](https://dev.to/uianimation/engineering-interactive-mascots-with-rives-state-machine-and-runtime-architecture-4e2h) · [Rive-viewer-on-Tauri reference](https://github.com/ivg-design/rive-animation-viewer)
- [Translucent overlay window on macOS (Swift)](https://gaitatzis.medium.com/create-a-translucent-overlay-window-on-macos-in-swift-67d5e000ce90) · [Always-on-top click-through Swift gist](https://gist.github.com/bakkiraju/bed042bb7f659fd99c748c7a32b835d5)
- Prior art: [VPet](https://github.com/LorisYounger/VPet) · [Shimeji-ee](https://github.com/gil/shimeji-ee)
