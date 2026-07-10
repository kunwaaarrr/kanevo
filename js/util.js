// Shared helpers — shell-owned. Money is integer cents.
let _hideAmounts = false;
export function setHideAmounts(v) { _hideAmounts = v; }

export function fmt(cents, { sign = false } = {}) {
  if (_hideAmounts) return '••••';
  return fmtExact(cents, { sign });
}
export function fmtExact(cents, { sign = false } = {}) {
  const n = (cents || 0) / 100;
  const abs = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const neg = cents < 0 ? '-' : sign && cents > 0 ? '+' : '';
  return `${neg}$${abs}`;
}
export function parseAmount(str) {
  const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function todayISO() { // local date, not UTC — toISOString() is a day behind for AU timezones
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function thisMonth() { return todayISO().slice(0, 7); }
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}
export function monthsBetween(a, b) { // whole months from a to b (can be negative)
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function h(strings, ...vals) { // tagged template: escapes interpolations; arrays and whole HTML fragments pass raw
  // ponytail: "<...>" strings pass unescaped so views can nest built fragments; a user naming a payee
  // literally "<tag>" could inject markup into their own local page — acceptable here, sanitize if this ever syncs
  const isFragment = v => typeof v === 'string' && /^\s*</.test(v) && />\s*$/.test(v);
  return strings.reduce((out, s, i) => {
    const v = vals[i - 1];
    return out + (Array.isArray(v) ? v.join('') : isFragment(v) ? v : esc(v)) + s;
  });
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// Monochrome line icons (currentColor). One family for sidebar + tab bar + toolbars.
const I = (inner, extra = '') => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
export const ICONS = {
  plan: I('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/>'),
  spending: I('<rect x="3.5" y="6.2" width="17" height="11.6" rx="2"/><path d="M3.5 10h17M7.2 14h3.2"/>'),
  reflect: I('<path d="M4.5 20h15M7.5 16.5v-6M12 16.5V6.5M16.5 16.5v-3.5"/>'),
  accounts: I('<path d="M12 3.8 20 8.8H4l8-5z"/><path d="M5.5 12v5.5M10 12v5.5M14 12v5.5M18.5 12v5.5M3.8 20.5h16.4"/>'),
  loans: I('<rect x="5.5" y="3.5" width="13" height="17" rx="2"/><path d="M8.5 7h7"/><g fill="currentColor" stroke="none"><circle cx="8.7" cy="11" r=".95"/><circle cx="12" cy="11" r=".95"/><circle cx="15.3" cy="11" r=".95"/><circle cx="8.7" cy="14.5" r=".95"/><circle cx="12" cy="14.5" r=".95"/><circle cx="15.3" cy="14.5" r=".95"/><circle cx="8.7" cy="18" r=".95"/><circle cx="12" cy="18" r=".95"/></g>'),
  settings: I('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.9v2.6M12 18.5v2.6M2.9 12h2.6M18.5 12h2.6M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9"/>'),
  eye: I('<path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  clock: I('<circle cx="12" cy="12" r="8.3"/><path d="M12 7.2V12l3.4 2"/>'),
  more: I('<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></g>'),
  fifty: I('<circle cx="12" cy="12" r="8.3"/><path d="M12 3.7V12l5.9 5.9M12 12H3.7"/>'),
  forecast: I('<path d="M3.5 20.5h17M4.5 16.5l4.5-4.5 3 3 5.5-5.5"/><path d="M14 9.5h3.5V13"/>'),
  search: I('<circle cx="10.8" cy="10.8" r="7"/><path d="M20 20l-4.8-4.8"/>'),
  moreVertical: I('<g fill="currentColor" stroke="none"><circle cx="12" cy="4.6" r="1.95"/><circle cx="12" cy="12" r="1.95"/><circle cx="12" cy="19.4" r="1.95"/></g>'),
  close: I('<path d="M5 5l14 14M19 5 5 19"/>'),
  filter: I('<circle cx="12" cy="12" r="9.3"/><path d="M6.8 9.3h10.4M8.4 12.3h7.2M10.4 15.3h3.2"/>'),
  edit: I('<path d="M4.5 21h15"/><path d="M14.6 4.9l4.4 4.4-9.3 9.3-4.9 1 1-4.9 8.8-8.8z"/>'),
  add: I('<path d="M12 5v14M5 12h14"/>'),
};
