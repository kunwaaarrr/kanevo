// Forecast ("what-if") spreadsheet view. Pure UI — all math lives in js/lib/forecast.js.
import { baseline, forecast } from '../lib/forecast.js';
import { store } from '../store.js';
import { fmt, fmtExact, parseAmount, thisMonth, h, ICONS } from '../util.js';
import { toast } from '../app.js';

// module-local UI state — survives re-render (render() rebuilds root.innerHTML each time)
let horizon = 12;                 // 1 | 6 | 12 | 24
let overrides = emptyOverrides();
let editing = null;               // { kind: 'income'|'cat', id } — first-column cell in edit mode
let rootEl;
let currentVariant = 'classic';
const v2Expanded = new Set();
let v2ResultMode = 'chart';
let v2ShowUnchanged = false;
let v2ShowZero = false;
let v2SpanOpen = false;

function emptyOverrides() { return { categories: {}, income: null, loanExtra: {} }; }

function hasAnyOverride() {
  return Object.keys(overrides.categories).length > 0
    || overrides.income != null
    || Object.values(overrides.loanExtra).some(v => v);
}

// "Aug 26" — short month + 2-digit year, per spec's header example
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

// ---------- row what-if control cluster (first column of income/expense rows) ----------
function overrideOf(kind, id) {
  return kind === 'income' ? overrides.income : overrides.categories[id];
}
function setOverride(kind, id, val) {
  if (kind === 'income') overrides.income = val;
  else if (val == null) delete overrides.categories[id];
  else overrides.categories[id] = val;
}

function rowControls(kind, id, base) {
  const ov = overrideOf(kind, id);
  const off = ov?.mode === 'off';
  const pct = ov?.mode === 'scale' ? ov.pct : 100;
  const displayVal = ov?.mode === 'set' ? ov.value : ov?.mode === 'scale' ? Math.round(base * pct / 100) : base;
  const isEditingThis = editing && editing.kind === kind && editing.id === id;
  return h`<div class="fc-controls">
    <button class="fc-toggle ${off ? 'off' : ''}" data-act="toggle-off" data-kind="${kind}" data-id="${id}" title="${off ? 'Enable' : 'Disable'}">${off ? '○' : '●'}</button>
    ${isEditingThis
      ? `<input class="fc-edit-input" data-kind="${kind}" data-id="${id}" type="text" value="${fmtExact(base).replace('$', '')}">`
      : h`<button class="fc-amt" data-act="edit-amt" data-kind="${kind}" data-id="${id}">${fmt(displayVal)}</button>`}
    <span class="fc-or">or</span>
    <span class="fc-stepper">
      <button class="fc-step-btn" data-act="step" data-kind="${kind}" data-id="${id}" data-dir="-1">−</button>
      <span class="fc-pct ${pct === 100 ? 'default' : ''}">${pct}%</span>
      <button class="fc-step-btn" data-act="step" data-kind="${kind}" data-id="${id}" data-dir="1">+</button>
    </span>
    ${ov ? `<button class="fc-reset" data-act="reset-row" data-kind="${kind}" data-id="${id}" title="Reset">✕</button>` : ''}
  </div>`;
}

function rowLabel(kind, id, name, base) {
  return h`<div class="fc-row-label">
    <span class="fc-name">${name}</span>
    ${[rowControls(kind, id, base)]}
  </div>`;
}

// ---------- grid cell helpers ----------
function numCell(cents, extraClass = '') {
  const neg = cents < 0 ? 'neg-text' : '';
  return `<td class="num ${extraClass} ${neg}">${fmt(cents)}</td>`;
}

function loanExtraInput(accountId, extra) {
  return h`<span class="fc-loan-extra">
    <span class="muted">extra/mo</span>
    <input class="fc-loan-extra-input" data-id="${accountId}" type="text" value="${extra ? fmtExact(extra).replace('$', '') : ''}" placeholder="0.00">
  </span>`;
}

// ---------- main render ----------
export function render(root, params) {
  rootEl = root;
  currentVariant = params?.variant === 'v2' ? 'v2' : 'classic';
  const fromMonth = thisMonth();
  const base = baseline(store.state, fromMonth);
  const hasHistory = base.categories.length > 0 || base.incomePerMonth > 0;

  if (!hasHistory) {
    root.innerHTML = h`<div class="forecast-view">
      ${[head(null)]}
      <div class="fc-empty">
        <p class="muted">Not enough transaction history yet. The forecast needs at least a full month behind you to spot a pattern. Keep tracking and check back once a month has closed out.</p>
      </div>
    </div>`;
    wireHead(root);
    return;
  }

  const fc = forecast(store.state, { months: horizon, fromMonth, overrides });

  if (currentVariant === 'v2') {
    root.innerHTML = v2Page(base, fc);
    wireHead(root);
    wireGrid(root);
    return;
  }

  root.innerHTML = h`<div class="forecast-view">
    ${[head(fc)]}
    ${[eventBanner(fc)]}
    <div class="fc-grid-wrap">
      ${[grid(base, fc)]}
    </div>
  </div>`;

  wireHead(root);
  wireGrid(root);
}

// ---------- head: title, toolbar (horizon segmented, reset, summary strip) ----------
function head(fc) {
  const net = fc ? fc.net.reduce((a, b) => a + b, 0) : 0;
  const endCash = fc ? fc.cash[fc.cash.length - 1] : 0;
  return h`<div class="view-head fc-head">
    <div class="fc-head-top">
      ${innerWidth < 768 ? '<a class="reflect-tool-back" href="#/reports/overview" aria-label="Back to Reflect">‹</a>' : ''}
      <div>
        <span class="view-title">Forecast &amp; What-If</span>
        <div class="muted fc-subtitle">Projected from your last 3 months of income and spending. Adjust any row to test a what-if.</div>
      </div>
    </div>
    <div class="fc-toolbar">
      <div class="segmented fc-horizon">
        ${[1, 6, 12, 24].map(n => h`<button class="seg-btn ${horizon === n ? 'active' : ''}" data-act="set-horizon" data-id="${n}">${n} mo</button>`).join('')}
      </div>
      <button class="btn secondary sm" data-act="reset-whatifs" ${hasAnyOverride() ? '' : 'disabled'}>Reset what-ifs</button>
      <div class="fc-summary">
        ${fc ? h`<span class="fc-summary-item"><span class="muted">Net over ${horizon}mo</span> <strong class="${net < 0 ? 'neg-text' : 'pos-text'}">${fmt(net, { sign: true })}</strong></span>
        <span class="fc-summary-item"><span class="muted">Cash at end</span> <strong class="${endCash < 0 ? 'neg-text' : ''}">${fmt(endCash)}</strong></span>` : ''}
      </div>
    </div>
  </div>`;
}

function v2DisplayValue(kind, id, base) {
  const override = overrideOf(kind, id);
  if (override?.mode === 'off') return 'Off';
  if (override?.mode === 'set') return fmt(override.value);
  if (override?.mode === 'scale') return fmt(Math.round(base * override.pct / 100));
  return fmt(base);
}

function v2VariableCard(kind, id, name, base) {
  const key = `${kind}:${id}`;
  const expanded = v2Expanded.has(key);
  const adjusted = !!overrideOf(kind, id);
  return h`<div class="fcv2-variable ${expanded ? 'open' : ''} ${adjusted ? 'adjusted' : ''}">
    <button class="fcv2-variable-pill" data-act="toggle-v2-variable" data-key="${key}" aria-expanded="${expanded}">
      <span>${name}</span><span><strong>${v2DisplayValue(kind, id, base)}</strong><i aria-hidden="true">${ICONS.chevronDown}</i></span>
    </button>
    ${expanded ? h`<div class="fcv2-variable-panel">
      <p>Turn this variable off, enter an exact amount, or adjust it in 5% steps.</p>
      ${rowControls(kind, id, base)}
    </div>` : ''}
  </div>`;
}

function v2LoanCard(loan) {
  const key = `loan:${loan.accountId}`;
  const expanded = v2Expanded.has(key);
  const extra = overrides.loanExtra[loan.accountId] || 0;
  return h`<div class="fcv2-variable fcv2-loan ${expanded ? 'open' : ''} ${extra ? 'adjusted' : ''}">
    <button class="fcv2-variable-pill" data-act="toggle-v2-variable" data-key="${key}" aria-expanded="${expanded}">
      <span>${loan.name}</span><span><strong>${extra ? `${fmt(extra)} extra` : `${fmt(loan.payment)}/mo`}</strong><i aria-hidden="true">${ICONS.chevronDown}</i></span>
    </button>
    ${expanded ? h`<div class="fcv2-variable-panel">
      <p>Your usual payment is ${fmt(loan.payment)} per month. Add an optional extra monthly amount below.</p>
      <label class="fcv2-loan-input"><span>Extra each month</span>${loanExtraInput(loan.accountId, extra)}</label>
    </div>` : ''}
  </div>`;
}

function v2Outlook(fc) {
  return fc.months.map((month, index) => h`<article class="fcv2-month-card">
    <header><strong>${shortMonth(month)}</strong><span class="${fc.net[index] < 0 ? 'neg-text' : 'pos-text'}">${fmt(fc.net[index], { sign: true })}</span></header>
    <div><span>Income</span><strong>${fmt(fc.income[index])}</strong></div>
    <div><span>Spending</span><strong>${fmt(fc.totalExpense[index])}</strong></div>
    <div class="fcv2-cash-row"><span>Cash at end</span><strong class="${fc.cash[index] < 0 ? 'neg-text' : ''}">${fmt(fc.cash[index])}</strong></div>
  </article>`).join('');
}

function v2Spreadsheet(fc) {
  const variableRows = [
    { name: 'Income', values: fc.income, adjusted: !!overrides.income },
    ...fc.rows.map(row => ({ name: row.name, values: row.values, adjusted: !!overrides.categories[row.id] })),
  ].map(row => ({ ...row, zero: row.values.every(value => value === 0) }));
  const totalRows = [
    { name: 'Total spending', values: fc.totalExpense, total: true },
    { name: 'Net', values: fc.net, total: true },
    { name: 'Cash', values: fc.cash, total: true },
  ];
  const shownRows = variableRows.filter(row => row.adjusted || (v2ShowUnchanged && (v2ShowZero || !row.zero)));
  const hiddenUnchanged = v2ShowUnchanged ? 0 : variableRows.filter(row => !row.adjusted).length;
  const hiddenZero = v2ShowUnchanged && !v2ShowZero ? variableRows.filter(row => !row.adjusted && row.zero).length : 0;
  const rowHtml = row => h`<tr class="${row.adjusted ? 'adjusted' : ''} ${row.total ? 'total' : ''}"><th>${row.adjusted ? '● ' : ''}${row.name}</th>${row.values.map(value => `<td class="${value < 0 ? 'neg-text' : ''}">${fmt(value)}</td>`).join('')}</tr>`;
  return h`<div class="fcv2-sheet-wrap"><table class="fcv2-sheet">
    <thead><tr><th>Variable</th>${fc.months.map(month => `<th>${shortMonth(month)}</th>`).join('')}</tr></thead>
    <tbody>
      ${shownRows.map(rowHtml).join('')}
      ${hiddenUnchanged ? `<tr class="collapsed"><td colspan="${fc.months.length + 1}">Collapsed ${hiddenUnchanged} unchanged variable${hiddenUnchanged === 1 ? '' : 's'}</td></tr>` : ''}
      ${hiddenZero ? `<tr class="collapsed zero"><td colspan="${fc.months.length + 1}">Collapsed ${hiddenZero} zero-value categor${hiddenZero === 1 ? 'y' : 'ies'}</td></tr>` : ''}
      ${totalRows.map(rowHtml).join('')}
    </tbody>
  </table></div>`;
}

function v2Page(base, fc) {
  const totalNet = fc.net.reduce((sum, value) => sum + value, 0);
  const endCash = fc.cash[fc.cash.length - 1] || 0;
  const groups = new Map();
  for (const row of fc.rows) {
    if (!groups.has(row.groupId)) groups.set(row.groupId, { name: row.groupName || 'Other', rows: [] });
    groups.get(row.groupId).rows.push(row);
  }
  const variableGroups = [...groups.values()].map(group => h`<div class="fcv2-variable-group">
    <h3>${group.name}</h3>
    <div class="fcv2-variable-list">${group.rows.map(row => v2VariableCard('cat', row.id, row.name, row.base)).join('')}</div>
  </div>`).join('');
  const resultMode = horizon === 1 ? 'outlook' : v2ResultMode;
  const changedCount = Object.keys(overrides.categories).length + (overrides.income ? 1 : 0) + Object.values(overrides.loanExtra).filter(Boolean).length;

  return h`<div class="forecast-view forecast-v2">
    <header class="fc-head fcv2-head">
      <a class="reflect-tool-back" href="#/reports/overview" aria-label="Back to Reflect">‹</a>
      <div><h1>What If...</h1><p>Open only the things you want to change.</p></div>
    </header>
    <div class="fcv2-sticky-summary">
      <div><span>Projected cash at end</span><strong class="${endCash < 0 ? 'neg-text' : ''}">${fmt(endCash)}</strong></div>
      <div><span>Net over ${horizon} mo</span><strong class="${totalNet < 0 ? 'neg-text' : 'pos-text'}">${fmt(totalNet, { sign: true })}</strong></div>
    </div>
    <main class="fcv2-content">
      ${eventBanner(fc)}
      <section class="fcv2-variables-section">
        <div class="fcv2-section-title"><div><h2>Change something</h2><p>Tap a category to reveal its controls.</p></div><button data-act="reset-whatifs" ${hasAnyOverride() ? '' : 'disabled'}>Reset${changedCount ? ` (${changedCount})` : ''}</button></div>
        <div class="fcv2-variable-group"><h3>Money in</h3><div class="fcv2-variable-list">${v2VariableCard('income', 'income', 'Income', base.incomePerMonth)}</div></div>
        ${variableGroups}
        ${fc.loans.length ? h`<div class="fcv2-variable-group fcv2-loan-group"><h3>Loans</h3><div class="fcv2-variable-list">${fc.loans.map(v2LoanCard).join('')}</div></div>` : ''}
      </section>
      <section class="fcv2-results">
        <div class="fcv2-results-head">
          <h2>Result:</h2>
          <div class="fcv2-span-wrap">
            <button class="fcv2-span-pill ${v2SpanOpen ? 'open' : ''}" data-act="toggle-v2-span" aria-haspopup="listbox" aria-expanded="${v2SpanOpen}"><span>Span</span><strong>${horizon} month${horizon === 1 ? '' : 's'}</strong><i aria-hidden="true">${ICONS.chevronDown}</i></button>
            ${v2SpanOpen ? h`<div class="fcv2-span-menu" role="listbox" aria-label="Result month span">${[1,6,12,24].map(value => h`<button role="option" aria-selected="${horizon === value}" class="${horizon === value ? 'selected' : ''}" data-act="set-v2-span" data-value="${value}"><span>${value} month${value === 1 ? '' : 's'}</span>${horizon === value ? '<b>✓</b>' : ''}</button>`).join('')}</div>` : ''}
          </div>
        </div>
        <div class="fcv2-result-modes">
          <button class="${resultMode === 'chart' ? 'active' : ''}" data-act="set-v2-result-mode" data-mode="chart" ${horizon === 1 ? 'disabled' : ''}>Spreadsheet view</button>
          <button class="${resultMode === 'outlook' ? 'active' : ''}" data-act="set-v2-result-mode" data-mode="outlook">Cards view</button>
        </div>
        ${resultMode === 'chart' ? h`<div class="fcv2-result-filters">
          <button role="switch" aria-checked="${v2ShowUnchanged}" class="${v2ShowUnchanged ? 'on' : ''}" data-act="toggle-v2-filter" data-filter="unchanged"><span>Show unchanged variables</span><i aria-hidden="true"></i></button>
          ${v2ShowUnchanged ? h`<button role="switch" aria-checked="${v2ShowZero}" class="${v2ShowZero ? 'on' : ''}" data-act="toggle-v2-filter" data-filter="zero"><span>Show zero-value categories</span><i aria-hidden="true"></i></button>` : ''}
        </div>` : ''}
        ${resultMode === 'chart' ? v2Spreadsheet(fc) : h`<div class="fcv2-outlook">${v2Outlook(fc)}</div>`}
      </section>
    </main>
  </div>`;
}

function rerender() { render(rootEl, { variant: currentVariant }); }

function eventBanner(fc) {
  if (!fc.events.length) return '';
  return h`<div class="fc-events">
    ${fc.events.map(ev => h`<div class="fc-event"><span class="fc-event-dot">●</span> <strong>${ev.month}:</strong> ${ev.label}</div>`).join('')}
  </div>`;
}

// ---------- grid ----------
function grid(base, fc) {
  const groups = new Map(); // groupId -> { groupName, rows: [] }
  for (const row of fc.rows) {
    if (!groups.has(row.groupId)) groups.set(row.groupId, { groupName: row.groupName || 'Other', rows: [] });
    groups.get(row.groupId).rows.push(row);
  }

  const monthHeadCells = fc.months.map(m => `<th class="num">${shortMonth(m)}</th>`).join('');

  const incomeRow = h`<tr class="fc-row fc-income-row ${overrides.income ? 'fc-tinted' : ''}">
    <td class="fc-first-col">${[rowLabel('income', 'income', 'Income', base.incomePerMonth)]}</td>
    ${fc.income.map(v => numCell(v)).join('')}
  </tr>`;

  const groupSections = [...groups.values()].map(g => h`
    <tr class="fc-group-row"><td class="fc-group-cell" colspan="${fc.months.length + 1}">${g.groupName}</td></tr>
    ${g.rows.map(row => h`<tr class="fc-row ${overrides.categories[row.id] ? 'fc-tinted' : ''}">
      <td class="fc-first-col">${[rowLabel('cat', row.id, row.name, row.base)]}</td>
      ${row.values.map(v => numCell(v)).join('')}
    </tr>`).join('')}
  `).join('');

  const totalsRows = h`
    <tr class="fc-row fc-bold"><td class="fc-first-col">Total Expenses</td>${fc.totalExpense.map(v => numCell(v)).join('')}</tr>
    <tr class="fc-row fc-bold"><td class="fc-first-col">Net</td>${fc.net.map(v => numCell(v)).join('')}</tr>
    <tr class="fc-row fc-bold"><td class="fc-first-col">Cash</td>${fc.cash.map(v => `<td class="num ${v < 0 ? 'fc-cash-neg' : ''}">${fmt(v)}</td>`).join('')}</tr>
  `;

  const loanSection = fc.loans.length ? h`
    <tr class="fc-group-row"><td class="fc-group-cell" colspan="${fc.months.length + 1}">Loans</td></tr>
    ${fc.loans.map(loan => loanRows(loan, fc)).join('')}
  ` : '';

  return h`<table class="fc-table">
    <thead><tr><th class="fc-first-col">&nbsp;</th>${monthHeadCells}</tr></thead>
    <tbody>
      ${incomeRow}
      ${groupSections}
      ${totalsRows}
      ${loanSection}
    </tbody>
  </table>`;
}

function loanRows(loan, fc) {
  const extra = overrides.loanExtra[loan.accountId] || 0;
  const payoffIdx = loan.payoffMonth ? fc.months.indexOf(loan.payoffMonth) : -1;
  const balCells = loan.balances.map((bal, i) => {
    if (payoffIdx >= 0 && i === payoffIdx) return `<td class="num"><span class="fc-paid-badge">PAID OFF ✓</span></td>`;
    if (payoffIdx >= 0 && i > payoffIdx) return `<td class="num muted">N/A</td>`;
    return numCell(bal);
  }).join('');
  return h`<tr class="fc-row fc-loan-row">
    <td class="fc-first-col">
      <div class="fc-row-label">
        <span class="fc-name">${loan.name}</span>
        <span class="muted fc-loan-payment">${fmt(loan.payment)}/mo</span>
        ${[loanExtraInput(loan.accountId, extra)]}
      </div>
    </td>
    ${balCells}
  </tr>`;
}

// ---------- wiring ----------
function wireHead(root) {
  root.querySelector('.fc-head').onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'set-horizon':
        horizon = +act.dataset.id;
        rerender();
        break;
      case 'reset-whatifs':
        overrides = emptyOverrides();
        editing = null;
        toast('What-ifs reset');
        rerender();
        break;
    }
  };
}

function wireGrid(root) {
  const wrap = root.querySelector('.fc-grid-wrap, .fcv2-content');
  if (!wrap) return;

  wrap.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) {
      if (v2SpanOpen) { v2SpanOpen = false; rerender(); }
      return;
    }
    const kind = act.dataset.kind;
    const id = act.dataset.id;
    switch (act.dataset.act) {
      case 'toggle-v2-variable':
        if (v2Expanded.has(act.dataset.key)) v2Expanded.delete(act.dataset.key);
        else v2Expanded.add(act.dataset.key);
        rerender();
        break;
      case 'set-v2-result-mode':
        v2ResultMode = act.dataset.mode === 'outlook' ? 'outlook' : 'chart';
        rerender();
        break;
      case 'toggle-v2-span':
        v2SpanOpen = !v2SpanOpen;
        rerender();
        break;
      case 'set-v2-span':
        horizon = +act.dataset.value;
        v2SpanOpen = false;
        rerender();
        break;
      case 'toggle-v2-filter':
        if (act.dataset.filter === 'zero') v2ShowZero = !v2ShowZero;
        else {
          v2ShowUnchanged = !v2ShowUnchanged;
          if (!v2ShowUnchanged) v2ShowZero = false;
        }
        rerender();
        break;
      case 'reset-whatifs':
        overrides = emptyOverrides();
        editing = null;
        toast('What-ifs reset');
        rerender();
        break;
      case 'toggle-off': {
        const cur = overrideOf(kind, id);
        setOverride(kind, id, cur?.mode === 'off' ? null : { mode: 'off' });
        rerender();
        break;
      }
      case 'edit-amt':
        editing = { kind, id };
        rerender();
        break;
      case 'step': {
        const dir = +act.dataset.dir;
        const cur = overrideOf(kind, id);
        const curPct = cur?.mode === 'scale' ? cur.pct : 100;
        const nextPct = Math.max(0, curPct + dir * 5);
        setOverride(kind, id, nextPct === 100 ? null : { mode: 'scale', pct: nextPct });
        rerender();
        break;
      }
      case 'reset-row':
        setOverride(kind, id, null);
        rerender();
        break;
    }
  };

  wrap.querySelectorAll('.fc-edit-input').forEach(inp => {
    inp.focus(); inp.select();
    const commit = () => {
      const val = parseAmount(inp.value);
      setOverride(inp.dataset.kind, inp.dataset.id, { mode: 'set', value: val });
      editing = null;
      rerender();
    };
    inp.onkeydown = e => {
      // detach the blur-commit first: render() detaches the focused input, and the
      // resulting blur would otherwise commit — turning Escape-cancel into a commit
      if (e.key === 'Enter') { inp.onblur = null; commit(); }
      else if (e.key === 'Escape') { inp.onblur = null; editing = null; rerender(); }
    };
    inp.onblur = commit;
  });

  wrap.querySelectorAll('.fc-loan-extra-input').forEach(inp => {
    inp.onchange = () => {
      const cents = parseAmount(inp.value);
      if (cents > 0) overrides.loanExtra[inp.dataset.id] = cents;
      else delete overrides.loanExtra[inp.dataset.id];
      rerender();
    };
  });

}
