import { store } from '../store.js';
import { openModal, closeModal, toast, navigate } from '../app.js';
import { fmt, fmtExact, parseAmount, addMonths, monthLabel, h, raw, ICONS } from '../util.js';
import { CATEGORY_TEMPLATES } from '../seed.js';

// module-local UI state — survives re-render since render() rebuilds root.innerHTML each time
const collapsedGroups = new Set();
let editingCatId = null;   // category id whose ASSIGNED cell is in edit mode
let selectedId = null;     // inspector selection
let activeFocusedViewId = null;
let curMonth;
let activeFilter = 'all';       // all | underfunded | overfunded | available | snoozed
let checkedCats = new Set();    // checkbox selection (Manually-assign + bulk highlight)
let density = 'compact';        // comfortable | compact — the supplied layout uses the tighter table rhythm
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

function isMobile() { return window.innerWidth < 768; }
function overspentCats(md) { return md.groups.flatMap(g => g.categories).filter(c => c.available < 0); }

// ---------- Cover overspending banner (desktop + mobile) ----------
function coverBanner(md) {
  const over = overspentCats(md);
  if (!over.length) return '';
  const n = over.length;
  return h`<div class="cover-banner">
    <span class="cover-count">${String(n)}</span>
    <span class="cover-text">${n} overspent categor${n === 1 ? 'y' : 'ies'}</span>
    <button class="btn subtle sm cover-btn" data-act="cover">Cover</button>
  </div>`;
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
      <span class="cat-name-btn" data-act="open-cat" data-id="${c.id}">${c.name}</span>${c.target?.snoozed ? raw(' <span class="snooze-tag">💤</span>') : ''}
      <div class="target-bar"><div class="target-bar-fill ${fundBarClass(c)}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
    </td>
    <td class="num assigned-cell" data-act="edit-assigned" data-id="${c.id}">
      ${editing
        ? h`<input class="assigned-input" data-id="${c.id}" type="text" value="${fmtExact(c.assigned).replace('$', '')}">`
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
        <span class="group-name">${g.name}${g.hidden ? raw(' <span class="muted">(hidden)</span>') : ''}</span>
        <button class="add-cat-btn" data-act="add-cat" data-id="${g.id}" title="Add category">+</button>
      </td>
      <td class="num">${fmt(totals.assigned)}</td>
      <td class="num muted">${fmt(totals.activity)}</td>
      <td class="num">${fmt(totals.available)}</td>
    </tr>
    ${collapsed ? '' : cats.map(c => catRow(c, g.hidden))}
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
  });
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
      ? h`<div class="auto-rows">${autoAssignRows(md)}</div>`
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
  });
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
    ${chips.map(([k, label]) => h`<button class="chip ${activeFilter === k ? 'active' : ''}" data-act="set-filter" data-id="${k}">${label}</button>`)}
    <div class="chip-fv-wrap">
      <button class="chip chip-fv ${activeFocusedViewId ? 'active' : ''}" data-act="toggle-fv-menu">${activeFocusedViewId ? views.find(v => v.id === activeFocusedViewId)?.name || 'View' : 'Views'} ▾</button>
      <div class="fv-menu" hidden>
        ${views.map(v => h`<button data-act="pick-fv" data-id="${v.id}">${v.name}</button>`)}
        <button data-act="new-fv">＋ New Focused View…</button>
        ${activeFocusedViewId ? raw('<button data-act="clear-focused-view">✕ Clear View</button>') : ''}
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
  const catName = id => id ? (store.state.categories.find(c => c.id === id)?.name || 'None') : 'Ready to Assign';
  const rows = moves.slice(0, 40).map(m => {
    const from = m.type === 'move' ? catName(m.fromCatId) : 'Ready to Assign';
    const to = m.type === 'move' ? catName(m.toCatId) : catName(m.toCatId);
    return h`<div class="recent-row"><span class="recent-date">${m.date}</span><span class="recent-desc">${from} → ${to}</span><span class="recent-amt">${fmt(m.amount)}</span></div>`;
  });
  return h`<div class="popover recent-popover" hidden>
    <h3>Recent Moves</h3>
    ${moves.length ? rows : raw(`<p class="muted">No money moves in the last 34 days. Assign or move money and it'll show up here.</p>`)}
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
    ${autoAssignOpen ? h`<div class="insp-card-body auto-rows">${autoAssignRows(md)}</div>` : ''}
  </div>`;
}

function futureMonthsCard() {
  const months = Object.keys(store.state.budget).filter(m => m > curMonth && Object.values(store.state.budget[m]).some(v => v)).sort();
  const total = months.reduce((s, m) => s + Object.values(store.state.budget[m]).reduce((a, b) => a + b, 0), 0);
  return h`<div class="insp-card">
    <button class="insp-card-head" data-act="toggle-future">Assigned in Future Months ${futureOpen ? '▾' : '▸'} ${fmt(total)}</button>
    ${futureOpen ? h`<div class="insp-card-body">
      ${months.length ? months.map(m => h`<div class="insp-row"><span>${monthLabel(m)}</span><span>${fmt(Object.values(store.state.budget[m]).reduce((a, b) => a + b, 0))}</span></div>`) : h`<p class="muted">Nothing assigned ahead of ${monthLabel(curMonth)} yet.</p>`}
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
        ${segs.map(([k, label]) => h`<button class="seg-btn ${cadence === k ? 'active' : ''}" data-act="set-target-cadence" data-id="${k}">${label}</button>`)}
      </div>
      <div class="form-row">
        <label for="insp-target-amount">I need</label>
        <input id="insp-target-amount" type="text" value="${fmtExact(t.amount).replace('$', '')}">
      </div>
      ${cadence === 'weekly' ? h`<div class="form-row">
        <label for="insp-target-every">Every</label>
        <select id="insp-target-every">
          ${WEEKDAYS.map((wd, i) => h`<option value="${i}" ${t.weekday === i ? 'selected' : ''}>${wd}</option>`)}
        </select>
      </div>` : ''}
      ${cadence === 'monthly' ? h`<div class="form-row">
        <label for="insp-target-every">Every</label>
        <select id="insp-target-every">
          ${Array.from({ length: 28 }, (_, i) => h`<option value="${i + 1}" ${((t.dayOfMonth || 1) === i + 1) ? 'selected' : ''}>Day ${i + 1}</option>`)}
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
  if (isMobile()) { renderMobile(root, md); return; }
  const view = activeFocusedViewId ? store.state.focusedViews.find(v => v.id === activeFocusedViewId) : null;
  const filterIds = view ? new Set(view.categoryIds) : null;
  const allVisibleIds = md.groups.flatMap(g => (filterIds ? g.categories.filter(c => filterIds.has(c.id)) : g.categories).filter(passesFilter)).map(c => c.id);
  const headerAllChecked = allVisibleIds.length > 0 && allVisibleIds.every(id => checkedCats.has(id));

  root.innerHTML = h`<div class="budget-view density-${density}">
    ${[header(md)]}
    ${[coverBanner(md)]}
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
          ${md.groups.map(g => groupRows(g, filterIds))}
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
    // only clear editingCatId if it's still ours — the outside click that triggered this
    // (deferred) commit may itself have already opened a different cell for editing
    const commit = () => {
      store.assign(curMonth, inp.dataset.id, parseAmount(inp.value));
      if (editingCatId === inp.dataset.id) editingCatId = null;
    };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { commit(); }
      else if (e.key === 'Escape') { editingCatId = null; render(root, { month: curMonth }); }
    };
    // deferred to a macrotask: committing synchronously on blur re-renders (tears down)
    // the DOM mid-click, so the pending mouseup/click on the outside target gets
    // swallowed by the browser (target node vanished between mousedown and mouseup).
    // setTimeout (not requestAnimationFrame) — rAF only fires on paint and can stall
    // indefinitely in a backgrounded/non-visible tab; setTimeout always runs.
    inp.onblur = () => setTimeout(commit, 0);
  });

  root.querySelector('#month-note-input')?.addEventListener('change', e => {
    const notes = { ...(store.state.settings.monthNotes || {}), [curMonth]: e.target.value };
    store.updateSettings({ monthNotes: notes });
  });

  root.onclick = e => {
    const act = e.target.closest('[data-act]');
    // clicks inside an open popover (e.g. typing in the income input) must not close it
    if (!act) { if (!e.target.closest('.popover')) closeAllPopovers(root); return; }
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
        if (isMobile()) openCategoryDetailsSheet(id);
        else openCategoryPopover(root, act, id, md);
        break;
      case 'cover': {
        e.stopPropagation();
        const over = overspentCats(md);
        if (over.length === 1) openMovePopover(root, act, over[0].id, md);
        else if (over.length) openCoverPicker(root, act, over, md);
        break;
      }
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
        openNewFocusedViewModal(root, md);
        break;
      case 'clear-focused-view':
        activeFocusedViewId = null;
        render(root, { month: curMonth });
        break;
      case 'open-views':
        openViewsSheet(root, md);
        break;
      case 'open-edit-plan':
        openEditPlanSheet(root, md);
        break;
      case 'open-overflow':
        openOverflowSheet(root, md);
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
      if (isMobile()) { openCategoryDetailsSheet(tr.dataset.catId); return; }
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
  input.focus({ preventScroll: true }); input.select(); // popover can start partly off-screen pre-clamp; a normal focus() would scroll the page to it
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
    </button>`);
  // returns a Safe so the non-h consumer (list.innerHTML in wireMoveMoney) also works
  return h`${rtaRow}${catRows}`;
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
    pop = openModal(`<div class="sheet-handle"></div>${body}`);
    pop.classList.add('bottom-sheet', 'ss-sheet');
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
      </label>`)}
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

function openNewFocusedViewModal(root, md) {
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
      </label>`)}
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
    // store.saveFocusedView already re-renders once (store.subscribe fires synchronously before
    // it returns), so that render still sees the old activeFocusedViewId — render again below to apply it.
    const id = store.saveFocusedView(name, ids); // returns the new view's id
    activeFocusedViewId = id ?? null;
    closeModal();
    render(root, { month: curMonth });
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

// ================= mobile Plan view (YNAB parity) =================
const M_ICONS = {
  chevDown: raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l5.5 5.5 5.5-5.5"/></svg>`),
  chevRight: raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6l6 6-6 6"/></svg>`),
  views: raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9.3"/><path d="M6.8 9.3h10.4M8.4 12.3h7.2M10.4 15.3h3.2"/></svg>`),
  pencil: raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 21h15"/><path d="M14.6 4.9l4.4 4.4-9.3 9.3-4.9 1 1-4.9 8.8-8.8z"/></svg>`),
  trash: raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`),
  dots: raw(`<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="4.6" r="1.95"/><circle cx="12" cy="12" r="1.95"/><circle cx="12" cy="19.4" r="1.95"/></svg>`),
  plusCircle: raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`),
};
function progressBarsOn() { return store.state.settings.progressBars !== false; }

function mobileCoverBanner(md) {
  const over = overspentCats(md);
  if (!over.length) return '';
  const n = over.length;
  return h`<div class="cover-banner m-cover">
    <span class="cover-count">${String(n)}</span>
    <span class="cover-text">Overspent categor${n === 1 ? 'y' : 'ies'}</span>
    <button class="btn subtle sm cover-btn" data-act="cover">Cover</button>
  </div>`;
}

function mRtaBanner(rta, md) {
  const cls = rta > 0 ? 'pos' : rta < 0 ? 'neg' : 'zero';
  const label = rta > 0 ? 'Ready to Assign' : rta < 0 ? 'You Assigned Too Much' : 'All Money Assigned';
  return h`<div class="assign-wrap m-rta-wrap">
    <button class="m-rta ${cls}" data-act="toggle-assign-pop">
      <span class="m-rta-amt">${fmt(Math.abs(rta))}</span>
      <span class="m-rta-label">${label} <span class="m-rta-chev">${[M_ICONS.chevRight]}</span></span>
    </button>
    ${assignPopover(md)}
  </div>`;
}

function mGroupHeader(g, bars) {
  const collapsed = collapsedGroups.has(g.id);
  const totals = g.categories.reduce((s, c) => ({ assigned: s.assigned + c.assigned, available: s.available + c.available }), { assigned: 0, available: 0 });
  const right = bars
    ? h`<div class="m-avail-label">Available<br>to Spend</div>`
    : h`<div class="m-col"><span class="m-col-label">Assigned</span><span class="m-col-amt">${fmt(totals.assigned)}</span></div>
        <div class="m-col"><span class="m-col-label">Available</span><span class="m-col-amt">${fmt(totals.available)}</span></div>`;
  return h`<div class="m-group ${collapsed ? 'collapsed' : ''}" data-act="toggle-group" data-id="${g.id}">
    <span class="m-group-chev">${collapsed ? [M_ICONS.chevRight] : [M_ICONS.chevDown]}</span>
    <span class="m-group-name">${g.name}${g.hidden ? raw(' <span class="muted">(hidden)</span>') : ''}</span>
    ${right}
  </div>`;
}

function mCatRow(c, bars) {
  const pill = h`<span class="pill ${c.pillClass}">${fmt(c.available)}</span>`;
  if (!bars) {
    return h`<div class="m-cat m-cat-flat" data-act="open-cat" data-id="${c.id}">
      <span class="m-cat-name">${c.name}${c.target?.snoozed ? ' 💤' : ''}</span>
      <span class="m-col m-cat-assigned">${fmt(c.assigned)}</span>
      <span class="m-col m-cat-avail" data-act="open-move" data-id="${c.id}">${[pill]}</span>
    </div>`;
  }
  const pct = c.goal ? c.goal.fundedPct : 0;
  const overspent = c.available < 0;
  const spent = Math.max(0, -c.activity);
  return h`<div class="m-cat m-cat-bars" data-act="open-cat" data-id="${c.id}">
    <div class="m-cat-top">
      <span class="m-cat-name">${c.name}${c.target?.snoozed ? ' 💤' : ''}</span>
      <span class="m-cat-avail" data-act="open-move" data-id="${c.id}">${[pill]}</span>
    </div>
    <div class="m-bar"><div class="m-bar-fill ${fundBarClass(c)}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
    ${overspent ? h`<div class="m-overspent-note">Overspent. ${fmt(spent)} of ${fmt(c.assigned)}</div>` : ''}
  </div>`;
}

function mobileEmptyState() {
  return h`<div class="m-empty-state" role="status">
    <p>Nothing here yet. Tap the <span class="m-empty-edit-icon" aria-hidden="true">${[M_ICONS.pencil]}</span> edit icon above to add groups and categories.</p>
  </div>`;
}

function renderMobile(root, md) {
  const bars = progressBarsOn();
  const view = activeFocusedViewId ? store.state.focusedViews.find(v => v.id === activeFocusedViewId) : null;
  const filterIds = view ? new Set(view.categoryIds) : null;
  const list = md.groups.map(g => {
    const collapsed = collapsedGroups.has(g.id);
    let cats = filterIds ? g.categories.filter(c => filterIds.has(c.id)) : g.categories;
    cats = cats.filter(passesFilter);
    if (!cats.length) return '';
    return [mGroupHeader(g, bars), collapsed ? '' : cats.map(c => mCatRow(c, bars))];
  });
  const hasCategories = md.groups.some(group => group.categories.length > 0);

  root.innerHTML = h`<div class="budget-view budget-mobile bars-${bars ? 'on' : 'off'}">
    <div class="m-head mobile-page-head">
      <div class="month-picker-wrap m-month-wrap">
        <button class="m-month" data-act="toggle-month-picker">${shortMonth(curMonth)}<span class="m-month-chev">${[M_ICONS.chevDown]}</span></button>
        ${monthPickerPopover(curMonth)}
      </div>
      <div class="m-head-actions mobile-page-actions">
        <button class="m-icon mobile-head-action ${activeFilter !== 'all' || activeFocusedViewId ? 'on' : ''}" data-act="open-views" aria-label="Views">${ICONS.filter}</button>
        <button class="m-icon mobile-head-action" data-act="open-edit-plan" aria-label="Edit plan">${ICONS.edit}</button>
        <button class="m-icon mobile-head-action" data-act="open-overflow" aria-label="More">${ICONS.moreVertical}</button>
      </div>
    </div>
    ${[mRtaBanner(md.rta, md)]}
    ${[mobileCoverBanner(md)]}
    <div class="m-list">${hasCategories ? list : [mobileEmptyState()]}</div>
  </div>`;

  wireEvents(root, md);
}

// ---------- Views sheet (screen 03) ----------
function openViewsSheet(root, md) {
  const filters = [['all', 'All'], ['underfunded', 'Underfunded'], ['overfunded', 'Overfunded'], ['available', 'Money Available'], ['snoozed', 'Snoozed']];
  const fvs = store.state.focusedViews;
  const row = (kind, id, label, on) => h`<button class="m-view-row ${on ? 'active' : ''}" data-act="pick-view" data-kind="${kind}" data-id="${id}">
    <span class="m-radio ${on ? 'on' : ''}"></span><span class="m-view-label">${label}</span></button>`;
  const rows = [
    filters.map(([id, label]) => row('filter', id, label, !activeFocusedViewId && activeFilter === id)),
    fvs.map(v => row('fv', v.id, v.name, activeFocusedViewId === v.id)),
  ];
  const sheet = openModal(h`<div class="sheet-handle"></div>
    <h2 class="sheet-title">Views</h2>
    <div class="m-views-btns">
      <button class="m-views-btn" data-act="views-edit">${[M_ICONS.pencil]} Edit</button>
      <button class="m-views-btn" data-act="views-new">${[M_ICONS.plusCircle]} New</button>
    </div>
    <div class="m-views-list">${rows}</div>`);
  sheet.classList.add('bottom-sheet', 'ss-sheet');
  sheet.classList.add('views-sheet');
  sheet.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'pick-view':
        if (act.dataset.kind === 'fv') { activeFocusedViewId = act.dataset.id; }
        else { activeFilter = act.dataset.id; activeFocusedViewId = null; }
        closeModal(); render(root, { month: curMonth });
        break;
      case 'views-new':
        closeModal(); openNewFocusedViewModal(root, md);
        break;
      case 'views-edit':
        openEditViewsSheet(root, md);
        break;
    }
  };
}

function openEditViewsSheet(root, md) {
  const fvs = store.state.focusedViews;
  const rows = fvs.length
    ? fvs.map(v => h`<div class="m-menu-row"><span class="m-menu-label">${v.name}</span>
        <button class="link-btn danger-text" data-act="del-fv" data-id="${v.id}">Delete</button></div>`)
    : raw(`<p class="muted" style="padding:8px 2px">No saved views yet. Tap New to create one.</p>`);
  const sheet = openModal(h`<div class="sheet-handle"></div><h2 class="sheet-title">Edit Views</h2>
    <div class="m-menu">${rows}</div>`);
  sheet.classList.add('bottom-sheet', 'ss-sheet');
  sheet.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'del-fv') {
      if (activeFocusedViewId === act.dataset.id) activeFocusedViewId = null;
      store.deleteFocusedView(act.dataset.id);
      closeModal(); render(root, { month: curMonth });
    }
  };
}

// ---------- Edit Plan sheet (pencil) ----------
function openPlanEditor(root, { title, label, value = '', inputMode = 'text', onSave }) {
  const host = document.querySelector('#modal-root .edit-plan-modal');
  if (!host) return;
  host.querySelector('.plan-editor-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'plan-editor-layer';
  layer.innerHTML = h`<div class="plan-editor-card" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title">
    <h2 id="plan-editor-title">${title}</h2>
    <label for="plan-editor-input">${label}</label>
    <input id="plan-editor-input" type="text" inputmode="${inputMode}" value="${value}" autocomplete="off">
    <div class="modal-actions">
      <button class="btn secondary" id="plan-editor-cancel">Cancel</button>
      <button class="btn" id="plan-editor-save">Save</button>
    </div>
  </div>`;
  host.append(layer);
  const input = layer.querySelector('#plan-editor-input');
  const dismiss = () => layer.remove();
  const save = () => {
    const value = input.value.trim();
    if (inputMode !== 'decimal' && !value) { input.focus(); return; }
    onSave(value);
    openEditPlanSheet(root, store.monthData(curMonth));
  };
  layer.onclick = event => {
    event.stopPropagation();
    if (event.target === layer) dismiss();
  };
  layer.querySelector('#plan-editor-cancel').onclick = dismiss;
  layer.querySelector('#plan-editor-save').onclick = save;
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  };
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function openPlanCategoryActions(root, category) {
  const host = document.querySelector('#modal-root .edit-plan-modal');
  if (!host || !category) return;
  host.querySelector('.plan-editor-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'plan-editor-layer plan-category-layer';
  const dismiss = () => layer.remove();
  const renderActions = () => {
    layer.innerHTML = h`<div class="plan-editor-card plan-category-card" role="dialog" aria-modal="true" aria-labelledby="plan-category-title">
      <div class="plan-category-head"><div><span>Category</span><h2 id="plan-category-title">${category.name}</h2></div><button class="plan-category-close" aria-label="Close">×</button></div>
      <div class="plan-category-actions">
        <button data-category-act="rename"><span>${M_ICONS.pencil}</span><strong>Edit name</strong><b aria-hidden="true">›</b></button>
        <button data-category-act="delete" class="danger-text"><span>${M_ICONS.trash}</span><strong>Delete category</strong><b aria-hidden="true">›</b></button>
      </div>
    </div>`;
    layer.querySelector('.plan-category-close').onclick = dismiss;
    layer.querySelector('[data-category-act="rename"]').onclick = () => {
      dismiss();
      openPlanEditor(root, { title: 'Edit category name', label: 'Category name', value: category.name, onSave: name => store.updateCategory(category.id, { name }) });
    };
    layer.querySelector('[data-category-act="delete"]').onclick = renderDeleteConfirm;
  };
  const renderDeleteConfirm = () => {
    layer.innerHTML = h`<div class="plan-editor-card plan-category-confirm" role="alertdialog" aria-modal="true" aria-labelledby="plan-delete-title">
      <span class="plan-delete-icon" aria-hidden="true">${M_ICONS.trash}</span>
      <h2 id="plan-delete-title">Delete ${category.name}?</h2>
      <p>Transactions in this category will become uncategorised. Any money budgeted here will return to Ready to Assign.</p>
      ${category.available ? h`<div class="plan-delete-balance"><span>Available now</span><strong>${fmt(category.available)}</strong></div>` : ''}
      <div class="modal-actions">
        <button class="btn secondary" data-category-act="cancel-delete">Keep category</button>
        <button class="btn danger" data-category-act="confirm-delete">Delete</button>
      </div>
    </div>`;
    layer.querySelector('[data-category-act="cancel-delete"]').onclick = renderActions;
    layer.querySelector('[data-category-act="confirm-delete"]').onclick = () => {
      store.deleteCategory(category.id);
      openEditPlanSheet(root, store.monthData(curMonth));
      toast('Category deleted');
    };
  };
  layer.onclick = event => {
    event.stopPropagation();
    if (event.target === layer) dismiss();
  };
  renderActions();
  host.append(layer);
}

function openPlanGroupActions(root, group) {
  const host = document.querySelector('#modal-root .edit-plan-modal');
  if (!host || !group) return;
  host.querySelector('.plan-editor-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'plan-editor-layer plan-group-layer';
  const dismiss = () => layer.remove();
  const renderActions = () => {
    layer.innerHTML = h`<div class="plan-editor-card plan-category-card" role="dialog" aria-modal="true" aria-labelledby="plan-group-title">
      <div class="plan-category-head"><div><span>Category group</span><h2 id="plan-group-title">${group.name}</h2></div><button class="plan-category-close" aria-label="Close">×</button></div>
      <div class="plan-category-actions">
        <button data-group-act="rename"><span>${M_ICONS.pencil}</span><strong>Edit name</strong><b aria-hidden="true">›</b></button>
        <button data-group-act="delete" class="danger-text"><span>${M_ICONS.trash}</span><strong>Delete group</strong><b aria-hidden="true">›</b></button>
      </div>
    </div>`;
    layer.querySelector('.plan-category-close').onclick = dismiss;
    layer.querySelector('[data-group-act="rename"]').onclick = () => {
      dismiss();
      openPlanEditor(root, { title: 'Edit category group', label: 'Group name', value: group.name, onSave: name => store.renameGroup(group.id, name) });
    };
    layer.querySelector('[data-group-act="delete"]').onclick = renderDeleteConfirm;
  };
  const renderDeleteConfirm = () => {
    const categoryCount = group.categories.length;
    const available = group.categories.reduce((sum, category) => sum + Math.max(0, category.available), 0);
    layer.innerHTML = h`<div class="plan-editor-card plan-category-confirm" role="alertdialog" aria-modal="true" aria-labelledby="plan-group-delete-title">
      <span class="plan-delete-icon" aria-hidden="true">${M_ICONS.trash}</span>
      <h2 id="plan-group-delete-title">Delete ${group.name}?</h2>
      <p>This will delete ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'} in this group. Transactions will become uncategorised, and any money budgeted here will return to Ready to Assign.</p>
      ${available ? h`<div class="plan-delete-balance"><span>Available now</span><strong>${fmt(available)}</strong></div>` : ''}
      <div class="modal-actions">
        <button class="btn secondary" data-group-act="cancel-delete">Keep group</button>
        <button class="btn danger" data-group-act="confirm-delete">Delete group</button>
      </div>
    </div>`;
    layer.querySelector('[data-group-act="cancel-delete"]').onclick = renderActions;
    layer.querySelector('[data-group-act="confirm-delete"]').onclick = () => {
      store.deleteGroup(group.id);
      openEditPlanSheet(root, store.monthData(curMonth));
      toast('Category group deleted');
    };
  };
  layer.onclick = event => {
    event.stopPropagation();
    if (event.target === layer) dismiss();
  };
  renderActions();
  host.append(layer);
}

function openEditPlanSheet(root, md) {
  const monthWord = monthLabel(curMonth).split(' ')[0];
  const totalTargets = md.groups.flatMap(g => g.categories)
    .reduce((sum, category) => sum + (category.target ? neededFor(category, curMonth) + category.assigned : 0), 0);
  const income = store.state.settings.expectedIncome;
  const groups = md.groups.map(group => {
    const categories = group.categories.map(category => {
      const targetLabel = category.target ? fmt(category.target.amount) : 'Add Target';
      return h`<button class="edit-plan-cat" data-act="plan-open-cat" data-id="${category.id}">
        <span>${category.name}</span>
        <span class="edit-plan-target ${category.target ? '' : 'empty'}">${targetLabel}</span>
      </button>`;
    });
    return h`<section class="edit-plan-group">
      <div class="edit-plan-group-head">
        <h3>${group.name}</h3>
        <div class="edit-plan-group-actions">
          <button data-act="plan-add-cat" data-id="${group.id}" aria-label="Add category">${[M_ICONS.plusCircle]}</button>
          <button data-act="plan-rename-group" data-id="${group.id}" aria-label="Rename category group">${[M_ICONS.dots]}</button>
        </div>
      </div>
      <div class="edit-plan-card">${categories}</div>
    </section>`;
  });
  const sheet = openModal(h`<div class="edit-plan-screen">
    <div class="edit-plan-hero">
      <div class="edit-plan-topbar">
        <button class="edit-plan-back" data-act="plan-close" aria-label="Back">‹</button>
        <h2>Edit Plan</h2>
        <button class="edit-plan-dots" data-act="plan-new-group" aria-label="Add category group">${[M_ICONS.dots]}</button>
      </div>
      <div class="edit-plan-total">${fmt(totalTargets)}</div>
      <div class="edit-plan-total-label">Cost to Be Me</div>
      <div class="edit-plan-summary">
        <div><span>${monthWord}'s Targets</span><strong>${fmt(totalTargets)}</strong></div>
        <button data-act="plan-income"><span>Enter your monthly income</span><strong>${income == null ? fmt(0) : fmt(income)}</strong></button>
      </div>
    </div>
    <div class="edit-plan-groups">${groups}</div>
  </div>`);
  sheet.classList.add('edit-plan-modal');
  sheet.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'plan-close') closeModal();
    else if (act.dataset.act === 'plan-new-group') {
      openPlanEditor(root, { title: 'New category group', label: 'Group name', onSave: name => store.addGroup(name) });
    } else if (act.dataset.act === 'plan-add-cat') {
      const groupId = act.dataset.id;
      openPlanEditor(root, { title: 'Add category', label: 'Category name', onSave: name => store.addCategory(groupId, name) });
    } else if (act.dataset.act === 'plan-rename-group') {
      const group = md.groups.find(item => item.id === act.dataset.id);
      openPlanGroupActions(root, group);
    } else if (act.dataset.act === 'plan-income') {
      openPlanEditor(root, {
        title: 'Monthly income', label: 'Expected income', value: income == null ? '' : fmtExact(income).replace('$', ''), inputMode: 'decimal',
        onSave: value => store.updateSettings({ expectedIncome: parseAmount(value) }),
      });
    } else if (act.dataset.act === 'plan-open-cat') {
      const category = md.groups.flatMap(group => group.categories).find(item => item.id === act.dataset.id);
      openPlanCategoryActions(root, category);
    }
  };
}

// ---------- Overflow (three-dot) sheet ----------
function openOverflowSheet(root, md) {
  const bars = progressBarsOn();
  const hideOn = store.state.settings.hideAmounts;
  const allCollapsed = collapsedGroups.size > 0;
  const modal = openModal(h`<h2 class="mobile-options-title">Plan options</h2>
    <div class="mobile-options-menu">
      <button class="mobile-options-row" data-act="ov-recent"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.clock}</span>Recent moves</span></button>
      <button class="mobile-options-row" data-act="ov-undo"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.undo}</span>Undo last change</span></button>
      <button class="mobile-options-row" data-act="ov-add-plan"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.addCircle}</span>Add category or group</span><span aria-hidden="true">›</span></button>
      <button class="mobile-options-row" data-act="ov-progress"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.reflect}</span>Progress bars</span><span class="mobile-options-checkbox ${bars ? 'checked' : ''}" aria-hidden="true">✓</span></button>
      <button class="mobile-options-row" data-act="ov-collapse"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.collapse}</span>${allCollapsed ? 'Expand all groups' : 'Collapse all groups'}</span></button>
      <button class="mobile-options-row" data-act="ov-hide"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.eye}</span>Hide amounts to share</span><span class="mobile-options-checkbox ${hideOn ? 'checked' : ''}" aria-hidden="true">✓</span></button>
      <button class="mobile-options-row" data-act="ov-settings"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.settings}</span>Settings &amp; privacy</span><span aria-hidden="true">›</span></button>
    </div>`);
  modal.classList.add('mobile-options-modal');
  modal.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'ov-recent': openRecentMovesSheet(); break;
      case 'ov-undo':
        if (store.canUndo()) { store.undo(); closeModal(); toast('Last change undone'); }
        else { closeModal(); toast('Nothing to undo yet'); }
        break;
      case 'ov-add-plan': closeModal(); openEditPlanSheet(root, md); break;
      case 'ov-progress': store.updateSettings({ progressBars: !bars }); closeModal(); break;
      case 'ov-collapse':
        if (allCollapsed) collapsedGroups.clear();
        else md.groups.forEach(group => collapsedGroups.add(group.id));
        closeModal(); render(root, { month: curMonth });
        break;
      case 'ov-hide': store.updateSettings({ hideAmounts: !hideOn }); closeModal(); break;
      case 'ov-settings': closeModal(); navigate('#/settings'); break;
    }
  };
}

function openRecentMovesSheet() {
  const moves = store.recentMoves();
  const catName = id => id ? (store.state.categories.find(c => c.id === id)?.name || 'None') : 'Ready to Assign';
  const rows = moves.slice(0, 40).map(m => {
    const from = m.type === 'move' ? catName(m.fromCatId) : 'Ready to Assign';
    const to = catName(m.toCatId);
    return h`<div class="recent-row"><span class="recent-date">${m.date}</span><span class="recent-desc">${from} → ${to}</span><span class="recent-amt">${fmt(m.amount)}</span></div>`;
  });
  const sheet = openModal(h`<div class="sheet-handle"></div><h2 class="sheet-title">Recent Moves</h2>
    <div class="m-recent">${moves.length ? rows : raw(`<p class="muted">No money moves in the last 34 days. Assign or move money and it'll show up here.</p>`)}</div>`);
  sheet.classList.add('bottom-sheet', 'ss-sheet');
}

// ================= mobile bottom sheets =================
// Category Details sheet + inline Target editor. Produces the SAME target shapes
// (via store.setTarget) as the desktop inspector — see set-target-cadence / saveTargetFromInspector.
let sheetCatId = null;
let sheetMode = 'details';   // 'details' | 'target'
let sheetTarget = null;      // draft target while editing (discarded on Cancel)

function openCategoryDetailsSheet(catId) {
  sheetCatId = catId; sheetMode = 'details'; sheetTarget = null;
  const sheet = openModal('');
  sheet.classList.add('bottom-sheet', 'ss-sheet');
  renderCategorySheet(sheet);
}

function renderCategorySheet(sheet) {
  const body = sheetMode === 'target' ? categorySheetTarget() : categorySheetDetails();
  sheet.innerHTML = `<div class="sheet-handle"></div>${body}`;
  wireCategorySheet(sheet);
}

function targetSummaryText(t) {
  const amt = fmtExact(t.amount);
  if (t.type === 'SAVINGS_BALANCE') return `Have ${amt} by ${t.targetDate || 'no date set'}`;
  const cad = t.cadence === 'weekly' ? 'per week' : t.cadence === 'yearly' ? 'per year' : 'per month';
  return `${t.refill ? 'Refill up to' : 'Set aside'} ${amt} ${cad}`;
}

function targetBlock(cat) {
  const t = cat.target;
  if (!t) {
    return h`<div class="sheet-card sheet-target-empty">
      <div class="sheet-target-q">How much do you need for ${cat.name}?</div>
      <p class="muted">Set a target so this category tells you when it's on track over time.</p>
      <button class="btn subtle sheet-create-target" data-act="create-target">Create Target</button>
    </div>`;
  }
  const needed = neededFor(cat, curMonth);
  const pct = cat.goal ? cat.goal.fundedPct : 0;
  const status = cat.goal ? cat.goal.status : 'funded';
  const statusText = status === 'funded' ? 'Fully funded'
    : status === 'overspent' ? 'Overspent'
    : `${fmt(needed)} more needed this month`;
  return h`<div class="sheet-card">
    <div class="sheet-target-summary">${targetSummaryText(t)}</div>
    <div class="target-bar sheet-bar"><div class="target-bar-fill ${fundBarClass(cat)}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
    <div class="sheet-target-status ${status}">${statusText}</div>
    <div class="sheet-target-actions">
      <button class="btn secondary sm" data-act="edit-target">Edit Target</button>
      <button class="link-btn danger-text" data-act="delete-target">Delete Target</button>
    </div>
  </div>`;
}

function categorySheetDetails() {
  const md = store.monthData(curMonth);
  const cat = md.groups.flatMap(g => g.categories).find(c => c.id === sheetCatId);
  const scat = store.state.categories.find(c => c.id === sheetCatId);
  if (!cat) return '';
  const prevMonth = addMonths(curMonth, -1);
  const prevAvail = store.monthData(prevMonth).groups.flatMap(g => g.categories).find(c => c.id === sheetCatId)?.available ?? 0;
  const leftOver = Math.max(prevAvail, 0);
  const monthWord = monthLabel(curMonth).split(' ')[0];
  return h`
    <h2 class="sheet-title">${cat.name}</h2>
    <div class="sheet-section-label">Balance</div>
    <div class="sheet-card">
      <div class="insp-row"><span>Left Over from Last Month</span><span>${fmt(leftOver)}</span></div>
      <div class="insp-row"><span>Assigned in ${monthWord}</span><span>${fmt(cat.assigned)}</span></div>
      <div class="insp-row"><span>Activity</span><span>${fmt(cat.activity)}</span></div>
      <div class="insp-row insp-total"><span>Available</span><span class="pill ${cat.pillClass}">${fmt(cat.available)}</span></div>
    </div>
    <div class="sheet-section-label">Target</div>
    ${[targetBlock(cat)]}
    <div class="sheet-section-label">Notes</div>
    <textarea class="sheet-note" id="sheet-note" placeholder="Enter a note…">${scat?.note || ''}</textarea>
    <button class="btn secondary sheet-move-btn" data-act="sheet-move">Move Money</button>
  `;
}

// tab -> target shape, mirroring desktop set-target-cadence (clean shapes, no stray fields)
function applyCadence(prev, id, month) {
  const t = { type: 'NEED', amount: prev.amount || 0 };
  if (id === 'weekly') { t.cadence = 'weekly'; t.weekday = prev.weekday ?? 1; }
  else if (id === 'monthly') { t.cadence = 'monthly'; t.dayOfMonth = prev.dayOfMonth ?? 1; }
  else if (id === 'yearly') { t.cadence = 'yearly'; t.targetDate = prev.targetDate || null; }
  else { t.type = 'SAVINGS_BALANCE'; t.targetDate = prev.targetDate || month; }
  if (prev.refill && id !== 'custom') t.refill = prev.refill;
  if (prev.snoozed) t.snoozed = prev.snoozed;
  return t;
}

function categorySheetTarget() {
  const cat = store.monthData(curMonth).groups.flatMap(g => g.categories).find(c => c.id === sheetCatId);
  const t = sheetTarget;
  const cadence = t.type === 'SAVINGS_BALANCE' ? 'custom' : (t.cadence || 'monthly');
  const segs = [['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['custom', 'Custom']];
  let everyField;
  if (cadence === 'weekly') everyField = h`<div class="form-row"><label for="tgt-every">Every</label>
    <select id="tgt-every">${WEEKDAYS.map((wd, i) => h`<option value="${i}" ${(t.weekday ?? 1) === i ? 'selected' : ''}>${wd}</option>`)}</select></div>`;
  else if (cadence === 'monthly') everyField = h`<div class="form-row"><label for="tgt-every">Every</label>
    <select id="tgt-every">${Array.from({ length: 28 }, (_, i) => h`<option value="${i + 1}" ${((t.dayOfMonth || 1) === i + 1) ? 'selected' : ''}>Day ${i + 1}</option>`)}</select></div>`;
  else everyField = h`<div class="form-row"><label for="tgt-every">${cadence === 'custom' ? 'By' : 'Every'}</label>
    <input id="tgt-every" type="month" value="${t.targetDate || ''}"></div>`;
  const refillField = cadence !== 'custom' ? h`<div class="form-row"><label for="tgt-refill">Next month I want to</label>
    <select id="tgt-refill">
      <option value="need" ${!t.refill ? 'selected' : ''}>Set aside another ${fmtExact(t.amount)}</option>
      <option value="refill" ${t.refill ? 'selected' : ''}>Refill up to ${fmtExact(t.amount)}</option>
    </select></div>` : '';
  return h`
    <h2 class="sheet-title">${cat.name}</h2>
    <div class="segmented tgt-tabs">
      ${segs.map(([k, label]) => h`<button class="seg-btn ${cadence === k ? 'active' : ''}" data-act="tgt-tab" data-id="${k}">${label}</button>`)}
    </div>
    <div class="sheet-card">
      <div class="form-row"><label for="tgt-amount">I need</label>
        <input id="tgt-amount" type="text" inputmode="decimal" value="${fmtExact(t.amount).replace('$', '')}"></div>
      ${everyField}
      ${refillField}
    </div>
    <div class="sheet-actions">
      <button class="btn secondary" data-act="cancel-target">Cancel</button>
      <button class="btn" data-act="save-target">Save Target</button>
    </div>
  `;
}

// read live editor fields back into the draft (survives tab switches + Save)
function captureEditor(sheet) {
  const t = sheetTarget;
  const amt = sheet.querySelector('#tgt-amount');
  if (amt) t.amount = parseAmount(amt.value);
  const every = sheet.querySelector('#tgt-every');
  if (every) {
    const cadence = t.type === 'SAVINGS_BALANCE' ? 'custom' : t.cadence;
    if (cadence === 'weekly') t.weekday = +every.value;
    else if (cadence === 'monthly') t.dayOfMonth = +every.value;
    else t.targetDate = every.value || null;
  }
  const refill = sheet.querySelector('#tgt-refill');
  if (refill) t.refill = refill.value === 'refill';
}

function wireCategorySheet(sheet) {
  const note = sheet.querySelector('#sheet-note');
  if (note) note.addEventListener('change', () => store.updateCategory(sheetCatId, { note: note.value }));

  sheet.onclick = e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'create-target':
        sheetTarget = { type: 'NEED', amount: 0, cadence: 'monthly', dayOfMonth: 1 };
        sheetMode = 'target'; renderCategorySheet(sheet);
        break;
      case 'edit-target': {
        const scat = store.state.categories.find(c => c.id === sheetCatId);
        sheetTarget = { ...(scat.target || { type: 'NEED', amount: 0, cadence: 'monthly', dayOfMonth: 1 }) };
        sheetMode = 'target'; renderCategorySheet(sheet);
        break;
      }
      case 'delete-target':
        if (confirm('Delete this target?')) { store.setTarget(sheetCatId, null); renderCategorySheet(sheet); }
        break;
      case 'sheet-move':
        openMovePopover(null, null, sheetCatId, store.monthData(curMonth));
        break;
      case 'tgt-tab':
        captureEditor(sheet);
        sheetTarget = applyCadence(sheetTarget, act.dataset.id, curMonth);
        renderCategorySheet(sheet);
        break;
      case 'save-target':
        captureEditor(sheet);
        store.setTarget(sheetCatId, { ...sheetTarget });
        sheetMode = 'details'; renderCategorySheet(sheet);
        toast('Target saved');
        break;
      case 'cancel-target':
        sheetMode = 'details'; renderCategorySheet(sheet);
        break;
    }
  };
}

// ---------- cover: pick which overspent category to cover (multiple) ----------
function openCoverPicker(root, anchorEl, over, md) {
  const rows = over.map(c => h`<button class="mm-row" data-cover-id="${c.id}">
    <span class="mm-row-name">${c.name}</span>
    <span class="pill ${c.pillClass}">${fmt(c.available)}</span>
  </button>`);
  const body = h`<div class="move-money-body">
    <h2>Cover overspending in:</h2>
    <div class="mm-list">${rows}</div>
  </div>`;
  let pop, mobile = isMobile();
  if (mobile) {
    pop = openModal(`<div class="sheet-handle"></div>${body}`);
    pop.classList.add('bottom-sheet', 'ss-sheet');
  } else {
    document.querySelectorAll('.popover.move-money-popover').forEach(p => p.remove());
    const rect = anchorEl.getBoundingClientRect();
    pop = document.createElement('div');
    pop.className = 'popover move-money-popover';
    pop.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    pop.innerHTML = body;
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', outsideCloser(pop), { once: true }));
  }
  pop.querySelector('.mm-list').onclick = e => {
    const row = e.target.closest('[data-cover-id]');
    if (!row) return;
    if (!mobile) pop.remove();   // mobile: openMovePopover's openModal replaces this sheet
    openMovePopover(root, anchorEl, row.dataset.coverId, store.monthData(curMonth));
  };
}
