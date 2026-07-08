# Remi MCP server

A tiny **stdio [MCP](https://modelcontextprotocol.io) server** that exposes Remi's
[F001 notification API](../docs/specs/001-notification-framework.md) as tools. Register it
with any MCP-capable agent (Claude Code, etc.) and the agent can make the buddy peek in,
ask a question, and read your answer back — without ever handling the API token.

It's a **producer** (see [`docs/CONCEPTS.md`](../docs/CONCEPTS.md)): it only fires
*notifications* over the loopback API. It holds no Gmail/Slack logic — Remi stays a dumb,
delightful renderer; the *agent* decides what's worth interrupting you for.

## Prerequisites

- **Remi is running.** Start it once (`npm start`) so it writes `config.json` with the API
  token/port, and keep it running so notifications have a face to render.
- **Node** (same one you run Remi with). No global install needed.
- Dependency: `@modelcontextprotocol/sdk` (already added to this repo's `package.json`; run
  `npm install` if you haven't).

## Register it

```sh
claude mcp add --transport stdio remi -- node /abs/path/to/mcp/remi-mcp.js
```

Use the **absolute path** to `mcp/remi-mcp.js` in this repo. After it's added, the agent sees
four tools: `remi_peek`, `remi_action`, `remi_get_reply`, `remi_health`.

> **Loopback only.** The server talks to Remi on `127.0.0.1` and reads the bearer token from
> `config.json` **server-side** — the token is never a tool argument, and nothing binds to a
> non-loopback interface. Same trust model as the CLI (`bin/remi-notify`).

### Config resolution

Token and port come from Remi's `config.json` (the same file `bin/remi-notify` and
`examples/notify-client.js` read), under `app.getPath('userData')`:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Remi/config.json` |
| Windows | `%APPDATA%\Remi\config.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Remi/config.json` |

Override with env vars when launching the server:

- `REMI_TOKEN` — API token (overrides `config.json`)
- `REMI_PORT` — API port (default `7777`)
- `REMI_CONFIG` — path to an alternate `config.json`

```sh
claude mcp add --transport stdio remi \
  --env REMI_PORT=7777 -- node /abs/path/to/mcp/remi-mcp.js
```

## Tools

| Tool | Does | Returns |
|---|---|---|
| `remi_peek` | Fire an `info` peek — one line, no buttons, auto-dismiss. `{ message, detail?, side? }` | `{ id, status }` |
| `remi_action` | Fire an `action` — message + up to 2 buttons. `{ message, detail?, actions:[{label,result}] }` | `{ id, status }` |
| `remi_get_reply` | Poll a notification for the user's answer. `{ id, waitSeconds? }` (blocks up to `waitSeconds`, default 30) | `{ id, status, reply }` |
| `remi_health` | Is Remi up? (no token needed) | `{ ok, version, present }` |

`status` lifecycle: `queued → shown → answered | dismissed | expired`. `reply` (e.g.
`{ result: "draft" }`) is set only once a button is chosen.

If Remi isn't running, tools return a friendly error (`… start Remi first`) instead of a
raw connection failure.

## Worked example (what the agent does)

```
1. remi_action { message: "Reply to Sam's DM?", detail: "\"review the PR today?\"",
                 actions: [{label:"Draft reply",result:"draft"}, {label:"Snooze 1h",result:"snooze"}] }
   → { id: "n_7", status: "queued" }
2. remi_get_reply { id: "n_7" }        # blocks until you tap a button (or 30s)
   → { id: "n_7", status: "answered", reply: { result: "draft" } }
3. …the agent drafts the reply.        # Remi never touched Slack; it only rendered the choice.
```

## Quick check

```sh
# Register it, then in the agent: call remi_health — expect { ok: true, present: … }.
# Or smoke-test the process directly (it should print the ready line to stderr and stay up):
node mcp/remi-mcp.js
```
