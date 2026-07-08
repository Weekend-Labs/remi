# remi-notify — an Agent Skill for firing Remi notifications

A self-contained [Claude Code Agent Skill](https://docs.claude.com/en/docs/claude-code/skills)
that teaches an AI agent to surface notifications through the **Remi** desktop buddy and
read the user's reply. The agent is a **producer** over Remi's local
[F001 notification API](../docs/specs/001-notification-framework.md); Remi is just the face.

**Only notifications, never reminders.** This skill fires *notifications* — event-driven
nudges the agent decides to send (a finished task, a reply-worthy DM). It never fires
*reminders* (water, breaks) — those are Remi's own internal scheduled loop. See
[`docs/CONCEPTS.md`](../docs/CONCEPTS.md) for the distinction.

**Only surface what matters.** The agent is the noise filter. A cron job fires on a clock;
an agent fires on judgement. Every notification is an interruption — the skill's whole
value is firing *few, well-chosen* ones. When in doubt, don't fire.

## Contents

| File | What it is |
|------|-----------|
| `SKILL.md` | The skill itself — front matter, when-to-use triggers, copy-paste API calls. |
| `remi.js` | Thin helper: `remi info "…"` / `remi action "…" "Label:result,…"` → prints the reply. No deps. |
| `README.md` | This file — install, prerequisites, worked example. |

## Prerequisites

1. **Remi is running.** Start it from the repo (`npm start`) or launch the packaged app.
   On first run it writes `config.json` (under `app.getPath('userData')`) containing the
   API **token** and **port** — that's what the helper reads.
2. **Node** — already required by Remi; the helper uses only built-in `http`.

## Install

The skill is self-contained in this `skill/` directory. Point your agent at it one of two ways:

**As a personal skill** — copy it under your Claude Code skills dir, named for the skill:

```bash
cp -R skill ~/.claude/skills/remi-notify
```

**As a project/plugin skill** — leave it here (or vendor it into a plugin's `skills/`).
Claude Code discovers `SKILL.md` by its front-matter `name` and loads it when the
`description` triggers match. The helper is referenced by path from `SKILL.md`; if you
copy the skill elsewhere, `remi.js` travels with it.

No build step. Nothing under the app's `src/` is touched — this is pure producer.

## Worked example

Remi running in one terminal (`npm start`). Then, as the agent would:

```bash
# 1. FYI peek — the buddy leans in, says it, strolls off. Prints the notification id.
$ node skill/remi.js info "Deploy to prod finished ✅" --kind build --detail "2m14s, 0 errors"
n_1

# 2. A decision — buttons. Blocks until the user clicks (or it expires), prints the result.
$ choice=$(node skill/remi.js action "Reply to Sam's DM?" \
             "Draft:draft,Snooze:snooze,Ignore:ignore" \
             --kind slack --detail '"can you review the PR today?"' --ttl 120)
$ echo "$choice"
draft            # ← what the user clicked (or "expired" / "dismissed" if they didn't)

# 3. Act on the choice.
$ case "$choice" in
    draft)  echo "→ writing the reply draft…" ;;
    snooze) echo "→ will re-surface in an hour" ;;
    *)      echo "→ dropping it" ;;
  esac
```

Overrides (skip `config.json`):

```bash
REMI_TOKEN=your-token REMI_PORT=7777 node skill/remi.js info "hi"
REMI_CONFIG=/path/to/config.json      node skill/remi.js info "hi"
```

If Remi isn't running you get a friendly `is it running? (npm start)` hint, not a stack trace.

## How it works

`remi.js` is a ~40-line wrapper over the F001 API:
- resolves token + port from `config.json` (same logic as `bin/remi-notify` and
  `examples/notify-client.js`),
- `POST /notify` with the right payload for `info` or `action`,
- for `action`, polls `GET /notify/:id` until the status is terminal
  (`answered` / `dismissed` / `expired`) and prints the chosen `result`.

For the full API contract see [`docs/specs/001-notification-framework.md`](../docs/specs/001-notification-framework.md) §5.
The repo's [`examples/notify-client.js`](../examples/notify-client.js) is a fuller,
annotated walk of the same endpoints.
