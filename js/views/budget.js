import { store } from '../store.js';
import { openModal, closeModal, toast } from '../app.js';
import { fmt, fmtExact, parseAmount, addMonths, monthLabel, h, ICONS } from '../util.js';
import { CATEGORY_TEMPLATES } from '../seed.js';

// module-local UI state — survives re-render since render() rebuilds root.innerHTML each time
const collapsedGroups = new Set();
let editingCatId = null;   // category id whose ASSIGNED cell is in edit mode
let selectedId = null;     // inspector selection
let activeFocusedViewId = null;
let curMonth;
let activeFilter = 'all';       // all | underfunded | overfunded | available | snoozed
let checkedCats = new Set();    // checkbox selection (Manually-assign + bulk highlight)
let density = 'comfortable';    // comfortable | compact
let assignTab = 'auto';         // auto | manual, inside the Assign popover
let summaryOpen = true, targetsOpen = true, autoAssignOpen = true, futureOpen = false; // inspector card disclosure

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- weekly target math (store only understands monthly/yearly cadence) ----------
function daysInMonth(y, mZero) { return new Date(y, mZero + 1, 0).getDate(); }
function weekdayOccurrencesInMonth(month, weekday) {
  const [y, m] = month.split('-').map(Number);
  const total = daysInMonth(y, m - 1);
  let count = 0;
  for (let d = 1; d <= total; d++) if (new Date(y, m - 1, d).getDay() === weekday) count++;
  return count;
}
function weeklyNeeded(cat, month) {
  const t = cat.target;
  const weekday = t.weekday ?? 1;
  const occurrences = weekdayOccurrencesInMonth(month, weekday);
  const total = t.amount * occurrences;
  return Math.max(0, total - cat.assigned);
}
// resolve the display "needed this month" figure, patching in weekly math the store can't do
function neededFor(cat, month) {
  if (cat.target && cat.target.cadence === 'weekly') return weeklyNeeded(cat, month);
  return cat.goal ? cat.goal.needed : 0;
}

// ---------- filters ----------
function passesFilter(c) {
  switch (activeFilter) {
    case 'underfunded': return c.goal && c.goal.status === 'underfunded';
    case 'overfunded': return !!c.target && c.available > (neededFor(c, curMonth) + c.assigned);
    case 'available': return c.available > 0;
    case 'snoozed': return !!c.target?.snoozed;
    default: return true; // 'all'
  }
}

function fundBarClass(c) {
  if (c.available < 0) return 'overspent';
  if (c.goal && c.goal.status === 'underfunded') return 'underfunded';
  if (c.goal && c.goal.status === 'funded') return 'funded';
  return c.available > 0 ? 'funded' : 'underfunded';
}

function catRow(c, groupHidden) {
  const selected = c.id === selectedId;
  const editing = c.id === editingCatId;
  const checked = checkedCats.has(c.id);
  const pct = c.goal ? c.goal.fundedPct : 0; // no target → bare track, like the real app
  return h`<tr class="cat-row ${selected ? 'selected' : ''} ${groupHidden ? 'hidden-row' : ''}" draggable="true" data-cat-id="${c.id}">
    <td class="chev-cell"></td>
    <td class="chk-cell"><input type="checkbox" class="row-chk" data-act="toggle-check" data-id="${c.id}" ${checked ? 'checked' : ''}></td>
    <td class="cat-name-cell">
      <span class="cat-name-btn" data-act="open-cat" data-id="${c.id}">${c.name}</span>${c.target?.snoozed ? ' <span class="snooze-tag">💤</span>' : ''}
      <div class="target-bar"><div class="target-bar-fill ${fundBarClass(c)}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
    </td>
    <td class="num assigned-cell" data-act="edit-assigned" data-id="${c.id}">
      ${editing
        ? `<input class="assigned-input" data-id="${c.id}" type="text" value="${fmtExact(c.assigned).replace('$', '')}">`
        : h`<span class="assigned-val">${fmt(c.assigned)}</span>`}
    </td>
    <td class="num muted">${fmt(c.activity)}</td>
    <td class="num">
      <button class="pill ${c.pillClass}" data-act="open-move" data-id="${c.id}">${fmt(c.available)}</button>
    </td>
  </tr>`;
}

function groupRows(g, filterIds) {
  const collapsed = collapsedGroups.has(g.id);
  let cats = filterIds ? g.categories.filter(c => filterIds.has(c.id)) : g.categories;
  cats = cats.filter(passesFilter);
  if (!cats.length) return '';
  const totals = cats.reduce((s, c) => ({ assigned: s.assigned + c.assigned, activity: s.activity + c.activity, available: s.available + c.available }),
    { assigned: 0, activity: 0, available: 0 });
  const allChecked = cats.length && cats.every(c => checkedCats.has(c.id));
  return h`<tbody class="group-body" data-group-id="${g.id}">
    <tr class="group-row" draggable="true" data-group-id="${g.id}">
      <td class="chev-cell"><button class="chevron-btn" data-act="toggle-group" data-id="${g.id}">${collapsed ? '▸' : '▾'}</button></td>
      <td class="chk-cell"><input type="checkbox" class="row-chk" data-act="toggle-check-group" data-id="${g.id}" ${allChecked ? 'checked' : ''}></td>
      <td class="group-name-cell">
        <span class="group-name">${g.name}${g.hidden ? ' <span class="muted">(hidden)</span>' : ''}</span>
        <button class="add-cat-btn" data-act="add-cat" data-id="${g.id}" title="Add category">+</button>
      </td>
      <td class="num">${fmt(totals.assigned)}</td>
      <td class="num muted">${fmt(totals.activity)}</td>
      <td class="num">${fmt(totals.available)}</td>
    </tr>
    ${collapsed ? '' : cats.map(c => catRow(c, g.hidden)).join('')}
  </tbody>`;
}

// ---------- auto-assign option rows (shared by Assign popover + inspector card) ----------
function autoAssignAmount(md, kind) {
  const cats = md.groups.flatMap(g => g.categories).filter(c => !c.hidden && !c.ccAccountId);
  if (kind === 'underfunded') return cats.reduce((s, c) => s + neededFor(c, curMonth), 0);
  if (kind === 'reset-available') return cats.reduce((s, c) => s + Math.max(0, -c.available), 0) * -1;
  if (kind === 'reset-assigned') return cats.reduce((s, c) => s + c.assigned, 0) * -1;
  // history-based: assigned/spent last month, or averages over up to 12 months
  const months = kind === 'avg-assigned' || kind === 'avg-spent'
    ? Array.from({ length: 12 }, (_, i) => addMonths(curMonth, -1 - i))
    : [addMonths(curMonth, -1)];
  let total = 0;
  for (const c of cats) {
    const vals = months.map(m => {
      const mc = store.monthData(m).groups.flatMap(g => g.categories).find(x => x.id === c.id);
      if (!mc) return 0;
      return kind.includes('spent') ? Math.max(0, -mc.activity) : mc.assigned;
    });
    const want = kind.startsWith('avg') ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : vals[0];
    if (want > 0) total += want;
  }
  return total;
}
function autoAssignRows(md) {
  const rows = [
    ['underfunded', 'Underfunded'],
    ['lastmonth-assigned', 'Assigned Last Month'],
    ['lastmonth-spent', 'Spent Last Month'],
    ['avg-assigned', 'Average Assigned'],
    ['avg-spent', 'Average Spent'],
    ['reset-available', 'Reset Available Amounts'],
    ['reset-assigned', 'Reset Assigned Amounts'],
  ];
  return rows.map(([kind, label]) => {
    const amt = autoAssignAmount(md, kind);
    return h`<button class="auto-row" data-act="auto-${kind}">
      <span class="auto-row-label">${label}</span>
      <span class="auto-row-amt">${fmt(amt)}</span>
    </button>`;
  }).join('');
}

// ---------- header: month nav / note / RTA card / assign popover ----------
function monthNoteVal(month) {
  return (store.state.settings.monthNotes || {})[month] || '';
}

function rtaCard(rta, md) {
  const cls = rta > 0 ? 'pos' : rta < 0 ? 'neg' : 'zero';
  const label = rta > 0 ? 'Ready to Assign' : rta < 0 ? 'You Assigned Too Much' : 'All Money Assigned';
  return h`<div class="rta-card ${cls}">
    <div class="rta-text">
      <div class="rta-amount">${fmt(Math.abs(rta))}</div>
      <span class="rta-label">${label}</span>
    </div>
    <div class="rta-row">
      <div class="assign-wrap">
        <button class="btn green rta-assign-btn" data-act="toggle-assign-pop">Assign ▾</button>
        ${assignPopover(md)}
      </div>
    </div>
  </div>`;
}

function assignPopover(md) {
  return h`<div class="popover assign-popover" hidden>
    <div class="assign-tabs">
      <button class="assign-tab ${assignTab === 'auto' ? 'active' : ''}" data-act="assign-tab-auto">⚡ Auto</button>
      <button class="assign-tab ${assignTab === 'manual' ? 'active' : ''}" data-act="assign-tab-manual">Manually</button>
    </div>
    ${assignTab === 'auto'
      ? `<div class="auto-rows">${autoAssignRows(md)}</div>`
      : h`<div class="manual-assign">
          <div class="form-row">
            <label for="manual-amount">Amount</label>
            <input id="manual-amount" type="text" placeholder="0.00">
          </div>
          <button class="btn" data-act="manual-assign-checked">Assign to checked categories</button>
          <div class="muted manual-hint">${checkedCats.size} categor${checkedCats.size === 1 ? 'y' : 'ies'} checked</div>
        </div>`}
  </div>`;
}

function monthPickerPopover(month) {
  const [y] = month.split('-').map(Number);
  const cur = month;
  const monthsWithData = new Set(Object.keys(store.state.budget).filter(m => m.startsWith(String(y))));
  const cells = Array.from({ length: 12 }, (_, i) => {
    const mm = `${y}-${String(i + 1).padStart(2, '0')}`;
    const isCurrent = mm === cur;
    const hasData = monthsWithData.has(mm);
    const label = new Date(y, i, 1).toLocaleDateString('en-AU', { month: 'short' });
    return h`<a class="mp-cell ${isCurrent ? 'current' : ''} ${hasData ? 'has-data' : ''}" href="#/budget/${mm}">${label}</a>`;
  }).join('');
  return h`<div class="popover month-picker-popover" hidden>
    <div class="mp-year">
      <button class="mp-year-btn" data-act="mp-year-prev">‹</button>
      <span>${y}</span>
      <button class="mp-year-btn" data-act="mp-year-next">›</button>
    </div>
    <div class="mp-grid">${cells}</div>
  </div>`;
}

// fixed abbreviations (YNAB's set, incl. "Sept") — toLocaleDateString month:'short' is unreliable across Chrome builds
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

function header(md) {
  return h`<div class="view-head budget-head">
    <div class="budget-head-top">
      <div class="month-group">
        <a class="month-nav-btn" href="#/budget/${addMonths(curMonth, -1)}">‹</a>
        <div class="month-stack">
          <div class="month-picker-wrap">
            <button class="month-label" data-act="toggle-month-picker">${shortMonth(curMonth)} ▾</button>
            ${monthPickerPopover(curMonth)}
          </div>
          <input class="month-note" id="month-note-input" type="text" placeholder="Enter a note…" value="${monthNoteVal(curMonth)}">
        </div>
        <a class="month-nav-btn" href="#/budget/${addMonths(curMonth, 1)}">›</a>
      </div>
      ${[rtaCard(md.rta, md)]}
      <div class="head-spacer"></div>
    </div>
  </div>`;
}

// ---------- filter chips ----------
function filterChips() {
  const chips = [
    ['all', 'All'], ['underfunded', 'Underfunded'], ['overfunded', 'Overfunded'],
    ['available', 'Money Available'], ['snoozed', 'Snoozed'],
  ];
  const views = store.state.focusedViews;
  return h`<div class="chip-row">
    ${chips.map(([k, label]) => h`<button class="chip ${activeFilter === k ? 'active' : ''}" data-act="set-filter" data-id="${k}">${label}</button>`).join('')}
    <div class="chip-fv-wrap">
      <button class="chip chip-fv ${activeFocusedViewId ? 'active' : ''}" data-act="toggle-fv-menu">${activeFocusedViewId ? views.find(v => v.id === activeFocusedViewId)?.name || 'View' : 'Views'} ▾</button>
      <div class="fv-menu" hidden>
        ${views.map(v => `<button data-act="pick-fv" data-id="${v.id}">${v.name}</button>`).join('')}
        <button data-act="new-fv">＋ New Focused View…</button>
        ${activeFocusedViewId ? `<button data-act="clear-focused-view">✕ Clear View</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------- toolbar ----------
function toolbar() {
  return h`<div class="budget-toolbar">
    <div class="addgroup-wrap">
      <button class="link-btn" data-act="toggle-addgroup-menu">⊕ Category Group</button>
      <div class="addgroup-menu" hidden>
        <button data-act="new-group">New Group…</button>
        <button data-act="from-template">Start from Template…</button>
      </div>
    </div>
    <button class="link-btn" data-act="undo" ${store.canUndo() ? '' : 'disabled'}>↺ Undo</button>
    <button class="link-btn" data-act="redo" title="Redo coming soon">↻ Redo</button>
    <div class="recent-wrap">
      <button class="link-btn" data-act="toggle-recent-moves"><span class="btn-ico">${[ICONS.clock]}</span> Recent Moves</button>
      ${recentMovesPopover()}
    </div>
    <div class="toolbar-spacer"></div>
    <button class="icon-btn ${store.state.settings.hideAmounts ? 'active' : ''}" data-act="toggle-hide" title="Hide amounts">${[ICONS.eye]}</button>
    <button class="icon-btn density-btn ${density === 'compact' ? 'active' : ''}" data-act="set-density" data-id="compact" title="Compact rows">☰</button>
    <button class="icon-btn density-btn ${density === 'comfortable' ? 'active' : ''}" data-act="set-density" data-id="comfortable" title="Comfortable rows">☷</button>
  </div>`;
}

function recentMovesPopover() {
  const moves = store.recentMoves();
  const catName = id => id ? (store.state.categories.find(c => c.id === id)?.name || '—') : 'Ready to Assign';
  const rows = moves.slice(0, 40).map(m => {
    const from = m.type === 'move' ? catName(m.fromCatId) : 'Ready to Assign';
    const to = m.type === 'move' ? catName(m.toCatId) : catName(m.toCatId);
    return h`<div class="recent-row"><span class="recent-date">${m.date}</span><span class="recent-desc">${from} → ${to}</span><span class="recent-amt">${fmt(m.amount)}</span></div>`;
  }).join('');
  return h`<div class="popover recent-popover" hidden>
    <h3>Recent Moves</h3>
    ${moves.length ? rows : `<p class="muted">No money moves in the last 34 days — assign or move money and it'll show up here.</p>`}
  </div>`;
}

// ---------- inspector ----------
function summaryCard(md) {
  const prevMonth = addMonths(curMonth, -1);
  const prevAvail = store.monthData(prevMonth).totals.available;
  const leftOver = Math.max(prevAvail, 0);
  return h`<div class="insp-card">
    <button class="insp-card-head" data-act="toggle-summary">${monthLabel(curMonth).split(' ')[0]}'s Summary ${summaryOpen ? '▾' : '▸'}</button>
    ${summaryOpen ? h`<div class="insp-card-body">
      <div class="insp-row"><span>Left Over from Last Month</span><span>${fmt(leftOver)}</span></div>
      <div class="insp-row"><span>Assigned in ${monthLabel(curMonth).split(' ')[0]}</span><span>${fmt(md.totals.assigned)}</span></div>
      <div class="insp-row"><span>Activity</span><span>${fmt(md.totals.activity)}</span></div>
      <div class="insp-row insp-total"><span>Available</span><span>${fmt(md.totals.available)}</span></div>
    </div>` : ''}
  </div>`;
}

function costToBeMeCard(md) {
  const monthWord = monthLabel(curMonth).split(' ')[0];
  const totalTargets = md.groups.flatMap(g => g.categories).reduce((s, c) => s + (c.target ? neededFor(c, curMonth) + c.assigned : 0), 0);
  const income = store.state.settings.expectedIncome;
  return h`<div class="insp-card">
    <div class="insp-card-body">
      <div class="insp-row insp-total"><span>${monthWord}'s Targets</span><span>${fmt(totalTargets)}</span></div>
      ${income != null ? h`<div class="insp-row"><span>Expected Income</span><span>${fmt(income)}</span></div>
        <div class="insp-row"><span>Targets vs Income</span><span class="${income - totalTargets < 0 ? 'neg-text' : 'pos-text'}">${fmt(income - totalTargets)}</span></div>` : ''}
      <button class="btn subtle sm" data-act="toggle-income-pop">Enter your expected income</button>
      <div class="popover income-popover" hidden>
        <div class="form-row">
          <label for="income-input">Expected income this month</label>
          <input id="income-input" type="text" placeholder="0.00" value="${income != null ? fmtExact(income).replace('$', '') : ''}">
        </div>
        <button class="btn sm" data-act="save-income">Save</button>
      </div>
    </div>
  </div>`;
}

function autoAssignCard(md) {
  return h`<div class="insp-card">
    <button class="insp-card-head" data-act="toggle-autoassign-card">⚡ Auto-Assign ${autoAssignOpen ? '▾' : '▸'}</button>
    ${autoAssignOpen ? `<div class="insp-card-body auto-rows">${autoAssignRows(md)}</div>` : ''}
  </div>`;
}

function futureMonthsCard() {
  const months = Object.keys(store.state.budget).filter(m => m > curMonth && Object.values(store.state.budget[m]).some(v => v)).sort();
  const total = months.reduce((s, m) => s + Object.values(store.state.budget[m]).reduce((a, b) => a + b, 0), 0);
  return h`<div class="insp-card">
    <button class="insp-card-head" data-act="toggle-future">Assigned in Future Months ${futureOpen ? '▾' : '▸'} ${fmt(total)}</button>
    ${futureOpen ? h`<div class="insp-card-body">
      ${months.length ? months.map(m => h`<div class="insp-row"><span>${monthLabel(m)}</span><span>${fmt(Object.values(store.state.budget[m]).reduce((a, b) => a + b, 0))}</span></div>`).join('') : `<p class="muted">Nothing assigned ahead of ${monthLabel(curMonth)} yet.</p>`}
    </div>` : ''}
  </div>`;
}

function cashCreditSplit(catId, month) {
  let cash = 0, credit = 0;
  for (const tx of store.state.transactions) {
    if (tx.date.slice(0, 7) !== month) continue;
    const acc = store.state.accounts.find(a => a.id === tx.accountId);
    if (!acc || !acc.onBudget) continue;
    const rows = tx.subtransactions?.length ? tx.subtransactions : [tx];
    for (const r of rows) {
      if (r.categoryId !== catId || r.amount >= 0) continue;
      if (acc.type === 'creditCard') credit += r.amount; else cash += r.amount;
    }
  }
  return { cash, credit };
}

function targetCard(cat) {
  const t = cat.target;
  if (!t) {
    return h`<div class="insp-card">
      <div class="insp-card-body">
        <div class="insp-target-question">How much do you need for ${cat.name}?</div>
        <p class="muted insp-target-hint">Set a target so this category tells you when it's on track, instead of you having to remember.</p>
        <button class="btn subtle" data-act="create-target">Create Target</button>
      </div>
    </div>`;
  }
  const cadence = t.type === 'SAVINGS_BALANCE' ? 'custom' : (t.weekly ? 'weekly' : t.cadence || 'monthly');
  const segs = [['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['custom', 'Custom']];
  const needed = neededFor(cat, curMonth);
  return h`<div class="insp-card">
    <div class="insp-card-body">
      <div class="insp-label">Target</div>
      <div class="segmented">
        ${segs.map(([k, label]) => h`<button class="seg-btn ${cadence === k ? 'active' : ''}" data-act="set-target-cadence" data-id="${k}">${label}</button>`).join('')}
      </div>
      <div class="form-row">
        <label for="insp-target-amount">I need</label>
        <input id="insp-target-amount" type="text" value="${fmtExact(t.amount).replace('$', '')}">
      </div>
      ${cadence === 'weekly' ? h`<div class="form-row">
        <label for="insp-target-every">Every</label>
        <select id="insp-target-every">
          ${WEEKDAYS.map((wd, i) => `<option value="${i}" ${t.weekday === i ? 'selected' : ''}>${wd}</option>`).join('')}
        </select>
      </div>` : ''}
      ${cadence === 'monthly' ? h`<div class="form-row">
        <label for="insp-target-every">Every</label>
        <select id="insp-target-every">
          ${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${((t.dayOfMonth || 1) === i + 1) ? 'selected' : ''}>Day ${i + 1}</option>`).join('')}
        </select>
      </div>` : ''}
      ${(cadence === 'yearly' || cadence === 'custom') ? h`<div class="form-row">
        <label for="insp-target-every">Every</label>
        <input id="insp-target-every" type="month" value="${t.targetDate || ''}">
      </div>` : ''}
      ${cadence !== 'custom' ? h`<div class="form-row">
        <label for="insp-target-refill">Next month I want to</label>
        <select id="insp-target-refill">
          <option value="need" ${!t.refill ? 'selected' : ''}>Set aside another ${fmtExact(t.amount)}</option>
          <option value="refill" ${t.refill ? 'selected' : ''}>Refill up to ${fmtExact(t.amount)}</option>
        </select>
      </div>` : ''}
      <label class="snooze-row">
        <input type="checkbox" id="insp-target-snooze" ${t.snoozed ? 'checked' : ''}>
        <span>Snooze this target</span>
      </label>
      <div class="insp-goal-status muted">Needed this month: <strong>${fmt(needed)}</strong></div>
      <div class="modal-actions target-actions">
        <button class="link-btn danger-text" data-act="delete-target">🗑 Delete</button>
        <div class="target-actions-right">
          <button class="btn secondary sm" data-act="cancel-target-edit">Cancel</button>
          <button class="btn sm" data-act="save-target">Save Target</button>
        </div>
      </div>
    </div>
  </div>`;
}

function inspector(md) {
  if (selectedId) {
    const cat = md.groups.flatMap(g => g.categories).find(c => c.id === selectedId);
    if (!cat) { selectedId = null; return inspector(md); }
    const prevMonth = addMonths(curMonth, -1);
    const prevAvail = store.monthData(prevMonth).groups.flatMap(g => g.categories).find(c => c.id === cat.id)?.available ?? 0;
    const cashLeftOver = Math.max(prevAvail, 0);
    const split = cashCreditSplit(cat.id, curMonth);
    return h`<aside class="inspector">
      <div class="insp-cat-head">
        <h3 class="insp-title">${cat.name}</h3>
        <button class="icon-btn" data-act="open-cat" data-id="${cat.id}" title="Rename">✏️</button>
      </div>
      <div class="insp-card">
        <div class="insp-card-body">
          <div class="insp-row insp-avail-head">
            <span class="insp-label">Available Balance ▾</span>
            <span class="pill ${cat.pillClass}">${fmt(cat.available)}</span>
          </div>
          <div class="insp-row"><span>Cash Left Over From Last Month</span><span>${fmt(cashLeftOver)}</span></div>
          <div class="insp-row"><span>Assigned This Month</span><span>${fmt(cat.assigned)}</span></div>
          <div class="insp-row"><span>Cash Spending</span><span>${fmt(split.cash)}</span></div>
          <div class="insp-row"><span>Credit Spending</span><span>${fmt(split.credit)}</span></div>
        </div>
      </div>
      ${[targetCard(cat)]}
    </aside>`;
  }
  return h`<aside class="inspector">
    ${[summaryCard(md)]}
    ${[costToBeMeCard(md)]}
    ${[autoAssignCard(md)]}
    ${[futureMonthsCard()]}
  </aside>`;
}

export function render(root, { month }) {
  curMonth = month;
  const md = store.monthData(month);
  const view = activeFocusedViewId ? store.state.focusedViews.find(v => v.id === activeFocusedViewId) : null;
  const filterIds = view ? new Set(view.categoryIds) : null;
  const allVisibleIds = md.groups.flatMap(g => (filterIds ? g.categories.filter(c => filterIds.has(c.id)) : g.categories).filter(passesFilter)).map(c => c.id);
  const headerAllChecked = allVisibleIds.length > 0 && allVisibleIds.every(id => checkedCats.has(id));

  root.innerHTML = h`<div class="budget-view density-${density}">
    ${[header(md)]}
    ${[filterChips()]}
    ${[toolbar()]}
    <div class="budget-body">
      <div class="budget-table-wrap">
        <table class="budget-table">
          <thead><tr>
            <th class="chev-cell"><button class="chevron-btn" data-act="toggle-all-groups" title="Collapse or expand all">${collapsedGroups.size ? '▸' : '▾'}</button></th>
            <th class="chk-cell"><input type="checkbox" class="row-chk" data-act="toggle-check-all" ${headerAllChecked ? 'checked' : ''}></th>
            <th>CATEGORY</th><th class="num">ASSIGNED</th><th class="num">ACTIVITY</th><th class="num">AVAILABLE</th>
          </tr></thead>
          ${md.groups.map(g => groupRows(g, filterIds)).join('')}
        </table>
      </div>
      <div class="inspector-wrap">${[inspector(md)]}</div>
    </div>
  </div>`;

  wireEvents(root, md);
}

function wireEvents(root, md) {
  const allCats = () => md.groups.flatMap(g => g.categories);

  root.querySelectorAll('.assigned-input').forEach(inp => {
    inp.focus(); inp.select();
    const commit = () => { store.assign(curMonth, inp.dataset.id, parseAmount(inp.value)); editingCatId = null; };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { commit(); }
      else if (e.key === 'Escape') { editingCatId = null; render(root, { month: curMonth }); }
    };
    inp.onblur = commit;
  });

  root.querySelector('#month-note-input')?.addEventListener('change', e => {
    const notes = { ...(store.state.settings.monthNotes || {}), [curMonth]: e.target.value };
    store.updateSettings({ monthNotes: notes });
  });

  root.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) { closeAllPopovers(root); return; }
    const id = act.dataset.id;
    switch (act.dataset.act) {
      case 'toggle-group':
        collapsedGroups.has(id) ? collapsedGroups.delete(id) : collapsedGroups.add(id);
        render(root, { month: curMonth });
        break;
      case 'toggle-all-groups': {
        const all = store.monthData(curMonth).groups.map(g => g.id);
        if (collapsedGroups.size) collapsedGroups.clear();
        else all.forEach(gid => collapsedGroups.add(gid));
        render(root, { month: curMonth });
        break;
      }
      case 'add-cat': {
        const name = prompt('New category name:');
        if (name && name.trim()) store.addCategory(id, name.trim());
        break;
      }
      case 'edit-assigned':
        if (editingCatId !== id) { editingCatId = id; render(root, { month: curMonth }); }
        break;
      case 'open-cat':
        e.stopPropagation();
        openCategoryPopover(root, act, id, md);
        break;
      case 'open-move':
        e.stopPropagation();
        openMovePopover(root, act, id, md);
        break;
      case 'toggle-check': {
        e.stopPropagation();
        checkedCats.has(id) ? checkedCats.delete(id) : checkedCats.add(id);
        render(root, { month: curMonth });
        break;
      }
      case 'toggle-check-group': {
        e.stopPropagation();
        const g = md.groups.find(g => g.id === id);
        const allChecked = g.categories.length && g.categories.every(c => checkedCats.has(c.id));
        g.categories.forEach(c => allChecked ? checkedCats.delete(c.id) : checkedCats.add(c.id));
        render(root, { month: curMonth });
        break;
      }
      case 'toggle-check-all': {
        e.stopPropagation();
        const ids = allCats().map(c => c.id);
        const allChecked = ids.every(cid => checkedCats.has(cid));
        ids.forEach(cid => allChecked ? checkedCats.delete(cid) : checkedCats.add(cid));
        render(root, { month: curMonth });
        break;
      }
      case 'set-filter':
        activeFilter = id;
        render(root, { month: curMonth });
        break;
      case 'set-density':
        density = id;
        render(root, { month: curMonth });
        break;
      case 'toggle-month-picker':
        e.stopPropagation();
        togglePopoverEl(act.parentElement.querySelector('.month-picker-popover'));
        break;
      case 'mp-year-prev': case 'mp-year-next': {
        e.stopPropagation();
        // shift the whole picker's displayed year by re-rendering with a temp month; simplest: navigate picker via data year swap
        const grid = act.closest('.month-picker-popover');
        const yearSpan = grid.querySelector('.mp-year span');
        const newYear = +yearSpan.textContent + (act.dataset.act === 'mp-year-next' ? 1 : -1);
        const monthsWithData = new Set(Object.keys(store.state.budget).filter(m => m.startsWith(String(newYear))));
        yearSpan.textContent = newYear;
        grid.querySelectorAll('.mp-cell').forEach((cell, i) => {
          const mm = `${newYear}-${String(i + 1).padStart(2, '0')}`;
          cell.href = `#/budget/${mm}`;
          cell.classList.toggle('current', mm === curMonth);
          cell.classList.toggle('has-data', monthsWithData.has(mm));
        });
        break;
      }
      case 'toggle-assign-pop':
        e.stopPropagation();
        togglePopoverEl(act.parentElement.querySelector('.assign-popover'));
        break;
      case 'assign-tab-auto':
        assignTab = 'auto'; render(root, { month: curMonth });
        break;
      case 'assign-tab-manual':
        assignTab = 'manual'; render(root, { month: curMonth });
        break;
      case 'manual-assign-checked': {
        const amtInput = act.closest('.assign-popover').querySelector('#manual-amount');
        const total = parseAmount(amtInput.value);
        const ids = [...checkedCats];
        if (total > 0 && ids.length) {
          const share = Math.floor(total / ids.length);
          ids.forEach(cid => {
            const c = allCats().find(x => x.id === cid);
            if (c) store.assign(curMonth, cid, c.assigned + share);
          });
          toast(`Split ${fmt(total)} across ${ids.length} categor${ids.length === 1 ? 'y' : 'ies'}`, { undoable: true });
        }
        break;
      }
      case 'auto-underfunded':
        store.autoAssign(curMonth);
        toast('Assigned underfunded categories', { undoable: true });
        break;
      case 'auto-lastmonth-assigned':
        applyLastMonth(md, 'assigned');
        break;
      case 'auto-lastmonth-spent':
        applyLastMonth(md, 'spent');
        break;
      case 'auto-avg-assigned':
        applyAverage(md, 'assigned');
        break;
      case 'auto-avg-spent':
        applyAverage(md, 'spent');
        break;
      case 'auto-reset-available':
        allCats().forEach(c => store.assign(curMonth, c.id, c.assigned - c.available));
        toast('Available amounts reset to zero', { undoable: true });
        break;
      case 'auto-reset-assigned':
        allCats().forEach(c => store.assign(curMonth, c.id, 0));
        toast('Assigned amounts reset', { undoable: true });
        break;
      case 'toggle-addgroup-menu':
        e.stopPropagation();
        togglePopoverEl(act.parentElement.querySelector('.addgroup-menu'));
        break;
      case 'new-group': {
        const name = prompt('New group name:');
        if (name && name.trim()) store.addGroup(name.trim());
        break;
      }
      case 'from-template':
        openTemplateModal();
        break;
      case 'undo':
        store.undo();
        break;
      case 'redo':
        toast('Redo coming soon');
        break;
      case 'toggle-recent-moves':
        e.stopPropagation();
        togglePopoverEl(act.parentElement.querySelector('.recent-popover'));
        break;
      case 'toggle-hide':
        store.updateSettings({ hideAmounts: !store.state.settings.hideAmounts });
        break;
      case 'toggle-fv-menu': {
        e.stopPropagation();
        const menu = act.parentElement.querySelector('.fv-menu');
        togglePopoverEl(menu);
        if (!menu.hidden && innerWidth < 768) { // escape the chip-row scroll clip on phones
          const r = act.getBoundingClientRect();
          Object.assign(menu.style, { position: 'fixed', top: r.bottom + 6 + 'px', right: '12px', left: 'auto' });
        }
        break;
      }
      case 'pick-fv':
        activeFocusedViewId = id;
        render(root, { month: curMonth });
        break;
      case 'new-fv':
        openNewFocusedViewModal(md);
        break;
      case 'clear-focused-view':
        activeFocusedViewId = null;
        render(root, { month: curMonth });
        break;
      case 'toggle-summary':
        summaryOpen = !summaryOpen; render(root, { month: curMonth });
        break;
      case 'toggle-autoassign-card':
        autoAssignOpen = !autoAssignOpen; render(root, { month: curMonth });
        break;
      case 'toggle-future':
        futureOpen = !futureOpen; render(root, { month: curMonth });
        break;
      case 'toggle-income-pop':
        e.stopPropagation();
        togglePopoverEl(act.closest('.insp-card-body').querySelector('.income-popover'));
        break;
      case 'save-income': {
        const val = act.closest('.income-popover').querySelector('#income-input').value;
        store.updateSettings({ expectedIncome: parseAmount(val) });
        break;
      }
      case 'create-target':
        store.setTarget(selectedId, { type: 'NEED', amount: 0, cadence: 'monthly', targetDate: null });
        break;
      case 'set-target-cadence': {
        const cat = allCats().find(c => c.id === selectedId);
        const t = { ...(cat.target || { amount: 0 }) };
        if (id === 'weekly') { t.cadence = 'weekly'; t.type = 'NEED'; t.weekday = t.weekday ?? 1; t.targetDate = null; }
        else if (id === 'monthly') { t.cadence = 'monthly'; t.type = 'NEED'; t.targetDate = null; }
        else if (id === 'yearly') { t.cadence = 'yearly'; t.type = 'NEED'; }
        else { t.type = 'SAVINGS_BALANCE'; t.targetDate = t.targetDate || curMonth; }
        store.setTarget(selectedId, t);
        break;
      }
      case 'save-target':
        saveTargetFromInspector(root, selectedId);
        break;
      case 'delete-target':
        store.setTarget(selectedId, null);
        break;
      case 'cancel-target-edit':
        render(root, { month: curMonth });
        break;
    }
  };

  root.querySelector('#insp-target-snooze')?.addEventListener('change', e => {
    const cat = allCats().find(c => c.id === selectedId);
    if (cat?.target) store.setTarget(selectedId, { ...cat.target, snoozed: e.target.checked });
  });

  root.querySelectorAll('tr.cat-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('[data-act]') || e.target.closest('.row-chk')) return;
      selectedId = selectedId === tr.dataset.catId ? null : tr.dataset.catId;
      render(root, { month: curMonth });
    });
    wireCatDrag(tr, root);
  });
  root.querySelectorAll('tr.group-row').forEach(tr => wireGroupDrag(tr, root));
}

function togglePopoverEl(el) {
  if (!el) return;
  const willOpen = el.hidden;
  document.querySelectorAll('.assign-popover, .month-picker-popover, .fv-menu, .addgroup-menu, .recent-popover, .income-popover').forEach(m => m.hidden = true);
  el.hidden = !willOpen;
}
function closeAllPopovers(root) {
  root.querySelectorAll('.assign-popover, .month-picker-popover, .fv-menu, .addgroup-menu, .recent-popover, .income-popover').forEach(m => m.hidden = true);
}

function applyLastMonth(md, mode) {
  const prevMonth = addMonths(curMonth, -1);
  const prevMd = store.monthData(prevMonth);
  const prevCats = new Map(prevMd.groups.flatMap(g => g.categories).map(c => [c.id, c]));
  let rtaLeft = store.readyToAssign(curMonth);
  md.groups.flatMap(g => g.categories).forEach(c => {
    const prev = prevCats.get(c.id);
    if (!prev) return;
    const want = mode === 'assigned' ? prev.assigned : Math.max(0, -prev.activity);
    if (want <= 0) return;
    const amt = Math.min(want, Math.max(0, rtaLeft));
    if (amt <= 0) return;
    store.assign(curMonth, c.id, c.assigned + amt);
    rtaLeft -= amt;
  });
  toast(mode === 'assigned' ? 'Assigned last month’s amounts' : 'Assigned last month’s spending', { undoable: true });
}

function applyAverage(md, mode) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(curMonth, -1 - i));
  let rtaLeft = store.readyToAssign(curMonth);
  md.groups.flatMap(g => g.categories).forEach(c => {
    const vals = months.map(m => {
      const mc = store.monthData(m).groups.flatMap(g => g.categories).find(x => x.id === c.id);
      if (!mc) return 0;
      return mode === 'spent' ? Math.max(0, -mc.activity) : mc.assigned;
    });
    const want = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    if (want <= 0) return;
    const amt = Math.min(want, Math.max(0, rtaLeft));
    if (amt <= 0) return;
    store.assign(curMonth, c.id, c.assigned + amt);
    rtaLeft -= amt;
  });
  toast(mode === 'spent' ? 'Assigned average spending' : 'Assigned average amounts', { undoable: true });
}

// ---------- category popover ----------
function openCategoryPopover(root, anchorEl, catId, md) {
  root.querySelectorAll('.popover.cat-popover').forEach(p => p.remove());
  const cat = md.groups.flatMap(g => g.categories).find(c => c.id === catId);
  const rect = anchorEl.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'popover cat-popover';
  pop.style.left = rect.left + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  pop.innerHTML = h`<input class="pop-rename-input" type="text" value="${cat.name}">
    <div class="pop-actions">
      <button data-pop-act="hide">Hide</button>
      <button data-pop-act="delete" class="danger-text">Delete</button>
    </div>`;
  document.body.appendChild(pop);
  const input = pop.querySelector('.pop-rename-input');
  input.focus(); input.select();
  input.onkeydown = e => {
    if (e.key === 'Enter') { store.updateCategory(catId, { name: input.value }); pop.remove(); }
    if (e.key === 'Escape') pop.remove();
  };
  pop.querySelector('[data-pop-act="hide"]').onclick = () => { store.hideCategory(catId); pop.remove(); };
  pop.querySelector('[data-pop-act="delete"]').onclick = () => {
    if (confirm(`Delete category "${cat.name}"?`)) store.deleteCategory(catId);
    pop.remove();
  };
  setTimeout(() => document.addEventListener('click', outsideCloser(pop), { once: true }));
}
function outsideCloser(pop, onClose) {
  return function handler(e) {
    if (pop.contains(e.target)) { document.addEventListener('click', outsideCloser(pop, onClose), { once: true }); return; }
    onClose ? onClose() : pop.remove();
  };
}

// ---------- move money popover ----------
// real app: anchored dropdown-list — click a row to execute the move immediately, no confirm step.
function moveListRows(catId, overspent, allCats, filterText) {
  const q = filterText.trim().toLowerCase();
  const rtaRow = !q || 'ready to assign'.includes(q)
    ? h`<button class="mm-row" data-mm-id="">
        <span class="mm-row-name">Ready to Assign</span>
        <span class="mm-row-amt">${fmt(store.readyToAssign(curMonth))}</span>
      </button>`
    : '';
  const catRows = allCats
    .filter(c => c.id !== catId)
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .map(c => h`<button class="mm-row" data-mm-id="${c.id}">
      <span class="mm-row-name">${c.name}</span>
      <span class="pill ${c.pillClass}">${fmt(c.available)}</span>
    </button>`)
    .join('');
  return rtaRow + catRows;
}

function openMovePopover(root, anchorEl, catId, md) {
  document.querySelectorAll('.popover.move-money-popover').forEach(p => p.remove());
  const cat = md.groups.flatMap(g => g.categories).find(c => c.id === catId);
  const overspent = cat.available < 0;
  const prefill = Math.abs(cat.available);
  const allCats = md.groups.flatMap(g => g.categories);
  const isMobile = window.innerWidth < 768;

  const body = h`<div class="move-money-body">
    <h2>${overspent ? 'Cover this overspending from:' : 'Move money to:'}</h2>
    <input class="mm-amount" id="mm-amount" type="text" value="${fmtExact(prefill).replace('$', '')}">
    <input class="mm-search" id="mm-search" type="text" placeholder="Filter categories…">
    <div class="mm-list" id="mm-list">${moveListRows(catId, overspent, allCats, '')}</div>
  </div>`;

  let pop;
  if (isMobile) {
    pop = openModal(body);
    pop.classList.add('bottom-sheet');
  } else {
    const rect = anchorEl.getBoundingClientRect();
    pop = document.createElement('div');
    pop.className = 'popover move-money-popover';
    pop.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    pop.innerHTML = body;
    document.body.appendChild(pop);
  }
  wireMoveMoney(pop, catId, overspent, allCats, isMobile);
}

function wireMoveMoney(pop, catId, overspent, allCats, isMobile) {
  const amountInput = pop.querySelector('#mm-amount');
  const searchInput = pop.querySelector('#mm-search');
  const list = pop.querySelector('#mm-list');
  amountInput.focus(); amountInput.select();

  searchInput.oninput = () => {
    list.innerHTML = moveListRows(catId, overspent, allCats, searchInput.value);
  };

  const close = () => {
    document.removeEventListener('keydown', onKey);
    isMobile ? closeModal() : pop.remove();
  };
  list.onclick = e => {
    const row = e.target.closest('.mm-row');
    if (!row) return;
    const cents = parseAmount(amountInput.value);
    if (cents <= 0) return;
    const otherId = row.dataset.mmId || null;
    const [from, to] = overspent ? [otherId, catId] : [catId, otherId];
    store.moveMoney(curMonth, from, to, cents);
    close();
    toast('Moved money', { undoable: true });
  };

  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  if (!isMobile) setTimeout(() => document.addEventListener('click', outsideCloser(pop, close), { once: true }));
}

// ---------- target save ----------
function saveTargetFromInspector(root, catId) {
  const cat = store.state.categories.find(c => c.id === catId);
  const t = { ...(cat.target || {}) };
  const amount = parseAmount(root.querySelector('#insp-target-amount')?.value || '0');
  t.amount = amount;
  const everyEl = root.querySelector('#insp-target-every');
  if (everyEl) {
    if (t.cadence === 'weekly') t.weekday = +everyEl.value;
    else if (t.cadence === 'monthly' && t.type !== 'SAVINGS_BALANCE') t.dayOfMonth = +everyEl.value;
    else t.targetDate = everyEl.value || null;
  }
  const refillEl = root.querySelector('#insp-target-refill');
  if (refillEl) t.refill = refillEl.value === 'refill';
  const snoozeEl = root.querySelector('#insp-target-snooze');
  if (snoozeEl) t.snoozed = snoozeEl.checked;
  store.setTarget(catId, t);
}

// ---------- new group / template modal ----------
function openTemplateModal() {
  const body = h`<h2>Start from Template</h2>
    <div class="template-list">
      ${CATEGORY_TEMPLATES.map((t, i) => h`<label class="template-item">
        <input type="checkbox" data-tpl-idx="${i}">
        <span>${t.name}</span>
      </label>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="tpl-cancel">Cancel</button>
      <button class="btn" id="tpl-apply">Apply</button>
    </div>`;
  const modal = openModal(body);
  modal.querySelector('#tpl-cancel').onclick = closeModal;
  modal.querySelector('#tpl-apply').onclick = () => {
    modal.querySelectorAll('[data-tpl-idx]:checked').forEach(cb => {
      const tpl = CATEGORY_TEMPLATES[+cb.dataset.tplIdx];
      (tpl.groups || []).forEach(g => {
        const groupId = store.addGroup(g.name);
        (g.categories || []).forEach(catName => store.addCategory(groupId, catName));
      });
    });
    closeModal();
  };
}

function openNewFocusedViewModal(md) {
  const cats = md.groups.flatMap(g => g.categories.map(c => ({ ...c, groupName: g.name })));
  const body = h`<h2>New Focused View</h2>
    <div class="form-row">
      <label for="fv-name">Name</label>
      <input id="fv-name" type="text">
    </div>
    <div class="fv-cat-list">
      ${cats.map(c => h`<label class="fv-cat-item">
        <input type="checkbox" data-fv-cat="${c.id}">
        <span>${c.groupName} : ${c.name}</span>
      </label>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="fv-cancel">Cancel</button>
      <button class="btn" id="fv-save">Save</button>
    </div>`;
  const modal = openModal(body);
  modal.querySelector('#fv-cancel').onclick = closeModal;
  modal.querySelector('#fv-save').onclick = () => {
    const name = modal.querySelector('#fv-name').value.trim();
    const ids = [...modal.querySelectorAll('[data-fv-cat]:checked')].map(cb => cb.dataset.fvCat);
    if (!name || !ids.length) return;
    const id = store.saveFocusedView(name, ids); // returns the new view's id
    activeFocusedViewId = id ?? null;
    closeModal();
  };
}

// ---------- drag and drop ----------
function wireCatDrag(tr, root) {
  tr.ondragstart = e => {
    e.dataTransfer.setData('text/cat-id', tr.dataset.catId);
    e.dataTransfer.effectAllowed = 'move';
  };
  tr.ondragover = e => {
    if (!e.dataTransfer.types.includes('text/cat-id')) return;
    e.preventDefault();
    showDropIndicator(tr, e.clientY);
  };
  tr.ondragleave = () => hideDropIndicator(tr);
  tr.ondrop = e => {
    e.preventDefault();
    hideDropIndicator(tr);
    const draggedId = e.dataTransfer.getData('text/cat-id');
    if (!draggedId || draggedId === tr.dataset.catId) return;
    const groupBody = tr.closest('.group-body');
    const groupId = groupBody.dataset.groupId;
    const rows = [...groupBody.querySelectorAll('.cat-row')];
    let index = rows.indexOf(tr);
    const rect = tr.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) index += 1;
    store.moveCategory(draggedId, groupId, index);
  };
}
function wireGroupDrag(tr, root) {
  tr.ondragstart = e => {
    e.dataTransfer.setData('text/group-id', tr.dataset.groupId);
    e.dataTransfer.effectAllowed = 'move';
  };
  tr.ondragover = e => {
    if (!e.dataTransfer.types.includes('text/group-id')) return;
    e.preventDefault();
    showDropIndicator(tr, e.clientY);
  };
  tr.ondragleave = () => hideDropIndicator(tr);
  tr.ondrop = e => {
    e.preventDefault();
    hideDropIndicator(tr);
    const draggedId = e.dataTransfer.getData('text/group-id');
    if (!draggedId || draggedId === tr.dataset.groupId) return;
    const bodies = [...root.querySelectorAll('.group-body')];
    let index = bodies.findIndex(b => b.dataset.groupId === tr.dataset.groupId);
    const rect = tr.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) index += 1;
    store.moveGroup(draggedId, index);
  };
}
function showDropIndicator(tr, clientY) {
  tr.classList.remove('drop-above', 'drop-below');
  const rect = tr.getBoundingClientRect();
  tr.classList.add(clientY > rect.top + rect.height / 2 ? 'drop-below' : 'drop-above');
}
function hideDropIndicator(tr) {
  tr.classList.remove('drop-above', 'drop-below');
}
