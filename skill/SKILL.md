---
name: remi-notify
description: Surface a notification to the user through the Remi desktop buddy — a peek for an FYI, or buttons when you need a decision — then read the reply and act on it. USE WHEN you (the agent) have something worth interrupting the user for right now: a long-running task just finished, you triaged a DM/email/PR that deserves a reply, or a time-sensitive heads-up. NOT for scheduled reminders (water, breaks) — those are Remi's own internal loop, not yours to fire.
---

# Remi notifications — how an agent gets the user's attention

Remi is a desktop buddy that **renders** notifications: it peeks in from a screen
edge, says one thing, optionally shows buttons, and hands you back the user's choice.
You are the **producer** — you decide *what* is worth saying and *when*. Remi is a dumb,
delightful face; all the intelligence is yours.

There are exactly two things you can send:

| | `info` (peek) | `action` (buttons) |
|---|---|---|
| Shape | one line, auto-dismisses | message + up to ~2 buttons |
| Use it for | an FYI — "say it and go" | you need the user to **decide** |
| Reply | none | the user's chosen `result`, back to you |
| You then | nothing | act on the choice (draft, snooze, open…) |

## When to use this skill

Fire a notification when you have **just produced something the user would want to know
or decide on now**:

- A long task you were running finished (build, deploy, research, batch job) → `info`.
- You triaged a Slack DM / email / PR comment and it's genuinely reply-worthy → `action`
  (["Draft", "Snooze", "Ignore"]), then act on the choice.
- A time-sensitive heads-up you noticed (meeting in 5, a failing check) → `info`.

**Do NOT use it for:**

- **Reminders.** Water, stretch, break-time nudges are Remi's own scheduled loop. You
  never fire those — you'd be duplicating the app's job. (See `docs/CONCEPTS.md`.)
- Anything the user didn't ask to be interrupted for and doesn't need *now*.

## Noise discipline — you are the filter

Every notification is an interruption. The whole point of routing through an agent
(instead of a dumb cron) is that **you judge what's worth it**. Before firing, ask:

- Does this need the user **right now**, or can it wait for when they next look?
- Is it **actionable or genuinely informative**, or just noise?
- Would *you* want to be interrupted for this?

When in doubt, **don't fire** — or batch it into a single summary `info` instead of
several. A few well-chosen notifications a day build trust; a stream of them gets Remi
muted. Prefer one `action` that captures the decision over three `info` peeks.

## How to fire — the helper (recommended)

`skill/remi.js` wraps the API: it resolves the token/port, fires, and for an `action`
**polls until the user answers** and prints the result. No dependencies.

```bash
# FYI peek — fire and forget. Prints the notification id.
node skill/remi.js info "Deploy to prod finished ✅" --kind build --detail "2m14s, 0 errors"

# Decision — buttons. BLOCKS until the user clicks (or it expires), prints the result.
choice=$(node skill/remi.js action "Reply to Sam's DM?" "Draft:draft,Snooze:snooze,Ignore:ignore" \
           --kind slack --detail '"can you review the PR today?"' --ttl 120)

case "$choice" in
  draft)   echo "→ user wants a draft; go write the reply" ;;
  snooze)  echo "→ remind later; re-fire in an hour" ;;
  ignore|dismissed|expired) echo "→ let it go" ;;
esac
```

- `info` prints the notification id and exits.
- `action` prints the chosen `result` (e.g. `draft`), or the terminal state
  `dismissed` / `expired` if the user didn't choose. With a quick-reply it prints
  `result<TAB>text`.
- Flags: `--kind <tag>` (drives icon/voice line: `slack|email|meeting|build|…`),
  `--detail <sub-line>`, `--ttl <seconds>`.

## How to fire — raw API (if you can't run the helper)

Loopback HTTP on `127.0.0.1:<port>` (default `7777`), bearer token. Read both from
Remi's `config.json` (`app.getPath('userData')`):

```bash
# macOS path; Linux: ~/.config/Remi/config.json — Windows: %APPDATA%\Remi\config.json
CFG="$HOME/Library/Application Support/Remi/config.json"
TOKEN=$(node -e "console.log(require('$CFG').apiToken)")
PORT=$(node  -e "console.log(require('$CFG').apiPort || 7777)")

# info peek
curl -s -XPOST "http://127.0.0.1:$PORT/notify" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"info","kind":"build","message":"Deploy finished ✅","detail":"2m14s"}'
# → {"id":"n_123","status":"queued"}

# action + poll for the reply
ID=$(curl -s -XPOST "http://127.0.0.1:$PORT/notify" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"action","kind":"slack","message":"Reply to Sam?","ttl":120,
       "actions":[{"label":"Draft","result":"draft"},{"label":"Snooze","result":"snooze"}]}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")

# poll GET /notify/:id until status leaves queued|shown
while :; do
  R=$(curl -s "http://127.0.0.1:$PORT/notify/$ID" -H "Authorization: Bearer $TOKEN")
  S=$(node -e "console.log(JSON.parse(process.argv[1]).status)" "$R")
  case "$S" in queued|shown) sleep 1 ;; *) echo "$R"; break ;; esac
done
# answered → {"status":"answered","reply":{"result":"draft",...}}
```

`bin/remi-notify` (in the repo) also fires a notification from the CLI, but it does
**not** poll for the reply — use `skill/remi.js` for `action`s.

## Payload reference (`POST /notify`)

```jsonc
{
  "type": "action",        // "info" | "action"
  "kind": "slack",         // free-form tag → icon/voice line
  "message": "Reply to Sam's DM?",
  "detail": "\"review the PR today?\"",  // optional sub-line
  "actions": [             // required for action, ignored for info
    { "label": "Draft", "result": "draft" },
    { "label": "Snooze", "result": "snooze" }
  ],
  "ttl": 120               // seconds before auto-expire (default 30 info / 120 action)
}
```

Reply (`GET /notify/:id`): `status` goes `queued → shown → answered | dismissed | expired`;
when `answered`, `reply.result` is the label's `result`. See
`docs/specs/001-notification-framework.md` §5 for the full contract.

## Prerequisites

- **Remi is running** (`npm start` in the repo, or the packaged app). It writes
  `config.json` with the token on first run.
- Node (already required by Remi). No other dependencies.
