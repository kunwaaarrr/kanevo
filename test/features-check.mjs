// node test/features-check.mjs — asserts fifty.js + forecast.js against hand-computed numbers.
import assert from 'node:assert/strict';

// localStorage shim BEFORE importing the store (we build fixtures via real store mutations
// so state shapes stay honest, then pass store.state into the pure lib functions).
const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { store, INFLOW } = await import('../js/store.js');
const { defaultClass, classOf, fiftyThirtyTwenty } = await import('../js/lib/fifty.js');
const { baseline, forecast } = await import('../js/lib/forecast.js');

const reset = () => store.resetAll();

// ---- 1. defaultClass mapping table ----
assert.equal(defaultClass({ name: 'Visa' }, { name: 'Credit Card Payments' }), 'need', 'cc/payment group → need');
assert.equal(defaultClass({ name: 'Holiday' }, { name: 'Quality of Life' }), 'savings', 'name /holiday/ → savings');
assert.equal(defaultClass({ name: 'X', target: { type: 'SAVINGS_BALANCE', amount: 1 } }, { name: 'Quality of Life' }), 'savings', 'SAVINGS_BALANCE target → savings');
assert.equal(defaultClass({ name: 'Rent' }, { name: 'Immediate Obligations' }), 'need', 'immediate/obligation → need');
assert.equal(defaultClass({ name: 'Electric' }, { name: 'Bills' }), 'need', 'bill → need');
assert.equal(defaultClass({ name: 'Coffee' }, { name: 'Just for Fun' }), 'want', 'fun → want');
assert.equal(defaultClass({ name: 'Dining' }, { name: 'Quality of Life' }), 'want', 'quality → want');
assert.equal(defaultClass({ name: 'Random' }, { name: 'Unknown Group' }), 'want', 'fallback → want');
// classOf prefers explicit budgetClass
assert.equal(classOf({ budgetClass: 'savings', name: 'Rent', groupId: 'g' }, { g: { name: 'Immediate Obligations' } }), 'savings', 'classOf honors budgetClass');
assert.equal(classOf({ name: 'Rent', groupId: 'g' }, { g: { name: 'Immediate Obligations' } }), 'need', 'classOf falls back to defaultClass');

// ---- 2. fiftyThirtyTwenty: actuals vs a known month of spending + rounding identity ----
reset();
const chk = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: chk, date: '2026-06-15', categoryId: INFLOW, amount: 300333 }); // odd income → forces rounding remainder
const gNeed = store.addGroup('Immediate Obligations');
const gWant = store.addGroup('Just for Fun');
const gSav = store.addGroup('Savings');
const cRent = store.addCategory(gNeed, 'Rent');    // need
const cFun = store.addCategory(gWant, 'Gaming');   // want
const cInv = store.addCategory(gSav, 'Investing'); // name /invest/ → savings
store.addTransaction({ accountId: chk, date: '2026-06-10', categoryId: cRent, amount: -100000 }); // need spend $1000
store.addTransaction({ accountId: chk, date: '2026-06-11', categoryId: cFun, amount: -30000 });   // want spend $300
store.addTransaction({ accountId: chk, date: '2026-06-12', categoryId: cInv, amount: -20000 });   // savings spend $200
store.addTransaction({ accountId: chk, date: '2026-06-13', categoryId: cFun, amount: 5000 });     // refund (ignored: inflow, not outflow)

let r = fiftyThirtyTwenty(store.state, '2026-06');
assert.equal(r.income, 300333, 'income = INFLOW inflows');
assert.equal(r.actuals.need, 100000, 'need actual = rent outflow');
assert.equal(r.actuals.want, 30000, 'want actual = gaming outflow (refund ignored)');
assert.equal(r.actuals.savings, 20000, 'savings actual = investing outflow');
// targets default 50/30/20 with remainder to savings
assert.equal(r.targets.need, Math.round(300333 * 0.5), 'need target');
assert.equal(r.targets.want, Math.round(300333 * 0.3), 'want target');
assert.equal(r.targets.need + r.targets.want + r.targets.savings, r.income, 'rounding identity (default split)');
// unallocated = income - total outflow (100000+30000+20000 = 150000)
assert.equal(r.unallocated, 300333 - 150000, 'unallocated = income − total outflows');
assert.equal(r.effectiveSavings, 20000 + Math.max(0, r.unallocated), 'effectiveSavings');
assert.ok(Math.abs(r.pct.need - 100 * 100000 / 300333) < 1e-9, 'pct.need share of income');
// rows present and sorted desc by amount
assert.equal(r.rows.length, 3, 'three category rows');
assert.equal(r.rows[0].amount, 100000, 'rows sorted by amount desc');

// custom split identity (60/30/10)
let r60 = fiftyThirtyTwenty(store.state, '2026-06', { need: 60, want: 30, savings: 10 });
assert.equal(r60.targets.need, Math.round(300333 * 0.6), 'custom split need target');
assert.equal(r60.targets.want, Math.round(300333 * 0.3), 'custom split want target');
assert.equal(r60.targets.need + r60.targets.want + r60.targets.savings, r60.income, 'rounding identity (60/30/10)');

// zero income → pct nulls
reset();
const chk0 = store.addAccount({ name: 'C', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: chk0, date: '2026-06-10', categoryId: store.addCategory(store.addGroup('G'), 'X'), amount: -1000 });
let rz = fiftyThirtyTwenty(store.state, '2026-06');
assert.equal(rz.income, 0, 'zero income');
assert.equal(rz.pct.need, null, 'pct null when income 0');
assert.equal(rz.targets.need + rz.targets.want + rz.targets.savings, 0, 'zero targets sum 0');

// ---- 3. baseline 3-month averaging + shorter-history case ----
reset();
const b1 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const bg = store.addGroup('Immediate Obligations');
const bGroc = store.addCategory(bg, 'Groceries');
// income + groceries in Mar/Apr/May; forecast from 2026-06 → window = Mar,Apr,May (3 full months)
store.addTransaction({ accountId: b1, date: '2026-03-15', categoryId: INFLOW, amount: 300000 });
store.addTransaction({ accountId: b1, date: '2026-04-15', categoryId: INFLOW, amount: 300000 });
store.addTransaction({ accountId: b1, date: '2026-05-15', categoryId: INFLOW, amount: 600000 });
store.addTransaction({ accountId: b1, date: '2026-03-10', categoryId: bGroc, amount: -30000 });
store.addTransaction({ accountId: b1, date: '2026-04-10', categoryId: bGroc, amount: -60000 });
store.addTransaction({ accountId: b1, date: '2026-05-10', categoryId: bGroc, amount: -90000 });
let base = baseline(store.state, '2026-06');
assert.equal(base.incomePerMonth, Math.round((300000 + 300000 + 600000) / 3), 'income avg over 3 months');
assert.equal(base.categories.find(c => c.id === bGroc).perMonth, Math.round((30000 + 60000 + 90000) / 3), 'groceries avg = 60000');
// shorter history: forecast from 2026-04 → window = Jan,Feb,Mar but only Mar has data → nWin=1 (Mar only, since first tx is Mar)
let baseShort = baseline(store.state, '2026-04');
assert.equal(baseShort.incomePerMonth, 300000, 'short window (1 full month) = Mar income');
assert.equal(baseShort.categories.find(c => c.id === bGroc).perMonth, 30000, 'short window groceries = Mar');
// no history before first month → baselines 0 (from 2026-03, window Dec/Jan/Feb all before first tx)
let baseZero = baseline(store.state, '2026-03');
assert.equal(baseZero.incomePerMonth, 0, 'zero full months → income 0');
assert.equal(baseZero.categories.find(c => c.id === bGroc).perMonth, 0, 'zero full months → cat 0');

// ---- 4. forecast override modes (off / set / scale on a category; income set/scale) ----
// base groceries = 60000, income = 400000 (avg of 300k,300k,600k). horizon 3 months.
const F = ov => forecast(store.state, { months: 3, fromMonth: '2026-06', overrides: ov });
let fOff = F({ categories: { [bGroc]: { mode: 'off' } } });
assert.deepEqual(fOff.rows.find(x => x.id === bGroc).values, [0, 0, 0], 'off → 0');
let fSet = F({ categories: { [bGroc]: { mode: 'set', value: 12345 } } });
assert.deepEqual(fSet.rows.find(x => x.id === bGroc).values, [12345, 12345, 12345], 'set → value');
let fScale = F({ categories: { [bGroc]: { mode: 'scale', pct: 50 } } });
assert.deepEqual(fScale.rows.find(x => x.id === bGroc).values, [30000, 30000, 30000], 'scale 50% → half');
let fIncSet = F({ income: { mode: 'set', value: 500000 } });
assert.deepEqual(fIncSet.income, [500000, 500000, 500000], 'income set');
let fIncScale = F({ income: { mode: 'scale', pct: 200 } });
assert.equal(fIncScale.income[0], 800000, 'income scale 200% (base 400000)');
// months start AFTER fromMonth
assert.deepEqual(F({}).months, ['2026-07', '2026-08', '2026-09'], 'months start after fromMonth');

// ---- 5. cash accumulation identity: cash[i] = cash[i-1] + net[i] ----
let fc = F({});
for (let i = 1; i < fc.cash.length; i++)
  assert.equal(fc.cash[i], fc.cash[i - 1] + fc.net[i], `cash[${i}] = cash[${i - 1}] + net[${i}]`);
// cash[0] = startCash + net[0]; startCash = Σ working balances of on-budget accounts (here just b1)
const startCash = store.accountBalances(b1).working;
assert.equal(fc.cash[0], startCash + fc.net[0], 'cash[0] = startCash + net[0]');

// ---- 6. loan payoff month + linked-category shrink + freed money increases net ----
reset();
const lc = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const lg = store.addGroup('Immediate Obligations');
const lTrans = store.addCategory(lg, 'Transport');
// 3 months of income + a small loan whose linked category is Transport (via loan-payment transfers)
for (const m of ['2026-03', '2026-04', '2026-05']) {
  store.addTransaction({ accountId: lc, date: m + '-15', categoryId: INFLOW, amount: 500000 });
  store.addTransaction({ accountId: lc, date: m + '-10', categoryId: lTrans, amount: -20000 }); // some genuine transport spend
}
// loan starts -$3400; two $600 payments over Apr/May bring working balance to -$2200 by June.
const loan = store.addAccount({ name: 'Car Loan', type: 'autoLoan', balance: -340000, date: '2026-03-01' });
store.updateAccount(loan, { loanInfo: { interestRate: 12, minimumPayment: 60000 } });
// loan-payment transfers categorized to Transport (checking → loan) so linkedCategoryId = Transport
store.addTransfer({ fromAccountId: lc, toAccountId: loan, date: '2026-04-06', amount: 60000, categoryId: lTrans });
store.addTransfer({ fromAccountId: lc, toAccountId: loan, date: '2026-05-06', amount: 60000, categoryId: lTrans });

let lb = baseline(store.state, '2026-06');
const loanB = lb.loans.find(x => x.accountId === loan);
assert.ok(loanB, 'loan appears in baseline');
assert.equal(loanB.linkedCategoryId, lTrans, 'linkedCategoryId = Transport (most frequent on transfers)');
assert.equal(loanB.balance, 220000, 'loan working balance = 340000 − 2×60000 payments = 220000');

// hand sim: bal=220000, r=12/1200=0.01, pay=60000
// m0: 220000*1.01 - 60000 = 162200 ; m1: 162200*1.01 - 60000 = 103822
// m2: 103822*1.01 - 60000 = 44860.22 → round 44860 ; m3: 44860*1.01 - 60000 = -14691.4 → payoff index 3 (2026-10)
let lf = forecast(store.state, { months: 6, fromMonth: '2026-06', overrides: {} });
const lfl = lf.loans.find(x => x.accountId === loan);
// months: [07,08,09,10,11,12]. min-pay balances: [162200,103822,44860,0,0,0] → payoff index 3 = 2026-10
assert.equal(lfl.payment, 60000, 'payment = min + extra(0)');
assert.deepEqual(lfl.balances, [162200, 103822, 44860, 0, 0, 0], 'loan balance trajectory');
assert.equal(lfl.payoffMonth, '2026-10', 'payoff month = index 3 after fromMonth');
assert.equal(lfl.freedPerMonth, 60000, 'freedPerMonth = minimumPayment');
assert.equal(lf.events.length, 1, 'one payoff event');
assert.equal(lf.events[0].label, 'Car Loan paid off — frees $600.00/mo', 'event label formatted');
assert.equal(lf.events[0].month, '2026-10', 'event month');
// linked category Transport base = avg transport outflow over Mar/Apr/May.
// Mar: 20000 (only genuine). Apr: 20000 + 60000 transfer = 80000. May: 20000 + 60000 = 80000. avg = 60000.
const transRow = lf.rows.find(x => x.id === lTrans);
assert.equal(transRow.base, Math.round((20000 + 80000 + 80000) / 3), 'transport base includes categorized loan-payment transfers');
// from month AFTER payoff (index 3): indices 4,5 subtract minimumPayment(60000), floor 0
assert.equal(transRow.values[0], transRow.base, 'pre-payoff unchanged');
assert.equal(transRow.values[3], transRow.base, 'payoff-month value unchanged (shrink starts AFTER)');
assert.equal(transRow.values[4], Math.max(0, transRow.base - 60000), 'month after payoff shrinks by min payment');
assert.equal(transRow.values[5], Math.max(0, transRow.base - 60000), 'stays shrunk');
// freed money increases net: post-payoff net > pre-payoff net (income constant)
assert.ok(lf.net[4] > lf.net[0], 'freed payment increases net after payoff');

// override on linked category suppresses the shrink
let lfOv = forecast(store.state, { months: 6, fromMonth: '2026-06', overrides: { categories: { [lTrans]: { mode: 'set', value: 70000 } } } });
const trOv = lfOv.rows.find(x => x.id === lTrans);
assert.deepEqual(trOv.values, [70000, 70000, 70000, 70000, 70000, 70000], 'explicit override on linked cat → no payoff shrink');

// loanExtra speeds payoff: extra-pay balances [102200,0,...] → payoff index 1 = 2026-08
let lfExtra = forecast(store.state, { months: 6, fromMonth: '2026-06', overrides: { loanExtra: { [loan]: 60000 } } });
const lflx = lfExtra.loans.find(x => x.accountId === loan);
assert.equal(lflx.payment, 120000, 'payment includes loanExtra');
assert.equal(lflx.payoffMonth, '2026-08', 'extra payment → earlier payoff');

console.log('OK — all feature checks passed');
