#!/usr/bin/env node
// notify-client.js — a standalone producer that exercises the F001 notification API
// end-to-end. No dependencies; Node's built-in http only. Reads the token + port from
// Remi's config.json (same file bin/remi-notify uses), so run Remi once first.
//
//   node examples/notify-client.js
//   REMI_TOKEN=... REMI_PORT=7777 node examples/notify-client.js   # override config.json
//
// It walks the whole contract: GET /health, an `info` peek, an `action` + reply poll,
// a 401 (no token), and a friendly message if Remi isn't running.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mirrors Electron's app.getPath('userData') for productName "Remi" — same as bin/remi-notify.
function configDir() {
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

// Poll GET /notify/:id until it leaves the live states, or we give up.
async function pollUntilTerminal(port, token, id, { tries = 60, everyMs = 1000 } = {}) {
  const LIVE = new Set(['queued', 'shown']);
  for (let i = 0; i < tries; i++) {
    const { json } = await request(port, 'GET', `/notify/${id}`, { token });
    if (!json || !LIVE.has(json.status)) return json;
    await sleep(everyMs);
  }
  return null; // timed out — still queued/shown
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error(`No API token found. Start Remi once (it writes config.json), or set REMI_TOKEN.`);
    console.error(`Looked in: ${cfg.file}`);
    process.exit(1);
  }
  console.log(`→ Talking to Remi on 127.0.0.1:${cfg.port} (token from ${process.env.REMI_TOKEN ? 'env' : cfg.file})\n`);

  // 1) Health — no token needed; also tells us presence.
  const health = await request(cfg.port, 'GET', '/health');
  console.log(`1. GET /health   → ${health.status}`, health.json);

  // 2) A 401 path — same POST, but with no Authorization header.
  const noAuth = await request(cfg.port, 'POST', '/notify', { body: { type: 'info', message: 'should be rejected' } });
  console.log(`2. POST /notify (no token) → ${noAuth.status}`, noAuth.json, noAuth.status === 401 ? '✓ rejected' : '✗ expected 401');

  // 3) An info peek — fire-and-forget. The buddy leans in, says it, strolls off.
  const info = await request(cfg.port, 'POST', '/notify', { token: cfg.token, body: {
    type: 'info', kind: 'meeting', message: 'Standup in 5 🗣️', detail: 'daily-sync',
  } });
  console.log(`3. POST /notify (info)  → ${info.status}`, info.json);

  // 4) An action — message + buttons. The user's choice comes back as the reply.
  const action = await request(cfg.port, 'POST', '/notify', { token: cfg.token, body: {
    type: 'action', kind: 'slack', message: "Reply to Sam's DM?",
    detail: '"can you review the PR today?"',
    actions: [{ label: 'Draft reply', result: 'draft' }, { label: 'Snooze 1h', result: 'snooze' }],
    ttl: 60,
  } });
  console.log(`4. POST /notify (action) → ${action.status}`, action.json);

  console.log(`   …waiting for you to click a button on the buddy (polling GET /notify/${action.json.id})`);
  const result = await pollUntilTerminal(cfg.port, cfg.token, action.json.id, { tries: 60, everyMs: 1000 });
  if (result && result.status === 'answered') {
    console.log(`   ✓ reply: you chose "${result.reply.result}"`, result.reply);
  } else if (result) {
    console.log(`   • ended as "${result.status}" (dismissed or expired — no choice made)`);
  } else {
    console.log(`   • timed out still waiting. Did the buddy show? Is Remi in the foreground?`);
  }
}

main().catch((err) => {
  if (err.code === 'ECONNREFUSED') {
    const port = loadConfig().port;
    console.error(`\nCould not reach Remi on 127.0.0.1:${port} — is it running?`);
    console.error(`Start it with \`npm start\` (or \`npm run demo\`) in another terminal, then re-run this.`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
