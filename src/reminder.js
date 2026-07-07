// Pure reminder logic — no Electron, no I/O. This is the testable core.
// All times are epoch millis; Date is only used to read local wall-clock fields.

function todayStr(now) {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseHM(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function minutesOfDay(now) {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

function isWithinWorkHours(now, config) {
  const mo = minutesOfDay(now);
  return mo >= parseHM(config.workHours.start) && mo < parseHM(config.workHours.end);
}

// New calendar day → reset the daily counter.
function rollover(state, now) {
  const t = todayStr(now);
  if (state.date !== t) return { ...state, date: t, glassesHad: 0, snoozeUntil: null };
  return state;
}

// Should the buddy appear right now?
// Snooze takes precedence over the interval: a pending snooze fires exactly when it elapses.
function shouldRemind(now, state, config) {
  if (state.paused) return false;
  if (!isWithinWorkHours(now, config)) return false;
  if (state.snoozeUntil) return now >= state.snoozeUntil;
  return now - (state.lastShownAt || 0) >= config.intervalMinutes * 60 * 1000;
}

// Called when the buddy is shown: consume any pending snooze, restart the interval.
function markShown(state, now) {
  return { ...state, lastShownAt: now, snoozeUntil: null };
}

// Apply the user's choice.
function applyAction(state, action, now, config) {
  const s = { ...state, lastShownAt: now };
  if (action === 'had-it') {
    s.glassesHad = state.glassesHad + 1;
    s.snoozeUntil = null;
  } else if (action === 'snooze') {
    s.snoozeUntil = now + config.snoozeMinutes * 60 * 1000;
  }
  return s;
}

module.exports = {
  todayStr, isWithinWorkHours, rollover, shouldRemind, markShown, applyAction,
};
