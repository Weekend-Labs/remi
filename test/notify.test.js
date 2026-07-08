const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { validate, createQueue, HttpError } = require('../src/notify');
const { startNotifyApi } = require('../src/api');

// ── validation ─────────────────────────────────────────────────────────────
test('info notification validates and defaults ttl to 30s', () => {
  const n = validate({ type: 'info', message: 'Standup in 5' });
  assert.equal(n.type, 'info');
  assert.equal(n.ttl, 30);
  assert.equal(n.priority, 'normal');
  assert.deepEqual(n.actions, []);
});

test('action notification requires actions and defaults ttl to 120s', () => {
  const n = validate({ type: 'action', message: 'Reply?', actions: [{ label: 'Draft', result: 'draft' }] });
  assert.equal(n.ttl, 120);
  assert.deepEqual(n.actions, [{ label: 'Draft', result: 'draft' }]);
});

test('missing message is rejected', () => {
  assert.throws(() => validate({ type: 'info' }), (e) => e instanceof HttpError && e.status === 400);
});

test('bad type is rejected', () => {
  assert.throws(() => validate({ type: 'nope', message: 'x' }), /type must be/);
});

test('action without actions[] is rejected', () => {
  assert.throws(() => validate({ type: 'action', message: 'x' }), /require a non-empty/);
});

test('more than two actions is rejected', () => {
  const actions = [1, 2, 3].map((i) => ({ label: `a${i}`, result: `r${i}` }));
  assert.throws(() => validate({ type: 'action', message: 'x', actions }), /at most 2/);
});

test('explicit ttl overrides the default', () => {
  assert.equal(validate({ type: 'info', message: 'x', ttl: 5 }).ttl, 5);
});

// ── queue lifecycle ────────────────────────────────────────────────────────
test('queue: add → shown → answered records the reply', () => {
  const q = createQueue();
  const n = q.add(validate({ type: 'action', message: 'x', actions: [{ label: 'Y', result: 'yes' }] }), 1000);
  assert.equal(n.status, 'queued');
  assert.equal(q.markShown(n.id, 2000).status, 'shown');
  const r = q.resolve(n.id, 'yes', 3000);
  assert.equal(r.status, 'answered');
  assert.deepEqual(r.reply, { result: 'yes', at: 3 });
});

test('queue: FIFO order, and a resolved item is skipped by nextQueued', () => {
  const q = createQueue();
  const a = q.add(validate({ type: 'info', message: 'a' }), 0);
  const b = q.add(validate({ type: 'info', message: 'b' }), 0);
  assert.equal(q.nextQueued().id, a.id);
  q.markShown(a.id, 0);
  assert.equal(q.nextQueued().id, b.id);
});

test('queue: cancel moves a live item to dismissed', () => {
  const q = createQueue();
  const n = q.add(validate({ type: 'info', message: 'x' }), 0);
  assert.equal(q.cancel(n.id, 5000).status, 'dismissed');
  assert.equal(q.cancel(n.id, 6000), null); // already terminal
});

test('queue: terminal states are immutable', () => {
  const q = createQueue();
  const n = q.add(validate({ type: 'info', message: 'x' }), 0);
  q.resolve(n.id, 'ok', 1000);
  assert.equal(q.resolve(n.id, 'again', 2000), null);
  assert.equal(q.markShown(n.id, 2000), null);
});

test('queue: sweep expires only live items past ttl', () => {
  const q = createQueue();
  const n = q.add(validate({ type: 'info', message: 'x', ttl: 30 }), 0);
  assert.deepEqual(q.sweep(29_000), []);          // not yet
  assert.deepEqual(q.sweep(30_000), [n.id]);      // now
  assert.equal(q.get(n.id).status, 'expired');
  assert.deepEqual(q.sweep(60_000), []);          // stays terminal, not re-swept
});

test('queue: sweep prunes terminal items only after the retention window', () => {
  const q = createQueue();
  const n = q.add(validate({ type: 'action', message: 'x', actions: [{ label: 'Y', result: 'yes' }] }), 0);
  q.markShown(n.id, 0);
  q.resolve(n.id, 'yes', 1000);                    // terminal (answered) at t=1s
  q.sweep(1000 + 4 * 60_000);                       // 4 min later: still readable for a producer GET
  assert.equal(q.get(n.id).status, 'answered');
  q.sweep(1000 + 6 * 60_000);                       // past the ~5 min retention window
  assert.equal(q.get(n.id), null);                  // pruned from the Map
});

test('queue: a fresh terminal item survives sweeps at other items\' expiry', () => {
  const q = createQueue();
  const answered = q.add(validate({ type: 'info', message: 'a' }), 0);
  q.resolve(answered.id, 'ok', 1000);              // answered, will need to live a while
  const expiring = q.add(validate({ type: 'info', message: 'b', ttl: 30 }), 0);
  assert.deepEqual(q.sweep(30_000), [expiring.id]); // b expires; a is only ~29s terminal → kept
  assert.equal(q.get(answered.id).status, 'answered');
});

// ── HTTP API (real loopback server, Electron stubbed out) ───────────────────
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

// Grab a free OS-assigned port. api.js does `Number(config.apiPort) || 7777`, so
// apiPort:0 is falsy and would bind the fixed 7777 — clashing (EADDRINUSE) with a
// running Remi or the e2e test's parallel process. Reserve a real ephemeral port.
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

async function withServer(fn) {
  const dispatched = [];
  const api = startNotifyApi({
    config: { apiPort: await freePort(), apiToken: 'secret-token' },
    version: '9.9.9',
    dispatch: (payload) => { dispatched.push(payload); return true; }, // truthy = rendered
    presence: () => true,
    log: () => {},
  });
  await new Promise((res) => api.server.once('listening', res));
  try { await fn(api, api.port(), dispatched); } finally { api.close(); }
}

test('API: binds 127.0.0.1 only', () => withServer(async (api) => {
  assert.equal(api.server.address().address, '127.0.0.1');
}));

test('API: health needs no token; presence is gated behind the token', () => withServer(async (api, port) => {
  const r = await req(port, 'GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, version: '9.9.9' }); // no `present` for an unauthenticated caller
  const authed = await req(port, 'GET', '/health', { token: 'secret-token' });
  assert.deepEqual(authed.json, { ok: true, version: '9.9.9', present: true });
}));

test('API: requests without a valid token are 401', () => withServer(async (api, port) => {
  assert.equal((await req(port, 'POST', '/notify', { body: { type: 'info', message: 'x' } })).status, 401);
  assert.equal((await req(port, 'POST', '/notify', { token: 'wrong', body: { type: 'info', message: 'x' } })).status, 401);
}));

test('API: POST info queues and dispatches notification:show', () => withServer(async (api, port, dispatched) => {
  const r = await req(port, 'POST', '/notify', { token: 'secret-token', body: { type: 'info', kind: 'meeting', message: 'Standup in 5' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'queued');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].message, 'Standup in 5');
  assert.equal(dispatched[0].side, 'right');
}));

test('API: POST action → dispatch → resolve → GET returns the chosen result', () => withServer(async (api, port) => {
  const r = await req(port, 'POST', '/notify', { token: 'secret-token', body: {
    type: 'action', message: 'Reply to Sam?', actions: [{ label: 'Draft', result: 'draft' }],
  } });
  const { id } = r.json;
  api.resolve(id, 'draft'); // simulates the button click coming back over IPC
  const got = await req(port, 'GET', `/notify/${id}`, { token: 'secret-token' });
  assert.equal(got.json.status, 'answered');
  assert.equal(got.json.reply.result, 'draft');
}));

test('API: DELETE cancels to dismissed; unknown id is 404', () => withServer(async (api, port) => {
  const { json } = await req(port, 'POST', '/notify', { token: 'secret-token', body: { type: 'info', message: 'x' } });
  const del = await req(port, 'DELETE', `/notify/${json.id}`, { token: 'secret-token' });
  assert.equal(del.json.status, 'dismissed');
  assert.equal((await req(port, 'DELETE', '/notify/nope', { token: 'secret-token' })).status, 404);
}));

test('API: an info never stalls a following action in the overlay slot', () => withServer(async (api, port, dispatched) => {
  await req(port, 'POST', '/notify', { token: 'secret-token', body: { type: 'info', message: 'fyi' } });
  await req(port, 'POST', '/notify', { token: 'secret-token', body: {
    type: 'action', message: 'act', actions: [{ label: 'Y', result: 'y' }],
  } });
  assert.deepEqual(dispatched.map((d) => d.type), ['info', 'action']); // both shown
}));

test('API: a notification fired while the overlay is busy is queued, then rendered — never dropped', async () => {
  // dispatch refuses (falsy) while `busy`, mirroring dispatchNotification bailing when
  // a water reminder is on-screen; flips to accepting once the overlay frees up.
  let busy = true;
  const dispatched = [];
  const api = startNotifyApi({
    config: { apiPort: await freePort(), apiToken: 'secret-token' },
    version: '9.9.9',
    dispatch: (p) => { if (busy) return false; dispatched.push(p); return true; },
    presence: () => true,
    log: () => {},
  });
  await new Promise((res) => api.server.once('listening', res));
  try {
    const port = api.port();
    // Overlay busy: POST is accepted but the item can't render yet.
    const posted = await req(port, 'POST', '/notify', { token: 'secret-token', body: { type: 'info', message: 'a' } });
    assert.equal(posted.status, 201);
    let got = await req(port, 'GET', `/notify/${posted.json.id}`, { token: 'secret-token' });
    assert.equal(got.json.status, 'queued');   // NOT marked shown — deferred until it renders
    assert.equal(dispatched.length, 0);        // and not lost

    // Overlay frees; a second POST re-pumps the FIFO and both render in order.
    busy = false;
    await req(port, 'POST', '/notify', { token: 'secret-token', body: { type: 'info', message: 'b' } });
    assert.deepEqual(dispatched.map((d) => d.message), ['a', 'b']); // 'a' retried, not dropped
    got = await req(port, 'GET', `/notify/${posted.json.id}`, { token: 'secret-token' });
    assert.equal(got.json.status, 'shown');
  } finally { api.close(); }
});
