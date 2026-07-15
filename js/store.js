// store.js — data layer + budget engine. Money is integer cents. Import-safe in Node.
import { uid, todayISO, thisMonth, addMonths, monthsBetween, daysBetween, debounce } from './util.js';
import { trainClassifier, suggestCategory } from './lib/categorize.js';

export const INFLOW = 'inflow';
const KEY = 'kanevo/v1';
const hasLS = typeof localStorage !== 'undefined';

const CASH_TYPES = new Set(['checking', 'savings', 'cash']);
const ONBUDGET_TYPES = new Set(['checking', 'savings', 'cash', 'creditCard']);

function monthOf(date) { return date.slice(0, 7); }

function emptyState() {
  return {
    version: 1,
    settings: { budgetName: 'My Budget', currencySymbol: '$', hideAmounts: false },
    accounts: [],
    categoryGroups: [],
    categories: [],
    budget: {},
    transactions: [],
    scheduled: [],
    payees: [],
    focusedViews: [],
  };
}

const DANGER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = v => v != null && typeof v === 'object' && !Array.isArray(v);

// recursively rebuild plain objects/arrays, dropping prototype-pollution keys
function stripDanger(v) {
  if (Array.isArray(v)) return v.map(stripDanger);
  if (isPlainObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) if (!DANGER_KEYS.has(k)) out[k] = stripDanger(v[k]);
    return out;
  }
  return v;
}

// parse + validate an untrusted backup file into a well-formed state (throws on garbage)
function sanitizeImport(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('Not a valid backup file'); }
  if (!isPlainObject(raw)) throw new Error('Not a valid backup file');
  const data = stripDanger(raw);
  const out = emptyState();
  for (const key of Object.keys(out)) {
    const want = out[key], got = data[key];
    if (Array.isArray(want)) { if (Array.isArray(got)) out[key] = got; }
    else if (isPlainObject(want)) { if (isPlainObject(got)) out[key] = got; }
    else if (typeof got === typeof want) out[key] = got; // version: number
  }
  if (Array.isArray(data.moveLog)) out.moveLog = data.moveLog; // lazily-added key, preserve if valid
  return out;
}

const isFirstRun = !hasLS || localStorage.getItem(KEY) == null;
let state = load() || emptyState();

function load() {
  if (!hasLS) return null;
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function persistNow() {
  if (!hasLS) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
const persist = debounce(persistNow, 300);

// ---------- subscribers / undo / cache ----------
const subs = new Set();
const undoStack = [];
let cache = {};

function invalidate() { cache = {}; }
function notify() { subs.forEach(fn => { try { fn(); } catch {} }); }
function logMove(entry) { // 34-day trail of assigns/moves (YNAB "Recent Moves")
  if (!entry.amount) return;
  if (!state.moveLog) state.moveLog = [];
  state.moveLog.push({ ...entry, date: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0') });
  const cutoff = new Date(Date.now() - 34 * 86400000).toISOString().slice(0, 10);
  state.moveLog = state.moveLog.filter(m => m.date >= cutoff);
}
function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 20) undoStack.shift();
}
// wrap every public mutation: snapshot -> run -> invalidate/notify/persist
function mutate(fn) {
  return (...args) => {
    pushUndo();
    const r = fn(...args);
    invalidate(); persist(); notify();
    return r;
  };
}
function memo(key, fn) {
  if (!(key in cache)) cache[key] = fn();
  return cache[key];
}

// ---------- lookups ----------
const acct = id => state.accounts.find(a => a.id === id);
const cat = id => state.categories.find(c => c.id === id);
const isOnBudget = id => { const a = acct(id); return a && a.onBudget; };
const isCash = id => { const a = acct(id); return a && CASH_TYPES.has(a.type); };
const isCredit = id => { const a = acct(id); return a && a.type === 'creditCard'; };

// all category-affecting rows in a tx (splits or the tx itself), on-budget accounts only
function catRows(tx) {
  if (!isOnBudget(tx.accountId)) return [];
  if (tx.subtransactions && tx.subtransactions.length)
    return tx.subtransactions.map(s => ({ categoryId: s.categoryId, amount: s.amount, accountId: tx.accountId, date: tx.date }));
  return [{ categoryId: tx.categoryId, amount: tx.amount, accountId: tx.accountId, date: tx.date }];
}

// ---------- engine: activity / available / RTA ----------
function activity(catId, month) {
  return memo(`act:${catId}:${month}`, () => {
    let sum = 0;
    for (const tx of state.transactions) {
      if (monthOf(tx.date) !== month) continue;
      for (const r of catRows(tx)) if (r.categoryId === catId) sum += r.amount;
    }
    return sum;
  });
}
function assigned(catId, month) {
  const m = state.budget[month];
  return (m && m[catId]) || 0;
}
// spending charged to credit cards for a category in a month (outflows on CC accts)
function creditSpending(catId, month) {
  let sum = 0;
  for (const tx of state.transactions) {
    if (monthOf(tx.date) !== month || !isCredit(tx.accountId)) continue;
    for (const r of catRows(tx)) if (r.categoryId === catId && r.amount < 0) sum += -r.amount;
  }
  return sum;
}

// available for a normal category (recursive carry). CC payment cats handled separately.
function available(catId, month) {
  return memo(`avail:${catId}:${month}`, () => {
    const c = cat(catId);
    if (c && c.ccAccountId) return ccAvailable(catId, month);
    const prev = addMonths(month, -1);
    const carry = Math.max(0, availableCarrySafe(catId, prev, month));
    return carry + assigned(catId, month) + activity(catId, month);
  });
}
// carry guard: don't recurse before any budget/tx exists
function availableCarrySafe(catId, prevMonth, curMonth) {
  if (!hasHistoryBefore(curMonth)) return 0;
  return available(catId, prevMonth);
}
function hasHistoryBefore(month) {
  return memo(`hist:${month}`, () => {
    for (const tx of state.transactions) if (monthOf(tx.date) < month) return true;
    for (const m of Object.keys(state.budget)) if (m < month) return true;
    return false;
  });
}

// cash overspending in a month = Σ over categories of cashPortion of negative available
function cashOverspending(month) {
  return memo(`cashover:${month}`, () => {
    let total = 0;
    for (const c of state.categories) {
      if (c.ccAccountId) continue;
      const av = available(c.id, month);
      if (av >= 0) continue;
      const over = -av;
      const credit = Math.min(over, creditSpending(c.id, month));
      total += over - credit; // cash portion
    }
    return total;
  });
}

function readyToAssign(month) {
  return memo(`rta:${month}`, () => {
    let inflow = 0, totAssigned = 0, cashOver = 0;
    // inflowToRTA = INFLOW-categorized inflows on on-budget accounts, any month ≤ month
    for (const tx of state.transactions) {
      const m = monthOf(tx.date);
      if (m > month || !isOnBudget(tx.accountId)) continue;
      for (const r of catRows(tx)) if (r.categoryId === INFLOW) inflow += r.amount;
    }
    // total assigned in months ≤ month
    for (const m of Object.keys(state.budget)) {
      if (m > month) continue;
      for (const cid of Object.keys(state.budget[m])) totAssigned += state.budget[m][cid];
    }
    // cash overspending in months < month
    for (const m of allMonthsUpTo(addMonths(month, -1))) cashOver += cashOverspending(m);
    return inflow - totAssigned - cashOver;
  });
}

function firstTxMonth() {
  let min = null;
  for (const tx of state.transactions) { const m = monthOf(tx.date); if (!min || m < min) min = m; }
  return min;
}
// distinct months with tx or budget history, up to & including `until`
function allMonthsUpTo(until) {
  const set = new Set();
  for (const tx of state.transactions) { const m = monthOf(tx.date); if (m <= until) set.add(m); }
  for (const m of Object.keys(state.budget)) if (m <= until) set.add(m);
  return [...set].sort();
}

// ---------- credit-card payment category simulation ----------
// available for a CC payment category at month = carry + assigned + ccActivity(month)
function ccAvailable(payCatId, month) {
  const prev = addMonths(month, -1);
  const carry = hasHistoryBefore(month) ? Math.max(0, ccAvailable(payCatId, prev)) : 0;
  return carry + assigned(payCatId, month) + ccActivity(payCatId, month);
}
// activity of a CC payment category this month: covered spending + payments/refunds
function ccActivity(payCatId, month) {
  return memo(`ccact:${payCatId}:${month}`, () => {
    const c = cat(payCatId);
    const accId = c.ccAccountId;
    let act = 0;

    // running available per spending category on this card, this month, in date order
    const running = {};
    const txns = state.transactions
      .filter(t => monthOf(t.date) === month)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    for (const tx of txns) {
      // payment: transfer on-budget -> this card (positive amount on card side)
      if (tx.accountId === accId && tx.transferAccountId && tx.amount > 0) {
        act -= tx.amount; // money leaves payment category to pay the card
        continue;
      }
      if (tx.accountId !== accId) continue;
      // spending / refunds charged to the card, per category
      for (const r of catRows(tx)) {
        const cid = r.categoryId;
        if (cid == null || cid === INFLOW) continue;
        if (r.amount < 0) {
          // spending: cover up to running available of that category
          if (!(cid in running)) running[cid] = spendCatAvailAtStart(cid, month);
          const outflow = -r.amount;
          const covered = Math.max(0, Math.min(outflow, Math.max(0, running[cid])));
          running[cid] -= outflow;
          act += covered;
        } else {
          // refund on card to a category: pull back from payment category
          act -= r.amount;
        }
      }
    }
    return act;
  });
}
// spending category available at start of month (carry+assigned), before this month's activity
function spendCatAvailAtStart(catId, month) {
  const prev = addMonths(month, -1);
  const carry = hasHistoryBefore(month) ? Math.max(0, available(catId, prev)) : 0;
  return carry + assigned(catId, month);
}

// ---------- account balances ----------
function accountBalances(accountId) {
  return memo(`bal:${accountId}`, () => {
    let cleared = 0, uncleared = 0;
    for (const tx of state.transactions) {
      if (tx.accountId !== accountId) continue;
      if (tx.cleared === 'uncleared') uncleared += tx.amount;
      else cleared += tx.amount;
    }
    return { cleared, uncleared, working: cleared + uncleared };
  });
}

// ---------- Age of Money (FIFO) ----------
function cashOutflowAges() {
  return memo('aomAges', () => {
    // gather cash-account tx in date order; inflows queue, outflows consume oldest
    const rows = state.transactions
      .filter(t => isCash(t.accountId))
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));
    const queue = []; // {date, remaining}
    const ages = [];  // {date, age}
    for (const tx of rows) {
      // transfer between two cash accounts: no AoM impact
      if (tx.transferAccountId && isCash(tx.transferAccountId)) continue;
      if (tx.amount > 0) {
        queue.push({ date: tx.date, remaining: tx.amount });
      } else if (tx.amount < 0) {
        let need = -tx.amount, weighted = 0, consumed = 0;
        while (need > 0 && queue.length) {
          const front = queue[0];
          const take = Math.min(need, front.remaining);
          weighted += take * daysBetween(front.date, tx.date);
          consumed += take;
          front.remaining -= take; need -= take;
          if (front.remaining <= 0) queue.shift();
        }
        if (consumed > 0) ages.push({ date: tx.date, age: weighted / consumed });
      }
    }
    return ages;
  });
}
function ageOfMoney() {
  const ages = cashOutflowAges();
  if (ages.length < 10) return null;
  const last10 = ages.slice(-10);
  return Math.round(last10.reduce((s, a) => s + a.age, 0) / last10.length);
}
function ageOfMoneySeries() {
  return memo('aomSeries', () => {
    const first = firstTxMonth();
    if (!first) return [];
    const now = thisMonth();
    const out = [];
    const allAges = cashOutflowAges();
    for (let m = first; m <= now; m = addMonths(m, 1)) {
      const cut = addMonths(m, 1); // month end = first day of next month
      const upto = allAges.filter(a => a.date < cut);
      let aom = null;
      if (upto.length >= 10) {
        const last10 = upto.slice(-10);
        aom = Math.round(last10.reduce((s, a) => s + a.age, 0) / last10.length);
      }
      out.push({ month: m, aom });
    }
    return out;
  });
}

// ---------- targets ----------
function neededThisMonth(catId, month) {
  const c = cat(catId);
  if (!c || !c.target) return 0;
  const t = c.target;
  const prev = addMonths(month, -1);
  const carry = hasHistoryBefore(month) ? Math.max(0, available(catId, prev)) : 0;
  const asg = assigned(catId, month);
  const avail0 = carry + asg;

  if (t.targetDate && (t.type === 'NEED' || t.type === 'SAVINGS_BALANCE')) {
    const monthsLeft = Math.max(1, monthsBetween(month, t.targetDate) + 1);
    const perMonth = Math.round((t.amount - carry) / monthsLeft);
    return Math.max(0, perMonth - asg);
  }
  if (t.type === 'NEED') {
    if (t.cadence === 'yearly') return Math.max(0, Math.round(t.amount / 12) - asg);
    return Math.max(0, t.amount - avail0); // monthly, no date
  }
  if (t.type === 'SAVINGS_MONTHLY' || t.type === 'DEBT_PAYMENT') return Math.max(0, t.amount - asg);
  return 0;
}

// ---------- monthData ----------
function goalFor(c, month) {
  if (!c.target) {
    const av = available(c.id, month);
    const act = activity(c.id, month);
    if (av < 0) return null; // status handled in caller via pill
    return null;
  }
  const needed = neededThisMonth(c.id, month);
  const av = available(c.id, month);
  const carry = hasHistoryBefore(month) ? Math.max(0, available(c.id, addMonths(month, -1))) : 0;
  const asg = assigned(c.id, month);
  const t = c.target;
  // required this month = needed + already-assigned toward it (for progress)
  let required = needed + asg;
  if (required <= 0) required = Math.max(1, t.amount);
  const fundedSoFar = carry + asg;
  let status;
  if (av < 0) status = 'overspent';
  else if (needed === 0) status = 'funded';
  else status = 'underfunded';
  const fundedPct = needed === 0 ? 100 : Math.max(0, Math.min(100, Math.round(100 * fundedSoFar / required)));
  return { needed, fundedPct, status };
}

function pillClassFor(av) {
  if (av > 0) return 'pos';
  if (av === 0) return 'zero';
  return 'overspent';
}

function monthData(month) {
  return memo(`monthData:${month}`, () => {
    const groups = state.categoryGroups
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
      .map(g => {
        const cats = state.categories
          .filter(c => c.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(c => {
            const asg = assigned(c.id, month);
            const act = c.ccAccountId ? ccActivity(c.id, month) : activity(c.id, month);
            const av = available(c.id, month);
            let goal = null, pillClass;
            if (c.ccAccountId) {
              pillClass = av > 0 ? 'pos' : av === 0 ? 'zero' : 'overspent';
            } else {
              goal = goalFor(c, month);
              if (av < 0) pillClass = 'overspent';
              else if (goal && goal.status === 'underfunded') pillClass = 'underfunded';
              else if (av === 0) pillClass = 'zero';
              else pillClass = 'pos';
            }
            return {
              id: c.id, name: c.name, groupId: c.groupId, hidden: c.hidden,
              assigned: asg, activity: act, available: av,
              target: c.target || null, goal, pillClass,
            };
          });
        return { id: g.id, name: g.name, hidden: g.hidden, categories: cats };
      });

    let assignedT = 0, activityT = 0, availableT = 0;
    for (const g of groups) for (const c of g.categories) {
      assignedT += c.assigned; activityT += c.activity; availableT += c.available;
    }
    return {
      month,
      rta: readyToAssign(month),
      ageOfMoney: ageOfMoney(),
      totals: { assigned: assignedT, activity: activityT, available: availableT },
      groups,
    };
  });
}

// ---------- reports ----------
function netWorthSeries() {
  return memo('netWorth', () => {
    const first = firstTxMonth();
    if (!first) return [];
    const now = thisMonth();
    const out = [];
    for (let m = first; m <= now; m = addMonths(m, 1)) {
      const cut = addMonths(m, 1); // month end
      let assets = 0, liabilities = 0;
      for (const a of state.accounts) {
        let bal = 0;
        for (const tx of state.transactions)
          if (tx.accountId === a.id && tx.date < cut) bal += tx.amount;
        if (bal >= 0) assets += bal; else liabilities += bal;
      }
      out.push({ month: m, assets, liabilities, netWorth: assets + liabilities });
    }
    return out;
  });
}

function spendingBreakdown({ fromMonth, toMonth, groupBy = 'category', categoryIds, accountIds }) {
  const map = new Map();
  const catSet = categoryIds ? new Set(categoryIds) : null;
  const accSet = accountIds ? new Set(accountIds) : null;
  for (const tx of state.transactions) {
    if (!isOnBudget(tx.accountId)) continue;
    const m = monthOf(tx.date);
    if (m < fromMonth || m > toMonth) continue;
    if (accSet && !accSet.has(tx.accountId)) continue;
    for (const r of catRows(tx)) {
      if (r.amount >= 0) continue; // outflows only
      if (r.categoryId == null || r.categoryId === INFLOW) continue;
      if (catSet && !catSet.has(r.categoryId)) continue;
      const c = cat(r.categoryId);
      if (!c) continue;
      let id, name;
      if (groupBy === 'group') {
        const g = state.categoryGroups.find(x => x.id === c.groupId);
        id = c.groupId; name = g ? g.name : '(none)';
      } else if (groupBy === 'payee') {
        const p = tx.payeeId ? getPayee(tx.payeeId) : null;
        id = tx.payeeId || 'none'; name = p ? p.name : '(no payee)';
      } else { id = c.id; name = c.name; }
      const cur = map.get(id) || { id, name, amount: 0 };
      cur.amount += -r.amount;
      map.set(id, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function incomeVsExpense({ fromMonth, toMonth }) {
  const months = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) months.push(m);
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const zero = () => months.map(() => 0);

  // income grouped by payee (INFLOW txns)
  const incomeRows = new Map();
  // expense grouped by group -> category
  const groupRows = new Map();

  for (const tx of state.transactions) {
    if (!isOnBudget(tx.accountId)) continue;
    const m = monthOf(tx.date);
    if (!(m in idx)) continue;
    for (const r of catRows(tx)) {
      if (r.categoryId === INFLOW && r.amount > 0) {
        const p = tx.payeeId ? getPayee(tx.payeeId) : null;
        const key = tx.payeeId || 'none';
        const row = incomeRows.get(key) || { id: key, name: p ? p.name : '(no payee)', values: zero(), total: 0 };
        row.values[idx[m]] += r.amount; row.total += r.amount;
        incomeRows.set(key, row);
      } else if (r.amount < 0 && r.categoryId && r.categoryId !== INFLOW) {
        const c = cat(r.categoryId);
        if (!c) continue;
        const g = state.categoryGroups.find(x => x.id === c.groupId);
        const gid = c.groupId || 'none';
        let grp = groupRows.get(gid);
        if (!grp) { grp = { id: gid, name: g ? g.name : '(none)', values: zero(), total: 0, categoryRows: new Map() }; groupRows.set(gid, grp); }
        let cr = grp.categoryRows.get(c.id);
        if (!cr) { cr = { id: c.id, name: c.name, values: zero(), total: 0 }; grp.categoryRows.set(c.id, cr); }
        const amt = -r.amount;
        cr.values[idx[m]] += amt; cr.total += amt;
        grp.values[idx[m]] += amt; grp.total += amt;
      }
    }
  }
  const income = { payeeRows: [...incomeRows.values()], values: zero(), total: 0 };
  for (const row of income.payeeRows) { row.values.forEach((v, i) => income.values[i] += v); income.total += row.total; }
  const expense = { groupRows: [...groupRows.values()].map(g => ({ ...g, categoryRows: [...g.categoryRows.values()] })), values: zero(), total: 0 };
  for (const g of expense.groupRows) { g.values.forEach((v, i) => expense.values[i] += v); expense.total += g.total; }
  const netRow = { values: months.map((_, i) => income.values[i] - expense.values[i]), total: income.total - expense.total };
  return { months, income, expense, netRow };
}

// ---------- loans ----------
function simulateLoan(balance, rate, payment) {
  const r = rate / 1200;
  let bal = balance, months = 0, totalInterest = 0;
  if (payment <= bal * r) return { months: Infinity, totalInterest: Infinity };
  while (bal > 0 && months < 1000) {
    const interest = bal * r;
    bal = bal + interest - payment;
    totalInterest += interest;
    months++;
  }
  return { months, totalInterest: Math.round(totalInterest) };
}
function payoffDateFrom(months) {
  if (months === Infinity) return null;
  return addMonths(thisMonth(), months) + '-01';
}
function loanStats(accountId, extraMonthlyCents = 0) {
  const a = acct(accountId);
  const balance = Math.abs(accountBalances(accountId).working);
  const rate = a.loanInfo ? a.loanInfo.interestRate : 0;
  const payment = a.loanInfo ? a.loanInfo.minimumPayment : 0;
  const base = simulateLoan(balance, rate, payment);
  const ext = simulateLoan(balance, rate, payment + extraMonthlyCents);
  const interestSaved = base.totalInterest === Infinity || ext.totalInterest === Infinity
    ? 0 : base.totalInterest - ext.totalInterest;
  const timeSavedMonths = base.months === Infinity || ext.months === Infinity
    ? 0 : base.months - ext.months;
  return {
    balance, rate, minimumPayment: payment,
    months: ext.months, payoffDate: payoffDateFrom(ext.months), totalInterest: ext.totalInterest,
    interestSaved, timeSavedMonths,
    withExtra: {
      months: ext.months, payoffDate: payoffDateFrom(ext.months), totalInterest: ext.totalInterest,
      interestSaved, timeSavedMonths,
    },
  };
}

// ---------- payees ----------
function getPayee(id) { return state.payees.find(p => p.id === id); }
function findOrCreatePayee(name) {
  name = String(name || '').trim();
  if (!name) return null;
  let p = state.payees.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!p) { p = { id: uid(), name, lastCategoryId: null, lat: null, lng: null }; state.payees.push(p); }
  return p.id;
}
function payeeSuggestions(prefix) {
  prefix = String(prefix || '').toLowerCase();
  return state.payees.filter(p => p.name.toLowerCase().includes(prefix)).map(p => p.name);
}
function nearestPayee(lat, lng) {
  let best = null, bestD = Infinity;
  for (const p of state.payees) {
    if (p.lat == null || p.lng == null) continue;
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best && bestD <= 250 ? best : null;
}
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLa = rad(la2 - la1), dLo = rad(lo2 - lo1);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------- internal mutation bodies ----------
function nextSort(arr) { return arr.reduce((m, x) => Math.max(m, x.sortOrder ?? 0), -1) + 1; }

function _addAccount({ name, type, balance = 0, date = todayISO() }) {
  const onBudget = ONBUDGET_TYPES.has(type);
  const id = uid();
  const a = { id, name, type, onBudget, closed: false, note: '', sortOrder: nextSort(state.accounts) };
  if (['mortgage', 'autoLoan', 'studentLoan', 'personalLoan'].includes(type)) a.loanInfo = { interestRate: 0, minimumPayment: 0 };
  state.accounts.push(a);
  if (type === 'creditCard') ensureCcCategory(a);
  if (balance) {
    const tx = {
      id: uid(), accountId: id, date, payeeId: null,
      categoryId: onBudget && balance > 0 ? INFLOW : null,
      memo: 'Starting Balance', amount: balance, cleared: 'cleared', approved: true,
      flag: null, transferAccountId: null, transferTxId: null, importId: null, attachments: [], subtransactions: null,
    };
    state.transactions.push(tx);
  }
  return id;
}
function ensureCcCategory(a) {
  let grp = state.categoryGroups.find(g => g.id === 'cc-payments');
  if (!grp) { grp = { id: 'cc-payments', name: 'Credit Card Payments', sortOrder: -1, hidden: false }; state.categoryGroups.push(grp); }
  const exists = state.categories.find(c => c.ccAccountId === a.id);
  if (!exists) state.categories.push({
    id: uid(), groupId: 'cc-payments', name: a.name, sortOrder: nextSort(state.categories.filter(c => c.groupId === 'cc-payments')),
    hidden: false, note: '', target: null, ccAccountId: a.id,
  });
}

function _addTransaction(tx) {
  const full = {
    id: tx.id || uid(), accountId: tx.accountId, date: tx.date || todayISO(),
    payeeId: tx.payeeId || null, categoryId: tx.categoryId ?? null, memo: tx.memo || '',
    amount: tx.amount || 0, cleared: tx.cleared || 'uncleared', approved: tx.approved !== false,
    flag: tx.flag || null, transferAccountId: tx.transferAccountId || null, transferTxId: tx.transferTxId || null,
    importId: tx.importId || null, attachments: tx.attachments || [],
    subtransactions: tx.subtransactions || null,
  };
  if (tx.autoCategorized) full.autoCategorized = true; // category was a guess, pending user approval
  if (full.subtransactions) full.categoryId = null;
  state.transactions.push(full);
  return full.id;
}

function _addTransfer({ fromAccountId, toAccountId, date = todayISO(), amount, memo = '', categoryId = null }) {
  const id1 = uid(), id2 = uid();
  const toTracking = !isOnBudget(toAccountId);
  const out = {
    id: id1, accountId: fromAccountId, date, payeeId: null,
    categoryId: toTracking ? categoryId : null, memo,
    amount: -Math.abs(amount), cleared: 'uncleared', approved: true, flag: null,
    transferAccountId: toAccountId, transferTxId: id2, importId: null, attachments: [], subtransactions: null,
  };
  const inn = {
    id: id2, accountId: toAccountId, date, payeeId: null, categoryId: null, memo,
    amount: Math.abs(amount), cleared: 'uncleared', approved: true, flag: null,
    transferAccountId: fromAccountId, transferTxId: id1, importId: null, attachments: [], subtransactions: null,
  };
  state.transactions.push(out, inn);
  return id1;
}

function _importTransactions(accountId, bankTxns) {
  let inserted = 0, merged = 0, skipped = 0;
  const seen = new Set();
  for (const t of state.transactions) if (t.accountId === accountId && t.importId) seen.add(t.importId);
  const model = trainClassifier(state); // learns payee-token -> category from existing history
  for (const b of bankTxns) {
    if (b.importId && seen.has(b.importId)) { skipped++; continue; } // same statement re-imported
    if (b.importId) seen.add(b.importId);
    const match = state.transactions.find(t =>
      t.accountId === accountId && !t.importId && t.approved &&
      !t.transferAccountId && t.amount === b.amount &&
      Math.abs(daysBetween(t.date, b.date)) <= 10);
    if (match) {
      match.importId = b.importId; match.approved = true;
      merged++;
    } else {
      const payeeId = b.payeeName ? findOrCreatePayee(b.payeeName) : null;
      const catId = payeeId
        ? (getPayee(payeeId).lastCategoryId || suggestCategory(state, b.payeeName, b.amount, model, b.memo))
        : null;
      _addTransaction({
        accountId, date: b.date, payeeId, categoryId: catId, memo: b.memo || '',
        amount: b.amount, importId: b.importId, approved: false, cleared: 'cleared',
        autoCategorized: catId != null,
      });
      inserted++;
    }
  }
  return { inserted, merged, skipped };
}

// group an account's unapproved txns by normalized payee name, for bulk approve/categorize UI
function pendingGroups(accountId) {
  const groups = new Map();
  for (const tx of state.transactions) {
    if (tx.accountId !== accountId || tx.approved) continue;
    if (tx.transferAccountId && tx.amount > 0) continue; // incoming leg is the hidden twin — skip so a transfer isn't double-counted
    const payee = tx.payeeId ? getPayee(tx.payeeId) : null;
    const key = payee ? `p:${payee.name.toLowerCase().trim()}` : `tx:${tx.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, payeeId: tx.payeeId || null, payeeName: payee ? payee.name : (tx.memo || '(no payee)'),
        count: 0, totalAmount: 0, categoryId: tx.categoryId, allSameCategory: true,
        autoCategorized: true, memberIds: [], sampleDate: tx.date,
      };
      groups.set(key, g);
    } else if (g.categoryId !== tx.categoryId) {
      g.categoryId = null; g.allSameCategory = false;
    }
    g.count++; g.totalAmount += tx.amount; g.memberIds.push(tx.id);
    if (tx.date > g.sampleDate) g.sampleDate = tx.date;
    if (!tx.autoCategorized) g.autoCategorized = false;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.payeeName < b.payeeName ? -1 : a.payeeName > b.payeeName ? 1 : 0));
}

function matchCandidates(accountId) {
  const out = [];
  for (const imp of state.transactions) {
    if (imp.accountId !== accountId || imp.approved || !imp.importId) continue;
    const match = state.transactions.find(t =>
      t.id !== imp.id && t.accountId === accountId && !t.importId && t.approved &&
      !t.transferAccountId && t.amount === imp.amount &&
      Math.abs(daysBetween(t.date, imp.date)) <= 10);
    out.push({ imported: imp, match: match || null });
  }
  return out;
}

const FREQ_MONTHS = { monthly: 1, every2months: 2, quarterly: 3, twiceayear: 6, yearly: 12 };

function advanceDate(iso, freq) {
  const [y, m, d] = iso.split('-').map(Number);
  if (freq === 'weekly') return isoAdd(iso, 7);
  if (freq === 'fortnightly') return isoAdd(iso, 14);
  const months = FREQ_MONTHS[freq];
  if (months) {
    const total = (m - 1) + months; // zero-indexed month count from year y
    const ny = y + Math.floor(total / 12);
    const nmZero = total % 12;
    const clamped = Math.min(d, daysInMonth(ny, nmZero));
    return `${ny}-${String(nmZero + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
  }
  return iso;
}
function isoAdd(iso, days) { return new Date(new Date(iso + 'T00:00:00').getTime() + days * 86400000).toISOString().slice(0, 10); }
function daysInMonth(y, mZero) { return new Date(y, mZero + 1, 0).getDate(); }

function _processDueScheduled() {
  const today = todayISO();
  let made = 0;
  for (const s of state.scheduled) {
    let guard = 0;
    while (s.nextDate <= today && guard++ < 100) {
      _addTransaction({
        accountId: s.accountId, date: s.nextDate, payeeId: s.payeeId, categoryId: s.categoryId,
        memo: s.memo, amount: s.amount, flag: s.flag, approved: false, cleared: 'uncleared',
      });
      s.nextDate = advanceDate(s.nextDate, s.frequency);
      made++;
    }
  }
  return made;
}
function upcomingScheduled(accountId, days) {
  const today = todayISO(), until = isoAdd(today, days);
  return state.scheduled
    .filter(s => (accountId == null || s.accountId === accountId) && s.nextDate <= until)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
}

function _reconcileAccount(accountId, actualBalanceCents) {
  const { cleared } = accountBalances(accountId);
  if (actualBalanceCents !== cleared) {
    const diff = actualBalanceCents - cleared;
    const payeeId = findOrCreatePayee('Reconciliation Balance Adjustment');
    _addTransaction({
      accountId, date: todayISO(), payeeId,
      categoryId: isOnBudget(accountId) ? INFLOW : null,
      memo: 'Reconciliation Balance Adjustment', amount: diff, cleared: 'cleared', approved: true,
    });
  }
  for (const t of state.transactions)
    if (t.accountId === accountId && t.cleared === 'cleared') t.cleared = 'reconciled';
}

function _autoAssign(month) {
  let rta = readyToAssign(month);
  let total = 0;
  const groups = state.categoryGroups.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  for (const g of groups) {
    if (g.hidden) continue;
    const cats = state.categories.filter(c => c.groupId === g.id).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const c of cats) {
      if (c.hidden || c.ccAccountId) continue;
      if (rta <= 0) return total;
      const need = neededThisMonth(c.id, month);
      const give = Math.min(need, rta);
      if (give > 0) {
        if (!state.budget[month]) state.budget[month] = {};
        state.budget[month][c.id] = assigned(c.id, month) + give;
        invalidate(); // recompute needed/rta as we go
        rta -= give; total += give;
      }
    }
  }
  return total;
}

function _removeCategories(categoryIds, replacementCategoryId = null) {
  const ids = new Set(categoryIds);
  const replacement = replacementCategoryId
    && !ids.has(replacementCategoryId)
    && state.categories.some(c => c.id === replacementCategoryId)
    ? replacementCategoryId
    : null;

  for (const tx of state.transactions) {
    if (ids.has(tx.categoryId)) tx.categoryId = replacement;
    if (tx.subtransactions) {
      for (const sub of tx.subtransactions) if (ids.has(sub.categoryId)) sub.categoryId = replacement;
    }
  }
  for (const scheduled of state.scheduled) if (ids.has(scheduled.categoryId)) scheduled.categoryId = replacement;
  for (const payee of state.payees) if (ids.has(payee.lastCategoryId)) payee.lastCategoryId = replacement;

  for (const month of Object.keys(state.budget)) {
    const budget = state.budget[month];
    let moved = 0;
    for (const id of ids) {
      moved += budget[id] || 0;
      delete budget[id];
    }
    if (replacement && moved) budget[replacement] = (budget[replacement] || 0) + moved;
  }

  for (const view of state.focusedViews) {
    const containedDeletedCategory = view.categoryIds.some(id => ids.has(id));
    view.categoryIds = view.categoryIds.filter(id => !ids.has(id));
    if (replacement && containedDeletedCategory && !view.categoryIds.includes(replacement)) view.categoryIds.push(replacement);
  }
  state.categories = state.categories.filter(c => !ids.has(c.id));
}

// ---------- public store ----------
export const store = {
  get state() { return state; },
  subscribe(fn) { subs.add(fn); },
  unsubscribe(fn) { subs.delete(fn); },
  canUndo() { return undoStack.length > 0; },
  undo() {
    if (!undoStack.length) return;
    state = JSON.parse(undoStack.pop());
    invalidate(); persist(); notify();
  },

  // accounts
  addAccount: mutate(_addAccount),
  updateAccount: mutate((id, patch) => { Object.assign(acct(id), patch); }),
  closeAccount: mutate(id => { acct(id).closed = true; }),
  reopenAccount: mutate(id => { acct(id).closed = false; }),

  // categories
  addGroup: mutate(name => {
    const g = { id: uid(), name, sortOrder: nextSort(state.categoryGroups), hidden: false };
    state.categoryGroups.push(g); return g.id;
  }),
  renameGroup: mutate((id, name) => { state.categoryGroups.find(g => g.id === id).name = name; }),
  hideGroup: mutate(id => { state.categoryGroups.find(g => g.id === id).hidden = true; }),
  deleteGroup: mutate((id, replacementCategoryId = null) => {
    const categoryIds = state.categories.filter(c => c.groupId === id).map(c => c.id);
    _removeCategories(categoryIds, replacementCategoryId);
    state.categoryGroups = state.categoryGroups.filter(g => g.id !== id);
  }),
  addCategory: mutate((groupId, name) => {
    const c = {
      id: uid(), groupId, name, sortOrder: nextSort(state.categories.filter(c => c.groupId === groupId)),
      hidden: false, note: '', target: null,
    };
    state.categories.push(c); return c.id;
  }),
  updateCategory: mutate((id, patch) => { Object.assign(cat(id), patch); }),
  hideCategory: mutate(id => { cat(id).hidden = true; }),
  deleteCategory: mutate((id, replacementCategoryId = null) => _removeCategories([id], replacementCategoryId)),
  moveCategory: mutate((id, groupId, index) => {
    const c = cat(id); c.groupId = groupId;
    const siblings = state.categories.filter(x => x.groupId === groupId && x.id !== id).sort((a, b) => a.sortOrder - b.sortOrder);
    siblings.splice(index, 0, c);
    siblings.forEach((x, i) => x.sortOrder = i);
  }),
  moveGroup: mutate((id, index) => {
    const g = state.categoryGroups.find(x => x.id === id);
    const others = state.categoryGroups.filter(x => x.id !== id).sort((a, b) => a.sortOrder - b.sortOrder);
    others.splice(index, 0, g);
    others.forEach((x, i) => x.sortOrder = i);
  }),
  setTarget: mutate((categoryId, target) => { cat(categoryId).target = target || null; }),
  // (Recent Moves keeps a 34-day trail of assigns/moves, matching YNAB)

  // budgeting
  assign: mutate((month, categoryId, cents) => {
    if (!state.budget[month]) state.budget[month] = {};
    const prev = state.budget[month][categoryId] || 0;
    state.budget[month][categoryId] = cents;
    logMove({ type: 'assign', month, toCatId: categoryId, amount: cents - prev });
  }),
  moveMoney: mutate((month, fromCatId, toCatId, cents) => {
    if (!state.budget[month]) state.budget[month] = {};
    const b = state.budget[month];
    if (fromCatId) b[fromCatId] = (b[fromCatId] || 0) - cents;
    if (toCatId) b[toCatId] = (b[toCatId] || 0) + cents;
    // null side = Ready to Assign, no stored value needed
    logMove({ type: 'move', month, fromCatId, toCatId, amount: cents });
  }),
  recentMoves() { return (state.moveLog || []).slice().reverse(); },
  autoAssign: mutate(_autoAssign),

  // transactions
  addTransaction: mutate(_addTransaction),
  updateTransaction: mutate((id, patch) => {
    const tx = state.transactions.find(t => t.id === id);
    Object.assign(tx, patch);
    if ('categoryId' in patch) delete tx.autoCategorized; // user chose — no longer a guess
    if (tx.subtransactions) tx.categoryId = null;
  }),
  deleteTransaction: mutate(id => {
    const tx = state.transactions.find(t => t.id === id);
    if (tx && tx.transferTxId) state.transactions = state.transactions.filter(t => t.id !== tx.transferTxId);
    state.transactions = state.transactions.filter(t => t.id !== id);
  }),
  addTransfer: mutate(_addTransfer),
  approveTransaction: mutate(id => {
    const tx = state.transactions.find(t => t.id === id);
    tx.approved = true;
    // approving is confirmation: teach the payee its category so future imports auto-fill
    if (tx.payeeId && tx.categoryId && !tx.transferAccountId) {
      const p = getPayee(tx.payeeId);
      if (p) p.lastCategoryId = tx.categoryId;
    }
  }),
  toggleCleared: mutate(id => {
    const tx = state.transactions.find(t => t.id === id);
    tx.cleared = tx.cleared === 'uncleared' ? 'cleared' : 'uncleared';
  }),
  reconcileAccount: mutate(_reconcileAccount),
  importTransactions: mutate(_importTransactions),
  matchCandidates,
  pendingGroups,
  // approve every member of a pending group; teaches the payee for each, same as approveTransaction
  approveGroup: mutate(memberIds => {
    for (const id of memberIds) {
      const tx = state.transactions.find(t => t.id === id);
      if (!tx) continue;
      tx.approved = true;
      if (tx.payeeId && tx.categoryId && !tx.transferAccountId) {
        const p = getPayee(tx.payeeId);
        if (p) p.lastCategoryId = tx.categoryId;
      }
    }
  }),
  // user-assign a category to every member of a pending group; no longer a guess, and teaches the payee
  categorizeGroup: mutate((memberIds, categoryId) => {
    for (const id of memberIds) {
      const tx = state.transactions.find(t => t.id === id);
      if (!tx) continue;
      tx.categoryId = categoryId;
      delete tx.autoCategorized;
      if (tx.payeeId) {
        const p = getPayee(tx.payeeId);
        if (p) p.lastCategoryId = categoryId;
      }
    }
  }),
  // re-run auto-categorization over unapproved/uncategorized-or-still-guessed txns (e.g. after a new category is added)
  resuggestPending: mutate(() => {
    const model = trainClassifier(state);
    let changed = 0;
    for (const tx of state.transactions) {
      if (tx.approved) continue;
      if (tx.categoryId != null && !tx.autoCategorized) continue; // user-confirmed category, leave alone
      const payee = tx.payeeId ? getPayee(tx.payeeId) : null;
      const catId = (payee && payee.lastCategoryId) || suggestCategory(state, payee ? payee.name : '', tx.amount, model, tx.memo);
      if (catId != null && catId !== tx.categoryId) { tx.categoryId = catId; tx.autoCategorized = true; changed++; }
    }
    return changed;
  }),

  // scheduled
  addScheduled: mutate(s => { const full = { id: uid(), ...s }; state.scheduled.push(full); return full.id; }),
  updateScheduled: mutate((id, patch) => { Object.assign(state.scheduled.find(s => s.id === id), patch); }),
  deleteScheduled: mutate(id => { state.scheduled = state.scheduled.filter(s => s.id !== id); }),
  processDueScheduled: mutate(_processDueScheduled),
  upcomingScheduled,

  // payees
  getPayee,
  findOrCreatePayee: mutate(findOrCreatePayee),
  renamePayee: mutate((id, name) => { getPayee(id).name = name; }),
  payeeSuggestions,
  nearestPayee,
  rememberPayeeContext: mutate((payeeId, categoryId, lat, lng) => {
    const p = getPayee(payeeId); if (!p) return;
    if (categoryId != null) p.lastCategoryId = categoryId;
    if (lat != null) p.lat = lat;
    if (lng != null) p.lng = lng;
  }),

  // focused views
  saveFocusedView: mutate((name, categoryIds) => {
    const v = { id: uid(), name, categoryIds }; state.focusedViews.push(v); return v.id;
  }),
  deleteFocusedView: mutate(id => { state.focusedViews = state.focusedViews.filter(v => v.id !== id); }),

  // computed
  monthData, readyToAssign, ageOfMoney, accountBalances,
  netWorthSeries, spendingBreakdown, incomeVsExpense, ageOfMoneySeries, loanStats,

  // settings / data
  isFirstRun,
  updateSettings: mutate(patch => { Object.assign(state.settings, patch); }),
  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON: mutate(text => { state = sanitizeImport(text); }),
  sanitizeImport, // exported for tests
  resetAll: mutate(() => { state = emptyState(); persistNow(); }),
};
