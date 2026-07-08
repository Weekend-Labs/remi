// Pure notification logic — no HTTP, no Electron, no I/O. The testable core of F001.
// Holds: request validation, the FIFO queue, and lifecycle/ttl transitions.
// Times are epoch millis; callers pass `now` so nothing here reads the clock.

const TTL_DEFAULTS = { info: 30, action: 120 }; // seconds
const MAX_ACTIONS = 2;                          // the overlay has two buttons

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Validate + normalize a POST /notify body. Throws HttpError(400) on bad input.
function validate(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be a JSON object');
  const { type } = body;
  if (type !== 'info' && type !== 'action') throw new HttpError(400, "type must be 'info' or 'action'");
  if (typeof body.message !== 'string' || !body.message.trim()) throw new HttpError(400, 'message is required');

  let actions = [];
  if (type === 'action') {
    if (!Array.isArray(body.actions) || body.actions.length === 0)
      throw new HttpError(400, 'action notifications require a non-empty actions[]');
    if (body.actions.length > MAX_ACTIONS)
      throw new HttpError(400, `at most ${MAX_ACTIONS} actions (the overlay has two buttons)`);
    actions = body.actions.map((a) => {
      if (!a || typeof a.label !== 'string' || typeof a.result !== 'string')
        throw new HttpError(400, 'each action needs a string {label, result}');
      return { label: a.label, result: a.result };
    });
  }

  const ttl = Number.isFinite(body.ttl) && body.ttl > 0 ? body.ttl : TTL_DEFAULTS[type];
  const priority = body.priority === 'low' || body.priority === 'high' ? body.priority : 'normal';
  return {
    type,
    kind: typeof body.kind === 'string' ? body.kind : null,
    message: body.message,
    detail: typeof body.detail === 'string' ? body.detail : null,
    actions,
    ttl,
    priority,
  };
}

const LIVE = new Set(['queued', 'shown']); // non-terminal states

// In-memory FIFO queue with lifecycle transitions. Insertion order == FIFO order.
function createQueue() {
  const items = new Map();
  let seq = 0;

  const publicView = (n) => n && ({ id: n.id, status: n.status, reply: n.reply });

  return {
    add(fields, now) {
      const id = `n_${++seq}`;
      const n = {
        id, ...fields, status: 'queued', reply: null,
        createdAt: now, expiresAt: now + fields.ttl * 1000,
      };
      items.set(id, n);
      return n;
    },

    get(id) { return items.get(id) || null; },
    list() { return [...items.values()]; },

    // Oldest still-queued notification, or null. FIFO dispatch order.
    nextQueued() {
      for (const n of items.values()) if (n.status === 'queued') return n;
      return null;
    },

    markShown(id, now) {
      const n = items.get(id);
      if (!n || n.status !== 'queued') return null;
      n.status = 'shown'; n.shownAt = now;
      return n;
    },

    // A reply arrived (button click) → answered. Ignored once terminal.
    resolve(id, result, now) {
      const n = items.get(id);
      if (!n || !LIVE.has(n.status)) return null;
      n.status = 'answered';
      n.reply = { result, at: Math.floor(now / 1000) };
      return n;
    },

    // DELETE /notify/:id → dismissed. Ignored once terminal.
    cancel(id, now) {
      const n = items.get(id);
      if (!n || !LIVE.has(n.status)) return null;
      n.status = 'dismissed'; n.reply = { result: 'dismissed', at: Math.floor(now / 1000) };
      return n;
    },

    // Expire every live notification past its ttl. Returns the expired ids.
    sweep(now) {
      const expired = [];
      for (const n of items.values()) {
        if (LIVE.has(n.status) && now >= n.expiresAt) { n.status = 'expired'; expired.push(n.id); }
      }
      return expired;
    },
  };
}

module.exports = { validate, createQueue, HttpError, TTL_DEFAULTS, MAX_ACTIONS };
