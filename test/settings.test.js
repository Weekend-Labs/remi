const test = require('node:test');
const assert = require('node:assert');
const { isValidConfig } = require('../src/state');

const good = {
  intervalMinutes: 60,
  workHours: { start: '09:00', end: '18:00' },
  snoozeMinutes: 15,
  goal: 8,
};

test('valid config passes', () => {
  assert.equal(isValidConfig(good), true);
});

test('interval at the 1m floor is allowed', () => {
  assert.equal(isValidConfig({ ...good, intervalMinutes: 1 }), true);
});

test('interval below 1m is rejected', () => {
  assert.equal(isValidConfig({ ...good, intervalMinutes: 0 }), false);
});

test('end must be after start', () => {
  assert.equal(isValidConfig({ ...good, workHours: { start: '18:00', end: '09:00' } }), false);
  assert.equal(isValidConfig({ ...good, workHours: { start: '09:00', end: '09:00' } }), false);
});

test('malformed time string is rejected', () => {
  assert.equal(isValidConfig({ ...good, workHours: { start: 'nope', end: '18:00' } }), false);
});
