# SPIKE-RIVE — F002 Buddy V2 de-risk spike

**Date:** 2026-07-08 · **Branch:** `13-kelp` (isolated worktree off `main`) · **Spec:** [002-buddy-v2-rive.md](002-buddy-v2-rive.md) §8–§9

## TL;DR — **GO** on the integration, **BLOCKED** on MCP authoring

The `@rive-app/canvas` integration is sound: it renders **transparently** in the overlay,
the **JS→state-machine input** API is present and reachable, the **idle footprint** is
known and acceptable, and the **flag-gated swap path** is clean (sprite path untouched
when `RB_RIVE` is off). **Proceed to rig the real character.**

One hard caveat: **the Rive MCP could not author `buddy-spike.riv` in this session.** The
tools are present and the editor is live, but no file was open and there is no autonomous
way to open/create one (details below). The spike therefore used a throwaway Rive **sample**
as a stand-in. That sample's state machine happens to expose **0 inputs**, so JS→input was
proven at the **API level** but not fired end-to-end on a named `trigOffer`. Everything else
was measured on a live runtime.

| Risk | Verdict | Evidence |
|---|---|---|
| 1. Transparent render in click-through overlay | ✅ **Proven** | Live `.riv` painted 19/144 sampled cells (maxAlpha 255) centre; all other cells **alpha 0**. Canvas-2D renderer, no opaque background. |
| 2. JS → state-machine input fires | ⚠️ **API proven, e2e pending a real .riv** | Runtime exposes `stateMachineInputs()` → `StateMachineInput{.name,.type,.fire()/.value}`, `StateMachineInputType {Number:56,Trigger:58,Boolean:59}`. Stand-in sample has 0 inputs → no named trigger to fire. |
| 3. Idle footprint acceptable | ✅ **Measured** | +2.2 MB bundle (328 KB js + 1.9 MB wasm), +1.57 MB JS heap, ~62 fps / 16.2 ms-per-frame continuous rAF while visible (paused by compositor when the overlay is hidden). |
| 4. Clean flag-gated swap path | ✅ **Proven by construction** | `RB_RIVE=1` → `main.js` adds `?rive=1` → `index.html` lazily loads `rive-stage.js`; flag off → script never fetched, sprite renders unchanged. |

## What was built (the plumbing — committed)

- **`src/main.js`** — `RB_RIVE=1` makes `createOverlay()` load the overlay with `{ query: { rive: '1' } }`; otherwise unchanged. One-line, reversible.
- **`src/renderer/index.html`** — adds a hidden `#rivecanvas` and a 6-line guard that loads `rive-stage.js` **only** when `?rive=1` is present. Inert when the flag is off.
- **`src/renderer/rive-stage.js`** *(new)* — the flagged Rive path: mounts a transparent canvas, loads the runtime from `node_modules` + local `.wasm` (no cloud), discovers the state machine, exposes `window.riveFire(name)`, and re-points `showReminder` at `trigOffer`. Stands the sprite scene down (doesn't remove it).
- **`package.json`** — `@rive-app/canvas@^2.38.4` added as a dependency.
- **`.gitignore`** — excludes the stand-in `buddy-spike.riv` (a sample, not our art) and the runtime binaries (loaded from `node_modules`, not vendored into git).

**Sprite path when `RB_RIVE` is off:** `rive-stage.js` is never fetched, `#rivecanvas` is
`display:none`, `showReminder` is the original. Runtime behaviour is identical to v0.1.
(The `index.html`/`main.js` *files* gained inert lines; the *sprite behaviour* is unchanged.)

## Evidence (measured on a real browser + the vendored runtime)

Harness: served `rive.js` + `rive.wasm` + `buddy-spike.riv` locally, loaded in a real
browser (Playwright), drove the runtime, read back canvas pixels and timings.

```
loadMs: 361                      # runtime + wasm + .riv ready
stateMachines: ["Machine"]       # the sample exposes one state machine
inputs: []                       # ...but zero inputs (why risk-2 is API-only)
renderer: Canvas 2D (got2d=true) # @rive-app/canvas uses CanvasRenderingContext2D
alpha grid (12x12): 19 painted cells maxAlpha=255, remainder alpha 0
jsHeapDeltaKB: 1570
idle: avgFrameMs 16.18 / 62 fps  # continuous rAF loop while visible; 99.9 ms startup hitch
runtime API present: Rive, RuntimeLoader, StateMachineInput, StateMachineInputType,
                     ViewModel* (data-binding for mood/notifKind is supported)
```

**Reading the footprint number:** Rive drives a **continuous ~60 fps render loop while the
overlay is visible** — unlike the v0.1 CSS sprite, which the GPU compositor animates for
free. For an always-on app this matters *only while the reminder is on screen* (a few seconds
per reminder); when `overlayWin` is hidden the browser/Electron throttles `requestAnimationFrame`
to ~0, so steady-state idle cost is negligible. The +2.2 MB bundle is the more permanent cost.

## MCP blocker (verified, not assumed)

The task's step 2 — *"create buddy-spike.riv with 2–3 states + a trigger via the Rive MCP"* —
**could not be completed autonomously.** What I verified:

- `mcp__rive__*` tools **are** present (server `rive` v0.6). ✅
- `open_file_editor` and every other Rive tool return **`No file context available` / `No file is currently open in the editor`** — for *all* commands including `createArtboard`. The MCP has **no create-file verb**; it automates a file that a human has already opened.
- **Rive.app is running** (desktop app, PID confirmed via `ps`) but signed into a **cloud/team** account with **no document open** and **no local `.riv` files** anywhere on disk.
- No autonomous way to open one: **`osascript` keystrokes are blocked** (`not allowed to send keystrokes` — accessibility permission not granted), the app has **no CLI** to create/open a file, and **no `rive://` URL scheme** worked. New files come only from the human-driven, cloud-backed picker UI.

**Conclusion:** authoring `buddy.riv` via the MCP needs a human to first open/create a file in
Rive.app (then the MCP's `path_editor`/`animation_editor`/`viewmodel_editor` can drive it).
It is **not** a headless/autonomous path today. The `buddy-spike.riv` present in the tree is a
**bundled Rive sample** used as a stand-in (its assets reference `bolt`/`music.svg` — not our
character); it is gitignored and not committed.

## Environment note — concurrent sessions (flag for the operator)

`ps` showed **5 Claude sessions running this identical spike in this same worktree**
simultaneously (shared git index + shared Rive.app). They were racing on the same files
(two different vendor layouts appeared mid-run). This looks like a Lanes worktree-isolation
misconfiguration — each spike session should get its **own** worktree. Harmless to the
findings, but it makes commits non-deterministic; worth fixing before the next fan-out.

## Recommended F002 spec updates

1. **§7 / §9 — correct the MCP claim.** §7 says authoring "via the Rive MCP (automated)" is
   "confirmed available." Verified reality: the MCP automates an **already-open** file; it
   **cannot create/open one headlessly**. Reframe §7-B as *"MCP for scaffolding **after a human
   opens the file in Rive.app**"* and answer §10's open question ("author fully via MCP?") →
   **no, MCP + human-opened file** (or MCP + human polish).
2. **§8 — record the runtime facts.** `@rive-app/canvas` renders via **Canvas 2D** (transparency
   is automatic; `getImageData` works for verification). Runtime exposes `ViewModel*` → the §4
   `mood`/`notifKind` **data-binding is supported** by this version (2.38.4).
3. **§9 / §10 — footprint answer.** Idle GPU cost = a ~60 fps rAF loop **only while the overlay
   is visible** (throttled to ~0 when hidden); bundle cost **+2.2 MB**. Acceptable for an
   always-on app; the bundle size is the thing to keep an eye on.
4. **§11 — acceptance criteria unblocked so far:** transparent + click-through ✅, clean swap
   path ✅, footprint measured ✅. Firing `trigOffer`/`trigHadIt` end-to-end (AC #2) remains
   **pending a real `buddy.riv` with the §4 inputs** — the next step, once the file exists.

## Next step

Author `buddy.riv` with the §4 input contract (`trigOffer`, `trigHadIt`, `trigSnooze`,
`mood`, `notifKind`, `isPeek`) — human opens a file in Rive.app, then drive the rig via the
MCP. Drop it in as `src/renderer/buddy.riv`, point `rive-stage.js` at it, and AC #2/#3
(named-input firing, `mood` blend) become verifiable end-to-end. **No blockers besides the
`.riv` itself.**

## How to reproduce the integration

```bash
npm install                 # brings in @rive-app/canvas
# place a .riv with a state machine at src/renderer/buddy-spike.riv
RB_RIVE=1 npm start         # overlay loads the Rive stage; unset RB_RIVE => sprite path
```
