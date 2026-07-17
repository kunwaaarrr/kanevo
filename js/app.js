// Shell: router, sidebar, modal, toast. Views own everything inside #view.
import { store } from './store.js';
import { maybeSeed } from './seed.js';
import { fmt, esc, h, thisMonth, setHideAmounts, ICONS } from './util.js';
import * as budgetView from './views/budget.js';
import * as registerView from './views/register.js';
import * as reportsView from './views/reports.js';
import * as loansView from './views/loans.js';
import * as settingsView from './views/settings.js';
import * as fiftyView from './views/fifty.js';
import * as forecastView from './views/forecast.js';
import * as profileView from './views/profile.js';

// ---------- modal ----------
const modalRoot = document.getElementById('modal-root');
export function openModal(html, { onOpen } = {}) {
  modalRoot.innerHTML = `<div class="modal-backdrop"></div><div class="modal" role="dialog">${html}</div>`;
  modalRoot.hidden = false;
  modalRoot.querySelector('.modal-backdrop').onclick = closeModal;
  const modal = modalRoot.querySelector('.modal');
  if (onOpen) onOpen(modal);
  return modal;
}
export function closeModal() { modalRoot.hidden = true; modalRoot.innerHTML = ''; }
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!modalRoot.hidden) { closeModal(); return; }
  document.querySelectorAll('.popover:not([hidden])').forEach(p => { p.hidden = true; }); // Escape closes open popovers too
});

// ---------- confirm sheet (in-app replacement for native confirm) ----------
// Built on the existing modal layer. Resolves true only when the confirm button is tapped;
// cancel / backdrop / Escape / any other dismissal resolve false.
export function confirmSheet({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const finish = val => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      closeModal();
      resolve(val);
    };
    const onKey = e => { if (e.key === 'Escape') finish(false); };
    const modal = openModal(h`<div class="confirm-sheet">
      <h2>${title}</h2>
      ${body ? h`<p class="muted confirm-body">${body}</p>` : ''}
      <div class="modal-actions">
        <button class="btn secondary confirm-cancel">${cancelLabel}</button>
        <button class="btn ${danger ? 'danger' : ''} confirm-ok">${confirmLabel}</button>
      </div>
    </div>`);
    modalRoot.querySelector('.modal-backdrop').onclick = () => finish(false); // openModal wired this to closeModal; take it over so it resolves
    modal.querySelector('.confirm-cancel').onclick = () => finish(false);
    modal.querySelector('.confirm-ok').onclick = () => finish(true);
    document.addEventListener('keydown', onKey, true); // capture: settles the promise before the module-level Escape handler
  });
}

// ---------- toast ----------
const toastRoot = document.getElementById('toast-root');
let toastTimer;
// undoable: true wires the action button to the generic store.undo() stack (existing callers).
// onAction: a scoped, caller-supplied undo (e.g. a category-approve snapshot) — takes priority
// over undoable when both would apply. actionLabel lets a scoped action rename the button.
export function toast(msg, { undoable = false, actionLabel = 'Undo', onAction = null } = {}) {
  const showAction = onAction ? true : (undoable && store.canUndo());
  toastRoot.innerHTML = h`<div class="toast">${msg}${showAction ? h`<button id="toast-undo">${actionLabel}</button>` : ''}</div>`;
  const btn = document.getElementById('toast-undo');
  if (btn) btn.onclick = () => { (onAction || (() => store.undo()))(); toastRoot.innerHTML = ''; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastRoot.innerHTML = ''), 4500);
}

// ---------- display options (theme + balance style) ----------
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function resolveTheme(t) {
  if (t === 'system') return darkMQ.matches ? 'dark' : 'light';
  return t === 'dark' ? 'dark' : 'light';
}
export function applyDisplaySettings() {
  const s = store.state.settings;
  const theme = resolveTheme(s.theme || 'light');
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.balance = s.balanceStyle || 'default';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#12141c' : '#f7f4ea';
}
darkMQ.addEventListener('change', () => {
  if ((store.state.settings.theme || 'light') === 'system') applyDisplaySettings();
});
applyDisplaySettings(); // before first paint, so the shell doesn't flash the wrong theme

// ---------- router ----------
const viewEl = document.getElementById('view');
let lastRenderedHash = null;
export function navigate(hash) { location.hash = hash; }
function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'budget', params: parts.slice(1) };
}
function renderView() {
  const routeKey = location.hash || '#/budget';
  const keepScroll = routeKey === lastRenderedHash;
  const previousScrollTop = viewEl.scrollTop;
  const r = currentRoute();
  applyDisplaySettings();
  setHideAmounts(store.state.settings.hideAmounts);
  const table = {
    budget:   () => budgetView.render(viewEl, { month: r.params[0] || thisMonth() }),
    accounts: () => innerWidth < 768
      ? registerView.renderAccountsOverview(viewEl)
      : registerView.render(viewEl, { accountId: null }),
    spending: () => innerWidth < 768
      ? registerView.renderSpendingOverview(viewEl)
      : registerView.render(viewEl, { accountId: null }),
    account:  () => registerView.render(viewEl, { accountId: r.params[0] }),
    reports:  () => reportsView.render(viewEl, { report: r.params[0] || 'spending' }),
    loans:    () => loansView.render(viewEl, { accountId: r.params[0] || null }),
    'loan-account': () => loansView.render(viewEl, { accountId: r.params[0] || null, context: 'accounts' }),
    settings: () => settingsView.render(viewEl, {}),
    fifty:    () => fiftyView.render(viewEl, { month: r.params[0] || thisMonth() }),
    forecast: () => forecastView.render(viewEl, { variant: 'classic' }),
    'what-if-v2': () => forecastView.render(viewEl, { variant: 'v2' }),
    profile:  () => profileView.render(viewEl),
  };
  (table[r.name] || table.budget)();
  renderSidebar(r);
  renderTabbar(r);
  lastRenderedHash = routeKey;
  if (keepScroll) {
    viewEl.scrollTop = previousScrollTop;
    requestAnimationFrame(() => { viewEl.scrollTop = previousScrollTop; });
  } else {
    viewEl.scrollTop = 0;
  }
}
window.addEventListener('hashchange', renderView);

// ---------- sidebar ----------
function renderSidebar(route) {
  const nav = document.getElementById('sidebar-nav');
  const month = route.name === 'budget' ? route.params[0] || thisMonth() : thisMonth();
  const items = [
    { hash: `#/budget/${month}`, ico: ICONS.plan, label: 'Plan', active: route.name === 'budget' },
    { hash: '#/reports/overview', ico: ICONS.reflect, label: 'Reflect', active: ['reports', 'fifty', 'forecast', 'what-if-v2', 'loans'].includes(route.name) },
    { hash: '#/accounts', ico: ICONS.accounts, label: 'All Accounts', active: route.name === 'accounts' || route.name === 'spending' },
    { hash: '#/settings', ico: ICONS.settings, label: 'Settings', active: route.name === 'settings' },
  ];
  nav.innerHTML = items.map(i =>
    h`<a class="nav-item ${i.active ? 'active' : ''}" href="${i.hash}"><span class="nav-ico">${i.ico}</span>${i.label}</a>`).join('');

  const groups = [
    { label: 'CASH', filter: a => a.onBudget && !a.closed && a.type !== 'creditCard' },
    { label: 'CREDIT', filter: a => a.onBudget && !a.closed && a.type === 'creditCard' },
    { label: 'LOANS', filter: a => !a.onBudget && !a.closed && a.loanInfo },
    { label: 'TRACKING', filter: a => !a.onBudget && !a.closed && !a.loanInfo },
  ];
  const accEl = document.getElementById('sidebar-accounts');
  accEl.innerHTML = groups.map(g => {
    const accs = store.state.accounts.filter(g.filter).sort((a, b) => a.sortOrder - b.sortOrder);
    if (!accs.length) return '';
    const rows = accs.map(a => {
      const bal = store.accountBalances(a.id).working;
      const active = route.name === 'account' && route.params[0] === a.id;
      return h`<a class="acct-row ${active ? 'active' : ''}" href="#/account/${a.id}">
        <span class="acct-name">${a.name}</span>
        <span class="acct-bal ${bal < 0 ? 'neg' : ''}">${fmt(bal)}</span></a>`;
    });
    const total = accs.reduce((s, a) => s + store.accountBalances(a.id).working, 0);
    return h`<div class="acct-group"><div class="acct-group-head"><span>${g.label}</span><span>${fmt(total)}</span></div>${rows}</div>`;
  }).join('');

  document.getElementById('budget-sub').textContent = store.state.settings.budgetName;
}
document.getElementById('add-account-btn').onclick = () => registerView.openAddAccountModal();
document.getElementById('bank-connections-btn').onclick = () => {
  const m = openModal(h`<h2>Bank Connections</h2>
    <p class="muted" style="margin-bottom:14px">Direct bank syncing via Basiq is coming soon. Until then, use the Sync button in a register to simulate a bank feed, or enter transactions manually. Everything stays on this device.</p>
    <div class="modal-actions"><button class="btn" id="bank-conn-close">Got It!</button></div>`);
  m.querySelector('#bank-conn-close').onclick = closeModal;
};

// ---------- mobile tab bar ----------
function renderTabbar(route) {
  const map = {
    budget: 'plan',
    spending: 'spending',
    profile: 'profile', account: 'profile', accounts: 'profile', 'loan-account': 'profile', settings: 'profile',
    reports: 'reflect', fifty: 'reflect', forecast: 'reflect', 'what-if-v2': 'reflect', loans: 'reflect',
  };
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('active', map[route.name] === b.dataset.tab));
  const transactionBtn = document.getElementById('mobile-transaction-btn');
  transactionBtn.hidden = !['budget', 'spending', 'account'].includes(route.name);
}
document.getElementById('tabbar').onclick = e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const go = {
    plan: `#/budget/${thisMonth()}`,
    spending: '#/spending',
    profile: '#/profile',
    reflect: '#/reports/overview',
  };
  navigate(go[btn.dataset.tab]);
};
document.getElementById('mobile-transaction-btn').onclick = () => registerView.openAddTransactionModal();

// Any in-view button can update state and synchronously rebuild its view. Keep the reader at the
// same vertical position for those same-page interactions; actual link/hash navigation still starts
// the destination at the top through renderView().
document.addEventListener('click', event => {
  if (!event.target.closest('#view button')) return;
  const top = viewEl.scrollTop;
  queueMicrotask(() => {
    viewEl.scrollTop = top;
    requestAnimationFrame(() => { viewEl.scrollTop = top; });
  });
}, true);

// collapse the ＋ Transaction pill to a square while scrolling down, expand near the top or scrolling up
{
  const scrollEl = document.getElementById('view'); // the actual scrolling element (#view { overflow-y: auto })
  let lastScrollTop = 0;
  scrollEl.addEventListener('scroll', () => {
    const btn = document.getElementById('mobile-transaction-btn');
    const st = scrollEl.scrollTop;
    if (st <= 8) btn.classList.remove('collapsed');
    else btn.classList.toggle('collapsed', st > lastScrollTop);
    lastScrollTop = st;
  }, { passive: true });
}

// ---------- dismiss open popovers on outside tap ----------
// popovers are plain elements toggled via [hidden] by view code with no backdrop; an outside tap
// otherwise falls through to the row beneath AND leaves the popover open. Capture the first outside
// tap, close every open popover, and swallow that tap so it can't also activate what's underneath.
// A tap on a popover, on any [data-act] trigger (which re-toggles), or inside the modal layer is left alone.
document.addEventListener('click', e => {
  const open = document.querySelectorAll('.popover:not([hidden])');
  if (!open.length) return;
  if (e.target.closest('.popover, [data-act], #modal-root')) return;
  open.forEach(p => { p.hidden = true; });
  e.preventDefault();
  e.stopPropagation();
}, true);

// ---------- keep popovers inside the viewport ----------
// menus anchor to their trigger and can bleed past the phone's right edge; nudge them back
function clampPopover(el) {
  // popovers anchored via an inline left (appended straight to body, e.g. .cat-popover):
  // rewrite the coordinate itself. A negative margin-left still leaves the pre-margin box
  // in the page's scrollable overflow in some browsers, so it under-corrects.
  if (el.style.left) {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const left = parseFloat(el.style.left) - Math.max(0, r.right - (innerWidth - 8));
    el.style.left = Math.max(8, Math.round(left)) + 'px';
    return;
  }
  el.style.marginLeft = '';
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const over = r.right - (innerWidth - 8);
  if (over > 0) el.style.marginLeft = -Math.round(Math.min(over, Math.max(0, r.left - 8))) + 'px';
  else if (r.left < 8) el.style.marginLeft = Math.round(8 - r.left) + 'px';
}
new MutationObserver(muts => {
  for (const m of muts) {
    const candidates = m.type === 'childList'
      ? [...m.addedNodes].filter(n => n.nodeType === 1)
          .flatMap(n => [n, ...(n.querySelectorAll ? [...n.querySelectorAll('[class*="popover"],[class*="menu"]:not(nav)')] : [])])
      : [m.target];
    for (const el of candidates) {
      if (el.nodeType === 1 && !el.hidden && /popover|menu/.test(el.className) && el.id !== 'sidebar-nav') {
        clampPopover(el);
        requestAnimationFrame(() => clampPopover(el)); // re-run once layout (fonts, inline left) has settled
      }
    }
  }
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });

// ---------- sidebar resize + collapse (UI chrome pref, plain localStorage) ----------
const layout = document.getElementById('layout');
const savedW = parseInt(localStorage.getItem('ss-sidebar-w'), 10);
if (savedW >= 200 && savedW <= 420) document.documentElement.style.setProperty('--sidebar-w', savedW + 'px');
if (localStorage.getItem('ss-sidebar-collapsed') === '1') {
  layout.classList.add('sidebar-collapsed');
  document.getElementById('sidebar-expand').classList.add('show');
}
const resizer = document.getElementById('sidebar-resizer');
resizer.addEventListener('pointerdown', e => {
  e.preventDefault();
  resizer.classList.add('dragging');
  resizer.setPointerCapture(e.pointerId);
  const move = ev => {
    const w = Math.min(420, Math.max(200, Math.round(ev.clientX)));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  };
  const up = () => {
    resizer.classList.remove('dragging');
    localStorage.setItem('ss-sidebar-w', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10));
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', up);
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up);
});
document.getElementById('sidebar-collapse').onclick = () => {
  layout.classList.add('sidebar-collapsed');
  document.getElementById('sidebar-expand').classList.add('show');
  localStorage.setItem('ss-sidebar-collapsed', '1');
};
document.getElementById('sidebar-expand').onclick = () => {
  layout.classList.remove('sidebar-collapsed');
  document.getElementById('sidebar-expand').classList.remove('show');
  localStorage.setItem('ss-sidebar-collapsed', '0');
};

// inject SVG icons into static shell slots (tab bar, sidebar buttons)
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ICONS[el.dataset.ico] || ''; });

// ---------- boot ----------
maybeSeed();
store.processDueScheduled();
store.subscribe(renderView);
if (!location.hash) location.hash = `#/budget/${thisMonth()}`;
renderView();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
