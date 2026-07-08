# Concepts — Reminders vs Notifications

Remi surfaces two distinct kinds of nudges through the **same buddy + overlay**, but they
differ in **origin, control, and lifecycle**. Keeping them separate is the core mental model
of the app — and it's what the upcoming AI-agent **skill**, **MCP**, and **client sample**
all build on.

## Reminders — *internal, recurring, Remi-owned*

The app **initiates** these on a schedule. Remi decides *when*, from your config.

- **Who fires it:** Remi itself (the timer loop).
- **When:** driven by `intervalMinutes`, `workHours`, `snooze` — see the Settings submenu.
- **Interaction:** buddy walks in, offers, you answer (**Had it 💧 / Snooze**), and progress is
  tracked (daily **history → streak → calendar**).
- **Reply goes to:** the app's own state (your progress).
- **Today:** water. (Future reminder *kinds* still count as reminders if Remi schedules them.)

> Example: *"Time for water 💧 (3/8 today)"* — the buddy walks in, you tap Had it, streak ticks up.

## Notifications — *external, event-driven, producer-owned*

Fired by **outside producers** — a cron job, a shell script, or an **AI agent** — through the
local **[notification API](specs/001-notification-framework.md)** (loopback HTTP, `127.0.0.1`,
token-auth). The producer decides *what* and *when*; **Remi is just the face**.

Two shapes:
- **`info` (peek)** — the buddy **peeks in** from a screen edge, says one thing, and retracts.
  **No buttons, auto-dismiss.** *"Standup in 5 🗣️."*
- **`action`** — a message **+ buttons** (or a quick reply). The user's choice is **returned to
  the producer** (the reply channel), so the agent can then act — send the Slack reply, archive
  the mail, open the meeting. *"Reply to Sam's DM? [Draft] [Snooze]."*

> Example: an agent triages your inbox → fires an `action` notification → you tap **Draft** → the
> agent drafts the reply. Remi never touched Slack; it only rendered the choice.

## Side by side

| | **Reminder** | **Notification** |
|---|---|---|
| Initiated by | Remi (timer) | External producer (API) |
| Configured by | interval / work-hours / goal | per call (`type`, `ttl`, `actions`) |
| Types | water (today) | `info` (peek) · `action` |
| Reply goes to | app state (progress) | back to the producer |
| Transport | internal loop | loopback HTTP API → IPC |
| Intelligence | Remi's schedule | **the producer / model** decides |

## How they share the screen

Both render through the one overlay window, and the framework keeps them from colliding:
- The API's dispatch routes **`info` → the peek surface** and **`action` → the buttons overlay**.
- The **water reminder stays on its own loop** (not yet refactored onto the API — see
  [F001 §7](specs/001-notification-framework.md)); it and a notification never show at once.
- Same guardrail either way: Remi is a **dumb, delightful renderer** — no Gmail/Slack logic in
  the app; that lives in producers.

## What's next (built on *Notifications*)

Once the API is tested, three things speak to it — all producers of **notifications**, never
reminders:
- **Skill** — lets an AI agent fire notifications (a thin wrapper over `bin/remi-notify` / the API).
- **MCP** — exposes the notification API as MCP tools for agents.
- **Client sample** — a small script that exercises `POST /notify` + reply polling end-to-end
  (doubles as the manual test of the API).
