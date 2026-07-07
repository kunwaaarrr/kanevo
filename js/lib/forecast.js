// forecast.js — "what-if" projection over trailing-average baselines. Pure: takes `state`, no DOM.
// Money is integer cents. Months are "YYYY-MM".

const INFLOW = 'inflow';
const LOAN_TYPES = new Set(['mortgage', 'autoLoan', 'studentLoan', 'personalLoan']);
const monthOf = date => date.slice(0, 7);

function addMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const dollars = cents => (cents / 100).toFixed(2);

function onBudgetIds(state) {
  const s = new Set();
  for (const a of state.accounts) if (a.onBudget) s.add(a.id); // store.isOnBudget semantics: flag only, no type fallback
  return s;
}
function catRows(tx) {
  if (tx.subtransactions && tx.subtransactions.length)
    return tx.subtransactions.map(s => ({ categoryId: s.categoryId, amount: s.amount }));
  return [{ categoryId: tx.categoryId, amount: tx.amount }];
}
function firstTxMonth(state) {
  let min = null;
  for (const tx of state.transactions) { const m = monthOf(tx.date); if (!min || m < min) min = m; }
  return min;
}

// the 3 full calendar months before `fromMonth` (fewer if history shorter; [] if none)
function windowMonths(state, fromMonth) {
  const first = firstTxMonth(state);
  const out = [];
  for (let k = 1; k <= 3; k++) {
    const m = addMonth(fromMonth, -k);
    if (first && m < first) continue;
    out.push(m);
  }
  return out;
}

export function baseline(state, fromMonth) {
  const onb = onBudgetIds(state);
  const win = windowMonths(state, fromMonth);
  const nWin = win.length; // 1..3, or 0
  const groupsById = Object.fromEntries(state.categoryGroups.map(g => [g.id, g]));

  // per-category outflow magnitude + income, summed across window
  const outSum = new Map();
  let incomeSum = 0;
  const winSet = new Set(win);
  for (const tx of state.transactions) {
    if (!winSet.has(monthOf(tx.date)) || !onb.has(tx.accountId)) continue;
    for (const r of catRows(tx)) {
      if (r.categoryId === INFLOW) { incomeSum += r.amount; continue; }
      if (r.categoryId == null || r.amount >= 0) continue;
      outSum.set(r.categoryId, (outSum.get(r.categoryId) || 0) + -r.amount);
    }
  }

  const incomePerMonth = nWin ? Math.round(incomeSum / nWin) : 0;
  const categories = [];
  for (const c of state.categories) {
    if (c.hidden || c.ccAccountId) continue; // CC-payment cats aren't expense rows
    const total = outSum.get(c.id) || 0;
    const g = groupsById[c.groupId];
    categories.push({
      id: c.id, name: c.name, groupId: c.groupId, groupName: g ? g.name : '',
      perMonth: nWin ? Math.round(total / nWin) : 0,
    });
  }

  const loans = state.accounts
    .filter(a => LOAN_TYPES.has(a.type) && a.loanInfo)
    .map(a => ({
      accountId: a.id, name: a.name,
      balance: Math.abs(accountWorking(state, a.id)),
      rate: a.loanInfo.interestRate || 0,
      minimumPayment: a.loanInfo.minimumPayment || 0,
      linkedCategoryId: linkedCategory(state, a.id),
    }));

  return { incomePerMonth, categories, loans };
}

// working balance (cleared+uncleared) of an account — mirrors store.accountBalances
function accountWorking(state, accountId) {
  let bal = 0;
  for (const tx of state.transactions) if (tx.accountId === accountId) bal += tx.amount;
  return bal;
}

// most-frequent categoryId on transfer txns touching this loan (both sides); null if none
function linkedCategory(state, loanId) {
  const counts = new Map();
  const byId = new Map(state.transactions.map(t => [t.id, t]));
  for (const tx of state.transactions) {
    if (tx.transferAccountId !== loanId) continue;
    // this side's category + its partner's category both belong to the transfer pair
    const cats = [tx.categoryId];
    const partner = tx.transferTxId && byId.get(tx.transferTxId);
    if (partner) cats.push(partner.categoryId);
    for (const cid of cats) {
      if (cid == null || cid === INFLOW) continue;
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
  }
  let best = null, bestN = 0;
  for (const [cid, n] of counts) if (n > bestN) { best = cid; bestN = n; }
  return best;
}

export function forecast(state, { months = 12, fromMonth, overrides = {} } = {}) {
  const base = baseline(state, fromMonth);
  const ovCats = (overrides && overrides.categories) || {};
  const ovIncome = overrides && overrides.income;
  const loanExtra = (overrides && overrides.loanExtra) || {};

  // month labels: start at month AFTER fromMonth
  const monthList = [];
  for (let i = 1; i <= months; i++) monthList.push(addMonth(fromMonth, i));

  // income series
  const incomeVal = applyOverride(base.incomePerMonth, ovIncome);
  const income = monthList.map(() => incomeVal);

  // expense rows after category overrides
  const rows = base.categories.map(c => {
    const ov = ovCats[c.id];
    const v = applyOverride(c.perMonth, ov);
    return {
      id: c.id, name: c.name, groupId: c.groupId, groupName: c.groupName,
      base: c.perMonth, values: monthList.map(() => v), _hasOverride: !!ov,
    };
  });
  const rowById = new Map(rows.map(r => [r.id, r]));

  // ---- loan simulation + payoff-driven adjustments ----
  const events = [];
  const loans = base.loans.map(loan => {
    const extra = loanExtra[loan.accountId] || 0;
    const payment = loan.minimumPayment + extra;
    const r = loan.rate / 1200;
    const balances = [];
    let bal = loan.balance, payoffIdx = -1;
    for (let i = 0; i < months; i++) {
      if (bal <= 0) { balances.push(0); continue; }
      let nb = bal * (1 + r) - payment;
      if (nb <= 0) { nb = 0; if (payoffIdx < 0) payoffIdx = i; } // paid off this month
      balances.push(Math.round(nb));
      bal = nb;
    }
    // cap already enforced by horizon (≤ months ≤ 1000 in practice); guard anyway
    const payoffMonth = payoffIdx >= 0 ? monthList[payoffIdx] : null;
    let freedPerMonth = 0;
    if (payoffMonth) {
      freedPerMonth = loan.minimumPayment;
      events.push({ month: payoffMonth, label: `${loan.name} paid off — frees $${dollars(freedPerMonth)}/mo` });
      // from the month AFTER payoff, shrink linked category (only if it has no explicit override)
      const lc = loan.linkedCategoryId && rowById.get(loan.linkedCategoryId);
      if (lc && !lc._hasOverride) {
        for (let i = payoffIdx + 1; i < months; i++)
          lc.values[i] = Math.max(0, lc.values[i] - loan.minimumPayment);
      }
    }
    return { accountId: loan.accountId, name: loan.name, payment, balances, payoffMonth, freedPerMonth };
  });

  // ---- totals / net / cash ----
  const totalExpense = monthList.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0));
  const net = monthList.map((_, i) => income[i] - totalExpense[i]);

  let startCash = 0;
  const onb = onBudgetIds(state);
  for (const id of onb) startCash += accountWorking(state, id);
  const cash = [];
  for (let i = 0; i < months; i++) cash.push((i === 0 ? startCash : cash[i - 1]) + net[i]);

  return {
    months: monthList, income,
    rows: rows.map(({ _hasOverride, ...r }) => r), // drop internal flag
    totalExpense, net, cash, loans, events,
  };
}

// off → 0, set → value, scale → round(base*pct/100), no override → base
function applyOverride(base, ov) {
  if (!ov) return base;
  if (ov.mode === 'off') return 0;
  if (ov.mode === 'set') return ov.value;
  if (ov.mode === 'scale') return Math.round(base * ov.pct / 100);
  return base;
}
