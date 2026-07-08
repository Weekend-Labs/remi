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
const had = document.getElementById('had');
const snz = document.getElementById('snz');
const REACT_MS = 1400; // how long the reaction shows before he leaves
let dismissTimer, arriveTimer, outTimer, reactTimer;

function clearTimers() {
  clearTimeout(dismissTimer); clearTimeout(arriveTimer);
  clearTimeout(outTimer); clearTimeout(reactTimer);
}

// ── Pose registry (art-ready, with fallback) ─────────────────────────────
// state → sprite. The pose files don't exist yet; poseSrc returns the mapped
// name and setPose's onerror swaps a missing sprite for buddy-hold.png — so
// with no pose art present the buddy just stays on hold (visually unchanged),
// and this merges safely before the art lands.
const FALLBACK_POSE = 'buddy-hold.png';
const POSES = {
  hold:   'buddy-hold.png',
  sad:    'buddy-sad.png',    // water snooze/deny
  cheer:  'buddy-cheer.png',  // water "Had it"
  peek:   'buddy-peek.png',   // info peek
  action: 'buddy-action.png', // action overlay
};
function poseSrc(name) { return POSES[name] || FALLBACK_POSE; }
function setPose(img, name) {
  img.onerror = () => { img.onerror = null; img.src = FALLBACK_POSE; }; // missing pose → hold
  img.src = poseSrc(name);
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
  setPose(avatar, 'hold'); // reset pose for the fresh reminder
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
  setPose(avatar, had ? 'cheer' : 'sad');
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

// ── F001: generic `action` notification (peek lane renders type:'info') ──────
// Reuses this same walk-in overlay: relabels the two buttons from actions[] and
// resolves the reply over IPC. The water path (showReminder/choose) is untouched.
let activeNotify = null;

function showNotification(data) {
  if (!data || data.type !== 'action') return; // info is the peek lane's job
  activeNotify = data;
  msg.textContent = data.message;
  count.textContent = data.detail || '';
  bubble.classList.remove('happy', 'meh');
  avatar.classList.remove('cheer', 'sad');
  setPose(avatar, 'action');
  const acts = (data.actions || []).slice(0, 2);
  [had, snz].forEach((b, i) => {
    if (acts[i]) { b.textContent = acts[i].label; b.dataset.result = acts[i].result; b.style.display = ''; }
    else b.style.display = 'none';
  });
  document.getElementById('actions').style.pointerEvents = '';
  clearTimers();
  playChime();
  // walk-in (same sequence as showReminder)
  scene.classList.remove('show');
  avatar.style.display = 'none';
  walker.classList.remove('flip');
  walker.classList.add('stepping');
  walker.style.display = 'block';
  scene.style.transition = 'none';
  scene.style.transform = 'translateX(160%)';
  void scene.offsetWidth;
  scene.style.transition = `transform ${WALK_IN_MS}ms linear`;
  requestAnimationFrame(() => { scene.style.transform = 'translateX(0)'; });
  arriveTimer = setTimeout(() => {
    walker.classList.remove('stepping');
    walker.style.display = 'none';
    avatar.style.display = 'block';
    scene.classList.add('show');
    // Honor the producer's ttl (seconds) so a 120 s action isn't silently capped at 30 s.
    const ttlMs = data.ttl > 0 ? data.ttl * 1000 : AUTO_DISMISS_MS;
    dismissTimer = setTimeout(() => resolveNotify(null), ttlMs); // no answer → dismiss
  }, WALK_IN_MS);
}

// result === null → the user let it auto-dismiss; else it's the chosen action result.
function resolveNotify(result) {
  if (!activeNotify) return;
  const { id } = activeNotify;
  activeNotify = null;
  clearTimers();
  if (result == null) window.buddy?.notifyDismiss(id);
  else window.buddy?.notifyReply(id, result);
  // restore the water buttons for the next water reminder
  had.textContent = 'Had it 💧'; snz.textContent = 'Snooze 15m'; snz.style.display = '';
  walkOut();
}

had.addEventListener('click', () => (activeNotify ? resolveNotify(had.dataset.result) : choose('had-it')));
snz.addEventListener('click', () => (activeNotify ? resolveNotify(snz.dataset.result) : choose('snooze')));

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
// changing the 'peek' pose (see POSES); tilt/clip are CSS vars on #peek.
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
  setPose(peekBuddy, 'peek');
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
  else if (data.type === 'action') showNotification(data);
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
