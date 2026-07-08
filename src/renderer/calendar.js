// Month grid of water progress, read from state.history via IPC.
// monthGrid + dayLevel come from ../calendar-grid.js (loaded as globals).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const now = new Date();
let year = now.getFullYear();
let month = now.getMonth();               // 0-indexed
let history = {};
const todayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const titleEl = document.getElementById('title');
const daysEl = document.getElementById('days');
const dowsEl = document.getElementById('dows');

DOW.forEach((d) => {
  const el = document.createElement('div');
  el.className = 'dow';
  el.textContent = d;
  dowsEl.appendChild(el);
});

function render() {
  titleEl.textContent = `${MONTHS[month]} ${year}`;
  daysEl.innerHTML = '';
  for (const cell of monthGrid(year, month)) {
    const el = document.createElement('div');
    if (!cell) { el.className = 'cell pad'; daysEl.appendChild(el); continue; }
    const entry = history[cell.date];
    el.className = `cell ${dayLevel(entry)}`;
    if (cell.date === todayStr) el.classList.add('today');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = cell.day;
    el.appendChild(num);
    const count = dayCount(entry);
    if (count) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = count;
      el.appendChild(c);
    }
    daysEl.appendChild(el);
  }
}

function step(delta) {
  month += delta;
  if (month < 0) { month = 11; year--; }
  else if (month > 11) { month = 0; year++; }
  render();
}

document.getElementById('prev').addEventListener('click', () => step(-1));
document.getElementById('next').addEventListener('click', () => step(1));

window.remi.getHistory().then((h) => { history = h || {}; render(); });
