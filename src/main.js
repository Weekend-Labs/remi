const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const { load, saveState, saveConfig, isValidConfig } = require('./state');
const { rollover, shouldRemind, markShown, applyAction, streak, todayStr } = require('./reminder');

const WIN_W = 380;
const WIN_H = 420;

// Settings menu presets (each hours window is inherently valid: end > start).
const INTERVAL_PRESETS = [30, 45, 60, 90];
const HOURS_PRESETS = [
  { start: '08:00', end: '16:00' },
  { start: '09:00', end: '17:00' },
  { start: '09:00', end: '18:00' },
  { start: '10:00', end: '19:00' },
];
const GOAL_PRESETS = [6, 8, 10, 12];
const SNOOZE_PRESETS = [10, 15, 30];

let overlayWin;
let calendarWin;
let tray;
let config;
let state;
let loopTimer;

function dataDir() {
  return path.join(app.getPath('userData'));
}

function persist() {
  saveState(dataDir(), state);
  updateTray();
}

// Bottom-right corner of the display the cursor is currently on — so on
// multi-monitor setups the buddy walks in from the corner of the active screen,
// not mid-screen. Recomputed on every show (triggerReminder), not just at startup.
function anchorOverlay() {
  if (!overlayWin) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlayWin.setBounds({
    x: workArea.x + workArea.width - WIN_W,
    y: workArea.y + workArea.height - WIN_H,
    width: WIN_W,
    height: WIN_H,
  });
}

function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W,
    y: workArea.y + workArea.height - WIN_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // never steals focus from my work
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required', // reminder fires from a timer, not a click
    },
  });
  overlayWin.setAlwaysOnTop(true, 'floating');
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Progress calendar: a plain (framed, closable) window, separate from the overlay —
// opening it never touches overlayWin. Singleton: re-focus if already open.
function openCalendar() {
  if (calendarWin && !calendarWin.isDestroyed()) { calendarWin.focus(); return; }
  calendarWin = new BrowserWindow({
    width: 420,
    height: 500,
    title: 'Remi — Progress',
    resizable: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  calendarWin.loadFile(path.join(__dirname, 'renderer', 'calendar.html'));
  calendarWin.on('closed', () => { calendarWin = null; });
}

function triggerReminder() {
  if (!overlayWin || overlayWin.isVisible()) return;
  state = markShown(state, Date.now());
  persist();
  anchorOverlay(); // land in the corner of whichever display is active now
  overlayWin.setIgnoreMouseEvents(false); // water has buttons — must catch clicks (a prior peek may have set it true)
  overlayWin.showInactive();
  overlayWin.webContents.send('reminder:show', {
    glassesHad: state.glassesHad,
    goal: state.goal,
  });
}

// F001 info peek: buddy leans in from an edge, says one thing, retracts. No
// buttons → make the window click-through so it never intercepts clicks.
// The parallel API lane emits `notification:show`; this fires the same event
// for the demo/tray trigger. Renderer ignores type:'action' (that's the API lane's).
function triggerPeek(data = {}) {
  if (!overlayWin || overlayWin.isVisible()) return;
  anchorOverlay();
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.showInactive();
  overlayWin.webContents.send('notification:show', {
    id: data.id || `peek_${Date.now()}`,
    type: 'info',
    message: data.message || 'Standup in 5 minutes 🗣️',
    detail: data.detail || 'Daily sync — grab your coffee ☕',
    side: data.side || 'right',
  });
}

// Merge a config patch, persist, and apply live (no app restart).
// Presets are always valid; the guard catches a hand-corrupted config.json.
function applyConfig(patch) {
  const next = { ...config, ...patch };
  if (!isValidConfig(next)) return;
  config = next;
  if (patch.goal != null) state = { ...state, goal: patch.goal }; // reflect goal today
  saveConfig(dataDir(), config);
  persist();      // saves state + refreshes tray
  startLoop();    // restart interval loop so new settings take effect immediately
}

function settingsSubmenu() {
  const hoursLabel = (h) => `${h.start}–${h.end}`;
  return [
    {
      label: 'Interval',
      submenu: INTERVAL_PRESETS.map((m) => ({
        label: `${m} min`, type: 'radio', checked: config.intervalMinutes === m,
        click: () => applyConfig({ intervalMinutes: m }),
      })),
    },
    {
      label: 'Work hours',
      submenu: HOURS_PRESETS.map((h) => ({
        label: hoursLabel(h), type: 'radio',
        checked: config.workHours.start === h.start && config.workHours.end === h.end,
        click: () => applyConfig({ workHours: { ...h } }),
      })),
    },
    {
      label: 'Daily goal',
      submenu: GOAL_PRESETS.map((g) => ({
        label: `${g} glasses`, type: 'radio', checked: config.goal === g,
        click: () => applyConfig({ goal: g }),
      })),
    },
    {
      label: 'Snooze',
      submenu: SNOOZE_PRESETS.map((m) => ({
        label: `${m} min`, type: 'radio', checked: config.snoozeMinutes === m,
        click: () => applyConfig({ snoozeMinutes: m }),
      })),
    },
  ];
}

function updateTray() {
  if (!tray) return;
  const s = streak(state.history || {}, todayStr(Date.now()), state.goal);
  tray.setTitle(` 💧 ${state.glassesHad}/${state.goal}${s > 0 ? ` · 🔥${s}` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Today: ${state.glassesHad}/${state.goal} glasses`, enabled: false },
    { label: `Every ${config.intervalMinutes}m · ${config.workHours.start}–${config.workHours.end}`, enabled: false },
    { type: 'separator' },
    { label: 'Remind now', click: triggerReminder },
    { label: 'Test peek 👀', click: () => triggerPeek() },
    { label: 'View progress', click: openCalendar },
    {
      label: state.paused ? 'Resume reminders' : 'Pause reminders',
      click: () => { state = { ...state, paused: !state.paused }; persist(); },
    },
    { label: 'Settings', submenu: settingsSubmenu() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty()); // title-only menu-bar item, no icon asset
  updateTray();
}

function startLoop() {
  clearInterval(loopTimer); // idempotent: applyConfig() calls this to restart live
  loopTimer = setInterval(() => {
    const now = Date.now();
    const rolled = rollover(state, now);
    if (rolled !== state) { state = rolled; persist(); }
    if (shouldRemind(now, state, config) && !overlayWin.isVisible()) triggerReminder();
  }, 30_000);
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // menu-bar app, keep out of the dock
  ({ config, state } = load(dataDir(), Date.now()));
  state = rollover(state, Date.now());
  persist();
  createOverlay();
  createTray();
  startLoop();
  // `npm run demo` → buddy walks in on launch so you can see the overlay without waiting
  if (process.env.RB_DEMO) setTimeout(triggerReminder, 2500);
  // `RB_PEEK=1 electron .` → fire a sample info peek on launch (testable without the API)
  if (process.env.RB_PEEK) setTimeout(() => triggerPeek({ side: process.env.RB_PEEK_SIDE }), 2500);
});

ipcMain.on('reminder:action', (_e, action) => {
  const before = state.glassesHad;
  state = applyAction(state, action, Date.now(), config);
  persist();
  // Fire the streak celebration exactly once: the glass that first hits today's goal.
  if (action === 'had-it' && before < state.goal && state.glassesHad >= state.goal) {
    const s = streak(state.history || {}, todayStr(Date.now()), state.goal);
    overlayWin?.webContents.send('reminder:celebrate', { streak: s });
  }
});

ipcMain.on('reminder:hide', () => {
  if (overlayWin) overlayWin.hide();
});

// Calendar window pulls the per-day history map to tint the month grid.
ipcMain.handle('history:get', () => state.history || {});

// Tray app: don't quit when the (hidden) overlay window closes.
app.on('window-all-closed', () => {});
