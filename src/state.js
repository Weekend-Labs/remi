// Load/save state + config as JSON under the app's userData dir. No database.
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  intervalMinutes: 60,
  workHours: { start: '09:00', end: '18:00' },
  snoozeMinutes: 15,
  autoDismissSeconds: 30,
  goal: 8,
};

function defaultState(now, goal) {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${m}-${day}`,
    glassesHad: 0,
    goal,
    snoozeUntil: null,
    lastShownAt: 0,
    paused: false,
  };
}

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return fallback; // missing/corrupt → defaults
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function load(dir, now) {
  const config = readJson(path.join(dir, 'config.json'), DEFAULT_CONFIG);
  const state = readJson(path.join(dir, 'state.json'), defaultState(now, config.goal));
  return { config, state };
}

function saveState(dir, state) {
  writeJson(path.join(dir, 'state.json'), state);
}

module.exports = { load, saveState, DEFAULT_CONFIG };
