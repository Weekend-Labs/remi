const test = require('node:test');
const assert = require('node:assert');
const { rollover, shouldRemind, markShown, applyAction } = require('../src/reminder');

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

test('outside work hours → no reminder', () => {
  const at8am = new Date(2026, 6, 7, 8, 0, 0).getTime();
  assert.equal(shouldRemind(at8am, base, config), false);
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
