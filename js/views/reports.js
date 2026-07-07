import { store } from '../store.js';
import { fmt, h, thisMonth, addMonths, monthLabel, monthsBetween } from '../util.js';

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
      <button type="button" class="report-switcher" id="report-switcher">${current.label} <span class="switcher-caret">▾</span></button>
      <div class="report-switch-menu" id="report-switch-menu" hidden>
        ${TABS.map(t => h`<a class="report-switch-item ${t.id === active ? 'active' : ''}" href="#/reports/${t.id}">${t.label}</a>`)}
      </div>
    </div>
  </div>`;
}
function wireReportSwitcher(root) {
  const btn = root.querySelector('#report-switcher');
  const menu = root.querySelector('#report-switch-menu');
  if (!btn) return;
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
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

  bindFilterRow(root, () => trendsReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`spending-trends-${state.from}_${state.to}.csv`,
    [['Month', 'Total Spending', 'Compared to Average %'],
     ...byMonth.map(m => [monthLabel(m.month), (m.amount / 100).toFixed(2), avg ? (((m.amount - avg) / avg) * 100).toFixed(1) : '0.0']),
     ['Average', (avg / 100).toFixed(2), '']]);
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

  bindFilterRow(root, () => netWorthReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`net-worth-${state.from}_${state.to}.csv`,
    [['Month', 'Assets', 'Debts', 'Net Worth'], ...series.map(p => [monthLabel(p.month), (p.assets / 100).toFixed(2), (p.liabilities / 100).toFixed(2), (p.netWorth / 100).toFixed(2)])]);
  if (series.length) bindNetWorthChart(root, series);
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
  root.innerHTML = h`${tabBar('income-expense')}
  ${pageHead('Income v Expense')}
  <div class="report-body">
    ${filterRow('income-expense')}
    <div class="card ie-card">
      ${!hasData ? emptyState('No income or expense data in this range.') : ieTable(data)}
    </div>
  </div>`;
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
          <td colspan="${cols.length + 1}"><span class="ie-caret">${incomeExpanded ? '▾' : '▸'}</span>Income</td>
        </tr>
        ${incomeRows}
        <tr class="ie-total-row ie-tinted"><td class="ie-name">Total All Income Sources</td>${rowVals(totalIncomeVals).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}</tr>
        <tr class="ie-total-row"><td class="ie-name">Total Income</td>${rowVals(totalIncomeVals).map(v => `<td class="num money">${fmt(v)}</td>`).join('')}</tr>
        <tr class="ie-section-head ie-expense-head" data-toggle-section="expense">
          <td colspan="${cols.length + 1}"><span class="ie-caret">${expenseExpanded ? '▾' : '▸'}</span>Expense</td>
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
      <p>Age of Money looks at the most recent 10 times you spent cash and asks how many days that money had been sitting in your accounts before it went out the door. A high number means you're spending dollars you earned a while ago rather than living off whatever just landed — a cushion, not a coincidence.</p>
      <p>YNAB's own rule of thumb is to push this past 30 days. Once you're there, this month's bills are covered by money you already have, so a slow paycheck or a surprise expense stops being an emergency and starts being a Tuesday.</p>
    </div>
  </div>`;

  bindFilterRow(root, () => ageOfMoneyReport(root));
  root.querySelector('#export-btn').onclick = () => downloadCsv(`age-of-money-${state.from}_${state.to}.csv`,
    [['Month', 'Age of Money (days)'], ...series.map(p => [monthLabel(p.month), p.aom == null ? '' : p.aom])]);
}

function aomEmptyCard() {
  return h`<div class="aom-empty-inner">
    <div class="aom-empty-headline">Still building up a track record — check back soon.</div>
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
  wireReportSwitcher(root);
}
