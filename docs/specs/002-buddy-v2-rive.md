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

**B. Via the Rive MCP (automated) — confirmed available:** a local Rive MCP server
(`rive` v0.6, `http://127.0.0.1:9791/mcp`) exposes a **full editor-automation API** that lets an
agent build the rig programmatically:
- `open_file_editor` (create/open), `path_editor` (vector), `assets_tool` (import art/meshes),
  `animation_editor`, `component_editor`, `layout_editor`, `property_group_editor`
- `viewmodel_editor` — **data-bind `mood` / `notifKind`** for the app to drive
- scene graph: `list_artboards`, `get_artboard_hierarchy`, `find_objects`, `select/duplicate/reparent/…_objects`, `set_property_values`
- scripting + tests: `manage_scripts`, `text_editor`, `script_diagnostics`, `run_tests`, `get_scripting_reference`
- debug: `grep`, `read_console`

> **Note (verified):** the MCP responds and the editor is live, but a file must be opened first
> (`open_file_editor`) — calls otherwise return `No file context available`. The MCP tools load
> into Claude Code on **session start**, so drive them from a fresh session.

Either way: keep the **input contract (§4)** documented so the app and the `.riv` never drift.

## 8. Integration (app side)

- Add `@rive-app/canvas` to the overlay renderer, gated by an env flag **`RB_RIVE=1`**
  (sprite path stays default). Load `buddy.riv`, grab the state-machine inputs, fire them from
  the existing event path (`reminder:action` today → F001 notifications later).
- Map the water flow first: `trigOffer` on show, `trigHadIt`/`trigSnooze` on the buttons.
- Verify transparent rendering + click-through still hold with a canvas in the overlay.

## 9. De-risk spike (do this before any art spend)

Per SPEC's "placeholder first" rule — a throwaway `.riv` proving the risky bits:
1. Wire `@rive-app/canvas` behind `RB_RIVE` in the overlay; sprite path untouched.
2. Load a rough `.riv` (primitive shapes) with 2–3 states + one trigger — **built via the Rive MCP**
   as the first real MCP exercise.
3. Prove: **transparent render** in the click-through overlay, **JS→input** fires, **idle footprint**
   stays sane (always-on app), and a **clean swap path** parallel to sprites.
4. Only after green → rig the real hybrid character + face variants.

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
