// 50/30/20 view — targets calculator + actual-vs-target comparison + classification manager.
import { store } from '../store.js';
import { toast } from '../app.js';
import { fmt, fmtExact, parseAmount, addMonths, monthLabel, h } from '../util.js';
import { fiftyThirtyTwenty } from '../lib/fifty.js';

// module-local UI state — survives re-render since render() rebuilds root.innerHTML each time
let curMonth;
let incomeSource = 'income';      // 'income' | 'incomeAvg3'
let splitPreset = '50/30/20';     // '50/30/20' | '60/30/10' | 'custom'
let customSplit = { need: 50, want: 30, savings: 20 };
let calcIncomeOverride = null;    // cents, or null to follow detected income
let openClassMenuId = null;

const PRESETS = {
  '50/30/20': { need: 50, want: 30, savings: 20 },
  '60/30/10': { need: 60, want: 30, savings: 10 },
};
const CLASS_LABEL = { need: 'Necessities', want: 'Wants', savings: 'Savings & debt repayment' };
const CLASS_ORDER = ['need', 'want', 'savings'];

function currentSplit() {
  return splitPreset === 'custom' ? customSplit : PRESETS[splitPreset];
}

// ---------- header: month nav + income source toggle ----------
function header() {
  return h`<div class="view-head fifty-head">
    ${innerWidth < 768 ? '<a class="reflect-tool-back" href="#/reports/overview" aria-label="Back to Reflect">‹</a>' : ''}
    <span class="view-title">50/30/20</span>
    <div class="month-group">
      <a class="month-nav-btn" href="#/fifty/${addMonths(curMonth, -1)}">‹</a>
      <span class="month-label">${monthLabel(curMonth)}</span>
      <a class="month-nav-btn" href="#/fifty/${addMonths(curMonth, 1)}">›</a>
    </div>
    <div class="head-spacer"></div>
    <div class="segmented income-source-seg">
      <button class="seg-btn ${incomeSource === 'income' ? 'active' : ''}" data-act="income-src" data-id="income">This Month</button>
      <button class="seg-btn ${incomeSource === 'incomeAvg3' ? 'active' : ''}" data-act="income-src" data-id="incomeAvg3">3-Month Avg</button>
    </div>
  </div>`;
}

// ---------- split preset control ----------
function splitControl() {
  const presets = ['50/30/20', '60/30/10', 'Custom'];
  const total = customSplit.need + customSplit.want + customSplit.savings;
  const valid = total === 100;
  return h`<div class="split-control">
    <div class="segmented split-seg">
      ${presets.map(p => {
        const key = p === 'Custom' ? 'custom' : p;
        return h`<button class="seg-btn ${splitPreset === key ? 'active' : ''}" data-act="set-split" data-id="${key}">${p}</button>`;
      }).join('')}
    </div>
    ${splitPreset === 'custom' ? h`<div class="custom-split-panel">
      <div class="custom-split-row">
        ${CLASS_ORDER.map(cls => h`<label class="custom-split-input custom-split-${cls}">
          <span class="class-dot dot-${cls}" aria-hidden="true"></span>
          <span>${cls === 'need' ? 'Necessities' : cls === 'want' ? 'Wants' : 'Savings'}</span>
          <span class="custom-split-value"><input type="number" min="0" max="100" data-act="custom-pct" data-id="${cls}" value="${customSplit[cls]}"><b>%</b></span>
        </label>`).join('')}
      </div>
      <div class="custom-split-total ${valid ? 'valid' : 'invalid'}"><span>Total</span><strong>${total}%</strong></div>
      ${!valid ? `<span class="split-error">Adjust the three amounts so the total is 100%.</span>` : ''}
    </div>` : ''}
  </div>`;
}

// ---------- section A: targets calculator ----------
function targetsSection(data, split) {
  const income = calcIncomeOverride != null ? calcIncomeOverride : data[incomeSource];
  const targets = {
    need: Math.round(income * split.need / 100),
    want: Math.round(income * split.want / 100),
    savings: 0,
  };
  targets.savings = income - targets.need - targets.want;
  return h`<section class="fifty-section">
    <h2 class="section-title">Your targets</h2>
    <p class="muted section-hint">A quick "what should I aim for" split, no history required. Edit the income below to try a different number.</p>
    <div class="calc-income-row">
      <label for="calc-income-input">Monthly income (after tax)</label>
      <input id="calc-income-input" class="calc-income-input" type="text" value="${fmtExact(income).replace('$', '')}">
    </div>
    <div class="target-stats">
      ${CLASS_ORDER.map(cls => h`<div class="target-stat">
        <div class="target-stat-label">${CLASS_LABEL[cls]} <span class="muted">(${split[cls]}%)</span></div>
        <div class="target-stat-amt">${fmt(targets[cls])}</div>
      </div>`).join('')}
    </div>
  </section>`;
}

// ---------- section B: comparison cards + donut ----------
function progressBar(actual, target, cls) {
  const pct = target > 0 ? (actual / target) * 100 : (actual > 0 ? 100 : 0);
  const capped = Math.min(100, Math.max(0, pct));
  const over = Math.max(0, pct - 100);
  return h`<div class="class-progress">
    <div class="class-progress-track">
      <div class="class-progress-fill fill-${cls}" style="width:${capped}%"></div>
      ${over > 0 ? `<div class="class-progress-over" style="width:${Math.min(100, over)}%"></div>` : ''}
    </div>
  </div>`;
}

function classCard(data, split, cls) {
  const target = data.targets[cls];
  const actual = data.actuals[cls];
  const delta = target - actual; // positive = under target
  const deltaClass = delta >= 0 ? 'pos-text' : 'neg-text';
  const deltaLabel = delta >= 0 ? `${fmt(Math.abs(delta))} under target` : `${fmt(Math.abs(delta))} over target`;
  return h`<div class="class-card card-${cls}">
    <div class="class-card-head">
      <span class="class-dot dot-${cls}"></span>
      <span class="class-card-title">${CLASS_LABEL[cls]}</span>
    </div>
    <div class="class-card-amounts">
      <div><span class="muted">Target</span> <strong>${fmt(target)}</strong></div>
      <div><span class="muted">Actual</span> <strong>${fmt(actual)}</strong></div>
    </div>
    ${progressBar(actual, target, cls)}
    <div class="class-delta ${deltaClass}">${deltaLabel}</div>
  </div>`;
}

function donutSvg(data) {
  const R = 70, CX = 90, CY = 90, STROKE = 26;
  const circumference = 2 * Math.PI * R;
  const total = data.actuals.need + data.actuals.want + data.actuals.savings;
  if (!total) {
    return `<svg viewBox="0 0 180 180" class="fifty-donut-svg">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--track)" stroke-width="${STROKE}"/>
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" class="donut-total">${fmt(0)}</text>
      <text x="${CX}" y="${CY + 14}" text-anchor="middle" class="donut-total-label">Income</text>
    </svg>`;
  }
  const GAP = 2;
  let acc = 0;
  const arcs = CLASS_ORDER.map(cls => {
    const frac = data.actuals[cls] / total;
    const dash = Math.max(0, frac * circumference - GAP);
    const offset = -acc * circumference;
    acc += frac;
    return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--fifty-${cls})"
      stroke-width="${STROKE}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}" stroke-linecap="butt" transform="rotate(-90 ${CX} ${CY})" class="donut-arc"/>`;
  }).join('');
  return `<svg viewBox="0 0 180 180" class="fifty-donut-svg">
    ${arcs}
    <text x="${CX}" y="${CY - 4}" text-anchor="middle" class="donut-total">${fmt(data.income)}</text>
    <text x="${CX}" y="${CY + 14}" text-anchor="middle" class="donut-total-label">Income</text>
  </svg>`;
}

function comparisonSection(data, split) {
  return h`<section class="fifty-section">
    <h2 class="section-title">How you're doing</h2>
    <p class="muted section-hint">Target vs what actually moved this month, per bucket.</p>
    <div class="class-cards">
      ${CLASS_ORDER.map(cls => classCard(data, split, cls)).join('')}
    </div>
    <div class="donut-row">
      <div class="donut-wrap">${donutSvg(data)}</div>
      <p class="muted unalloc-note">
        Leftover unspent income (${fmt(Math.max(0, data.unallocated))}) counts toward savings too:
        all in, that puts effective savings at ${fmt(data.effectiveSavings)}.
      </p>
    </div>
  </section>`;
}

// ---------- section C: classification manager ----------
function classManager(data) {
  const groups = CLASS_ORDER.map(cls => ({
    cls, rows: data.rows.filter(r => r.cls === cls),
  }));
  return h`<section class="fifty-section">
    <h2 class="section-title">Classify your categories</h2>
    <p class="muted section-hint">Minimum debt payments belong under Necessities; only the extra you throw at a loan counts as Savings &amp; debt repayment.</p>
    ${groups.map(g => h`<div class="class-group">
      <h3 class="class-group-head"><span class="class-dot dot-${g.cls}"></span>${CLASS_LABEL[g.cls]}</h3>
      ${!g.rows.length ? '<p class="muted class-group-empty">Nothing here yet.</p>' : h`<div class="class-rows">
        ${g.rows.map(r => h`<div class="class-row">
          <span class="class-row-name">${r.name}<span class="muted class-row-group"> · ${r.groupName}</span></span>
          <span class="class-row-amt">${fmt(r.amount)}</span>
          <div class="class-row-picker">
            <button class="class-row-select" data-act="toggle-class-menu" data-id="${r.id}" aria-haspopup="listbox" aria-expanded="${openClassMenuId === r.id}">
              <span class="class-dot dot-${r.cls}" aria-hidden="true"></span><span>${r.cls === 'need' ? 'Need' : r.cls === 'want' ? 'Want' : 'Savings'}</span><span class="class-row-chevron" aria-hidden="true">⌄</span>
            </button>
            ${openClassMenuId === r.id ? h`<div class="class-row-menu" role="listbox" aria-label="Classify ${r.name}">
              ${CLASS_ORDER.map(cls => h`<button role="option" aria-selected="${r.cls === cls}" class="${r.cls === cls ? 'selected' : ''}" data-act="set-class" data-id="${r.id}" data-class="${cls}"><span class="class-dot dot-${cls}"></span><span>${cls === 'need' ? 'Need' : cls === 'want' ? 'Want' : 'Savings'}</span>${r.cls === cls ? '<b>✓</b>' : ''}</button>`).join('')}
            </div>` : ''}
          </div>
        </div>`).join('')}
      </div>`}
    </div>`).join('')}
  </section>`;
}

// ---------- empty state ----------
function emptyState() {
  return h`<div class="fifty-empty">
    <p>No income detected for ${monthLabel(curMonth)} yet.</p>
    <p class="muted">Try the 3-Month Avg toggle above, or come back once this month's paycheck lands.</p>
  </div>`;
}

export function render(root, { month }) {
  if (curMonth && curMonth !== month) calcIncomeOverride = null; // a typed income belongs to the month it was typed on
  curMonth = month;
  const split = currentSplit();
  const data = fiftyThirtyTwenty(store.state, curMonth, split);

  root.innerHTML = h`<div class="fifty-view">
    ${[header()]}
    <div class="fifty-body">
      ${[splitControl()]}
      ${data[incomeSource] === 0 && calcIncomeOverride == null
        ? emptyState()
        : h`${[targetsSection(data, split)]}${[comparisonSection(data, split)]}${[classManager(data)]}`}
    </div>
  </div>`;

  wireEvents(root);
}

function wireEvents(root) {
  root.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) {
      if (openClassMenuId) { openClassMenuId = null; render(root, { month: curMonth }); }
      return;
    }
    switch (act.dataset.act) {
      case 'income-src':
        incomeSource = act.dataset.id;
        calcIncomeOverride = null;
        render(root, { month: curMonth });
        break;
      case 'set-split':
        splitPreset = act.dataset.id;
        render(root, { month: curMonth });
        break;
      case 'toggle-class-menu':
        openClassMenuId = openClassMenuId === act.dataset.id ? null : act.dataset.id;
        render(root, { month: curMonth });
        break;
      case 'set-class':
        store.updateCategory(act.dataset.id, { budgetClass: act.dataset.class });
        openClassMenuId = null;
        toast('Category reclassified');
        render(root, { month: curMonth });
        break;
    }
  };

  root.querySelector('#calc-income-input')?.addEventListener('change', e => {
    calcIncomeOverride = parseAmount(e.target.value);
    render(root, { month: curMonth });
  });

  root.querySelectorAll('[data-act="custom-pct"]').forEach(inp => {
    inp.addEventListener('change', e => {
      const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      customSplit[e.target.dataset.id] = v;
      render(root, { month: curMonth });
    });
  });

}
