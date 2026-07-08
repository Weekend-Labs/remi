const test = require('node:test');
const assert = require('node:assert');
const { rollover, shouldRemind, markShown, applyAction, streak } = require('../src/reminder');
const { monthGrid, dayLevel, dayCount } = require('../src/calendar-grid');

const config = {
  intervalMinutes: 60,
  workHours: { start: '09:00', end: '18:00' },
  snoozeMinutes: 15,
};
const MIN = 60 * 1000;
// a fixed "now" at 12:00 local on some day
const noon = new Date(2026, 6, 7, 12, 0, 0).getTime();
const base = { date: '2026-07-07', glassesHad: 3, goal: 8, snoozeUntil: null, lastShownAt: 0, paused: false };

test('paused → never reminds', () => {
  assert.equal(shouldRemind(noon, { ...base, paused: true }, config), false);
});

test('work hours ignored → reminds outside the old window', () => {
  // Work-hours gating is bypassed: interval-elapsed reminders fire at any hour.
  const at8am = new Date(2026, 6, 7, 8, 0, 0).getTime();   // before old 09:00 start
  const at10pm = new Date(2026, 6, 7, 22, 0, 0).getTime(); // after old 18:00 end
  assert.equal(shouldRemind(at8am, { ...base, lastShownAt: at8am - 61 * MIN }, config), true);
  assert.equal(shouldRemind(at10pm, { ...base, lastShownAt: at10pm - 61 * MIN }, config), true);
});

test('interval elapsed in work hours → reminds', () => {
  assert.equal(shouldRemind(noon, { ...base, lastShownAt: noon - 61 * MIN }, config), true);
});

test('interval not elapsed → no reminder', () => {
  assert.equal(shouldRemind(noon, { ...base, lastShownAt: noon - 30 * MIN }, config), false);
});

test('pending snooze in the future → waits', () => {
  assert.equal(shouldRemind(noon, { ...base, snoozeUntil: noon + 5 * MIN }, config), false);
});

test('snooze elapsed → reminds even if interval has not', () => {
  const s = { ...base, lastShownAt: noon - 5 * MIN, snoozeUntil: noon - 1 };
  assert.equal(shouldRemind(noon, s, config), true);
});

test('markShown consumes snooze and restarts interval', () => {
  const s = markShown({ ...base, snoozeUntil: noon + 5 * MIN }, noon);
  assert.equal(s.snoozeUntil, null);
  assert.equal(s.lastShownAt, noon);
});

test('had-it increments and clears snooze', () => {
  const s = applyAction({ ...base, snoozeUntil: noon }, 'had-it', noon, config);
  assert.equal(s.glassesHad, 4);
  assert.equal(s.snoozeUntil, null);
});

test('snooze sets snoozeUntil 15m out', () => {
  const s = applyAction(base, 'snooze', noon, config);
  assert.equal(s.snoozeUntil, noon + 15 * MIN);
  assert.equal(s.glassesHad, 3);
});

test('rollover resets counter on a new day', () => {
  const nextDay = new Date(2026, 6, 8, 9, 0, 0).getTime();
  const s = rollover({ ...base, glassesHad: 7 }, nextDay);
  assert.equal(s.date, '2026-07-08');
  assert.equal(s.glassesHad, 0);
});

test('rollover leaves same-day state untouched', () => {
  assert.equal(rollover(base, noon), base);
});

// --- Lane #0: daily history ---

test('rollover writes the finishing day into history before resetting', () => {
  const nextDay = new Date(2026, 6, 8, 9, 0, 0).getTime();
  const s = rollover({ ...base, glassesHad: 5, goal: 8 }, nextDay);
  assert.deepEqual(s.history['2026-07-07'], { had: 5, goal: 8 });
  assert.equal(s.glassesHad, 0);
  assert.equal(s.date, '2026-07-08');
});

test('rollover retains prior days across multiple date changes', () => {
  let s = { ...base, date: '2026-07-07', glassesHad: 6, goal: 8, history: {} };
  s = rollover(s, new Date(2026, 6, 8, 9, 0, 0).getTime()); // finish 07-07
  s = { ...s, glassesHad: 4 };
  s = rollover(s, new Date(2026, 6, 9, 9, 0, 0).getTime()); // finish 07-08
  assert.deepEqual(s.history['2026-07-07'], { had: 6, goal: 8 });
  assert.deepEqual(s.history['2026-07-08'], { had: 4, goal: 8 });
});

test('rollover with no history starts a fresh map', () => {
  const { history, ...noHistory } = { ...base, glassesHad: 2 };
  const s = rollover(noHistory, new Date(2026, 6, 8, 9, 0, 0).getTime());
  assert.deepEqual(s.history, { '2026-07-07': { had: 2, goal: 8 } });
});

test('had-it mirrors the new count into history[today]', () => {
  const s = applyAction({ ...base, glassesHad: 3, history: {} }, 'had-it', noon, config);
  assert.equal(s.glassesHad, 4);
  assert.deepEqual(s.history['2026-07-07'], { had: 4, goal: 8 });
});

test('had-it carries the current goal into history', () => {
  const s = applyAction({ ...base, glassesHad: 0, goal: 10, history: {} }, 'had-it', noon, config);
  assert.equal(s.history['2026-07-07'].goal, 10);
});

test('applyAction on state without history does not lose today count', () => {
  const { history, ...noHistory } = { ...base, glassesHad: 1 };
  const s = applyAction(noHistory, 'had-it', noon, config);
  assert.equal(s.glassesHad, 2);
  assert.deepEqual(s.history['2026-07-07'], { had: 2, goal: 8 });
});

// --- Lane #1: streak days ---

test('streak of empty history is 0', () => {
  assert.equal(streak({}, '2026-07-07', 8), 0);
});

test('streak counts consecutive goal-met days ending today', () => {
  const history = {
    '2026-07-05': { had: 8, goal: 8 },
    '2026-07-06': { had: 9, goal: 8 },
    '2026-07-07': { had: 8, goal: 8 },
  };
  assert.equal(streak(history, '2026-07-07', 8), 3);
});

test('streak includes today only when today met', () => {
  const history = {
    '2026-07-06': { had: 8, goal: 8 },
    '2026-07-07': { had: 2, goal: 8 }, // today not yet met
  };
  assert.equal(streak(history, '2026-07-07', 8), 1); // counts yesterday, not today
});

test('today-not-yet-met with no prior days is 0', () => {
  const history = { '2026-07-07': { had: 2, goal: 8 } };
  assert.equal(streak(history, '2026-07-07', 8), 0);
});

test('a gap (missed day) resets the streak', () => {
  const history = {
    '2026-07-04': { had: 8, goal: 8 },
    '2026-07-05': { had: 3, goal: 8 }, // missed
    '2026-07-06': { had: 8, goal: 8 },
    '2026-07-07': { had: 8, goal: 8 },
  };
  assert.equal(streak(history, '2026-07-07', 8), 2); // only 07-06 + 07-07
});

test('a calendar-day gap (absent record) resets the streak', () => {
  const history = {
    '2026-07-05': { had: 8, goal: 8 },
    // 07-06 absent entirely
    '2026-07-07': { had: 8, goal: 8 },
  };
  assert.equal(streak(history, '2026-07-07', 8), 1);
});

test('streak uses each day’s own goal', () => {
  const history = {
    '2026-07-06': { had: 6, goal: 6 }, // met that day’s goal of 6
    '2026-07-07': { had: 8, goal: 8 },
  };
  assert.equal(streak(history, '2026-07-07', 8), 2);
});

test('streak crosses a month boundary', () => {
  const history = {
    '2026-06-30': { had: 8, goal: 8 },
    '2026-07-01': { had: 8, goal: 8 },
  };
  assert.equal(streak(history, '2026-07-01', 8), 2);
});

// --- Lane #2: calendar grid ---

test('monthGrid pads leading blanks to the 1st weekday', () => {
  // July 2026: the 1st is a Wednesday (weekday 3) → 3 leading nulls.
  const cells = monthGrid(2026, 6);
  assert.equal(cells[0], null);
  assert.equal(cells[3].day, 1);
  assert.equal(cells[3].date, '2026-07-01');
});

test('monthGrid covers every day of the month with zero-padded dates', () => {
  const cells = monthGrid(2026, 6).filter(Boolean); // July has 31 days
  assert.equal(cells.length, 31);
  assert.equal(cells[30].date, '2026-07-31');
});

test('monthGrid handles February in a leap year', () => {
  const days = monthGrid(2024, 1).filter(Boolean);  // Feb 2024 = 29 days
  assert.equal(days.length, 29);
  assert.equal(days[28].date, '2024-02-29');
});

test('dayLevel: none / partial / full', () => {
  assert.equal(dayLevel(undefined), 'none');
  assert.equal(dayLevel({ had: 0, goal: 8 }), 'none');
  assert.equal(dayLevel({ had: 3, goal: 8 }), 'partial');
  assert.equal(dayLevel({ had: 8, goal: 8 }), 'full');
  assert.equal(dayLevel({ had: 9, goal: 8 }), 'full');
});

test('dayCount: had/goal for days with water, null for empty days', () => {
  assert.equal(dayCount(undefined), null);           // no data → clean cell
  assert.equal(dayCount({ had: 0, goal: 8 }), null); // drank nothing → no "0/8"
  assert.equal(dayCount({ had: 3, goal: 8 }), '3/8');
  assert.equal(dayCount({ had: 8, goal: 8 }), '8/8');
  assert.equal(dayCount({ had: 5 }), '5');           // no stored goal → just the count
});
