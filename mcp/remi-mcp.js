#!/usr/bin/env node
// remi-mcp.js — a stdio MCP server that exposes Remi's F001 notification API as tools,
// so any MCP-capable agent (Claude Code, etc.) can fire notifications and read the reply.
// A *producer*: it only talks to Remi over the loopback API — it holds no Gmail/Slack logic.
//
//   node mcp/remi-mcp.js                       # reads token+port from config.json
//   REMI_TOKEN=... REMI_PORT=7777 node mcp/remi-mcp.js   # override config.json
//
// Register it once with:
//   claude mcp add --transport stdio remi -- node /abs/path/to/mcp/remi-mcp.js
//
// The API token is read server-side from config.json (or REMI_TOKEN) and is NEVER a
// tool argument — an agent can fire notifications without ever seeing the secret.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// --- config/token/port resolution — mirrors examples/notify-client.js & bin/remi-notify ---

function configDir() {
  // Mirrors Electron's app.getPath('userData') for productName "Remi".
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Remi');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'Remi');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Remi');
}

function loadConfig() {
  const file = process.env.REMI_CONFIG || path.join(configDir(), 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not started yet — fall back to env */ }
  return {
    file,
    token: process.env.REMI_TOKEN || cfg.apiToken,
    port: Number(process.env.REMI_PORT) || cfg.apiPort || 7777,
  };
}

// One request → { status, json }. Rejects with a tagged ECONNREFUSED so callers can be friendly.
function request(port, method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, agent: false, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      } },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, json: out ? JSON.parse(out) : null }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tool result: a single text block carrying pretty JSON. `isError` flips it to a failure.
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

// Wrap a call to the API: resolve the token lazily (so a mid-session `npm start` is picked up),
// and turn the two producer-facing failures — Remi down, no token — into friendly tool errors.
async function call(needsToken, fn) {
  const cfg = loadConfig();
  if (needsToken && !cfg.token) {
    return fail(`No API token found. Start Remi once (it writes ${cfg.file}), or set REMI_TOKEN.`);
  }
  try {
    return await fn(cfg);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      return fail(`Could not reach Remi on 127.0.0.1:${cfg.port} — start Remi first (\`npm start\`), then retry.`);
    }
    return fail(`Request failed: ${err.message}`);
  }
}

// --- the MCP server ---

const server = new McpServer({ name: 'remi', version: '0.2.0' });

server.registerTool(
  'remi_peek',
  {
    title: 'Remi: peek (info)',
    description:
      'Fire an `info` notification: the buddy peeks in from a screen edge, says one line, and ' +
      'retracts. No buttons, auto-dismiss. Use for FYIs that need no answer ("Standup in 5"). ' +
      'Returns { id, status }.',
    inputSchema: {
      message: z.string().min(1).describe('The speech-bubble text, e.g. "Standup in 5 🗣️".'),
      detail: z.string().optional().describe('Optional smaller sub-line under the message.'),
      side: z.enum(['left', 'right']).optional().describe('Screen edge to peek from (hint; defaults to right).'),
    },
  },
  ({ message, detail, side }) =>
    call(true, async (cfg) => {
      const { status, json } = await request(cfg.port, 'POST', '/notify', {
        token: cfg.token,
        body: { type: 'info', message, detail, side },
      });
      if (status !== 201) return fail(`Remi returned ${status}: ${JSON.stringify(json)}`);
      return ok(json); // { id, status }
    }),
);

server.registerTool(
  'remi_action',
  {
    title: 'Remi: action (buttons)',
    description:
      'Fire an `action` notification: a message plus up to two buttons. The user\'s choice is ' +
      'returned to you — call `remi_get_reply` with the returned id to read it. Use when a ' +
      'decision is needed ("Reply to Sam\'s DM? [Draft] [Snooze]"). Returns { id, status }.',
    inputSchema: {
      message: z.string().min(1).describe('The speech-bubble question, e.g. "Reply to Sam\'s DM?".'),
      detail: z.string().optional().describe('Optional smaller sub-line (e.g. a quote of the DM).'),
      actions: z
        .array(z.object({
          label: z.string().min(1).describe('Button text the user sees, e.g. "Draft reply".'),
          result: z.string().min(1).describe('Value returned in the reply when this button is chosen, e.g. "draft".'),
        }))
        .min(1)
        .max(2)
        .describe('1–2 buttons (the overlay shows two).'),
    },
  },
  ({ message, detail, actions }) =>
    call(true, async (cfg) => {
      const { status, json } = await request(cfg.port, 'POST', '/notify', {
        token: cfg.token,
        body: { type: 'action', message, detail, actions },
      });
      if (status !== 201) return fail(`Remi returned ${status}: ${JSON.stringify(json)}`);
      return ok(json); // { id, status }
    }),
);

server.registerTool(
  'remi_get_reply',
  {
    title: 'Remi: get reply',
    description:
      'Poll a notification for its reply. Blocks up to `waitSeconds` (default 30) for the user ' +
      'to answer, then returns the current { id, status, reply }. status is one of ' +
      'queued | shown | answered | dismissed | expired; `reply` is set only when answered ' +
      '(e.g. { result: "draft" }). Set waitSeconds: 0 for a single non-blocking check.',
    inputSchema: {
      id: z.string().min(1).describe('The notification id returned by remi_action / remi_peek.'),
      waitSeconds: z.number().int().min(0).max(120).optional().describe('Max seconds to wait for a terminal reply (default 30).'),
    },
  },
  ({ id, waitSeconds = 30 }) =>
    call(true, async (cfg) => {
      const LIVE = new Set(['queued', 'shown']);
      const deadline = waitSeconds; // seconds; we poll ~1/s
      for (let i = 0; ; i++) {
        const { status, json } = await request(cfg.port, 'GET', `/notify/${encodeURIComponent(id)}`, { token: cfg.token });
        if (status === 404) return fail(`No notification with id "${id}" (unknown or long expired).`);
        if (status !== 200) return fail(`Remi returned ${status}: ${JSON.stringify(json)}`);
        if (!json || !LIVE.has(json.status)) return ok(json); // terminal — answered/dismissed/expired
        if (i >= deadline) return ok(json); // still live; hand back the current state
        await sleep(1000);
      }
    }),
);

server.registerTool(
  'remi_health',
  {
    title: 'Remi: health',
    description: 'Check whether Remi is running and reachable. Returns { ok, version, present } (no token needed).',
    inputSchema: {},
  },
  () =>
    call(false, async (cfg) => {
      const { status, json } = await request(cfg.port, 'GET', '/health');
      if (status !== 200) return fail(`Remi returned ${status}: ${JSON.stringify(json)}`);
      return ok(json);
    }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel — log to stderr only.
  console.error('[remi-mcp] stdio server ready (remi_peek, remi_action, remi_get_reply, remi_health)');
}

main().catch((err) => {
  console.error('[remi-mcp] fatal:', err);
  process.exit(1);
});
