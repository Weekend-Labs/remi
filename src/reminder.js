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

// New calendar day → archive the finishing day into history, then reset the counter.
function rollover(state, now) {
  const t = todayStr(now);
  if (state.date === t) return state;
  const history = { ...(state.history || {}) };
  history[state.date] = { had: state.glassesHad, goal: state.goal };
  return { ...state, history, date: t, glassesHad: 0, snoozeUntil: null };
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
    // Mirror today's count into history so streak/calendar read one source of truth.
    s.history = { ...(state.history || {}), [todayStr(now)]: { had: s.glassesHad, goal: s.goal } };
  } else if (action === 'snooze') {
    s.snoozeUntil = now + config.snoozeMinutes * 60 * 1000;
  }
  return s;
}

// Previous calendar day as "YYYY-MM-DD". UTC math so DST never shifts the date.
function prevDayStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

// Consecutive goal-met days ending today. Today counts only if already met;
// a not-yet-met today doesn't count but doesn't break the streak (still drinkable).
// Any earlier day below its goal — or absent — ends the run. Each day judged by
// its own stored goal, falling back to `goal` when a record lacks one.
function streak(history, today, goal) {
  let count = 0;
  let day = today;
  let first = true;
  while (true) {
    const rec = history[day];
    const met = rec && rec.had >= (rec.goal != null ? rec.goal : goal);
    if (met) count++;
    else if (!first) break; // a missed/absent past day ends the streak
    first = false;
    day = prevDayStr(day);
  }
  return count;
}

module.exports = {
  todayStr, isWithinWorkHours, rollover, shouldRemind, markShown, applyAction, streak,
};
