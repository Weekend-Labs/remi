// Sequences the buddy: walk in (stepping) → arrive (front idle + bubble) → walk out.
// Driven by Electron via window.buddy; also exposes showReminder on window for browser testing.
const AUTO_DISMISS_MS = 30_000;
const WALK_IN_MS = 2200;   // stepping across into view
const WALK_OUT_MS = 1600;

const scene = document.getElementById('scene');
const walker = document.getElementById('walker');
const avatar = document.getElementById('avatar');
const bubble = document.getElementById('bubble');
const msg = document.getElementById('msg');
const count = document.getElementById('count');
const REACT_MS = 1400; // how long the reaction shows before he leaves
let dismissTimer, arriveTimer, outTimer, reactTimer;

function clearTimers() {
  clearTimeout(dismissTimer); clearTimeout(arriveTimer);
  clearTimeout(outTimer); clearTimeout(reactTimer);
}

// Light two-note chime on walk-in — synthesized, no audio file needed.
let audioCtx;
function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    for (const [freq, t] of [[523.25, 0], [783.99, 0.11]]) { // C5 → G5, gentle
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(0.05, now + t + 0.02); // soft
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.4);
    }
  } catch { /* audio is optional; never block the reminder */ }
}

function showReminder(data = {}) {
  const { glassesHad = 0, goal = 8 } = data;
  msg.textContent = 'Time for water 💧';
  count.textContent = `${glassesHad}/${goal} today`;
  bubble.classList.remove('happy', 'meh');
  avatar.classList.remove('cheer', 'sad');
  document.getElementById('actions').style.pointerEvents = ''; // clear the guard from a prior reaction
  clearTimers();
  playChime(); // light sound as he walks in
  // entry state: off-screen right, walker stepping, bubble/buttons hidden
  scene.classList.remove('show');
  avatar.style.display = 'none';
  walker.classList.remove('flip');
  walker.classList.add('stepping');
  walker.style.display = 'block';
  scene.style.transition = 'none';
  scene.style.transform = 'translateX(160%)';
  void scene.offsetWidth; // reflow so the walk-in replays
  scene.style.transition = `transform ${WALK_IN_MS}ms linear`; // constant walking speed
  requestAnimationFrame(() => { scene.style.transform = 'translateX(0)'; });
  arriveTimer = setTimeout(arrive, WALK_IN_MS);
}

function arrive() {
  walker.classList.remove('stepping');
  walker.style.display = 'none';
  avatar.style.display = 'block'; // inline set (overrides the none from showReminder)
  scene.classList.add('show');    // fades in bubble + buttons, starts idle bob
  dismissTimer = setTimeout(() => choose('snooze'), AUTO_DISMISS_MS);
}

function choose(action) {
  clearTimers();
  window.buddy?.action(action);
  react(action);
}

// Show a reaction (message + little animation) in place, then walk out.
function react(action) {
  const had = action === 'had-it';
  msg.textContent = had ? 'Wohooo!! 🎉' : 'Not good 😕';
  count.textContent = '';
  bubble.classList.add(had ? 'happy' : 'meh');
  document.getElementById('actions').style.pointerEvents = 'none'; // no double-click
  avatar.classList.add(had ? 'cheer' : 'sad');
  reactTimer = setTimeout(walkOut, REACT_MS);
}

function walkOut() {
  clearTimers();
  scene.classList.remove('show');       // hide bubble + buttons + idle
  avatar.style.display = 'none';
  walker.classList.add('flip', 'stepping'); // face right, step away
  walker.style.display = 'block';
  scene.style.transition = `transform ${WALK_OUT_MS}ms linear`;
  requestAnimationFrame(() => { scene.style.transform = 'translateX(160%)'; });
  outTimer = setTimeout(() => window.buddy?.hide(), WALK_OUT_MS);
}

document.getElementById('had').addEventListener('click', () => choose('had-it'));
document.getElementById('snz').addEventListener('click', () => choose('snooze'));

// Main fires this once, right after "Had it" first reaches today's goal. It lands
// during the happy reaction and swaps the bubble text for the streak cheer.
function celebrate(data = {}) {
  const n = data.streak || 0;
  if (n <= 0) return;
  msg.textContent = `🔥 ${n}-day streak!`;
  count.textContent = '';
}

// ── PEEK (info notification) ──────────────────────────────────────────────
// Separate path from the water walk-in: the buddy leans in from a screen edge,
// says one thing, and retracts. No buttons, auto-dismisses. Swap the art by
// changing PEEK_SPRITE; tilt/clip are CSS vars on #peek (see index.html).
const PEEK_SPRITE = 'buddy-hold.png'; // richer mood/pose sheets drop in here later
const PEEK_HOLD_MS = 4500;            // peek in → hold → retract
const PEEK_OUT_MS = 500;              // matches #peekBuddy transition
const peek = document.getElementById('peek');
const peekBuddy = document.getElementById('peekBuddy');
const peekMsg = document.getElementById('peekMsg');
const peekDetail = document.getElementById('peekDetail');
let peekHoldTimer, peekOutTimer;

function showPeek(data = {}) {
  const { message = '', detail = '', side = 'right' } = data;
  clearTimeout(peekHoldTimer); clearTimeout(peekOutTimer);
  peekMsg.textContent = message;
  peekDetail.textContent = detail;
  peekDetail.style.display = detail ? '' : 'none';
  if (peekBuddy.getAttribute('src') !== PEEK_SPRITE) peekBuddy.src = PEEK_SPRITE;
  peek.classList.remove('show', 'left', 'right');
  peek.classList.add(side === 'left' ? 'left' : 'right');
  void peek.offsetWidth;              // reflow so the lean-in replays
  requestAnimationFrame(() => peek.classList.add('show'));
  peekHoldTimer = setTimeout(retractPeek, PEEK_HOLD_MS);
}

function retractPeek() {
  clearTimeout(peekHoldTimer);
  peek.classList.remove('show');     // slide + tilt back off the edge
  peekOutTimer = setTimeout(() => window.buddy?.hide(), PEEK_OUT_MS);
}

// Shared IPC contract: renderer handles type:'info' (peek); 'action' is the API lane's.
function onNotify(data = {}) {
  if (data.type === 'info') showPeek(data);
}

window.buddy?.onShow(showReminder);
window.buddy?.onCelebrate(celebrate);
window.buddy?.onNotify(onNotify);

// test hooks
window.showReminder = showReminder;
window.hideReminder = walkOut;
window.celebrate = celebrate;
window.showPeek = showPeek;
window.hidePeek = retractPeek;
