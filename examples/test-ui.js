#!/usr/bin/env node
// test-ui.js — a clickable test bench for the F001 notification API. A tiny Node server
// (built-in http only, no deps) that serves one self-contained HTML page AND proxies the
// browser's calls to the notification API, injecting the Bearer token SERVER-SIDE. So the
// browser is same-origin with this UI → no CORS, and the token never leaves the machine's
// config.json for the browser.
//
//   node examples/test-ui.js        # then open http://localhost:7788 (Remi running)
//   UI_PORT=9000 node examples/test-ui.js
//
// Token + API port resolve exactly like examples/notify-client.js (config.json, env overrides).

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UI_PORT = Number(process.env.UI_PORT) || 7788;

// --- token/port resolution: identical to notify-client.js ---------------------------------

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

// --- server -------------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    let out = '';
    req.on('data', (c) => (out += c));
    req.on('end', () => { try { resolve(out ? JSON.parse(out) : undefined); } catch { resolve(undefined); } });
  });
}

function send(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

// Proxy /api/* → the real notification API, token injected here (never in the browser).
async function proxy(req, res) {
  const cfg = loadConfig();
  const apiPath = req.url.slice('/api'.length); // "/api/notify" → "/notify"
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  try {
    const { status, json } = await request(cfg.port, req.method, apiPath, { token: cfg.token, body });
    send(res, status, json);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      send(res, 502, { error: 'unreachable', message: `Remi isn't reachable on 127.0.0.1:${cfg.port}. Start it with \`npm start\` and try again.` });
    } else {
      send(res, 500, { error: 'proxy_failed', message: String(err && err.message || err) });
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (req.url.startsWith('/api/')) { proxy(req, res); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

// Only listen when run directly. `node --test` globs `test-*.js` and runs this file AS the
// main module (require.main === module is true under the runner), so also bail when the
// test-runner env marker is present — keeps it inert (no server, no hang) under `npm test`.
if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
  server.listen(UI_PORT, '127.0.0.1', () => {
    const cfg = loadConfig();
    console.log(`Test UI → http://localhost:${UI_PORT}`);
    console.log(`Proxying to notification API on 127.0.0.1:${cfg.port} (token from ${process.env.REMI_TOKEN ? 'env' : cfg.file})`);
    if (!cfg.token) console.log(`⚠  No API token yet — start Remi once (npm start) so it writes config.json, then reload the page.`);
  });
}

// --- the page: one self-contained HTML doc, inline CSS + JS, no external assets ------------

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remi — Notification API test bench</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0;
         background: #f6f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16181d; color: #e7e9ee; } }
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin: 0 0 20px; }
  .card { background: #fff; border: 1px solid #e3e5ea; border-radius: 12px; padding: 18px; margin-bottom: 18px; }
  @media (prefers-color-scheme: dark) { .card { background: #1e2127; border-color: #2c313a; } }
  label { display: block; font-weight: 600; font-size: 13px; margin: 12px 0 4px; }
  input, select { width: 100%; padding: 8px 10px; border: 1px solid #cbd0d8; border-radius: 8px;
                  font: inherit; background: transparent; color: inherit; }
  @media (prefers-color-scheme: dark) { input, select { border-color: #3a4049; } }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .hint { font-weight: 400; color: #9aa0aa; font-size: 12px; }
  button { margin-top: 16px; padding: 10px 18px; border: 0; border-radius: 8px; font: inherit;
           font-weight: 600; background: #2563eb; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .health { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #9aa0aa; }
  .dot.ok { background: #16a34a; } .dot.down { background: #dc2626; }
  pre { background: #0d1117; color: #d6deeb; padding: 12px; border-radius: 8px; overflow: auto;
        font-size: 12.5px; margin: 12px 0 0; white-space: pre-wrap; word-break: break-word; }
  .log { list-style: none; margin: 8px 0 0; padding: 0; font-size: 13px; }
  .log li { padding: 8px 0; border-top: 1px solid #eceef2; }
  @media (prefers-color-scheme: dark) { .log li { border-color: #2c313a; } }
  .log .id { font-family: ui-monospace, monospace; color: #6b7280; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .badge.answered { background: #dcfce7; color: #166534; }
  .badge.queued, .badge.shown { background: #dbeafe; color: #1e40af; }
  .badge.dismissed, .badge.expired { background: #f3f4f6; color: #4b5563; }
  .badge.error { background: #fee2e2; color: #991b1b; }
  h2 { font-size: 15px; margin: 0 0 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Remi · Notification API test bench</h1>
  <p class="sub">Fire notifications at a running Remi and watch the reply come back. The token is injected server-side — same-origin, never in this page.</p>

  <div class="card">
    <div class="health"><span id="dot" class="dot"></span><span id="health">checking Remi…</span></div>
  </div>

  <div class="card">
    <h2>Compose</h2>
    <label>Message <span class="hint">the speech-bubble line</span></label>
    <input id="message" value="Reply to Sam's DM?">

    <label>Detail <span class="hint">optional sub-line</span></label>
    <input id="detail" value='"can you review the PR today?"'>

    <div class="row">
      <div>
        <label>Type</label>
        <select id="type"><option value="info">info (peek)</option><option value="action" selected>action (buttons)</option></select>
      </div>
      <div>
        <label>Kind <span class="hint">icon/voice tag</span></label>
        <input id="kind" value="slack">
      </div>
      <div>
        <label>Side</label>
        <select id="side"><option value="right" selected>right</option><option value="left">left</option></select>
      </div>
    </div>

    <label id="actionsLabel">Actions <span class="hint">Label:result, comma-separated (action only)</span></label>
    <input id="actions" value="Draft reply:draft, Snooze 1h:snooze">

    <button id="fire">Fire →</button>
    <pre id="out" hidden></pre>
  </div>

  <div class="card">
    <h2>Recent sends</h2>
    <ul id="log" class="log"><li style="color:#9aa0aa;border:0">nothing yet — fire one above.</li></ul>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const LIVE = new Set(['queued', 'shown']);
let logRows = [];

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function pollHealth() {
  try {
    const { status, json } = await api('GET', '/health');
    if (status === 502) { setHealth(false, json && json.message || 'Remi not reachable'); return; }
    if (json && json.ok) {
      setHealth(true, 'Remi up · v' + (json.version || '?') + ' · present: ' + (json.present ? 'yes' : 'no'));
    } else {
      setHealth(false, 'API responded ' + status);
    }
  } catch (e) {
    setHealth(false, 'UI server unreachable');
  }
}
function setHealth(ok, text) {
  $('dot').className = 'dot ' + (ok ? 'ok' : 'down');
  $('health').textContent = text;
}

function parseActions(str) {
  return str.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.indexOf(':');
    if (i === -1) return { label: pair, result: pair.toLowerCase().replace(/\\s+/g, '-') };
    return { label: pair.slice(0, i).trim(), result: pair.slice(i + 1).trim() };
  });
}

function toggleActions() {
  const isAction = $('type').value === 'action';
  $('actions').disabled = !isAction;
  $('actionsLabel').style.opacity = isAction ? 1 : .4;
}
$('type').addEventListener('change', toggleActions);

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function badge(status) { return '<span class="badge ' + esc(status) + '">' + esc(status) + '</span>'; }

function renderLog() {
  if (!logRows.length) return;
  $('log').innerHTML = logRows.map((r) =>
    '<li><span class="id">' + esc(r.id) + '</span> · ' + esc(r.type) + ' · "' + esc(r.message) + '" ' + badge(r.status) +
    (r.reply ? ' → chose <b>' + esc(r.reply) + '</b>' : '') + '</li>'
  ).join('');
}

async function fire() {
  const type = $('type').value;
  const body = {
    type,
    kind: $('kind').value || undefined,
    message: $('message').value,
    detail: $('detail').value || undefined,
    side: $('side').value,
  };
  if (type === 'action') body.actions = parseActions($('actions').value);

  $('fire').disabled = true;
  $('out').hidden = false;
  $('out').textContent = 'POST /notify …\\n' + JSON.stringify(body, null, 2);

  const { status, json } = await api('POST', '/notify', body);
  $('out').textContent = 'POST /notify → ' + status + '\\n' + JSON.stringify(json, null, 2);

  if (status === 502 || !json || !json.id) {
    const row = { id: json && json.id || '—', type, message: body.message, status: 'error' };
    logRows.unshift(row); renderLog();
    $('fire').disabled = false;
    return;
  }

  const row = { id: json.id, type, message: body.message, status: json.status };
  logRows.unshift(row); renderLog();

  if (type === 'action') {
    await pollReply(json.id, row);
  }
  $('fire').disabled = false;
}

async function pollReply(id, row) {
  for (let i = 0; i < 60; i++) {
    const { json } = await api('GET', '/notify/' + id);
    if (!json) break;
    row.status = json.status;
    if (!LIVE.has(json.status)) {
      if (json.status === 'answered' && json.reply) row.reply = json.reply.result || (json.reply.text ? '“' + json.reply.text + '”' : '?');
      renderLog();
      $('out').textContent += '\\n\\nGET /notify/' + id + ' → ' + json.status +
        (json.reply ? '\\nreply: ' + JSON.stringify(json.reply) : '');
      return;
    }
    renderLog();
    await new Promise((r) => setTimeout(r, 1000));
  }
  row.status = 'expired'; renderLog();
}

$('fire').addEventListener('click', fire);
toggleActions();
pollHealth();
setInterval(pollHealth, 5000);
</script>
</body>
</html>`;
