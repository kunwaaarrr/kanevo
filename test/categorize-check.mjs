// node test/categorize-check.mjs — asserts auto-categorization tiers against a realistic budget.
import assert from 'node:assert/strict';

const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { suggestCategory, trainClassifier, classify } = await import('../js/lib/categorize.js');
const { store } = await import('../js/store.js');

store.resetAll();
const acc = store.addAccount({ name: 'Checking', type: 'checking', balance: 100000, date: '2026-06-01' });
const grp = store.addGroup('Spending');
const groceries = store.addCategory(grp, 'Groceries');
const dining = store.addCategory(grp, 'Dining Out');
const fuel = store.addCategory(grp, 'Fuel');
const subs = store.addCategory(grp, 'Subscriptions');
const junk = store.addCategory(grp, 'Junk Food');

// ---- 1. dictionary tier: brand-new payees, zero history ----
const s = store.state;
assert.equal(suggestCategory(s, 'KFC Seaview', -975, null), dining, 'KFC -> Dining Out');
assert.equal(suggestCategory(s, 'Woolworths Northbrook', -8750, null), groceries, 'Woolies -> Groceries');
assert.equal(suggestCategory(s, 'BP Lakeside', -7200, null), fuel, 'BP -> Fuel');
assert.equal(suggestCategory(s, 'Cloudify Pro Subscr', -3185, null), subs, 'subscr keyword -> Subscriptions');
assert.equal(suggestCategory(s, 'Caltex Hillcrest', -5000, null), fuel);
assert.equal(suggestCategory(s, 'Doordash Noodlehut Melbourne', -2435, null), dining);
assert.equal(suggestCategory(s, 'Some Unknown Merchant', -1000, null), null, 'unknown stays unassigned');
assert.equal(suggestCategory(s, 'KFC Seaview', 975, null), null, 'inflows never auto-assigned');
assert.equal(suggestCategory(s, 'Hoyts Westfield', -2400, null), null, 'no matching category name -> no guess');

// ---- 2. learned tier: user's own habits beat the dictionary ----
// user files every HJs store under Junk Food; a NEW HJs location should follow
for (let i = 0; i < 6; i++) {
  store.addTransaction({ accountId: acc, date: `2026-06-${10 + i}`, payeeId: store.findOrCreatePayee(`HJs Store${i}`), categoryId: junk, amount: -900 - i });
  store.addTransaction({ accountId: acc, date: `2026-06-${10 + i}`, payeeId: store.findOrCreatePayee(`Coles Store${i}`), categoryId: groceries, amount: -4000 - i });
}
const model = trainClassifier(store.state);
assert.equal(classify(model, 'HJs Riverbend'), junk, 'new HJs location follows user habit');
assert.equal(classify(model, 'Coles Maddington'), groceries);
assert.equal(classify(model, 'Store3'), null, 'ambiguous token (seen in both cats) -> no guess');
assert.equal(suggestCategory(store.state, 'HJs Riverbend', -800, model), junk, 'learned tier wins');

// ---- 3. end-to-end import: history -> learned -> dictionary -> unassigned ----
const res = store.importTransactions(acc, [
  { date: '2026-07-01', amount: -1050, payeeName: 'HJs Lakeside', importId: 'i1' },      // learned
  { date: '2026-07-01', amount: -8823, payeeName: 'Aldi Brookdale', importId: 'i2' },   // dictionary
  { date: '2026-07-02', amount: -1200, payeeName: 'Mystery Shop 42', importId: 'i3' },     // neither
]);
assert.equal(res.inserted, 3);
const byImport = id => store.state.transactions.find(t => t.importId === id);
assert.equal(byImport('i1').categoryId, junk);
assert.equal(byImport('i2').categoryId, groceries);
assert.equal(byImport('i3').categoryId, null);
assert.equal(byImport('i1').approved, false, 'auto-categorized rows still need approval');

// ---- 4. exact payee history (lastCategoryId) outranks everything ----
// the user recategorized Aldi into Junk Food once (the register UI calls
// updateTransaction + rememberPayeeContext together); next import must respect that
const aldi = store.state.payees.find(p => p.name === 'Aldi Brookdale');
store.updateTransaction(byImport('i2').id, { categoryId: junk });
store.rememberPayeeContext(aldi.id, junk);
assert.equal(store.state.payees.find(p => p.id === aldi.id).lastCategoryId, junk);
const res2 = store.importTransactions(acc, [{ date: '2026-07-09', amount: -5000, payeeName: 'Aldi Brookdale', importId: 'i4' }]);
assert.equal(res2.inserted, 1);
assert.equal(byImport('i4').categoryId, junk, 'exact payee history wins');

// ---- 5. hidden / credit-card-payment categories are never suggested ----
store.updateCategory(dining, { hidden: true });
assert.equal(suggestCategory(store.state, 'KFC Seaview', -975, null), null, 'hidden category not suggested');

console.log('categorize-check: all assertions passed');
