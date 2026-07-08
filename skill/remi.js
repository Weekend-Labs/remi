#!/usr/bin/env node
// remi — thin producer helper for the F001 notification API. Fires a Remi
// notification and, for an `action`, polls until the user answers and prints
// the chosen result. No dependencies; Node's built-in http only.
//
//   remi info   "Deploy finished ✅"            [--kind build] [--detail "prod, 2m14s"]
//   remi action "Reply to Sam's DM?" "Draft:draft,Snooze:snooze"   [--kind slack] [--ttl 120]
//
// info   → fires a peek and exits (fire-and-forget); prints the notification id.
// action → fires buttons, polls GET /notify/:id, prints the chosen result on
//          stdout (e.g. "draft"), or the terminal state ("dismissed"/"expired").
//
// Token + port come from Remi's config.json (same file bin/remi-notify uses),
// overridable with REMI_TOKEN / REMI_PORT / REMI_CONFIG. Run Remi once first.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mirrors Electron's app.getPath('userData') for productName "Remi".
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

// Poll GET /notify/:id until it leaves the live states, or give up.
async function pollUntilTerminal(port, token, id, { tries = 300, everyMs = 1000 } = {}) {
  const LIVE = new Set(['queued', 'shown']);
  for (let i = 0; i < tries; i++) {
    const { json } = await request(port, 'GET', `/notify/${id}`, { token });
    if (!json || !LIVE.has(json.status)) return json;
    await sleep(everyMs);
  }
  return null; // timed out — still queued/shown
}

const HELP = `remi — fire a Remi notification (info peek or action + reply)
  remi info   "<message>" [--kind t] [--detail t]
  remi action "<message>" "Label:result,Label2:result2" [--kind t] [--detail t] [--ttl n]

info   → peek-and-go; prints the notification id, exits.
action → buttons; polls for the reply and prints the chosen result (e.g. "draft"),
         or the terminal state "dismissed" / "expired".
Env: REMI_TOKEN, REMI_PORT, REMI_CONFIG (override config.json).`;

// Minimal flag parser: pull --key value pairs out, leave positionals.
function parse(argv) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
    else pos.push(argv[i]);
  }
  return { flags, pos };
}

async function main() {
  const { flags, pos } = parse(process.argv.slice(2));
  const [type, message, actionsCsv] = pos;
  if (!type || type === '-h' || type === '--help' || !message ||
      (type !== 'info' && type !== 'action')) {
    console.log(HELP);
    process.exit(type === '-h' || type === '--help' ? 0 : 1);
  }

  const cfg = loadConfig();
  if (!cfg.token) {
    console.error(`No API token. Start Remi once (it writes config.json), or set REMI_TOKEN.`);
    console.error(`Looked in: ${cfg.file}`);
    process.exit(1);
  }

  // "Label:result,Label2:result2" → [{label,result}] ; bare "Label" → result=Label.
  const actions = type === 'action'
    ? (actionsCsv || '').split(',').filter(Boolean).map((s) => {
        const i = s.indexOf(':');
        return i < 0 ? { label: s.trim(), result: s.trim() }
                     : { label: s.slice(0, i).trim(), result: s.slice(i + 1).trim() };
      })
    : [];
  if (type === 'action' && actions.length === 0) {
    console.error('action needs buttons: "Label:result,Label2:result2"');
    process.exit(1);
  }

  const body = {
    type, kind: flags.kind, message, detail: flags.detail,
    actions: actions.length ? actions : undefined,
    ttl: flags.ttl ? Number(flags.ttl) : undefined,
  };

  let fired;
  try {
    fired = await request(cfg.port, 'POST', '/notify', { token: cfg.token, body });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error(`Could not reach Remi on 127.0.0.1:${cfg.port} — is it running? (npm start)`);
      process.exit(1);
    }
    throw err;
  }
  if (fired.status < 200 || fired.status >= 300) {
    console.error(`POST /notify → ${fired.status}`, fired.json || '');
    process.exit(1);
  }

  const id = fired.json.id;
  if (type === 'info') { console.log(id); return; } // fire-and-forget

  const result = await pollUntilTerminal(cfg.port, cfg.token, id);
  if (result && result.status === 'answered') {
    console.log(result.reply.text ? `${result.reply.result}\t${result.reply.text}` : result.reply.result);
  } else if (result) {
    console.log(result.status); // dismissed | expired
  } else {
    console.error(`timed out waiting for a reply to ${id}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
