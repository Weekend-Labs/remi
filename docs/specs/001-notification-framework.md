# F001 — Reminder & Notification Framework

| | |
|---|---|
| **Feature ID** | F001 |
| **Name** | Reminder & Notification Framework |
| **Status** | 🟡 Proposed (design) — not yet implemented |
| **Owner** | Vijay ([@Weekend-Labs](https://github.com/Weekend-Labs)) |
| **Supersedes** | the ad-hoc water-only reminder loop (v0.1) |
| **Related** | [`README.md` roadmap](../../README.md#-roadmap--from-water-buddy-to-notification-framework), [`SPEC.md` §4.3 (the reserved seam)](../../SPEC.md) |

---

## 1. Summary

> **Note:** *Reminders* (Remi-scheduled, e.g. water) and *Notifications* (producer-fired via
> this API) are two distinct concepts that share the buddy. This spec is about **Notifications**;
> see [`docs/CONCEPTS.md`](../CONCEPTS.md) for how they differ.

Turn Remi from a single-purpose **water reminder** into a general **reminder +
notification framework**: a small, local, delightful *face* for any notification —
meetings, a Slack DM that needs a reply, an email worth your attention, an ad-hoc nudge.

The guiding principle: **Remi stays a dumb renderer; all intelligence lives in external
producers.** The app knows how to make a character peek in, speak, and optionally
collect a reply. It does *not* know what Gmail or Slack are. Producers — a cron job, a
shell script, or an AI agent (Claude / Codex) — decide *what* to say and *when*, and
talk to Remi over a small local API.

This is the realisation of the seam already reserved in `SPEC.md §4.3`:

```ts
type ReminderEvent = { kind: 'water' | 'calendar' | 'slack', message, actions[] }
```

## 2. Goals / Non-goals

**Goals**
- A **local HTTP API** any producer can call to fire a notification and receive the reply.
- Two notification primitives: **`info`** (peek-and-go) and **`action`** (buttons / quick-reply that returns the user's choice).
- Refactor the existing water reminder to ride the framework (dogfood the seam).
- Presence-aware delivery: buddy at the desk, a fallback channel (WhatsApp / push) when away.
- Language-agnostic: cron, bash, Claude, Codex, or a webhook all speak the same call.

**Non-goals (explicitly out of scope for this feature)**
- No Gmail/Slack/Calendar SDKs *inside Remi* — those live in producers.
- No cloud service, no account, no multi-device sync. Loopback-only, single Mac.
- No decision logic ("is this worth interrupting me?") in the app — that's the model's job.
- Not a general message bus — just enough API to render notifications and return replies.

## 3. Concepts

- **Producer** — anything that emits notifications: a cron job (deterministic, time-based)
  or an AI agent (content-based, noise-filtering). Interchangeable behind the API.
- **Notification** — one thing Remi shows. Has a **type**:
  - **`info`** — buddy leans in, delivers, strolls off. Fire-and-forget. *"Standup in 5."*
  - **`action`** — message + buttons (or a quick-reply field). **Returns the user's choice**
    to the producer so it can act (send the Slack reply, archive the mail, open the meeting).
  - **`ambient`** *(stretch)* — tray-only, no walk-in, for low-priority counts/status.
- **Reply** — the user's response to an `action` notification (a chosen result, optional text),
  or a terminal state (`dismissed`, `expired`).

## 4. Architecture

```
  PRODUCERS (the brains)                REMI (the face)                YOU
 ┌────────────────────────┐        ┌────────────────────────────┐
 │ cron  → meetings, water│        │ HTTP API (127.0.0.1:7777)  │   buddy peeks in
 │ agent → Slack/Gmail    │  POST  │  ────────────────────────► │   ───────────────►
 │  (Claude / Codex)      │/notify │  queue → walk-in → render  │   info: just delivers
 │ webhook → anything     │◄───────│  → collect reply → resolve │   action: buttons/reply
 └────────────────────────┘ reply  └────────────────────────────┘   ◄─────────── you answer
                                            │ fallback (away/locked)
                                            └──► WhatsApp / system push
```

Remi's Electron **main** process hosts the API + queue + presence; the **renderer**
(existing transparent overlay) renders whatever event it's handed. The current
`reminder:action` IPC path becomes the internal transport between the API layer and the overlay.

## 5. Local API contract (draft)

**Transport:** loopback HTTP on `127.0.0.1:<port>` (default `7777`, configurable).
**Auth:** `Authorization: Bearer <token>`; token generated on first run, stored in
`config.json`, printed once for the user to copy into producers. **Never binds to a
non-loopback interface.**

### `POST /notify` — fire a notification

```jsonc
{
  "type": "action",                 // "info" | "action" | "ambient"
  "kind": "slack",                  // free-form producer tag (drives icon/voice line): "meeting" | "slack" | "email" | ...
  "message": "Reply to Sam's DM?",  // speech-bubble text
  "detail": "\"can you review the PR today?\"",   // optional sub-line
  "actions": [                       // required for type=action, ignored otherwise
    { "label": "Draft reply", "result": "draft" },
    { "label": "Snooze 1h",   "result": "snooze" },
    { "label": "Dismiss",     "result": "dismiss" }
  ],
  "quickReply": false,               // if true, show a text field; reply carries {text}
  "ttl": 120,                        // seconds before auto-expire (default 30 for info)
  "priority": "normal",              // "low" | "normal" | "high" — affects walk-in vs peek vs queue jump
  "callbackUrl": null                // optional: Remi POSTs the reply here instead of the producer polling
}
```

Response: `201 { "id": "n_123", "status": "queued" }`

### `GET /notify/:id` — poll status / reply

```jsonc
{ "id": "n_123", "status": "answered", "reply": { "result": "draft", "text": null, "at": 1783450000 } }
```

`status` lifecycle: `queued → shown → answered | dismissed | expired`.

### Other endpoints
- `DELETE /notify/:id` — cancel a queued/shown notification (e.g. the meeting got cancelled).
- `GET /health` — `{ ok, version, present: true|false }` (also exposes current presence).
- `GET /notify` — list recent notifications (debug / history).

### Reply delivery — producer's choice
- **Poll** `GET /notify/:id` until terminal (simplest; good for scripts/agents).
- **Callback** — set `callbackUrl`; Remi `POST`s the reply object there once resolved.
- **Long-poll** *(stretch)* — `GET /notify/:id?wait=1` holds until resolved or timeout.

## 6. Presence-aware delivery

Remi already knows work-hours; add a lightweight **presence** signal (screen locked /
idle time / display sleeping). Routing:
- **Present** → buddy renders the notification.
- **Away / locked** → fall back to **WhatsApp** (via a bridge, e.g. a WhatsApp Cloud API
  number or a local relay) and/or a system push, so nothing is missed.
- `high` priority may do both. Presence is exposed on `GET /health` so producers can adapt.

## 7. Dogfooding: refactor water onto the framework

The v0.1 water loop becomes an **internal producer**: the timer emits an `action`
notification (`kind:"water"`, actions `Had it` / `Snooze`) through the same API/queue.
This proves the seam and deletes the special-case path — history/streak/calendar keep
working because they read the same state the water producer writes.

## 8. Security model

- **Loopback + token only.** The API can pop UI and read replies → treat the token like a
  secret. Reject any request without a valid `Bearer` token; never bind `0.0.0.0`.
- Token lives in `config.json` (already under `app.getPath('userData')`, not the repo).
- Rate-limit `POST /notify` to avoid a runaway producer spamming walk-ins.
- Producers that touch Slack/Gmail hold *their own* credentials — Remi never sees them.

## 9. Phasing

| Phase | Deliverable | Powered by |
|-------|-------------|------------|
| **3** | The API + `info`/`action` types + reply channel; water refactored to ride it | core app |
| **4** | A `remi-notify` skill/CLI wrapper + a cron example (meetings from Calendar) | cron / any script |
| **5** | Agent reads Slack & email, filters the noise, only interrupts for what matters | Claude / Codex |
| **6** | Presence-aware delivery + WhatsApp / push fallback | presence + bridge |

## 10. Open questions

- **Port/discovery:** fixed default `7777` vs a port written to `~/.remi/port` for producers to read?
- **Queue policy:** when multiple notifications land while the buddy is out — FIFO, priority jump, or collapse duplicates by `kind`?
- **Quick-reply UX:** inline text field in the overlay, or hand off to a small window?
- **WhatsApp bridge:** official Cloud API (number + token) vs a self-hosted relay — cost/setup tradeoff.
- **Multiple producers, one token** vs per-producer tokens (revocable) — worth the complexity?

## 11. Acceptance criteria (high level)

- [ ] `POST /notify` renders an `info` notification (buddy peeks, delivers, leaves); no reply needed.
- [ ] `POST /notify` with `type:action` renders buttons and `GET /notify/:id` returns the chosen `result`.
- [ ] Requests without a valid token are rejected; server binds only to `127.0.0.1`.
- [ ] Water reminder works entirely through the framework (no special-case path).
- [ ] `ttl` expiry and `DELETE /notify/:id` both resolve a notification to a terminal state.
- [ ] `GET /health` reports presence; delivery falls back when the screen is locked.
- [ ] Existing test suite stays green; new tests cover the API contract + queue lifecycle.

---

> Status is **Proposed** — this is a design contract to build against, not shipped behaviour.
> A new reminder type should never require touching this framework: it's *just another producer*.
