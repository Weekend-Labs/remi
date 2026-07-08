# Notification API — client sample

A tiny **producer** that exercises the F001 [notification API](../docs/specs/001-notification-framework.md)
end-to-end: `GET /health`, an `info` peek, an `action` + reply poll, a 401 path, and a
friendly message when Remi isn't running. No dependencies — Node's built-in `http` only.

See [`docs/CONCEPTS.md`](../docs/CONCEPTS.md) for how *notifications* (this) differ from
*reminders* (Remi's own water loop).

## Live demo — against a running Remi

The client reads the API **token** and **port** from Remi's `config.json`, which Remi
writes on first run (under `app.getPath('userData')` — e.g.
`~/Library/Application Support/Remi/config.json` on macOS).

```sh
# 1. Start Remi in one terminal (it writes config.json and prints the token once):
npm start            # or: npm run demo

# 2. Run the client in another terminal:
node examples/notify-client.js
```

You'll see the buddy **peek in** for the `info`, then show **buttons** for the `action`.
Click one — the client polls `GET /notify/:id` and prints the reply you chose.

Overrides (skip config.json):

```sh
REMI_TOKEN=your-token REMI_PORT=7777 node examples/notify-client.js
REMI_CONFIG=/path/to/config.json      node examples/notify-client.js
```

If Remi isn't running you'll get a friendly `ECONNREFUSED` hint instead of a stack trace.

## Automated test — no Electron, no clicking

[`test/api.e2e.test.js`](../test/api.e2e.test.js) is the unattended twin of the demo. It
boots the API standalone via `startNotifyApi(...)` with a **mock dispatch** that plays the
user (auto-answers `action` notifications), then drives the same requests over real
loopback HTTP and asserts: 401-without-token, `info` queues, `action` round-trips to a
reply, and `DELETE` / `ttl` reach terminal states.

```sh
npm test                              # runs the whole suite, including this file
node --test test/api.e2e.test.js      # just the e2e file
```

No Electron and no network fixtures required — it uses an ephemeral loopback port and a
fixed token.

## Test UI — a clickable bench in the browser

[`test-ui.js`](./test-ui.js) is the point-and-click twin of the client sample: a tiny Node
server (built-in `http`, no deps) that serves one self-contained page **and** proxies the
browser's calls to the notification API. The API **token is injected server-side** (read
from `config.json`), so the browser stays same-origin with the UI server — no CORS, and the
token never reaches the page.

```sh
# 1. Start Remi in one terminal (writes config.json):
npm start

# 2. Start the test UI in another, then open the URL:
node examples/test-ui.js        # → http://localhost:7788
UI_PORT=9000 node examples/test-ui.js   # pick a different UI port
```

The page lets you set **message / detail / type (`info`|`action`) / kind / side / actions**
(as `Label:result, …`), then **Fire** it. You get the raw API response; for an `action` it
**live-polls `GET /notify/:id`** and shows the reply you clicked on the buddy. A **health**
readout (up / version / presence) sits at the top, a **log of recent sends** at the bottom,
and if Remi isn't running you get a friendly hint instead of a stack trace.

Token/port resolve exactly like the client sample — same `config.json`, same `REMI_TOKEN` /
`REMI_PORT` / `REMI_CONFIG` overrides.
