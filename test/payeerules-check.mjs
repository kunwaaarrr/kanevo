// node test/payeerules-check.mjs — asserts store.learnedPayees()/setPayeeCategory() against
// hand-computed expectations (the "Learned merchants" feature's data layer).
import assert from 'node:assert/strict';

// localStorage shim BEFORE importing the store
const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { store } = await import('../js/store.js');

function reset() { store.resetAll(); }
reset();

const chk = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
const grp = store.addGroup('Group');
const catA = store.addCategory(grp, 'CatA');
const catB = store.addCategory(grp, 'CatB');

// three payees: two taught (via approve, the normal teaching path), one never taught
const zetaId = store.findOrCreatePayee('Zeta Corp');
const alphaId = store.findOrCreatePayee('Alpha Store');
store.findOrCreatePayee('Untaught Co');

const zetaTx = store.addTransaction({ accountId: chk, date: '2026-01-05', payeeId: zetaId, categoryId: catA, amount: -1000, approved: false });
store.approveTransaction(zetaTx);
const alphaTx = store.addTransaction({ accountId: chk, date: '2026-01-06', payeeId: alphaId, categoryId: catB, amount: -2000, approved: false });
store.approveTransaction(alphaTx);

// ---- 1. accessor: only taught payees, sorted by name, with their category attached ----
let learned = store.learnedPayees();
assert.deepEqual(learned.map(p => p.name), ['Alpha Store', 'Zeta Corp'], 'sorted by name, untaught payee excluded');
assert.equal(learned.find(p => p.id === zetaId).categoryId, catA, 'zeta taught catA');
assert.equal(learned.find(p => p.id === alphaId).category.id, catB, 'alpha taught catB, category object attached');

// ---- 2. setPayeeCategory reassigns the rule and immediately re-suggests pending txns ----
const pendingTx = store.addTransaction({
  accountId: chk, date: '2026-01-10', payeeId: alphaId, categoryId: catB, amount: -1500,
  approved: false, autoCategorized: true, // simulates a prior auto-categorized/pending import
});
store.setPayeeCategory(alphaId, catA);
assert.equal(store.getPayee(alphaId).lastCategoryId, catA, 'rule reassigned to catA');
let pending = store.state.transactions.find(t => t.id === pendingTx);
assert.equal(pending.categoryId, catA, 'pending txn of that payee immediately re-suggested to the new category');
assert.equal(pending.autoCategorized, true, 'still flagged as a guess, not user-confirmed');

// ---- 3. setPayeeCategory(id, null) clears the rule; it does NOT retroactively strip categories ----
// Decision: clearing only stops FUTURE suggestions. resuggestPending() only overwrites a pending
// txn's category when it finds a NEW suggestion (payee rule or classifier guess); with the rule
// gone and no classifier signal for this payee, it finds none, so the already-applied category
// is left as-is rather than reset to null.
store.setPayeeCategory(alphaId, null);
assert.equal(store.getPayee(alphaId).lastCategoryId, null, 'rule cleared');
assert.equal(store.learnedPayees().some(p => p.id === alphaId), false, 'no longer listed as learned');
pending = store.state.transactions.find(t => t.id === pendingTx);
assert.equal(pending.categoryId, catA, 'clearing the rule leaves the already-applied pending category untouched');

// explicit re-run confirms it stays put (no lingering rule to reapply, no classifier signal to replace it)
store.resuggestPending();
pending = store.state.transactions.find(t => t.id === pendingTx);
assert.equal(pending.categoryId, catA, 'resuggestPending no longer applies the forgotten rule');

console.log('OK — all payee rules checks passed');
