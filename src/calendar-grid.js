// Pure month-grid + tint helpers for the calendar view. No Electron, no I/O.
// Dual-loaded: `require()` in node/main + tests, and as a plain <script> global
// in the renderer (calendar.js) — so the grid logic has one tested source.

function pad(n) { return String(n).padStart(2, '0'); }

// Flat array of cells for a month, laid out 7-per-row (Sun-first).
// Leading blanks before the 1st are null. `month` is 0-indexed (0 = Jan), matching JS Date.
function monthGrid(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay();   // 0 = Sun
  const days = new Date(year, month + 1, 0).getDate();      // last day of month
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    cells.push({ day: d, date: `${year}-${pad(month + 1)}-${pad(d)}` });
  }
  return cells;
}

// Tint level for one day's history entry: none (no water) / partial / full (goal met).
function dayLevel(entry) {
  if (!entry || !entry.had) return 'none';
  if (entry.goal && entry.had >= entry.goal) return 'full';
  return 'partial';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { monthGrid, dayLevel };
}
