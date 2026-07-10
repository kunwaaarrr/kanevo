// Forecast ("what-if") spreadsheet view. Pure UI — all math lives in js/lib/forecast.js.
import { baseline, forecast } from '../lib/forecast.js';
import { store } from '../store.js';
import { fmt, fmtExact, parseAmount, thisMonth, h } from '../util.js';
import { toast } from '../app.js';

// module-local UI state — survives re-render (render() rebuilds root.innerHTML each time)
let horizon = 12;                 // 6 | 12 | 24
let overrides = emptyOverrides();
let editing = null;               // { kind: 'income'|'cat', id } — first-column cell in edit mode
let rootEl;

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
    <span class="fc-stepper">
      <button class="fc-step-btn" data-act="step" data-kind="${kind}" data-id="${id}" data-dir="-1">−</button>
      ${pct !== 100 ? `<span class="fc-pct">${pct}%</span>` : ''}
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
        ${[6, 12, 24].map(n => h`<button class="seg-btn ${horizon === n ? 'active' : ''}" data-act="set-horizon" data-id="${n}">${n} mo</button>`).join('')}
      </div>
      <button class="btn secondary sm" data-act="reset-whatifs" ${hasAnyOverride() ? '' : 'disabled'}>Reset what-ifs</button>
      <div class="fc-summary">
        ${fc ? h`<span class="fc-summary-item"><span class="muted">Net over ${horizon}mo</span> <strong class="${net < 0 ? 'neg-text' : 'pos-text'}">${fmt(net, { sign: true })}</strong></span>
        <span class="fc-summary-item"><span class="muted">Cash at end</span> <strong class="${endCash < 0 ? 'neg-text' : ''}">${fmt(endCash)}</strong></span>` : ''}
      </div>
    </div>
  </div>`;
}

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
        render(root, {});
        break;
      case 'reset-whatifs':
        overrides = emptyOverrides();
        editing = null;
        toast('What-ifs reset');
        render(root, {});
        break;
    }
  };
}

function wireGrid(root) {
  const wrap = root.querySelector('.fc-grid-wrap');
  if (!wrap) return;

  wrap.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const kind = act.dataset.kind;
    const id = act.dataset.id;
    switch (act.dataset.act) {
      case 'toggle-off': {
        const cur = overrideOf(kind, id);
        setOverride(kind, id, cur?.mode === 'off' ? null : { mode: 'off' });
        render(rootEl, {});
        break;
      }
      case 'edit-amt':
        editing = { kind, id };
        render(rootEl, {});
        break;
      case 'step': {
        const dir = +act.dataset.dir;
        const cur = overrideOf(kind, id);
        const curPct = cur?.mode === 'scale' ? cur.pct : 100;
        const nextPct = Math.max(0, curPct + dir * 5);
        setOverride(kind, id, nextPct === 100 ? null : { mode: 'scale', pct: nextPct });
        render(rootEl, {});
        break;
      }
      case 'reset-row':
        setOverride(kind, id, null);
        render(rootEl, {});
        break;
    }
  };

  wrap.querySelectorAll('.fc-edit-input').forEach(inp => {
    inp.focus(); inp.select();
    const commit = () => {
      const val = parseAmount(inp.value);
      setOverride(inp.dataset.kind, inp.dataset.id, { mode: 'set', value: val });
      editing = null;
      render(rootEl, {});
    };
    inp.onkeydown = e => {
      // detach the blur-commit first: render() detaches the focused input, and the
      // resulting blur would otherwise commit — turning Escape-cancel into a commit
      if (e.key === 'Enter') { inp.onblur = null; commit(); }
      else if (e.key === 'Escape') { inp.onblur = null; editing = null; render(rootEl, {}); }
    };
    inp.onblur = commit;
  });

  wrap.querySelectorAll('.fc-loan-extra-input').forEach(inp => {
    inp.onchange = () => {
      const cents = parseAmount(inp.value);
      if (cents > 0) overrides.loanExtra[inp.dataset.id] = cents;
      else delete overrides.loanExtra[inp.dataset.id];
      render(rootEl, {});
    };
  });
}
