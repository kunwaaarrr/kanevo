// node test/engine-check.mjs — asserts the store engine against hand-computed numbers.
import assert from 'node:assert/strict';

// localStorage shim BEFORE importing the store
const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { store, INFLOW } = await import('../js/store.js');

function reset() { store.resetAll(); }
const M1 = '2026-01', M2 = '2026-02', M3 = '2026-03';

// ---- 1. RTA after inflow + assign ----
reset();
const chk = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: chk, date: '2026-01-05', categoryId: INFLOW, amount: 100000 }); // +$1000 inflow
const grp = store.addGroup('Bills');
const rent = store.addCategory(grp, 'Rent');
assert.equal(store.readyToAssign(M1), 100000, 'RTA = inflow before assigning');
store.assign(M1, rent, 30000); // assign $300
assert.equal(store.readyToAssign(M1), 70000, 'RTA reduced by assignment');
assert.equal(store.monthData(M1).groups.find(g => g.id === grp).categories[0].available, 30000, 'rent available = assigned');

// deleting a group also removes its budget assignments, so the money returns to RTA
const disposableGroup = store.addGroup('Disposable');
const disposableCategory = store.addCategory(disposableGroup, 'Temporary');
store.assign(M1, disposableCategory, 20000);
assert.equal(store.readyToAssign(M1), 50000, 'RTA includes the disposable group assignment');
store.deleteGroup(disposableGroup);
assert.equal(store.readyToAssign(M1), 70000, 'deleted group assignment returns to RTA');
assert.equal(store.state.budget[M1]?.[disposableCategory], undefined, 'deleted group budget key is removed');

// deleting into another category preserves assignments and recategorises affected transactions
const movedGroup = store.addGroup('Move Me');
const movedA = store.addCategory(movedGroup, 'A');
const movedB = store.addCategory(movedGroup, 'B');
store.assign(M1, movedA, 10000);
store.assign(M1, movedB, 5000);
const movedTx = store.addTransaction({ accountId: chk, date: '2026-01-08', categoryId: movedA, amount: -2500 });
const rtaBeforeMoveDelete = store.readyToAssign(M1);
store.deleteGroup(movedGroup, rent);
assert.equal(store.readyToAssign(M1), rtaBeforeMoveDelete, 'moving deleted-group assignments preserves RTA');
assert.equal(store.state.budget[M1][rent], 45000, 'deleted-group assignments move to destination category');
assert.equal(store.state.transactions.find(tx => tx.id === movedTx).categoryId, rent, 'deleted-group transactions move to destination category');

// groups and categories retain user-defined drag order, including cross-group moves
const orderGroupA = store.addGroup('Order A');
const orderGroupB = store.addGroup('Order B');
const orderCatA = store.addCategory(orderGroupA, 'First');
const orderCatB = store.addCategory(orderGroupB, 'Second');
store.moveGroup(orderGroupB, 0);
assert.equal(store.state.categoryGroups.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0].id, orderGroupB, 'group order is persisted');
store.moveCategory(orderCatA, orderGroupB, 0);
const movedOrder = store.state.categories.filter(category => category.groupId === orderGroupB).sort((a, b) => a.sortOrder - b.sortOrder);
assert.deepEqual(movedOrder.map(category => category.id), [orderCatA, orderCatB], 'category can be reordered into another group');

// ---- 2. Carryover: positive carries, negative does not ----
reset();
const a2 = store.addAccount({ name: 'C', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: a2, date: '2026-01-02', categoryId: INFLOW, amount: 100000 });
const g2 = store.addGroup('G');
const catPos = store.addCategory(g2, 'Pos');
const catNeg = store.addCategory(g2, 'Neg');
store.assign(M1, catPos, 20000);
store.addTransaction({ accountId: a2, date: '2026-01-10', categoryId: catPos, amount: -5000 }); // spend $50 -> avail $150
store.assign(M1, catNeg, 3000);
store.addTransaction({ accountId: a2, date: '2026-01-11', categoryId: catNeg, amount: -8000 }); // spend $80 -> avail -$50 (cash overspend)
assert.equal(store.monthData(M1).groups[0].categories[0].available, 15000, 'pos avail this month');
assert.equal(store.monthData(M2).groups[0].categories[0].available, 15000, 'positive carries to next month');
assert.equal(store.monthData(M2).groups[0].categories[1].available, 0, 'negative does NOT carry (starts at 0)');

// ---- 3. Cash overspending reduces NEXT month RTA; credit overspending does not ----
// Cash: from case 2 above, catNeg overspent $50 cash in Jan.
const rtaFeb = store.readyToAssign(M2);
const rtaJan = store.readyToAssign(M1);
// Jan RTA = 100000 - (20000+3000) - 0 = 77000; Feb RTA = 100000 - 23000 - 5000(cash overspend) = 72000
assert.equal(rtaJan, 77000, 'Jan RTA');
assert.equal(rtaFeb, 72000, 'Feb RTA reduced by Jan cash overspending $50');

// credit overspending: does NOT reduce RTA
reset();
const c3 = store.addAccount({ name: 'C', type: 'checking', balance: 0, date: '2026-01-01' });
const cc3 = store.addAccount({ name: 'Visa', type: 'creditCard', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: c3, date: '2026-01-02', categoryId: INFLOW, amount: 100000 });
const g3 = store.addGroup('G');
const dining = store.addCategory(g3, 'Dining');
// no assignment; spend $60 on the credit card -> available -$60, but it's all credit
store.addTransaction({ accountId: cc3, date: '2026-01-15', categoryId: dining, amount: -6000 });
assert.equal(store.monthData(M1).groups.find(g => g.id === g3).categories[0].available, -6000, 'dining overspent on credit');
// RTA Jan unaffected by credit overspend, Feb also unaffected (credit portion never reduces RTA)
assert.equal(store.readyToAssign(M1), 100000, 'credit overspend does not touch Jan RTA');
assert.equal(store.readyToAssign(M2), 100000, 'credit overspend does not reduce Feb RTA');

// ---- 4. CC covered spending moves money into payment category; payment reduces it ----
reset();
const c4 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const cc4 = store.addAccount({ name: 'Visa', type: 'creditCard', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: c4, date: '2026-01-01', categoryId: INFLOW, amount: 100000 });
const g4 = store.addGroup('G');
const groc = store.addCategory(g4, 'Groceries');
store.assign(M1, groc, 10000); // fund $100
store.addTransaction({ accountId: cc4, date: '2026-01-10', categoryId: groc, amount: -4000 }); // $40 on card, fully covered
const payCat = store.state.categories.find(c => c.ccAccountId === cc4);
assert.ok(payCat, 'cc payment category auto-created');
// covered $40 moves into payment category available
assert.equal(store.monthData(M1).groups.find(g => g.id === 'cc-payments').categories[0].available, 4000, 'payment cat holds $40 covered');
// groceries available = 100 - 40 = 60
assert.equal(store.monthData(M1).groups.find(g => g.id === g4).categories[0].available, 6000, 'groceries reduced by covered spend');
// now pay the card $40 (transfer checking -> visa)
store.addTransfer({ fromAccountId: c4, toAccountId: cc4, date: '2026-01-20', amount: 4000 });
assert.equal(store.monthData(M1).groups.find(g => g.id === 'cc-payments').categories[0].available, 0, 'payment reduces payment cat to 0');
assert.equal(store.accountBalances(cc4).working, 0, 'card debt cleared after payment');

// ---- 5. Age of Money FIFO known scenario ----
reset();
const c5 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
// inflow of $1000 on day 0, then 10 outflows of $10 each, one per day starting day 10..19
store.addTransaction({ accountId: c5, date: '2026-01-01', categoryId: INFLOW, amount: 100000 });
for (let i = 0; i < 10; i++) {
  const day = String(11 + i).padStart(2, '0');
  store.addTransaction({ accountId: c5, date: `2026-01-${day}`, amount: -1000 });
}
// each outflow consumes from the single day-1 inflow; ages = 10,11,...,19 days; mean=14.5 -> round 15 (round half up? JS Math.round(14.5)=15)
assert.equal(store.ageOfMoney(), 15, 'AoM = mean of last 10 outflow ages');

// fewer than 10 outflows -> null
reset();
const c5b = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: c5b, date: '2026-01-01', categoryId: INFLOW, amount: 100000 });
store.addTransaction({ accountId: c5b, date: '2026-01-05', amount: -1000 });
assert.equal(store.ageOfMoney(), null, 'AoM null with <10 outflows');

// ---- 6. NEED-with-date target neededThisMonth ----
reset();
const c6 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: c6, date: '2026-01-01', categoryId: INFLOW, amount: 1000000 });
const g6 = store.addGroup('True Expenses');
const ins = store.addCategory(g6, 'Insurance');
// need $1200 by 2026-06 (from Jan: monthsLeft = 5+1 = 6). per month = round(120000/6)=20000
store.setTarget(ins, { type: 'NEED', amount: 120000, targetDate: '2026-06', cadence: 'yearly' });
let md6 = store.monthData(M1).groups.find(g => g.id === g6).categories[0];
assert.equal(md6.goal.needed, 20000, 'NEED-with-date needed = amount/monthsLeft');
// after assigning $200, needed becomes 0
store.assign(M1, ins, 20000);
md6 = store.monthData(M1).groups.find(g => g.id === g6).categories[0];
assert.equal(md6.goal.needed, 0, 'needed 0 after funding');
assert.equal(md6.goal.status, 'funded', 'status funded');

// ---- 7. autoAssign stops at RTA ----
reset();
const c7 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: c7, date: '2026-01-01', categoryId: INFLOW, amount: 5000 }); // only $50 available
const g7 = store.addGroup('G');
const a7 = store.addCategory(g7, 'A');
const b7 = store.addCategory(g7, 'B');
store.setTarget(a7, { type: 'NEED', amount: 4000, cadence: 'monthly' }); // needs $40
store.setTarget(b7, { type: 'NEED', amount: 4000, cadence: 'monthly' }); // needs $40
const assignedTotal = store.autoAssign(M1);
assert.equal(assignedTotal, 5000, 'autoAssign gives out exactly RTA');
assert.equal(store.readyToAssign(M1), 0, 'RTA exhausted');
// A funded fully ($40), B gets remaining $10
assert.equal(store.monthData(M1).groups[0].categories[0].assigned, 4000, 'A fully funded first');
assert.equal(store.monthData(M1).groups[0].categories[1].assigned, 1000, 'B gets leftover');

// ---- 8. Transaction matching merges ----
reset();
const c8 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const g8 = store.addGroup('G'); const cat8 = store.addCategory(g8, 'Coffee');
const pid = store.findOrCreatePayee('Cafe');
store.addTransaction({ accountId: c8, date: '2026-01-10', payeeId: pid, categoryId: cat8, memo: 'flat white', amount: -550, approved: true });
const before = store.state.transactions.length;
store.importTransactions(c8, [{ date: '2026-01-12', amount: -550, payeeName: 'BANK CAFE', importId: 'imp1' }]);
assert.equal(store.state.transactions.length, before, 'match merged, no new tx');
const merged = store.state.transactions.find(t => t.importId === 'imp1');
assert.equal(merged.categoryId, cat8, 'kept manual category');
assert.equal(merged.memo, 'flat white', 'kept manual memo');
assert.equal(merged.payeeId, pid, 'kept manual payee');
// non-match inserts unapproved
store.importTransactions(c8, [{ date: '2026-01-15', amount: -9999, payeeName: 'New', importId: 'imp2' }]);
const inserted = store.state.transactions.find(t => t.importId === 'imp2');
assert.equal(inserted.approved, false, 'non-match inserted unapproved');

// ---- 9. Scheduled materialization advances nextDate ----
reset();
const c9 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const g9 = store.addGroup('G'); const cat9 = store.addCategory(g9, 'Rent');
// monthly on the 31st -> Feb should clamp to 28 (2026 not leap)
const sid = store.addScheduled({ frequency: 'monthly', nextDate: '2000-01-31', accountId: c9, payeeId: null, categoryId: cat9, memo: 'rent', amount: -50000, flag: null });
const madeBefore = store.state.transactions.length;
store.processDueScheduled();
const s = store.state.scheduled.find(x => x.id === sid);
const madeTx = store.state.transactions.filter(t => t.memo === 'rent');
assert.ok(madeTx.length > 0 && madeTx.every(t => t.approved === false), 'scheduled materialized as unapproved txns');
assert.ok(s.nextDate > '2000-01-31', 'nextDate advanced past original');
// monthly day-of-month clamp: the first two materialized dates must be Jan-31 then Feb clamped to 28
assert.equal(madeTx[0].date, '2000-01-31', 'first occurrence on original date');
assert.equal(madeTx[1].date, '2000-02-29', 'monthly advance clamps to Feb (2000 leap) 29');

// ---- 10. Reconcile adjustment ----
reset();
const c10 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
store.addTransaction({ accountId: c10, date: '2026-01-05', categoryId: INFLOW, amount: 50000, cleared: 'cleared' });
// actual balance says $520 but cleared is $500 -> create +$20 adjustment
store.reconcileAccount(c10, 52000);
const adj = store.state.transactions.find(t => t.memo === 'Reconciliation Balance Adjustment');
assert.ok(adj, 'adjustment tx created');
assert.equal(adj.amount, 2000, 'adjustment = actual - cleared');
assert.equal(store.accountBalances(c10).cleared, 52000, 'cleared now matches actual');
assert.ok(store.state.transactions.filter(t => t.accountId === c10).every(t => t.cleared === 'reconciled'), 'all marked reconciled');

// ---- 11. loanStats sanity: extra payment => fewer months, less interest ----
reset();
const loan = store.addAccount({ name: 'Car', type: 'autoLoan', balance: -1420000, date: '2026-01-01' });
store.updateAccount(loan, { loanInfo: { interestRate: 7.49, minimumPayment: 41500 } });
const base = store.loanStats(loan, 0);
const withExtra = store.loanStats(loan, 10000);
assert.ok(base.months > 0 && base.months < 1000, 'baseline months finite');
assert.ok(withExtra.months < base.months, 'extra payment => fewer months');
assert.ok(withExtra.totalInterest < base.totalInterest, 'extra payment => less interest');
assert.ok(base.interestSaved === 0, 'baseline (extra 0) saves nothing');
assert.ok(withExtra.interestSaved > 0, 'extra payment saves interest');
assert.ok(withExtra.timeSavedMonths > 0, 'extra payment saves time');

console.log('OK — all engine checks passed');
