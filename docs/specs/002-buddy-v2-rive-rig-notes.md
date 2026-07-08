# RIG-NOTES — F002 first real `buddy.riv` + clean RB_RIVE plumbing

**Date:** 2026-07-08 · **Branch:** `15-lush` · **Issue:** #15 · **Spec:** [002-buddy-v2-rive.md](002-buddy-v2-rive.md) §4/§8

## TL;DR

- **(A) Rig — built in the open Rive.app file** via the Rive MCP: a placeholder character
  (basic shapes), 4 keyframed animations, the **exact §4 input contract** as a ViewModel, and a
  state machine `Buddy` with states `idle / walk-in / cheer / wave` + entry and exit-time returns.
- **(B) Plumbing — rebuilt clean and VERIFIED** (browser, Playwright): `RB_RIVE=1` flag in
  `main.js`, a hidden canvas + `?rive=1` guard in `index.html`, and a new
  `src/renderer/overlay-rive.js` (`@rive-app/canvas@2.38.4`). Sprite path is **byte-for-byte
  untouched when the flag is off**, and a missing `.riv` **fails safe** to the sprite.
- **Two verified MCP blockers** stop full autonomous completion — both the *output-side* analogue
  of the spike's open-file blocker:
  1. **No runtime export** — the MCP has no export/save verb and Rive.app keeps the doc as
     cloud-backed editor change-logs (not a `.riv`), so `src/renderer/buddy.riv` **cannot be
     produced autonomously**.
  2. **`createConditions` is unverifiable** — it returns `success` but the trigger conditions
     never appear in `queryStateMachine` (the only SM read-back), and there's no runtime to
     confirm them against.
- **Net:** everything that can be done headlessly is done and proven. The e2e trigger-firing proof
  (AC #2) is **pending one human step: File → Export `buddy.riv` from Rive.app** (then drop it at
  `src/renderer/buddy.riv` and, if needed, confirm the 3 transition conditions in the editor).

## Gate

`npm test` → **34/34 green** (baseline preserved; the plumbing is inert unless `RB_RIVE=1`).

---

## (A) What was rigged (lives in the open Rive.app `buddy` file)

Artboard `0-2`, 380×420 (matches the overlay window).

**Placeholder character** — basic shapes (no polished art, per scope):
| Shape | id | notes |
|---|---|---|
| Body | `0-30` | rounded blue body `#2FB3FF` |
| Head | `0-38` | yellow `#FFC94D`, dark stroke |
| EyeL / EyeR | `0-48` / `0-56` | dark dots |
| Mouth | `0-64` | stroked smile |

**Animations** (keyframed, cubic/linear):
| Anim | id | motion |
|---|---|---|
| idle | `0-70` | breathing bob (60f loop) |
| walk-in | `0-71` | slide in from off-screen right (45f) |
| cheer | `0-72` | hop up + down (45f) |
| wave | `0-73` | head-tilt + gentle sway (45f) |

**Input contract — §4 EXACT** (ViewModel `BuddyVM` `0-16`, instance `BuddyDefault` `0-190`,
bound to the artboard). This editor drives transition conditions from ViewModel properties
(`createConditions` requires a `viewModelPropertyId`), and `@rive-app/canvas@2.38.4` exposes the
ViewModel runtime API (§8) — so the contract is **data-binding**, not legacy `stateMachineInputs()`:

| Input | Type | VM prop id | Fires |
|---|---|---|---|
| `trigOffer` | trigger | `0-18` | reminder shown → walk-in |
| `trigHadIt` | trigger | `0-20` | "Had it" → cheer |
| `trigSnooze` | trigger | `0-22` | "Snooze" → wave |
| `mood` | number | `0-24` | face blend (reserved) |
| `notifKind` | number | `0-26` | tone/icon (reserved) |
| `isPeek` | boolean | `0-28` | half-body peek (reserved) |

**State machine `Buddy`** (`0-197`, layer `Main` `0-202`):
- `{Entry}` → `idle` (`0-206`)
- `idle` → `walk-in` (`0-207`) on **trigOffer** · → `cheer` (`0-208`) on **trigHadIt** ·
  → `wave` (`0-209`) on **trigSnooze**
- `walk-in`/`cheer`/`wave` → `idle` with **exit-time 100%** (waits for the clip; flags=12 =
  EnableExitTime|ExitTimeIsPercentage — verified via `set_property_values`).

> A stray empty auto-created `Layer 1` (`0-198`) remains — harmless (no states); left in place
> rather than risk deleting a load-bearing default.

---

## (B) Clean RB_RIVE plumbing (app-side, this branch)

| File | Change |
|---|---|
| `package.json` | `@rive-app/canvas@^2.38.4` added to `dependencies`. |
| `src/main.js` | `RB_RIVE` set → `createOverlay()` loads `index.html` with `{ query: { rive: '1' } }`. One line, reversible. |
| `src/renderer/index.html` | Hidden `#rivecanvas` (behind `#scene`, `pointer-events:none`) + a guard that loads `overlay-rive.js` **only** when `?rive=1`. |
| `src/renderer/overlay-rive.js` *(new)* | Loads the runtime from `node_modules` + **local wasm** (no cloud), loads `buddy.riv`, binds the `BuddyVM` instance, and fires the §4 inputs: **trigOffer on show** (via `window.buddy.onShow`, appended alongside the sprite handler), **trigHadIt/trigSnooze on the buttons**. Stands the sprite *character* down (`body.rive-active` hides `#walker`/`#avatar`) while keeping the bubble/buttons. Exposes `window.riveFire/riveSetNumber/riveSetBool` for the proof. |

**Runtime firing API** (confirmed against `@rive-app/canvas@2.38.4`):
```js
const vm = r.defaultViewModel();
const inst = vm.instanceByName('BuddyDefault') ?? vm.defaultInstance();
r.bindViewModelInstance(inst);
inst.trigger('trigOffer').trigger();   // triggers
inst.number('mood').value = 50;         // numbers
inst.boolean('isPeek').value = true;    // booleans
```

## Verification (Playwright, served over http so `../../node_modules` resolves)

| Check | Flag OFF | Flag ON (`?rive=1`) |
|---|---|---|
| `overlay-rive.js` fetched | **no** ✅ | yes ✅ |
| `rive.js` / `rive.wasm` fetched | **no** ✅ | yes (local wasm, no CDN) ✅ |
| `buddy.riv` fetched | no | yes → **404** (art not exported yet) |
| `#rivecanvas` display | `none` ✅ | `none` (stayed on sprite — fail-safe) ✅ |
| sprite `#avatar` present | yes ✅ | yes (retained on load error) ✅ |
| `window.riveFire` | `undefined` ✅ | `function` (fire API wired) ✅ |

Console on the ON path: `[RB_RIVE] buddy.riv failed to load — staying on sprite path`. This proves
the **flag-gated swap path** (§11 AC #1, spike risk-4) *and* that a missing `.riv` degrades to the
sprite — the runtime boots, exposes the fire API, and never breaks the reminder.

**Not proven (blocked):** firing `trigOffer`/`trigHadIt`/`trigSnooze` actually drives the state
machine (§11 AC #2) — this needs the real `buddy.riv`, which can't be exported autonomously.

---

## The two blockers (verified, not assumed)

### 1. No autonomous `.riv` export
- The `rive` MCP (v0.6) exposes editor-automation only — **no export/save/download verb** across
  the full tool set (`open_file_editor`, `animation_editor`, `viewmodel_editor`, …).
- Rive.app stores the open doc under `~/Library/Containers/app.rive.editor/.../app.rive.editor/<id>/changes`
  — a proprietary **editor** change-log, not a runtime `.riv`. No `.riv` exists anywhere on disk.
- Same class as the spike's open-file blocker (§7-B / MCP-blocker), on the **output** side: the MCP
  rigs an already-open file but cannot emit the runtime binary.

### 2. `createConditions` not reflected
- `animation_editor.createConditions` returns `{success, "Conditions created"}` for trigger, number,
  and boolean comparators — but `queryStateMachine` shows `conditions: []` on every transition, and
  `query_objects`/`find_objects` don't traverse SM internals. With no runtime export, the conditions
  **can't be confirmed**. Treated as best-effort/unverified.
- (During probing, a boolean `isPeek` and a numeric `mood>50` comparator were also submitted to
  transitions `0-211`/`0-213`. If conditions *do* persist invisibly, those are spurious and should be
  cleared when finalizing in-editor — see below.)

## To finish (one human, ~5 min in Rive.app)

1. **Confirm the 3 transition conditions** in the editor's state-machine panel — each `idle →`
   transition should fire on its single trigger only: `walk-in`←`trigOffer`, `cheer`←`trigHadIt`,
   `wave`←`trigSnooze`. Remove any stray `isPeek`/`mood` conditions if present.
2. **File → Export** the runtime `buddy.riv`; drop it at **`src/renderer/buddy.riv`** (commit it —
   it's our art; `node_modules` stays gitignored, runtime loaded from there).
3. Run `RB_RIVE=1 npm start` (or `RB_RIVE=1 npm run demo`). The buddy should walk in on a reminder;
   "Had it"/"Snooze" play cheer/wave. Or prove headlessly: serve the tree and
   `window.riveFire('trigOffer')` → `r.stateMachineInputs`/`onStateChange` reports `walk-in`.

## Acceptance criteria (§11) status

- [x] `buddy.riv` loads under `RB_RIVE=1`; sprite path unaffected when off — **swap path proven**;
      `.riv` load pending export.
- [~] Firing `trigOffer` walks the buddy in; `trigHadIt`/`trigSnooze` → cheer/wave — **rig + app
      wiring built; e2e pending `buddy.riv` export**.
- [ ] `mood` face blend — input exposed; blend states are polish (not in placeholder scope).
- [ ] `isPeek` half-body peek — input exposed; peek state is polish.
- [x] Overlay stays transparent + click-through with the canvas (`pointer-events:none`, hidden until boot).
- [x] Existing tests green (34/34).
- [~] New tests for input-firing glue — plumbing verified in-browser; unit test deferred (needs the `.riv`).
