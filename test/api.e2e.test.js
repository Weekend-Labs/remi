// End-to-end test of the F001 notification API — boots startNotifyApi standalone (no
// Electron) with a MOCK dispatch that auto-answers `action` notifications, then drives
// the whole contract over real loopback HTTP the way a producer would.
//
// This is the automated twin of examples/notify-client.js: same requests, but the "user
// clicking a button" is faked by the mock dispatch so it runs unattended under `npm test`.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startNotifyApi } = require('../src/api');

const TOKEN = 'e2e-fixed-token';

// Minimal HTTP client — { status, json } for one request.
function req(port, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, json: out ? JSON.parse(out) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Grab a free OS-assigned port. api.js does `Number(config.apiPort) || 7777`, so 0 is
// falsy and would resolve to the default 7777 — which clashes with the other test file's
// server running in a parallel process. Reserve a real ephemeral port and hand that in.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Boot the API with a mock dispatch that plays "the user". For an `action`, it picks the
// first button and answers on the next tick — deferred so the reply lands AFTER pump()
// has set the overlay slot (resolving mid-dispatch would strand the slot).
async function withApi(fn) {
  let api;
  const dispatched = [];
  api = startNotifyApi({
    config: { apiPort: await freePort(), apiToken: TOKEN },
    version: '1.2.3',
    dispatch: (payload) => {
      dispatched.push(payload);
      if (payload.type === 'action') {
        setImmediate(() => api.resolve(payload.id, payload.actions[0].result));
      }
      return true; // rendered — pump marks it shown (falsy would leave it queued)
    },
    presence: () => true,
    log: () => {},
  });
  await new Promise((res) => api.server.once('listening', res));
  try { await fn(api, api.port(), dispatched); } finally { api.close(); }
}

test('e2e: a request without a token is rejected 401', () => withApi(async (api, port) => {
  const r = await req(port, 'POST', '/notify', { body: { type: 'info', message: 'nope' } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /bearer token/);
}));

test('e2e: health needs no token and reports version (presence gated behind the token)', () => withApi(async (api, port) => {
  const r = await req(port, 'GET', '/health');
  assert.deepEqual(r.json, { ok: true, version: '1.2.3' }); // unauthenticated → no presence leak
  const authed = await req(port, 'GET', '/health', { token: TOKEN });
  assert.deepEqual(authed.json, { ok: true, version: '1.2.3', present: true });
}));

test('e2e: info peek queues and dispatches, then reads back non-terminal', () => withApi(async (api, port, dispatched) => {
  const r = await req(port, 'POST', '/notify', { token: TOKEN, body: { type: 'info', kind: 'meeting', message: 'Standup in 5' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'queued');
  assert.equal(dispatched.at(-1).message, 'Standup in 5'); // buddy was handed the peek
  const got = await req(port, 'GET', `/notify/${r.json.id}`, { token: TOKEN });
  assert.equal(got.json.status, 'shown');   // info was pumped to the overlay, never answered
  assert.equal(got.json.reply, null);
}));

test('e2e: action round-trips to a reply (mock dispatch answers)', () => withApi(async (api, port) => {
  const r = await req(port, 'POST', '/notify', { token: TOKEN, body: {
    type: 'action', kind: 'slack', message: "Reply to Sam's DM?",
    actions: [{ label: 'Draft reply', result: 'draft' }, { label: 'Snooze', result: 'snooze' }],
  } });
  assert.equal(r.status, 201);
  const { id } = r.json;

  // Poll like a real producer until the notification leaves the live states.
  let got;
  for (let i = 0; i < 50; i++) {
    got = await req(port, 'GET', `/notify/${id}`, { token: TOKEN });
    if (got.json.status !== 'queued' && got.json.status !== 'shown') break;
    await sleep(10);
  }
  assert.equal(got.json.status, 'answered');
  assert.equal(got.json.reply.result, 'draft'); // the first action, chosen by the mock
}));

test('e2e: DELETE cancels a live notification to a terminal state', () => withApi(async (api, port) => {
  const { json } = await req(port, 'POST', '/notify', { token: TOKEN, body: { type: 'info', message: 'meeting moved' } });
  const del = await req(port, 'DELETE', `/notify/${json.id}`, { token: TOKEN });
  assert.equal(del.json.status, 'dismissed');
  const got = await req(port, 'GET', `/notify/${json.id}`, { token: TOKEN });
  assert.equal(got.json.status, 'dismissed'); // stays terminal
  assert.equal((await req(port, 'DELETE', `/notify/${json.id}`, { token: TOKEN })).status, 404); // already terminal
}));

test('e2e: ttl expiry drives a notification to a terminal state', () => withApi(async (api, port) => {
  const { json } = await req(port, 'POST', '/notify', { token: TOKEN, body: { type: 'info', message: 'expires soon', ttl: 30 } });
  // Force the clock forward through the queue's sweep instead of waiting real seconds,
  // then confirm the terminal state over HTTP.
  api.queue.sweep(Date.now() + 60_000);
  const got = await req(port, 'GET', `/notify/${json.id}`, { token: TOKEN });
  assert.equal(got.json.status, 'expired');
}));
