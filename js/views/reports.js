import { store } from '../store.js';
import { fmt, h, thisMonth, addMonths, monthLabel, monthsBetween, ICONS } from '../util.js';

const TABS = [
  { id: 'spending', label: 'Spending Breakdown' },
  { id: 'trends', label: 'Spending Trends' },
  { id: 'net-worth', label: 'Net Worth' },
  { id: 'income-expense', label: 'Income v Expense' },
  { id: 'age-of-money', label: 'Age of Money' },
];
const PRESETS = ['This Month', 'Latest 3 Months', 'This Year', 'Last Year', 'All Dates'];
const CHART_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8', '--chart-9', '--chart-10'];

// module-local filter state, survives re-render
const state = {
  preset: 'This Month',
  from: thisMonth(),
  to: thisMonth(),
  groupBy: 'category', // spending breakdown segmented toggle: category|group|payee
  accountIds: null, // null = all
  categoryIds: null, // null = all
  highlight: null, // spending: id of highlighted slice/legend row
  expandedGroups: new Set(), // income-expense
  openPopover: null, // 'date' | 'accounts' | 'categories' | null
  mobileFiltersOpen: false,
  mobileMenuOpen: false,
};

function applyPreset(preset) {
  const now = thisMonth();
  state.preset = preset;
  if (preset === 'This Month') { state.from = now; state.to = now; }
  else if (preset === 'Latest 3 Months') { state.from = addMonths(now, -2); state.to = now; }
  else if (preset === 'This Year') { state.from = now.slice(0, 4) + '-01'; state.to = now; }
  else if (preset === 'Last Year') {
    const y = Number(now.slice(0, 4)) - 1;
    state.from = `${y}-01`; state.to = `${y}-12`;
  } else if (preset === 'All Dates') {
    const first = store.state.transactions.reduce((min, t) => t.date < min ? t.date : min, now);
    state.from = first.slice(0, 7); state.to = now;
  }
}
if (!state._init) { applyPreset(state.preset); state._init = true; }

function monthRange(from, to) {
  const months = [];
  const n = monthsBetween(from, to);
  for (let i = 0; i <= n; i++) months.push(addMonths(from, i));
  return months;
}

// ---------- CSV export ----------
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------- filter chip row ----------
function monthStepperChip() {
  return h`<div class="chip chip-stepper">
    <button type="button" class="chip-step" id="month-prev">‹</button>
    <button type="button" class="chip-date-btn" id="chip-date"><span class="chip-ico">📅</span> ${monthLabel(state.from).slice(0, 3)} ${state.from.slice(0, 4)}</button>
    <button type="button" class="chip-step" id="month-next">›</button>
  </div>`;
}

function datePopover() {
  return h`<div class="popover date-popover">
    <div class="popover-presets">
      ${PRESETS.map(p => `<button type="button" class="popover-preset ${p === state.preset ? 'active' : ''}" data-preset="${p}">${p}</button>`).join('')}
    </div>
    <div class="popover-range">
      <label><span class="range-label">From</span><input type="month" id="from-month" value="${state.from}"></label>
      <label><span class="range-label">To</span><input type="month" id="to-month" value="${state.to}"></label>
    </div>
  </div>`;
}

function checkboxDropdownChip({ id, label, items, selectedIds }) {
  const allSelected = !selectedIds;
  return h`<div class="chip-wrap">
    <button type="button" class="chip chip-dd" data-dd="${id}">${label} ▾</button>
    ${state.openPopover === id ? h`<div class="popover dd-popover">
      <div class="dd-actions">
        <button type="button" data-dd-all="${id}">Select All</button>
        <button type="button" data-dd-none="${id}">Select None</button>
      </div>
      ${items.map(it => h`<label class="dd-row">
        <input type="checkbox" data-dd-item="${id}" value="${it.id}" ${allSelected || selectedIds.includes(it.id) ? 'checked' : ''}> ${it.name}
      </label>`)}
    </div>` : ''}
  </div>`;
}

function filterRow(activeTab) {
  const showCatAcc = activeTab === 'spending' || activeTab === 'trends';
  const showAccOnly = activeTab === 'net-worth';
  const accounts = store.state.accounts.filter(a => !a.closed);
  const cats = store.state.categories.filter(c => !c.hidden);

  const accLabel = !state.accountIds ? 'All Accounts' : `${state.accountIds.length} Account${state.accountIds.length === 1 ? '' : 's'}`;
  const catLabel = !state.categoryIds ? 'All Categories' : `${state.categoryIds.length} Categor${state.categoryIds.length === 1 ? 'y' : 'ies'}`;

  return h`<div class="filter-row">
    <div class="chip-wrap">
      ${monthStepperChip()}
      ${state.openPopover === 'date' ? datePopover() : ''}
    </div>
    ${showCatAcc ? checkboxDropdownChip({ id: 'categories', label: catLabel, items: cats, selectedIds: state.categoryIds }) : ''}
    ${(showCatAcc || showAccOnly) ? checkboxDropdownChip({ id: 'accounts', label: accLabel, items: accounts, selectedIds: state.accountIds }) : ''}
  </div>`;
}

function bindFilterRow(root, rerender) {
  const rangeIsSingleMonth = state.from === state.to;
  const step = n => {
    if (rangeIsSingleMonth) { state.from = addMonths(state.from, n); state.to = state.from; }
    else { state.from = addMonths(state.from, n); state.to = addMonths(state.to, n); }
    state.preset = 'Custom';
    rerender();
  };
  root.querySelector('#month-prev').onclick = () => step(-1);
  root.querySelector('#month-next').onclick = () => step(1);
  root.querySelector('#chip-date').onclick = () => { state.openPopover = state.openPopover === 'date' ? null : 'date'; rerender(); };

  const presetBtns = root.querySelectorAll('[data-preset]');
  presetBtns.forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); rerender(); });
  const fromInput = root.querySelector('#from-month');
  const toInput = root.querySelector('#to-month');
  if (fromInput) fromInput.onchange = e => { state.from = e.target.value; state.preset = 'Custom'; rerender(); };
  if (toInput) toInput.onchange = e => { state.to = e.target.value; state.preset = 'Custom'; rerender(); };

  root.querySelectorAll('[data-dd]').forEach(b => {
    b.onclick = () => { state.openPopover = state.openPopover === b.dataset.dd ? null : b.dataset.dd; rerender(); };
  });
  root.querySelectorAll('[data-dd-all]').forEach(b => {
    b.onclick = () => { setFilterList(b.dataset.ddAll, null); rerender(); };
  });
  root.querySelectorAll('[data-dd-none]').forEach(b => {
    b.onclick = () => { setFilterList(b.dataset.ddNone, []); rerender(); };
  });
  root.querySelectorAll('[data-dd-item]').forEach(cb => {
    cb.onclick = () => {
      const kind = cb.dataset.ddItem;
      const all = (kind === 'accounts' ? store.state.accounts.filter(a => !a.closed) : store.state.categories.filter(c => !c.hidden)).map(x => x.id);
      const cur0 = kind === 'accounts' ? state.accountIds : state.categoryIds;
      let cur = cur0 || all.slice();
      if (cb.checked) cur = [...new Set([...cur, cb.value])]; else cur = cur.filter(id => id !== cb.value);
      setFilterList(kind, cur.length === all.length ? null : cur);
      rerender();
    };
  });
}
function setFilterList(kind, val) {
  if (kind === 'accounts') state.accountIds = val; else state.categoryIds = val;
}

function tabBar(active) {
  const current = TABS.find(t => t.id === active) || TABS[0];
  return h`<div class="report-tabs">
    ${TABS.map(t => h`<a class="report-tab ${t.id === active ? 'active' : ''}" href="#/reports/${t.id}">${t.label}</a>`)}
    <div class="report-switcher-wrap">
      <a class="mobile-report-back" href="#/reports/overview" aria-label="Back to Reflect">‹</a>
      <button type="button" class="report-switcher" id="report-switcher">${current.label} <span class="switcher-caret">▾</span></button>
      <button type="button" class="mobile-report-filter" id="mobile-report-filter" aria-label="Jump to report filters">≡</button>
      <button type="button" class="mobile-report-more" id="mobile-report-more" aria-label="More report options">⋮</button>
      <div class="report-switch-menu" id="report-switch-menu" hidden>
        ${TABS.map(t => h`<a class="report-switch-item ${t.id === active ? 'active' : ''}" href="#/reports/${t.id}">${t.label}</a>`)}
      </div>
      <div class="mobile-report-actions-menu" id="mobile-report-actions-menu" hidden>
        <a href="#/reports/overview">Reflect overview</a>
        <button type="button" id="mobile-report-export">Export this report</button>
      </div>
    </div>
  </div>`;
}
function wireReportSwitcher(root) {
  const btn = root.querySelector('#report-switcher');
  const menu = root.querySelector('#report-switch-menu');
  if (!btn) return;
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  const filterBtn = root.querySelector('#mobile-report-filter');
  const moreBtn = root.querySelector('#mobile-report-more');
  const actionsMenu = root.querySelector('#mobile-report-actions-menu');
  filterBtn.onclick = () => root.querySelector('.filter-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  moreBtn.onclick = e => { e.stopPropagation(); actionsMenu.hidden = !actionsMenu.hidden; };
  root.querySelector('#mobile-report-export').onclick = () => root.querySelector('#export-btn')?.click();
  document.addEventListener('click', () => { menu.hidden = true; actionsMenu.hidden = true; }, { once: true });
}

function pageHead(title) {
  return h`<div class="reflect-head">
    <div class="reflect-title">${title}</div>
    <button type="button" class="link-btn" id="export-btn"><span class="chip-ico">📄</span> Export</button>
  </div>`;
}

function emptyState(msg) {
  return h`<div class="empty-state"><p>${msg}</p></div>`;
}

// ============================================================
// MOBILE REFLECT OVERVIEW
// ============================================================
function reflectOverview(root) {
  const month = thisMonth();
  const raw = store.spendingBreakdown({ fromMonth: month, toMonth: month, groupBy: 'category' });
  const totalSpending = raw.reduce((sum, item) => sum + item.amount, 0);
  const topCategories = raw.slice(0, 4);
  const income = store.state.transactions.reduce((sum, transaction) => {
    if (transaction.date.slice(0, 7) !== month || transaction.amount <= 0) return sum;
    const account = store.state.accounts.find(item => item.id === transaction.accountId);
    return account?.onBudget ? sum + transaction.amount : sum;
  }, 0);
  const netSeries = store.netWorthSeries();
  const latestNet = netSeries.length ? netSeries[netSeries.length - 1].netWorth : 0;
  const age = store.ageOfMoney();
  const comparisonMax = Math.max(1, income, totalSpending);
  const incomeWidth = Math.round((income / comparisonMax) * 100);
  const spendingWidth = Math.round((totalSpending / comparisonMax) * 100);
  const allocationSegments = raw.filter(item => item.amount > 0).map((item, index) => {
    const share = totalSpending ? Math.round((item.amount / totalSpending) * 100) : 0;
    return h`<span style="flex-grow:${item.amount};background:var(${CHART_COLORS[index % CHART_COLORS.length]})" title="${item.name}: ${share}%"></span>`;
  }).join('');

  root.innerHTML = h`<div class="reflect-overview">
    <header class="reflect-overview-head mobile-page-head">
      <h1 class="mobile-page-title">Reflect</h1>
      <div class="reflect-overview-menu-wrap mobile-page-actions">
        <button id="reflect-overview-more" class="reflect-overview-more mobile-head-action" aria-label="Choose Reflect view">${ICONS.views}</button>
        <div id="reflect-overview-menu" class="reflect-overview-menu" role="dialog" aria-label="Reflect views" hidden>
          <div class="reflect-view-menu-title"><strong>Reflect views</strong><span>Reports and planning tools</span></div>
          <div class="reflect-view-grid">
            <a href="#/reports/spending"><span class="reflect-view-icon" aria-hidden="true">${ICONS.spending}</span><span>Spending</span></a>
            <a href="#/reports/trends"><span class="reflect-view-icon" aria-hidden="true">${ICONS.forecast}</span><span>Trends</span></a>
            <a href="#/reports/net-worth"><span class="reflect-view-icon" aria-hidden="true">${ICONS.reflect}</span><span>Net worth</span></a>
            <a href="#/reports/income-expense"><span class="reflect-view-icon" aria-hidden="true">${ICONS.accounts}</span><span>Income v expense</span></a>
            <a href="#/reports/age-of-money"><span class="reflect-view-icon" aria-hidden="true">${ICONS.clock}</span><span>Age of money</span></a>
            <a href="#/fifty"><span class="reflect-view-icon" aria-hidden="true">${ICONS.fifty}</span><span>50/30/20</span></a>
            <a href="#/forecast"><span class="reflect-view-icon" aria-hidden="true">${ICONS.forecast}</span><span>Forecast</span></a>
            <a href="#/what-if-v2"><span class="reflect-view-icon" aria-hidden="true">${ICONS.forecast}</span><span>What If v2</span></a>
            <a href="#/loans"><span class="reflect-view-icon" aria-hidden="true">${ICONS.loans}</span><span>Loan planner</span></a>
          </div>
        </div>
      </div>
    </header>
    <main class="reflect-overview-cards">
      <a class="reflect-summary-card reflect-spending-summary" href="#/reports/spending">
        <div class="reflect-card-link-head"><strong><span aria-hidden="true">${ICONS.spending}</span> Spending Breakdown</strong><span aria-hidden="true">›</span></div>
        <div class="reflect-period">${monthLabel(month)}</div>
        <div class="reflect-primary-amount">${fmt(totalSpending)}</div>
        <div class="reflect-allocation-bar" aria-label="Spending allocation by category">${allocationSegments}</div>
        <div class="reflect-list-head"><span>Top Categories</span><span>Spent</span></div>
        <div class="reflect-top-list">
          ${topCategories.length ? topCategories.map((item, index) => h`<div><span><i style="background:var(${CHART_COLORS[index % CHART_COLORS.length]})"></i>${item.name}</span><strong>${fmt(item.amount)}</strong></div>`).join('') : '<p class="muted">No spending this month yet.</p>'}
        </div>
      </a>
      <a class="reflect-summary-card" href="#/reports/income-expense">
        <div class="reflect-card-link-head"><strong><span aria-hidden="true">${ICONS.accounts}</span> Income vs Spending</strong><span aria-hidden="true">›</span></div>
        <p class="reflect-insight">${income >= totalSpending ? 'You are spending less than you brought in.' : 'Spending is currently ahead of income.'}</p>
        <div class="reflect-comparison-row"><span>Income</span><strong>${fmt(income)}</strong></div>
        <div class="reflect-comparison-track"><span class="income" style="width:${incomeWidth}%"></span></div>
        <div class="reflect-comparison-row"><span>Spending</span><strong>${fmt(totalSpending)}</strong></div>
        <div class="reflect-comparison-track"><span class="spending" style="width:${spendingWidth}%"></span></div>
      </a>
      <div class="reflect-mini-grid">
        <a class="reflect-summary-card reflect-mini-card" href="#/reports/net-worth">
          <div class="reflect-card-link-head"><strong>Net Worth</strong><span aria-hidden="true">›</span></div>
          <div class="reflect-mini-value ${latestNet < 0 ? 'neg-text' : 'pos-text'}">${fmt(latestNet)}</div>
        </a>
        <a class="reflect-summary-card reflect-mini-card" href="#/reports/age-of-money">
          <div class="reflect-card-link-head"><strong>Age of Money</strong><span aria-hidden="true">›</span></div>
          <div class="reflect-mini-value">${age} days</div>
        </a>
      </div>
      <section class="reflect-link-card">
        <h2>More reports</h2>
        <a href="#/reports/trends"><span><i aria-hidden="true">↗</i><b>Spending Trends</b><small>See how spending changes month to month</small></span><strong aria-hidden="true">›</strong></a>
        <a href="#/reports/income-expense"><span><i aria-hidden="true">⇄</i><b>Income v Expense</b><small>Compare money in, money out, and what remains</small></span><strong aria-hidden="true">›</strong></a>
      </section>
      <section class="reflect-link-card reflect-tools-card">
        <h2>Planning tools</h2>
        <a href="#/fifty"><span><i aria-hidden="true">%</i><b>50/30/20</b><small>Compare your plan with a simple allocation guide</small></span><strong aria-hidden="true">›</strong></a>
        <a href="#/forecast"><span><i aria-hidden="true">⌁</i><b>Forecast &amp; What-If</b><small>Project cash flow and test future changes</small></span><strong aria-hidden="true">›</strong></a>
        <a href="#/what-if-v2"><span><i aria-hidden="true">◇</i><b>What If v2</b><small>A mobile-first forecast with adjustable assumptions</small></span><strong aria-hidden="true">›</strong></a>
        <a href="#/loans"><span><i aria-hidden="true">↓</i><b>Loan Planner</b><small>Explore payoff timing and extra payments</small></span><strong aria-hidden="true">›</strong></a>
      </section>
    </main>
  </div>`;

  const button = root.querySelector('#reflect-overview-more');
  const menu = root.querySelector('#reflect-overview-menu');
  button.onclick = event => { event.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
}

// ============================================================
// MOBILE REPORT SYSTEM
// Detailed reports use a phone-native composition rather than shrinking the
// desktop cards and tables. The calculations and export contracts stay shared.
// ============================================================
function isMobileReport() { return innerWidth < 768; }

function mobileReportHeader(active, title) {
  return h`<header class="mobile-report-head">
    <a href="#/reports/overview" class="mobile-report-head-back" aria-label="Back to Reflect">‹</a>
    <h1>${title}</h1>
    <button id="mobile-filter-open" class="mobile-report-head-button mobile-head-action" aria-label="Open report filters">${ICONS.filter}</button>
    <button id="mobile-report-menu-toggle" class="mobile-report-head-button mobile-head-action" aria-label="Choose report view">${ICONS.views}</button>
    <div class="mobile-report-menu" id="mobile-report-menu" ${state.mobileMenuOpen ? '' : 'hidden'}>
      <div class="mobile-report-menu-title">Report views</div>
      ${TABS.map(item => h`<a class="${item.id === active ? 'active' : ''}" href="#/reports/${item.id}">${item.label}</a>`)}
      <button id="mobile-report-export-action" class="mobile-report-export-action"><span aria-hidden="true">${ICONS.download}</span><span><strong>Export report</strong><small>Download this view as CSV</small></span></button>
    </div>
  </header>`;
}

function mobileRangeBar(active) {
  const range = state.from === state.to ? monthLabel(state.from) : `${monthLabel(state.from)} – ${monthLabel(state.to)}`;
  const showCategories = active === 'spending' || active === 'trends';
  const showAccounts = showCategories || active === 'net-worth';
  const categoryLabel = state.categoryIds ? `${state.categoryIds.length} categories` : 'All categories';
  const accountLabel = state.accountIds ? `${state.accountIds.length} accounts` : 'All accounts';
  return h`<div class="mobile-report-range">
    <button id="mobile-month-prev" aria-label="Previous period">‹</button>
    <button id="mobile-range-open"><span>${range}</span><span class="mobile-range-chevron" aria-hidden="true">${ICONS.chevronDown}</span></button>
    <button id="mobile-month-next" aria-label="Next period">›</button>
  </div>
  ${(showCategories || showAccounts) ? h`<div class="mobile-report-filter-summary">
    ${showCategories ? `<button id="mobile-categories-open">${categoryLabel}</button>` : ''}
    ${showAccounts ? `<button id="mobile-accounts-open">${accountLabel}</button>` : ''}
  </div>` : ''}`;
}

function mobileFilterPanel(active) {
  if (!state.mobileFiltersOpen) return '';
  const showCategories = active === 'spending' || active === 'trends';
  const showAccounts = showCategories || active === 'net-worth';
  const categories = store.state.categories.filter(item => !item.hidden);
  const accounts = store.state.accounts.filter(item => !item.closed);
  return h`<div class="mobile-filter-panel">
    <header><button id="mobile-filter-close" aria-label="Close filters">×</button><h2>Report filters</h2><button id="mobile-filter-save">Done</button></header>
    <div class="mobile-filter-body">
      <section class="mobile-filter-card">
        <h3>Date range</h3>
        ${PRESETS.map(preset => `<button class="mobile-preset-row ${preset === state.preset ? 'active' : ''}" data-mobile-preset="${preset}"><span>${preset}</span><i>${preset === state.preset ? '✓' : ''}</i></button>`).join('')}
        <div class="mobile-custom-range">
          <label>From<input type="month" id="mobile-from-month" value="${state.from}"></label>
          <label>To<input type="month" id="mobile-to-month" value="${state.to}"></label>
        </div>
      </section>
      ${showCategories ? mobileFilterChecklist('categories', 'Categories', categories, state.categoryIds) : ''}
      ${showAccounts ? mobileFilterChecklist('accounts', 'Accounts', accounts, state.accountIds) : ''}
    </div>
  </div>`;
}

function mobileFilterChecklist(kind, label, items, selectedIds) {
  const selected = selectedIds ? new Set(selectedIds) : null;
  return h`<section class="mobile-filter-card">
    <div class="mobile-filter-card-head"><h3>${label}</h3><button data-mobile-all="${kind}">${selected ? 'Select all' : 'Clear all'}</button></div>
    ${items.map(item => h`<label class="mobile-filter-check"><input type="checkbox" data-mobile-check="${kind}" value="${item.id}" ${!selected || selected.has(item.id) ? 'checked' : ''}><span>${item.name}</span></label>`)}
  </section>`;
}

function wireMobileReport(root, active, rerender, exportAction) {
  const step = direction => {
    const single = state.from === state.to;
    state.from = addMonths(state.from, direction);
    state.to = single ? state.from : addMonths(state.to, direction);
    state.preset = 'Custom';
    rerender();
  };
  root.querySelector('#mobile-month-prev').onclick = () => step(-1);
  root.querySelector('#mobile-month-next').onclick = () => step(1);
  const openFilters = () => { state.mobileFiltersOpen = true; state.mobileMenuOpen = false; rerender(); };
  root.querySelector('#mobile-filter-open').onclick = openFilters;
  root.querySelector('#mobile-range-open').onclick = openFilters;
  root.querySelector('#mobile-categories-open')?.addEventListener('click', openFilters);
  root.querySelector('#mobile-accounts-open')?.addEventListener('click', openFilters);
  root.querySelector('#mobile-report-menu-toggle').onclick = event => {
    event.stopPropagation(); state.mobileMenuOpen = !state.mobileMenuOpen; rerender();
  };
  root.querySelector('#mobile-report-export-action')?.addEventListener('click', exportAction);
  root.querySelector('#mobile-filter-close')?.addEventListener('click', () => { state.mobileFiltersOpen = false; rerender(); });
  root.querySelector('#mobile-filter-save')?.addEventListener('click', () => { state.mobileFiltersOpen = false; rerender(); });
  root.querySelectorAll('[data-mobile-preset]').forEach(button => {
    button.onclick = () => { applyPreset(button.dataset.mobilePreset); rerender(); };
  });
  root.querySelector('#mobile-from-month')?.addEventListener('change', event => { state.from = event.target.value; state.preset = 'Custom'; rerender(); });
  root.querySelector('#mobile-to-month')?.addEventListener('change', event => { state.to = event.target.value; state.preset = 'Custom'; rerender(); });
  root.querySelectorAll('[data-mobile-all]').forEach(button => {
    button.onclick = () => { const kind = button.dataset.mobileAll; setFilterList(kind, kind === 'accounts' ? (state.accountIds ? null : []) : (state.categoryIds ? null : [])); rerender(); };
  });
  root.querySelectorAll('[data-mobile-check]').forEach(checkbox => {
    checkbox.onchange = () => {
      const kind = checkbox.dataset.mobileCheck;
      const all = (kind === 'accounts' ? store.state.accounts.filter(item => !item.closed) : store.state.categories.filter(item => !item.hidden)).map(item => item.id);
      const current = (kind === 'accounts' ? state.accountIds : state.categoryIds) || all.slice();
      const next = checkbox.checked ? [...new Set([...current, checkbox.value])] : current.filter(id => id !== checkbox.value);
      setFilterList(kind, next.length === all.length ? null : next);
      rerender();
    };
  });
}

function mobileProgressRows(items) {
  const max = Math.max(1, ...items.map(item => item.amount));
  return items.map((item, index) => h`<div class="mobile-data-row">
    <span class="mobile-data-row-top"><span><i style="background:var(${CHART_COLORS[index % CHART_COLORS.length]})"></i>${item.name}</span><strong>${fmt(item.amount)}</strong></span>
    <span class="mobile-data-track"><span style="width:${Math.max(3, Math.round((item.amount / max) * 100))}%;background:var(${CHART_COLORS[index % CHART_COLORS.length]})"></span></span>
  </div>`).join('');
}

// ============================================================
// 1. SPENDING BREAKDOWN
// ============================================================
function spendingReport(root) {
  const GROUPBYS = [{ id: 'category', label: 'Categories' }, { id: 'group', label: 'Groups' }, { id: 'payee', label: 'Payees' }];
  const raw = store.spendingBreakdown({
    fromMonth: state.from, toMonth: state.to, groupBy: state.groupBy,
    categoryIds: state.categoryIds || undefined, accountIds: state.accountIds || undefined,
  });
  const total = raw.reduce((s, r) => s + r.amount, 0);

  let slices = raw;
  if (raw.length > 11) {
    const top = raw.slice(0, 10);
    const restAmt = raw.slice(10).reduce((s, r) => s + r.amount, 0);
    slices = [...top, { id: '__other__', name: 'Everything Else', amount: restAmt }];
  }
  slices = slices.map((s, i) => ({ ...s, color: `var(${CHART_COLORS[i % CHART_COLORS.length]})`, pct: total ? (s.amount / total) * 100 : 0 }));

  if (isMobileReport()) {
    renderMobileSpendingReport(root, slices, total, GROUPBYS);
    return;
  }

  root.innerHTML = h`${tabBar('spending')}
  ${pageHead('Spending Breakdown')}
  <div class="report-body">
    ${filterRow('spending')}
    <div class="spending-cards">
      <div class="card total-spending-card">
        <div class="card-head-row">
          <div>
            <div class="card-label">Total Spending</div>
            <div class="card-big-amt">${fmt(total)}</div>
          </div>
          <div class="segmented">
            ${GROUPBYS.map(g => `<button type="button" class="segment-btn ${g.id === state.groupBy ? 'active' : ''}" data-gb="${g.id}">${g.label}</button>`).join('')}
          </div>
        </div>
        <div class="donut-wrap">${donutSvg(slices, total)}</div>
      </div>
      <div class="card spending-list-card">
        <div class="spending-list-head"><span>${GROUPBYS.find(g => g.id === state.groupBy).label}</span><span>Total Spending</span></div>
        ${!slices.length ? emptyState('No spending to show yet') : h`<div class="legend-list">
          ${slices.map(s => h`<div class="legend-row ${state.highlight === s.id ? 'hl' : ''} ${state.highlight && state.highlight !== s.id ? 'dim' : ''}" data-slice="${s.id}">
            <span class="legend-dot" style="background:${s.color}"></span>
            <span class="legend-name">${s.name}</span>
            <span class="legend-amt">${fmt(s.amount)}</span>
          </div>`)}
        </div>`}
      </div>
    </div>
  </div>`;

  wireReportSwitcher(root);
  bindFilterRow(root, () => spendingReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`spending-breakdown-${state.from}_${state.to}.csv`,
    [['Name', 'Amount'], ...slices.map(s => [s.name, (s.amount / 100).toFixed(2)]), ['Total', (total / 100).toFixed(2)]]);
  root.querySelectorAll('[data-gb]').forEach(b => b.onclick = () => { state.groupBy = b.dataset.gb; state.highlight = null; spendingReport(root); });
  root.querySelectorAll('[data-slice]').forEach(el => {
    el.onclick = () => { state.highlight = state.highlight === el.dataset.slice ? null : el.dataset.slice; spendingReport(root); };
  });
  root.querySelectorAll('[data-arc]').forEach(el => {
    el.onclick = () => { state.highlight = state.highlight === el.dataset.arc ? null : el.dataset.arc; spendingReport(root); };
  });
}

function renderMobileSpendingReport(root, slices, total, groupBys) {
  const exportAction = () => downloadCsv(`spending-breakdown-${state.from}_${state.to}.csv`,
    [['Name', 'Amount'], ...slices.map(item => [item.name, (item.amount / 100).toFixed(2)]), ['Total', (total / 100).toFixed(2)]]);
  root.innerHTML = h`<div class="mobile-report-page">
    ${mobileReportHeader('spending', 'Spending Breakdown')}
    ${mobileRangeBar('spending')}
    <main class="mobile-report-content">
      <section class="mobile-hero-card">
        <span class="mobile-eyebrow">Total spending</span>
        <strong class="mobile-hero-value">${fmt(total)}</strong>
        <span class="mobile-hero-period">${state.from === state.to ? monthLabel(state.from) : `${monthLabel(state.from)} – ${monthLabel(state.to)}`}</span>
        <span class="mobile-hero-bar mobile-allocation-bar" aria-label="Spending allocation by ${groupBys.find(group => group.id === state.groupBy).label.toLowerCase()}">
          ${slices.map(item => h`<i style="flex-grow:${item.amount};background:${item.color}" title="${item.name}: ${Math.round(item.pct)}%"></i>`).join('')}
        </span>
      </section>
      <div class="mobile-report-segmented">
        ${groupBys.map(group => `<button class="${group.id === state.groupBy ? 'active' : ''}" data-gb="${group.id}">${group.label}</button>`).join('')}
      </div>
      <section class="mobile-list-section">
        <div class="mobile-section-title"><h2>${groupBys.find(group => group.id === state.groupBy).label}</h2><span>${slices.length} shown</span></div>
        <div class="mobile-data-card">${slices.length ? mobileProgressRows(slices) : emptyState('No spending to show yet')}</div>
      </section>
    </main>
    ${mobileFilterPanel('spending')}
  </div>`;
  wireMobileReport(root, 'spending', () => spendingReport(root), exportAction);
  root.querySelectorAll('[data-gb]').forEach(button => button.onclick = () => { state.groupBy = button.dataset.gb; state.highlight = null; spendingReport(root); });
}

function donutSvg(slices, total) {
  const R = 80, CX = 100, CY = 100, STROKE = 32;
  const circumference = 2 * Math.PI * R;
  if (!total) {
    return `<svg viewBox="0 0 200 200" class="donut-svg">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--track)" stroke-width="${STROKE}"/>
      <text x="${CX}" y="${CY - 6}" text-anchor="middle" class="donut-total">${fmt(0)}</text>
      <text x="${CX}" y="${CY + 14}" text-anchor="middle" class="donut-total-label">Total Spending</text>
    </svg>`;
  }
  const GAP = slices.length > 1 ? 2 : 0; // px of separator visible between adjacent slices
  let acc = 0;
  const arcs = slices.map(s => {
    const frac = total ? s.amount / total : 0;
    const dash = Math.max(0, frac * circumference - GAP);
    const offset = -acc * circumference;
    acc += frac;
    const hl = state.highlight === s.id;
    const dim = state.highlight && !hl;
    return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${s.color}"
      stroke-width="${hl ? STROKE + 8 : STROKE}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}" stroke-linecap="butt" transform="rotate(-90 ${CX} ${CY})" class="donut-arc ${dim ? 'dim' : ''}"
      data-arc="${s.id}"/>`;
  }).join('');
  return `<svg viewBox="0 0 200 200" class="donut-svg">
    ${arcs}
    <text x="${CX}" y="${CY - 6}" text-anchor="middle" class="donut-total">${fmt(total)}</text>
    <text x="${CX}" y="${CY + 14}" text-anchor="middle" class="donut-total-label">Total Spending</text>
  </svg>`;
}

// ============================================================
// 2. SPENDING TRENDS
// ============================================================
function trendsReport(root) {
  const months = monthRange(state.from, state.to);
  const byMonth = months.map(m => ({
    month: m,
    amount: store.spendingBreakdown({
      fromMonth: m, toMonth: m, groupBy: 'category',
      categoryIds: state.categoryIds || undefined, accountIds: state.accountIds || undefined,
    }).reduce((s, r) => s + r.amount, 0),
  }));
  const total = byMonth.reduce((s, m) => s + m.amount, 0);
  const avg = Math.round(total / (byMonth.length || 1));

  if (isMobileReport()) {
    renderMobileTrendsReport(root, byMonth, total, avg);
    return;
  }

  root.innerHTML = h`${tabBar('trends')}
  ${pageHead('Spending Trends')}
  <div class="report-body">
    ${filterRow('trends')}
    <div class="card trends-card">
      <div class="card-label">Average Monthly Spending</div>
      <div class="card-big-amt">${fmt(avg)}</div>
      <div class="card-sub-amt">Total Spending: ${fmt(total)}</div>
      ${!byMonth.length ? emptyState('No spending in this range.') : `<div class="chart-wrap">${trendsSvg(byMonth, avg)}</div>`}
    </div>
    ${byMonth.length ? h`<div class="card trends-table-card">
      <table class="report-table">
        <thead><tr><th>Month</th><th class="num">Total Spending</th><th class="num">Compared to Average</th></tr></thead>
        <tbody>
          ${byMonth.map(m => {
            const diff = avg ? ((m.amount - avg) / avg) * 100 : 0;
            const under = m.amount <= avg;
            return h`<tr>
              <td>${monthLabel(m.month)}</td>
              <td class="num">${fmt(m.amount)}</td>
              <td class="num ${under ? 'pos-text' : 'neg-text'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>` : ''}
  </div>`;

  wireReportSwitcher(root);
  bindFilterRow(root, () => trendsReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`spending-trends-${state.from}_${state.to}.csv`,
    [['Month', 'Total Spending', 'Compared to Average %'],
     ...byMonth.map(m => [monthLabel(m.month), (m.amount / 100).toFixed(2), avg ? (((m.amount - avg) / avg) * 100).toFixed(1) : '0.0']),
     ['Average', (avg / 100).toFixed(2), '']]);
}

function renderMobileTrendsReport(root, byMonth, total, avg) {
  const exportAction = () => downloadCsv(`spending-trends-${state.from}_${state.to}.csv`,
    [['Month', 'Total Spending', 'Compared to Average %'], ...byMonth.map(item => [monthLabel(item.month), (item.amount / 100).toFixed(2), avg ? (((item.amount - avg) / avg) * 100).toFixed(1) : '0.0'])]);
  const max = Math.max(1, ...byMonth.map(item => item.amount));
  root.innerHTML = h`<div class="mobile-report-page">
    ${mobileReportHeader('trends', 'Spending Trends')}
    ${mobileRangeBar('trends')}
    <main class="mobile-report-content">
      <section class="mobile-hero-card">
        <span class="mobile-eyebrow">Average per month</span>
        <strong class="mobile-hero-value">${fmt(avg)}</strong>
        <span class="mobile-hero-period">${fmt(total)} total across ${byMonth.length} month${byMonth.length === 1 ? '' : 's'}</span>
      </section>
      <section class="mobile-chart-card">
        <div class="mobile-section-title"><h2>Monthly spending</h2><span>Average shown as dotted line</span></div>
        ${byMonth.length ? trendsSvg(byMonth, avg) : emptyState('No spending in this range.')}
      </section>
      <section class="mobile-list-section">
        <div class="mobile-section-title"><h2>Month by month</h2></div>
        <div class="mobile-data-card">${byMonth.map(item => {
          const difference = avg ? ((item.amount - avg) / avg) * 100 : 0;
          return h`<div class="mobile-month-row"><span><b>${monthLabel(item.month)}</b><i><em style="width:${Math.max(3, Math.round((item.amount / max) * 100))}%"></em></i></span><span><strong>${fmt(item.amount)}</strong><small class="${difference <= 0 ? 'pos-text' : 'neg-text'}">${difference >= 0 ? '+' : ''}${difference.toFixed(1)}%</small></span></div>`;
        }).join('')}</div>
      </section>
    </main>
    ${mobileFilterPanel('trends')}
  </div>`;
  wireMobileReport(root, 'trends', () => trendsReport(root), exportAction);
}

function trendsSvg(byMonth, avg) {
  const W = 900, H = 300, padL = 92, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = byMonth.length;
  const bw = Math.min(36, (plotW / n) * 0.5);
  const maxV = Math.max(1, avg, ...byMonth.map(m => m.amount));
  const step = niceStep(maxV);
  const yMax = Math.ceil(maxV / step) * step;
  const x = i => padL + (n === 1 ? plotW / 2 : (i / n + 0.5 / n) * plotW);
  const y = v => padT + plotH - (v / yMax) * plotH;

  const gridlines = [];
  for (let v = 0; v <= yMax; v += step) {
    gridlines.push(`<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="ln-grid"/>`);
    gridlines.push(`<text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="ln-ylabel" text-anchor="end">${fmt(v)}</text>`);
  }
  const bars = byMonth.map((m, i) => {
    const cx = x(i);
    const barY = y(m.amount);
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${barY.toFixed(1)}" width="${bw.toFixed(1)}" height="${(plotH - (barY - padT)).toFixed(1)}" class="bar-spend" data-i="${i}"/>`;
  }).join('');
  const baselineY = y(avg).toFixed(1);
  const baseline = `<line x1="${padL}" y1="${baselineY}" x2="${W - padR}" y2="${baselineY}" class="ln-baseline"/>`;
  const linePath = byMonth.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.amount).toFixed(1)}`).join(' ');
  const dots = byMonth.map((m, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(m.amount).toFixed(1)}" r="3.5" class="trend-dot"/>`).join('');
  const everyN = Math.ceil(n / 12);
  const xlabels = byMonth.map((m, i) => i % everyN === 0
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ln-xlabel" text-anchor="middle">${monthLabel(m.month).slice(0, 3)}</text>` : '').join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="trends-svg" preserveAspectRatio="xMidYMid meet">
    ${gridlines.join('')}
    ${baseline}
    ${bars}
    <path d="${linePath}" class="trend-line"/>
    ${dots}
    ${xlabels}
  </svg>`;
}

// ============================================================
// 3. NET WORTH
// ============================================================
function netWorthReport(root) {
  const all = store.netWorthSeries();
  const accSet = state.accountIds ? new Set(state.accountIds) : null;
  const series = all.filter(p => p.month >= state.from && p.month <= state.to)
    .map(p => accSet ? netWorthForAccounts(p.month, accSet) : p);

  if (isMobileReport()) {
    renderMobileNetWorthReport(root, series);
    return;
  }

  root.innerHTML = h`${tabBar('net-worth')}
  ${pageHead('Net Worth')}
  <div class="report-body">
    ${filterRow('net-worth')}
    ${!series.length ? emptyState('No net worth data in this range.') : h`
    <div class="card netw-card">
      ${netWorthSummary(series)}
      <div class="chart-wrap" id="nw-chart-wrap">${netWorthSvg(series)}</div>
      <div class="chart-tooltip" id="nw-tooltip" hidden></div>
    </div>
    <div class="card netw-table-card">
      <table class="report-table">
        <thead><tr><th>Month</th><th class="num">Net Worth</th><th class="num">Monthly Change</th></tr></thead>
        <tbody>
          ${series.map((p, i) => {
            const prev = i > 0 ? series[i - 1].netWorth : p.netWorth;
            const chg = p.netWorth - prev;
            const pct = prev ? (chg / Math.abs(prev)) * 100 : 0;
            return h`<tr>
              <td>${monthLabel(p.month)}</td>
              <td class="num">${fmt(p.netWorth)}</td>
              <td class="num muted">${fmt(chg, { sign: true })} ${i > 0 ? `(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`}
  </div>`;

  wireReportSwitcher(root);
  bindFilterRow(root, () => netWorthReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`net-worth-${state.from}_${state.to}.csv`,
    [['Month', 'Assets', 'Debts', 'Net Worth'], ...series.map(p => [monthLabel(p.month), (p.assets / 100).toFixed(2), (p.liabilities / 100).toFixed(2), (p.netWorth / 100).toFixed(2)])]);
  if (series.length) bindNetWorthChart(root, series);
}

function renderMobileNetWorthReport(root, series) {
  const exportAction = () => downloadCsv(`net-worth-${state.from}_${state.to}.csv`,
    [['Month', 'Assets', 'Debts', 'Net Worth'], ...series.map(item => [monthLabel(item.month), (item.assets / 100).toFixed(2), (item.liabilities / 100).toFixed(2), (item.netWorth / 100).toFixed(2)])]);
  const latest = series.at(-1);
  const first = series[0];
  const change = latest && first ? latest.netWorth - first.netWorth : 0;
  root.innerHTML = h`<div class="mobile-report-page">
    ${mobileReportHeader('net-worth', 'Net Worth')}
    ${mobileRangeBar('net-worth')}
    <main class="mobile-report-content">
      ${latest ? h`<section class="mobile-hero-card mobile-net-hero">
        <span class="mobile-eyebrow">Net worth</span>
        <strong class="mobile-hero-value ${latest.netWorth < 0 ? 'neg-text' : ''}">${fmt(latest.netWorth)}</strong>
        <div class="mobile-net-pairs"><span><small>Assets</small><b>${fmt(latest.assets)}</b></span><span><small>Debts</small><b class="neg-text">${fmt(latest.liabilities)}</b></span></div>
        <div class="mobile-change-pill ${change >= 0 ? 'positive' : 'negative'}">${fmt(change, { sign: true })} over this period</div>
      </section>
      <section class="mobile-chart-card"><div class="mobile-section-title"><h2>Net worth history</h2></div>${netWorthSvg(series)}</section>
      <section class="mobile-list-section"><div class="mobile-section-title"><h2>Monthly history</h2></div><div class="mobile-data-card">${series.slice().reverse().map((item, index) => {
        const previous = series[series.length - 2 - index];
        const delta = previous ? item.netWorth - previous.netWorth : 0;
        return h`<div class="mobile-history-row"><span><b>${monthLabel(item.month)}</b><small>Assets ${fmt(item.assets)} · Debts ${fmt(item.liabilities)}</small></span><span><strong>${fmt(item.netWorth)}</strong><small class="${delta >= 0 ? 'pos-text' : 'neg-text'}">${fmt(delta, { sign: true })}</small></span></div>`;
      }).join('')}</div></section>` : emptyState('No net worth data in this range.')}
    </main>
    ${mobileFilterPanel('net-worth')}
  </div>`;
  wireMobileReport(root, 'net-worth', () => netWorthReport(root), exportAction);
}

// ponytail: account-filtered net worth recomputed from raw transactions here (store's netWorthSeries has no
// account filter param); fine at demo data scale, revisit if store grows an accountIds arg for this query.
function netWorthForAccounts(month, accSet) {
  const cut = addMonths(month, 1);
  let assets = 0, liabilities = 0;
  for (const a of store.state.accounts) {
    if (!accSet.has(a.id)) continue;
    let bal = 0;
    for (const tx of store.state.transactions) if (tx.accountId === a.id && tx.date < cut) bal += tx.amount;
    if (bal >= 0) assets += bal; else liabilities += bal;
  }
  return { month, assets, liabilities, netWorth: assets + liabilities };
}

function netWorthSummary(series) {
  const last = series.at(-1), first = series[0];
  const change = last.netWorth - first.netWorth;
  const pct = first.netWorth ? (change / Math.abs(first.netWorth)) * 100 : 0;
  return h`<div class="summary-strip">
    <div class="summary-item"><span class="card-label">Net Worth</span><span class="card-big-amt">${fmt(last.netWorth)}</span></div>
    <div class="nw-legend">
      <div class="nw-legend-col">
        <span class="nw-legend-head"><span class="swatch sq-asset"></span>Assets</span>
        <span class="nw-legend-val">${fmt(last.assets)}</span>
      </div>
      <div class="nw-legend-col">
        <span class="nw-legend-head"><span class="swatch sq-debt"></span>Debts</span>
        <span class="nw-legend-val">${fmt(last.liabilities)}</span>
      </div>
      <div class="nw-legend-col">
        <span class="nw-legend-head">Change in Net Worth</span>
        <span class="nw-legend-val ${change >= 0 ? 'pos-text' : 'neg-text'}">${fmt(change, { sign: true })} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>
      </div>
    </div>
  </div>`;
}

function niceStep(maxVal, ticks = 4) {
  const raw = maxVal / ticks || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
}

function netWorthSvg(series) {
  const W = 900, H = 340, padL = 92, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = series.length;
  const bw = Math.min(28, (plotW / n) * 0.36);
  const maxAbs = Math.max(1, ...series.map(p => Math.max(p.assets, Math.abs(p.liabilities), Math.abs(p.netWorth))));
  const step = niceStep(maxAbs);
  const yMax = Math.ceil(maxAbs / step) * step;
  const x = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = v => padT + plotH - (v / yMax) * plotH;

  const gridlines = [];
  for (let v = 0; v <= yMax; v += step) {
    gridlines.push(`<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="ln-grid"/>`);
    gridlines.push(`<text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="ln-ylabel" text-anchor="end">${fmt(v)}</text>`);
  }
  const everyN = Math.ceil(n / 12);
  const xlabels = series.map((p, i) => i % everyN === 0
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ln-xlabel" text-anchor="middle">${p.month.slice(5, 7)}/${p.month.slice(2, 4)}</text>` : '').join('');

  const bars = series.map((p, i) => {
    const cx = x(i);
    const assetBar = p.assets > 0 ? `<rect x="${(cx - bw / 2 - bw * 0.55).toFixed(1)}" y="${y(p.assets).toFixed(1)}" width="${(bw / 2).toFixed(1)}" height="${(plotH - (y(p.assets) - padT)).toFixed(1)}" class="bar-asset"/>` : '';
    const debtAbs = Math.abs(p.liabilities);
    const liabBar = debtAbs > 0 ? `<rect x="${(cx + bw * 0.05).toFixed(1)}" y="${y(debtAbs).toFixed(1)}" width="${(bw / 2).toFixed(1)}" height="${(plotH - (y(debtAbs) - padT)).toFixed(1)}" class="bar-liability"/>` : '';
    return `<g class="nw-col" data-i="${i}">
      <rect x="${(cx - bw / 2 - bw * 0.6).toFixed(1)}" y="${padT}" width="${(bw * 1.2 + bw * 0.6).toFixed(1)}" height="${plotH}" class="nw-hit" fill="transparent"/>
      ${assetBar}${liabBar}
    </g>`;
  }).join('');

  const linePath = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(' ');
  const dots = series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.netWorth).toFixed(1)}" r="3.5" class="nw-dot" data-i="${i}"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="nw-svg" preserveAspectRatio="xMidYMid meet">
    ${gridlines.join('')}
    ${bars}
    <path d="${linePath}" class="nw-line"/>
    ${dots}
    ${xlabels}
  </svg>`;
}

function bindNetWorthChart(root, series) {
  const tooltip = root.querySelector('#nw-tooltip');
  const wrap = root.querySelector('#nw-chart-wrap');
  root.querySelectorAll('.nw-col, .nw-dot').forEach(el => {
    const show = () => {
      const i = +el.dataset.i;
      const p = series[i];
      tooltip.hidden = false;
      tooltip.innerHTML = h`<strong>${monthLabel(p.month)}</strong>
        <div>Assets: ${fmt(p.assets)}</div>
        <div>Debts: ${fmt(p.liabilities)}</div>
        <div>Net Worth: ${fmt(p.netWorth)}</div>`;
    };
    el.onmouseenter = show;
    el.onclick = show;
  });
  wrap.onmouseleave = () => { tooltip.hidden = true; };
}

// ============================================================
// 4. INCOME V EXPENSE
// ============================================================
function incomeExpenseReport(root) {
  const data = store.incomeVsExpense({ fromMonth: state.from, toMonth: state.to });
  const hasData = data.months && data.months.length;
  if (isMobileReport()) {
    renderMobileIncomeExpenseReport(root, data, hasData);
    return;
  }
  root.innerHTML = h`${tabBar('income-expense')}
  ${pageHead('Income v Expense')}
  <div class="report-body">
    ${filterRow('income-expense')}
    <div class="card ie-card">
      ${!hasData ? emptyState('No income or expense data in this range.') : ieTable(data)}
    </div>
  </div>`;
  wireReportSwitcher(root);
  bindFilterRow(root, () => incomeExpenseReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`income-vs-expense-${state.from}_${state.to}.csv`, ieCsvRows(data));
  if (hasData) {
    root.querySelectorAll('[data-toggle-group]').forEach(el => {
      el.onclick = () => {
        const id = el.dataset.toggleGroup;
        state.expandedGroups.has(id) ? state.expandedGroups.delete(id) : state.expandedGroups.add(id);
        incomeExpenseReport(root);
      };
    });
    root.querySelectorAll('[data-toggle-section]').forEach(el => {
      el.onclick = () => {
        const id = 'section:' + el.dataset.toggleSection;
        state.expandedGroups.has(id) ? state.expandedGroups.delete(id) : state.expandedGroups.add(id);
        incomeExpenseReport(root);
      };
    });
  }
}

function renderMobileIncomeExpenseReport(root, data, hasData) {
  const incomeRows = data.income?.payeeRows || [];
  const expenseRows = data.expense?.groupRows || [];
  const income = incomeRows.reduce((sum, row) => sum + row.values.reduce((a, b) => a + b, 0), 0);
  const expenses = expenseRows.reduce((sum, row) => sum + row.values.reduce((a, b) => a + b, 0), 0);
  const net = income - expenses;
  const comparisonMax = Math.max(1, income, expenses);
  const exportAction = () => downloadCsv(`income-vs-expense-${state.from}_${state.to}.csv`, ieCsvRows(data));
  root.innerHTML = h`<div class="mobile-report-page">
    ${mobileReportHeader('income-expense', 'Income v Expense')}
    ${mobileRangeBar('income-expense')}
    <main class="mobile-report-content">
      ${hasData ? h`<section class="mobile-hero-card mobile-income-hero">
        <span class="mobile-eyebrow">Net income</span>
        <strong class="mobile-hero-value ${net >= 0 ? 'pos-text' : 'neg-text'}">${fmt(net, { sign: true })}</strong>
        <p>${net >= 0 ? 'You kept more than you spent in this period.' : 'Spending was higher than income in this period.'}</p>
        <div class="mobile-compare-line"><span><b>Income</b><strong>${fmt(income)}</strong></span><i><em class="income" style="width:${Math.round((income / comparisonMax) * 100)}%"></em></i></div>
        <div class="mobile-compare-line"><span><b>Expenses</b><strong>${fmt(expenses)}</strong></span><i><em class="expense" style="width:${Math.round((expenses / comparisonMax) * 100)}%"></em></i></div>
      </section>
      <section class="mobile-list-section"><div class="mobile-section-title"><h2>Income sources</h2></div><div class="mobile-data-card">${incomeRows.map(row => h`<div class="mobile-simple-row"><span>${row.name}</span><strong class="pos-text">${fmt(row.values.reduce((a, b) => a + b, 0))}</strong></div>`).join('') || '<div class="mobile-simple-empty">No income in this period</div>'}</div></section>
      <section class="mobile-list-section"><div class="mobile-section-title"><h2>Expense groups</h2></div><div class="mobile-data-card">${expenseRows.map(row => h`<div class="mobile-simple-row"><span>${row.name}</span><strong>${fmt(row.values.reduce((a, b) => a + b, 0))}</strong></div>`).join('') || '<div class="mobile-simple-empty">No expenses in this period</div>'}</div></section>` : emptyState('No income or expense data in this range.')}
    </main>
    ${mobileFilterPanel('income-expense')}
  </div>`;
  wireMobileReport(root, 'income-expense', () => incomeExpenseReport(root), exportAction);
}

function rowVals(vals) {
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = Math.round(total / (vals.length || 1));
  return [...vals, avg, total];
}

function ieCsvRows(data) {
  const months = data.months;
  const header = ['', ...months.map(monthLabel), 'Average', 'Total'];
  const rows = [header];
  rows.push(['Income']);
  (data.income.payeeRows || []).forEach(r => rows.push([r.name, ...rowVals(r.values).map(v => (v / 100).toFixed(2))]));
  const totalIncomeVals = months.map((_, i) => (data.income.payeeRows || []).reduce((s, r) => s + r.values[i], 0));
  rows.push(['Total Income', ...rowVals(totalIncomeVals).map(v => (v / 100).toFixed(2))]);
  rows.push(['Expense']);
  (data.expense.groupRows || []).forEach(g => {
    rows.push([g.name, ...rowVals(g.values).map(v => (v / 100).toFixed(2))]);
    (g.categoryRows || []).forEach(c => rows.push(['  ' + c.name, ...rowVals(c.values).map(v => (v / 100).toFixed(2))]));
  });
  const totalExpenseVals = months.map((_, i) => (data.expense.groupRows || []).reduce((s, r) => s + r.values[i], 0));
  rows.push(['Total Expenses', ...rowVals(totalExpenseVals).map(v => (v / 100).toFixed(2))]);
  const netVals = months.map((_, i) => totalIncomeVals[i] - totalExpenseVals[i]);
  rows.push(['Net Income', ...rowVals(netVals).map(v => (v / 100).toFixed(2))]);
  return rows;
}

function ieTable(data) {
  const months = data.months;
  const cols = [...months.map(m => monthLabel(m)), 'AVERAGE', 'TOTAL'];
  const moneyRow = (label, vals, cls = '') => h`<tr class="${cls}"><td class="ie-name">${label}</td>${rowVals(vals).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}</tr>`;

  const incomeExpanded = state.expandedGroups.has('section:income');
  const incomeRows = incomeExpanded ? (data.income.payeeRows || []).map(r => moneyRow(r.name, r.values)) : [];
  const totalIncomeVals = months.map((_, i) => (data.income.payeeRows || []).reduce((s, r) => s + r.values[i], 0));

  const expenseExpanded = state.expandedGroups.has('section:expense');
  const expenseGroupBlocks = expenseExpanded ? (data.expense.groupRows || []).map(g => {
    const expanded = state.expandedGroups.has(g.id);
    const groupRow = h`<tr class="ie-group-row" data-toggle-group="${g.id}">
      <td class="ie-name"><span class="ie-caret">${expanded ? '▾' : '▸'}</span>${g.name}</td>
      ${rowVals(g.values).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}
    </tr>`;
    const catRows = expanded ? (g.categoryRows || []).map(c => moneyRow(c.name, c.values, 'ie-cat-row')) : [];
    return [groupRow, ...catRows];
  }).flat() : [];
  const totalExpenseVals = months.map((_, i) => (data.expense.groupRows || []).reduce((s, r) => s + r.values[i], 0));

  const netVals = months.map((_, i) => totalIncomeVals[i] - totalExpenseVals[i]);
  const netTotal = netVals.reduce((a, b) => a + b, 0);

  return h`<div class="ie-scroll">
    <table class="ie-table">
      <thead><tr><th class="ie-name">&nbsp;</th>${cols.map(c => `<th class="num">${c}</th>`).join('')}</tr></thead>
      <tbody>
        <tr class="ie-section-head ie-income-head" data-toggle-section="income">
          <td class="ie-name"><span class="ie-caret">${incomeExpanded ? '▾' : '▸'}</span>Income</td><td colspan="${cols.length}"></td>
        </tr>
        ${incomeRows}
        <tr class="ie-total-row ie-tinted"><td class="ie-name">Total All Income Sources</td>${rowVals(totalIncomeVals).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}</tr>
        <tr class="ie-total-row"><td class="ie-name">Total Income</td>${rowVals(totalIncomeVals).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}</tr>
        <tr class="ie-section-head ie-expense-head" data-toggle-section="expense">
          <td class="ie-name"><span class="ie-caret">${expenseExpanded ? '▾' : '▸'}</span>Expense</td><td colspan="${cols.length}"></td>
        </tr>
        ${expenseGroupBlocks}
        <tr class="ie-total-row ie-tinted"><td class="ie-name">Total Expenses</td>${rowVals(totalExpenseVals).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}</tr>
        <tr class="ie-net-row"><td class="ie-name">Net Income</td>${rowVals(netVals).map(v => `<td class="num money ${netTotal >= 0 ? 'pos-text' : 'neg-text'}">${fmt(v, { sign: true })}</td>`).join('')}</tr>
      </tbody>
    </table>
  </div>`;
}

// ============================================================
// 5. AGE OF MONEY
// ============================================================
function ageOfMoneyReport(root) {
  const all = store.ageOfMoneySeries();
  const series = all.filter(p => p.month >= state.from && p.month <= state.to);
  const current = store.ageOfMoney();

  if (isMobileReport()) {
    renderMobileAgeOfMoneyReport(root, series, current);
    return;
  }

  root.innerHTML = h`${tabBar('age-of-money')}
  ${pageHead('Age of Money')}
  <div class="report-body">
    ${filterRow('age-of-money')}
    <div class="card aom-card">
      ${current == null ? aomEmptyCard() : h`
        <div class="card-label">Age of Money</div>
        <div class="card-big-amt">${current} days</div>
        ${series.length ? `<div class="chart-wrap">${aomSvg(series)}</div>` : ''}
      `}
    </div>
    <div class="card aom-explainer-card">
      <div class="explainer-head">Understanding Age of Money</div>
      <div class="explainer-divider"></div>
      <p>Age of Money looks at the most recent 10 times you spent cash and asks how many days that money had been sitting in your accounts before it went out the door. A high number means you're spending dollars you earned a while ago rather than living off whatever just landed: a cushion, not a coincidence.</p>
      <p>YNAB's own rule of thumb is to push this past 30 days. Once you're there, this month's bills are covered by money you already have, so a slow paycheck or a surprise expense stops being an emergency and starts being a Tuesday.</p>
    </div>
  </div>`;

  wireReportSwitcher(root);
  bindFilterRow(root, () => ageOfMoneyReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`age-of-money-${state.from}_${state.to}.csv`,
    [['Month', 'Age of Money (days)'], ...series.map(p => [monthLabel(p.month), p.aom == null ? '' : p.aom])]);
}

function renderMobileAgeOfMoneyReport(root, series, current) {
  const exportAction = () => downloadCsv(`age-of-money-${state.from}_${state.to}.csv`,
    [['Month', 'Age of Money (days)'], ...series.map(item => [monthLabel(item.month), item.aom == null ? '' : item.aom])]);
  root.innerHTML = h`<div class="mobile-report-page">
    ${mobileReportHeader('age-of-money', 'Age of Money')}
    ${mobileRangeBar('age-of-money')}
    <main class="mobile-report-content">
      <section class="mobile-hero-card mobile-age-hero">
        <span class="mobile-eyebrow">Your current cushion</span>
        ${current == null ? h`<strong class="mobile-age-pending">Still learning</strong><p>Keep recording cash-account spending and this measure will appear once there is enough history.</p>` : h`<strong class="mobile-hero-value">${current} <small>days</small></strong><p>Your recent spending used money that had been available for about ${current} days.</p>`}
      </section>
      ${series.length ? `<section class="mobile-chart-card"><div class="mobile-section-title"><h2>Age over time</h2></div>${aomSvg(series)}</section>` : ''}
      <section class="mobile-explainer-card"><span aria-hidden="true">◷</span><div><h2>What this means</h2><p>Age of Money looks at when recently spent cash first entered your accounts. A larger number generally means more breathing room between earning and spending.</p><p>Use it as a trend, not a score: consistent progress matters more than any single day.</p></div></section>
    </main>
    ${mobileFilterPanel('age-of-money')}
  </div>`;
  wireMobileReport(root, 'age-of-money', () => ageOfMoneyReport(root), exportAction);
}

function aomEmptyCard() {
  return h`<div class="aom-empty-inner">
    <div class="aom-empty-headline">Still building up a track record. Check back soon.</div>
    <p class="muted">Age of Money needs at least 10 spending transactions on your cash accounts before it can measure anything. Log a few more purchases and this card will fill in with your number.</p>
  </div>`;
}

function aomSvg(series) {
  const W = 900, H = 260, padL = 92, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = series.length;
  const vals = series.map(p => p.aom ?? 0);
  const maxV = Math.max(1, ...vals);
  const step = niceStep(maxV);
  const yMax = Math.ceil(maxV / step) * step;
  const x = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = v => padT + plotH - (v / yMax) * plotH;

  const gridlines = [];
  for (let v = 0; v <= yMax; v += step) {
    gridlines.push(`<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="ln-grid"/>`);
    gridlines.push(`<text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="ln-ylabel" text-anchor="end">${v}</text>`);
  }
  const everyN = Math.ceil(n / 12);
  const xlabels = series.map((p, i) => i % everyN === 0
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ln-xlabel" text-anchor="middle">${monthLabel(p.month).slice(0, 3)}</text>` : '').join('');

  const linePath = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.aom ?? 0).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const dots = series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.aom ?? 0).toFixed(1)}" r="3.5" class="aom-dot"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="aom-svg" preserveAspectRatio="xMidYMid meet">
    ${gridlines.join('')}
    <path d="${areaPath}" class="aom-area"/>
    <path d="${linePath}" class="aom-line"/>
    ${dots}
    ${xlabels}
  </svg>`;
}

// ============================================================
const TAB_FNS = {
  overview: reflectOverview,
  spending: spendingReport,
  trends: trendsReport,
  'net-worth': netWorthReport,
  'income-expense': incomeExpenseReport,
  'age-of-money': ageOfMoneyReport,
};

export function render(root, { report }) {
  state.report = report;
  root.className = 'reflect-view';
  (TAB_FNS[report] || spendingReport)(root);
}
