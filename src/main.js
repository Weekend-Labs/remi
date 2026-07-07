const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const { load, saveState } = require('./state');
const { rollover, shouldRemind, markShown, applyAction } = require('./reminder');

const WIN_W = 380;
const WIN_H = 420;

let overlayWin;
let tray;
let config;
let state;

function dataDir() {
  return path.join(app.getPath('userData'));
}

function persist() {
  saveState(dataDir(), state);
  updateTray();
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

function triggerReminder() {
  if (!overlayWin || overlayWin.isVisible()) return;
  state = markShown(state, Date.now());
  persist();
  overlayWin.showInactive();
  overlayWin.webContents.send('reminder:show', {
    glassesHad: state.glassesHad,
    goal: state.goal,
  });
}

function updateTray() {
  if (!tray) return;
  tray.setTitle(` 💧 ${state.glassesHad}/${state.goal}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Today: ${state.glassesHad}/${state.goal} glasses`, enabled: false },
    { type: 'separator' },
    { label: 'Remind now', click: triggerReminder },
    {
      label: state.paused ? 'Resume reminders' : 'Pause reminders',
      click: () => { state = { ...state, paused: !state.paused }; persist(); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty()); // title-only menu-bar item, no icon asset
  updateTray();
}

function startLoop() {
  setInterval(() => {
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
});

ipcMain.on('reminder:action', (_e, action) => {
  state = applyAction(state, action, Date.now(), config);
  persist();
});

ipcMain.on('reminder:hide', () => {
  if (overlayWin) overlayWin.hide();
});

// Tray app: don't quit when the (hidden) overlay window closes.
app.on('window-all-closed', () => {});
