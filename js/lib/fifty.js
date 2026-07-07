// fifty.js — 50/30/20 budgeting classification & math. Pure: takes `state`, no DOM, no store import.
// Money is integer cents. Months are "YYYY-MM".

const INFLOW = 'inflow';
const monthOf = date => date.slice(0, 7);

export function defaultClass(cat, group) {
  const gname = (group && group.name) || '';
  const cname = (cat && cat.name) || '';
  if (/credit card|payment/i.test(gname)) return 'need';         // NerdWallet: minimum debt payments are needs
  if ((cat && cat.target && cat.target.type === 'SAVINGS_BALANCE') ||
      /saving|holiday|emergency|invest/i.test(cname)) return 'savings';
  if (/immediate|obligation|bill|need|true expense/i.test(gname)) return 'need';
  if (/quality|fun|want/i.test(gname)) return 'want';
  return 'want';
}

export function classOf(cat, groupsById) {
  return cat.budgetClass || defaultClass(cat, groupsById[cat.groupId]);
}

// on-budget account id set for a state
function onBudgetIds(state) {
  const s = new Set();
  for (const a of state.accounts) if (a.onBudget) s.add(a.id); // store.isOnBudget semantics: flag only, no type fallback
  return s;
}

// category-affecting rows of a tx (splits or self); mirrors store.catRows but filtered by caller
function catRows(tx) {
  if (tx.subtransactions && tx.subtransactions.length)
    return tx.subtransactions.map(s => ({ categoryId: s.categoryId, amount: s.amount }));
  return [{ categoryId: tx.categoryId, amount: tx.amount }];
}

// Σ outflow magnitude per category in `month` on on-budget accounts (skips INFLOW/null/inflows).
// Transfers between two on-budget accounts carry categoryId:null so they self-skip (matches store).
function outflowByCategory(state, month) {
  const onb = onBudgetIds(state);
  const by = new Map();
  for (const tx of state.transactions) {
    if (monthOf(tx.date) !== month || !onb.has(tx.accountId)) continue;
    for (const r of catRows(tx)) {
      if (r.categoryId == null || r.categoryId === INFLOW || r.amount >= 0) continue;
      by.set(r.categoryId, (by.get(r.categoryId) || 0) + -r.amount);
    }
  }
  return by;
}

// INFLOW-categorized inflows to on-budget accounts in `month`
function incomeIn(state, month) {
  const onb = onBudgetIds(state);
  let inc = 0;
  for (const tx of state.transactions) {
    if (monthOf(tx.date) !== month || !onb.has(tx.accountId)) continue;
    for (const r of catRows(tx)) if (r.categoryId === INFLOW) inc += r.amount;
  }
  return inc;
}

function addMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// trailing 3 full months before `month` (fewer if history shorter; 0 if none)
function income3Avg(state, month) {
  let sum = 0, n = 0;
  const first = firstTxMonth(state);
  for (let k = 1; k <= 3; k++) {
    const m = addMonth(month, -k);
    if (first && m < first) continue;
    sum += incomeIn(state, m); n++;
  }
  return n ? Math.round(sum / n) : 0;
}

function firstTxMonth(state) {
  let min = null;
  for (const tx of state.transactions) { const m = monthOf(tx.date); if (!min || m < min) min = m; }
  return min;
}

export function fiftyThirtyTwenty(state, month, split = { need: 50, want: 30, savings: 20 }) {
  const groupsById = Object.fromEntries(state.categoryGroups.map(g => [g.id, g]));
  const outflow = outflowByCategory(state, month);
  const income = incomeIn(state, month);

  const targets = {
    need: Math.round(income * split.need / 100),
    want: Math.round(income * split.want / 100),
    savings: 0,
  };
  targets.savings = income - targets.need - targets.want; // rounding remainder → savings

  const actuals = { need: 0, want: 0, savings: 0 };
  const rows = [];
  let totalOut = 0;
  for (const c of state.categories) {
    if (c.hidden || c.ccAccountId) continue; // skip hidden & CC-payment cats (per shared rule)
    const amount = outflow.get(c.id) || 0;
    const cls = classOf(c, groupsById);
    actuals[cls] += amount;
    totalOut += amount;
    const g = groupsById[c.groupId];
    rows.push({ id: c.id, name: c.name, groupName: g ? g.name : '', cls, amount });
  }
  // CC-payment cats excluded: their spend already rides in the real spending category, no double-count.
  const unallocated = income - totalOut;
  const effectiveSavings = actuals.savings + Math.max(0, unallocated);
  const pct = income === 0 ? { need: null, want: null, savings: null } : {
    need: 100 * actuals.need / income,
    want: 100 * actuals.want / income,
    savings: 100 * actuals.savings / income,
  };

  return {
    month, income, incomeAvg3: income3Avg(state, month),
    targets, actuals, unallocated, effectiveSavings, pct,
    rows: rows.sort((a, b) => b.amount - a.amount),
  };
}
