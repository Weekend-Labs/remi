# F002 — Buddy V2: Expressive Rive Avatar

| | |
|---|---|
| **Feature ID** | F002 |
| **Name** | Buddy V2 — Expressive Rive Avatar |
| **Status** | 🟡 Proposed (design) — not yet implemented |
| **Owner** | Vijay ([@Weekend-Labs](https://github.com/Weekend-Labs)) |
| **Cashes in** | [`SPEC.md` §5 (Rive avatar, deferred in v0.1)](../../SPEC.md) |
| **Related** | [F001 — Notification Framework](001-notification-framework.md) (expressions are driven by notification kinds) |

---

## 1. Summary

Replace the v0.1 **pixel sprites** (`walk.png` 4-frame CSS `steps()` + static `buddy-hold.png`,
with only `cheer`/`sad` CSS jiggles) with a **Rive character driven by a state machine** —
so the buddy has a real range of **expressions** and **smooth, blended transitions**
instead of hard frame-cuts.

This is not a pivot: `SPEC.md §5` already specced a Rive avatar with states
(`walk-in, idle, happy, wave, walk-out`) and inputs (`trigOffer, trigHadIt, trigSnooze`);
v0.1 shipped sprites as the deliberate placeholder ("Rive character deferred to a future
version"). F002 delivers it.

## 2. Goals / Non-goals

**Goals**
- A single `buddy.riv` with a **state machine**: blended transitions, an idle breathing loop,
  and a set of expressions richer than v0.1's two.
- Expressions **mapped to app events and F001 notification kinds** (water, streak, slack, meeting…).
- Integrate `@rive-app/canvas` into the existing transparent overlay **behind a flag**, with the
  sprite path staying the default until V2 proves out.
- Keep the app dumb: it fires **named inputs**; the `.riv` owns all animation logic.

**Non-goals**
- Not removing the sprite renderer yet — V2 ships alongside it behind `RB_RIVE`.
- No 3D, no per-notification bespoke animations — expressions are a fixed, reusable set.
- No dependency on cloud Rive at runtime — the exported `.riv` is a local, static asset.

## 3. Rig design — **hybrid** (mesh body + swappable face)

| Approach | Smooth motion | Facial range | Effort | Keeps AI art |
|---|---|---|---|---|
| Pure vector (redraw in Rive) | ✅✅ | ✅✅ | high | ✗ |
| Image mesh (rig existing PNG) | ✅ | ⚠️ limited | low–med | ✅ |
| **Hybrid** ⭐ | ✅ | ✅ | medium | ✅ body |

**Decision: hybrid.** Rig the **body** as an image mesh over the existing AI-rendered
character (bones → smooth walk / lean / bob / hop, puppet-style). Make the **face** a set of
**swappable / cross-faded layers** (eyes + mouth) so expressions change without redrawing the
whole character. Biggest expressiveness for the least art spend; keeps the character on-brand.

## 4. State machine — the **input contract** (app ↔ `.riv`)

These names/types are a **breaking contract**: the app fires them, the `.riv` consumes them.
Document changes here like an API.

**Inputs**
| Input | Type | Fired when |
|---|---|---|
| `trigOffer` | trigger | a reminder/notification arrives → walk-in + talk |
| `trigHadIt` | trigger | user accepts (water "Had it", action confirmed) → cheer |
| `trigSnooze` | trigger | user snoozes → sleepy-wave + walk-out |
| `trigCelebrate` | trigger | streak milestone hit → party |
| `trigDismiss` | trigger | ignored / auto-dismissed → sulk + walk-out |
| `mood` | number 0–100 | blends face sulk↔neutral↔happy (smoothness lever) |
| `notifKind` | number/enum | 0=water 1=streak 2=slack 3=meeting 4=email … tints tone/icon |
| `isPeek` | boolean | F001 `info` notifications → half-body lean from edge, no full walk-in |

**States:** `offscreen → walk-in → idle(breathing) → talk → {cheer | sulk | wave | party} → walk-out`,
plus `peek` (half-body lean for `isPeek`). Transitions use blend states + an additive breathing layer.

## 5. Expression set (driven by events + `mood`)

| Expression | Fires on | Face | Body |
|---|---|---|---|
| idle | waiting | blink loop | breathing (additive) |
| warm-offer | water / gentle reminder | smile, brows up | holds glass, lean-in |
| cheer | "Had it" / goal hit | grin, eyes closed | hop + fist pump |
| party | streak milestone 🔥 | starry eyes | jump + confetti |
| sulk | ignored / auto-dismissed | droop | shoulders down, turn away |
| sleepy-wave | snooze | yawn | wave, backpedal off |
| psst / point | F001 slack / meeting `info` | alert brows | peek from edge, points |
| concerned | `high` priority | wide eyes | urgent lean, both hands |

Smoothness comes from a **1D blend state on `mood`** (glide between faces) with discrete
triggers layering motion on top.

## 6. Art sourcing — climb only as far as needed

1. **Rig existing art** (image-mesh the current character) — proves the pipeline with the real buddy.
2. **AI-generate face variants** — reuse the `DESIGN-YOUR-OWN-BUDDY` magenta workflow to make
   neutral/happy/sad/sleepy **face layers**; cut out, drop in as swappable parts. ← where "more expressions" comes from, cheaply.
3. **Redraw as vector** — only if mesh feels stiff; most expressive + smallest file.
4. **Commission a Rive artist** (~$100–300, SPEC §5) — the "amazing avatar" endgame.

Ship **1 → 2** for V2; hold 3/4 as polish.

## 7. Authoring workflow — two paths

**`.riv` is a binary format** — no LLM hand-authors it. Two ways to build it:

**A. Rive editor (human):** design artboard → import art (mesh) / draw vector → rig bones →
author clips → build state machine + inputs → export `buddy.riv`.

**B. Rive MCP — for editing an *already-open* file (NOT headless authoring):** a local Rive MCP
server (`rive` v0.6, `http://127.0.0.1:9791/mcp`) exposes a **full editor-automation API**
(`path_editor`, `animation_editor`, `viewmodel_editor` for `mood`/`notifKind` data-binding, full
scene-graph ops, scripting + `run_tests`, `read_console`). It can drive the rig programmatically —
**but only against a file a human has already opened in Rive.app.**

> **⚠️ Verified by the [spike](002-buddy-v2-rive-spike.md) (2026-07-08):** the MCP has **no
> create-file / open-file verb**. `open_file_editor` and every other tool return
> `No file context available` until a document is open, and there is **no autonomous way to open
> one** — `osascript` keystrokes are blocked (accessibility), Rive.app has no CLI, and no URL
> scheme works. So authoring is **human-opens-`.riv`-in-Rive.app → then the MCP drives it**, not a
> headless/autonomous path. (This corrects the earlier "automated, confirmed available" claim.)

Either way: keep the **input contract (§4)** documented so the app and the `.riv` never drift.

## 8. Integration (app side)

- Add `@rive-app/canvas` to the overlay renderer, gated by an env flag **`RB_RIVE=1`**
  (sprite path stays default). Load `buddy.riv`, grab the state-machine inputs, fire them from
  the existing event path (`reminder:action` today → F001 notifications later).
- Map the water flow first: `trigOffer` on show, `trigHadIt`/`trigSnooze` on the buttons.
- Verify transparent rendering + click-through still hold with a canvas in the overlay.

**Runtime facts (verified by the [spike](002-buddy-v2-rive-spike.md), `@rive-app/canvas@2.38.4`):**
`@rive-app/canvas` renders via **Canvas 2D** — transparency is automatic and `getImageData` works
for pixel verification. The runtime exposes `stateMachineInputs()` → `StateMachineInput{name,type,fire()/value}`
(types `Trigger`/`Boolean`/`Number`) and **`ViewModel*`**, so the §4 `mood`/`notifKind` **data-binding
is supported** by this version.

## 9. De-risk spike — ✅ **done (2026-07-08)** → full log: [002-buddy-v2-rive-spike.md](002-buddy-v2-rive-spike.md)

**Verdict: GO on the integration.** Measured on a live runtime:
- ✅ **Transparent render** in the click-through overlay (Canvas 2D, no opaque bg).
- ✅ **Clean flag-gated swap path** — `RB_RIVE=1` lazy-loads the Rive stage; when off, the sprite
  path is untouched (script never fetched).
- ✅ **Idle footprint acceptable** — **+2.2 MB** bundle (js + wasm); a **~60 fps rAF loop only while
  the overlay is visible** (a few seconds per reminder), throttled to ~0 when hidden. Bundle size is
  the one thing to watch.
- ⚠️ **JS→input proven at the API level, not end-to-end** — the stand-in sample `.riv` exposed zero
  named inputs, so firing `trigOffer` end-to-end is **pending a real `buddy.riv`** with the §4 inputs.

**Not built here (deliberate):** the spike's plumbing was discarded (a 5-session race left it
inconsistent); it will be **rebuilt cleanly alongside the real `buddy.riv`**. The blocker for that is
just the `.riv` itself (see §7-B — a human opens it in Rive.app, then the MCP rigs it).

## 10. Open questions

- Image-mesh body + **how many** swappable face layers before it's simpler to go vector?
- `mood` as one 1D blend vs separate eye/mouth blends?
- Bundle size / idle GPU cost of Rive canvas in an always-on overlay — measure in the spike.
- Author the rig **fully via MCP**, or MCP for scaffolding + human polish in the editor?
- Where does `buddy.riv` live + how do we version a binary asset (source in Rive cloud, export to repo)?

## 11. Acceptance criteria (high level)

- [ ] `buddy.riv` loads in the overlay under `RB_RIVE=1`; sprite path unaffected when off.
- [ ] Firing `trigOffer` walks the buddy in; `trigHadIt`/`trigSnooze` play cheer/wave then exit.
- [ ] `mood` visibly blends the face (no hard cut) across sulk↔neutral↔happy.
- [ ] `isPeek` produces a half-body peek (no full walk-in) for `info` notifications.
- [ ] Overlay stays transparent + click-through with the Rive canvas present.
- [ ] Idle footprint measured and acceptable for an always-on app.
- [ ] Existing tests stay green; new tests cover the input-firing glue.

---

> Status is **Proposed** — a design contract to build against. The spike (§9) is the first
> concrete step and the first real use of the Rive MCP.
