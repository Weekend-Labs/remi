// Loopback HTTP API for F001. Node's built-in http only (no new deps).
// Binds 127.0.0.1 ONLY. Bearer-token auth. Owns the queue + ttl sweep + dispatch
// gating; Electron wiring (IPC, overlay) is injected via `dispatch`/`presence` so
// this module stays testable without Electron.

const http = require('http');
const { validate, createQueue, HttpError } = require('./notify');

const MAX_BODY = 64 * 1024;        // reject oversized bodies (runaway producer guard)
const RATE_WINDOW_MS = 10_000;     // ponytail: naive fixed-window rate limit; swap for a
const RATE_MAX = 30;               // token bucket only if a real producer needs bursts

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function startNotifyApi({ config, version = '0.0.0', dispatch, presence = () => true, log = console.log }) {
  const port = Number(config.apiPort) || 7777;
  const token = config.apiToken;
  const queue = createQueue();
  let active = null;      // id holding the overlay (an action awaiting a reply)
  const hits = [];        // POST /notify timestamps for the rate limiter

  // Pump the FIFO: show queued notifications until an action grabs the slot.
  // info is fire-and-forget — it never holds the overlay, so actions don't stall behind it.
  function pump() {
    if (active) return;
    let n;
    while ((n = queue.nextQueued())) {
      queue.markShown(n.id, Date.now());
      dispatch({
        id: n.id, type: n.type, kind: n.kind, message: n.message,
        detail: n.detail, actions: n.actions, side: 'right',
      });
      if (n.type === 'action') { active = n.id; return; }
    }
  }

  function clearIf(id) { if (active === id) { active = null; pump(); } }

  // Called by main when a reply/dismiss comes back over IPC.
  function resolve(id, result) { const n = queue.resolve(id, result, Date.now()); if (n) clearIf(id); return n; }
  function cancel(id) { const n = queue.cancel(id, Date.now()); if (n) clearIf(id); return n; }

  const sweep = setInterval(() => {
    for (const id of queue.sweep(Date.now())) clearIf(id);
  }, 1000);
  if (sweep.unref) sweep.unref(); // don't keep the process alive on its own

  function rateLimited(now) {
    while (hits.length && now - hits[0] > RATE_WINDOW_MS) hits.shift();
    if (hits.length >= RATE_MAX) return true;
    hits.push(now);
    return false;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean); // ['notify', ':id']

    if (parts[0] === 'health' && req.method === 'GET') {
      return send(res, 200, { ok: true, version, present: !!presence() });
    }

    // Everything else requires the bearer token.
    // ponytail: direct compare — loopback-only, the token IS the secret; a timing
    // side-channel over 127.0.0.1 isn't a realistic vector.
    if (req.headers['authorization'] !== `Bearer ${token}`) {
      return send(res, 401, { error: 'missing or invalid bearer token' });
    }

    if (parts[0] === 'notify' && parts.length === 1) {
      if (req.method === 'POST') {
        if (rateLimited(Date.now())) return send(res, 429, { error: 'rate limit exceeded' });
        const fields = validate(await readBody(req));
        const n = queue.add(fields, Date.now());
        send(res, 201, { id: n.id, status: 'queued' }); // respond before pump() mutates status
        return pump();
      }
      if (req.method === 'GET') {
        return send(res, 200, queue.list().map((n) => ({ id: n.id, type: n.type, kind: n.kind, status: n.status })));
      }
    }

    if (parts[0] === 'notify' && parts.length === 2) {
      const id = parts[1];
      if (req.method === 'GET') {
        const n = queue.get(id);
        if (!n) return send(res, 404, { error: 'not found' });
        return send(res, 200, { id: n.id, status: n.status, reply: n.reply });
      }
      if (req.method === 'DELETE') {
        const n = cancel(id);
        if (!n) return send(res, 404, { error: 'not found or already resolved' });
        return send(res, 200, { id: n.id, status: n.status });
      }
    }

    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res)
      .catch((err) => {
        const status = err instanceof HttpError ? err.status : 500;
        send(res, status, { error: err.message || 'internal error' });
      })
      // Drain any unread request body (e.g. a 401 that never called readBody) so the
      // socket closes cleanly instead of resetting the client → avoids ECONNRESET.
      .finally(() => { if (!req.readableEnded) req.resume(); });
  });

  // 127.0.0.1 ONLY — never 0.0.0.0, per F001 §8.
  server.listen(port, '127.0.0.1', () => {
    log(`[remi] notification API on http://127.0.0.1:${server.address().port}`);
  });

  return {
    server, queue, resolve, cancel,
    port: () => server.address() && server.address().port,
    close: () => { clearInterval(sweep); server.close(); },
  };
}

module.exports = { startNotifyApi };
