// node test/categorize-check.mjs — asserts auto-categorization tiers against a realistic budget.
import assert from 'node:assert/strict';

const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { suggestCategory, trainClassifier, classify, dist1 } = await import('../js/lib/categorize.js');
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
// (Junk Food also matches the dining bucket's /food/ name pattern, so hide both)
store.updateCategory(dining, { hidden: true });
store.updateCategory(junk, { hidden: true });
assert.equal(suggestCategory(store.state, 'KFC Seaview', -975, null), null, 'hidden categories not suggested');
store.updateCategory(dining, { hidden: false });
store.updateCategory(junk, { hidden: false });

// ---- 6. memo words drive categorization ----
const st = store.state;
assert.equal(suggestCategory(st, 'Transfer To Jess Smith', -2000, null, 'food drink'), dining, 'memo word "food" -> Dining Out');
assert.equal(suggestCategory(st, 'Random Person', -4500, null, 'fuel money'), fuel, 'memo word "fuel" -> Fuel');
assert.equal(suggestCategory(st, 'Random Person', -4500, null, ''), null, 'no signal without memo');

// ---- 7. generic word vocabulary + new buckets ----
const personal = store.addCategory(grp, 'Personal Care');
const ent = store.addCategory(grp, 'Entertainment');
const payback = store.addCategory(grp, 'Paybacks');
assert.equal(suggestCategory(st, 'Luxe Studio', -6500, null, 'nails'), personal, '"nails" -> Personal Care');
assert.equal(suggestCategory(st, 'Some Venue', -3000, null, 'tickets'), ent, '"tickets" -> Entertainment');
assert.equal(suggestCategory(st, 'Glamour Bar Willagee', -4000, null, 'haircut and beard trim'), personal);

// ---- 8. typo tolerance: plural-s and 1-letter typos ----
assert.equal(suggestCategory(st, 'A Friend', -2500, null, 'foods'), dining, 'plural survives');
assert.equal(suggestCategory(st, 'A Friend', -2500, null, 'tiket'), ent, 'missing letter survives');
assert.equal(suggestCategory(st, 'A Friend', -2500, null, 'grocceries'), groceries, 'doubled letter survives');
assert.equal(suggestCategory(st, 'A Friend', -2500, null, 'fod'), null, 'short words need exact match');
assert.equal(suggestCategory(st, 'A Friend', -2500, null, 'stickets'), ent, 'stray leading letter survives');
assert.equal(suggestCategory(st, 'Beach Foodies Victoria Park', -1500, null, ''), null, 'foodie must not fuzzy-match hoodie');
assert.equal(dist1('nails', 'nailz'), true);
assert.equal(dist1('nails', 'snail'), false, 'two edits away');

// ---- 9. payback words: the one inflow case, only into a matching category ----
assert.equal(suggestCategory(st, 'Jess Smith', 2500, null, 'payback for dinner'), payback, 'inflow + payback word -> Paybacks');
assert.equal(suggestCategory(st, 'Jess Smith', 2500, null, 'thanks!'), null, 'other inflows untouched');
store.updateCategory(payback, { hidden: true });
assert.equal(suggestCategory(st, 'Jess Smith', 2500, null, 'payback'), null, 'no Paybacks category -> no guess');
store.updateCategory(payback, { hidden: false });

// ---- 10. approval teaches: approve = confirm payee category ----
const res3 = store.importTransactions(acc, [{ date: '2026-07-10', amount: -1800, payeeName: 'Caltex Hillcrest', memo: '', importId: 'i5' }]);
assert.equal(res3.inserted, 1);
const tx5 = byImport('i5');
assert.equal(tx5.categoryId, fuel, 'dictionary suggested Fuel');
assert.equal(tx5.autoCategorized, true, 'marked as auto');
assert.equal(store.state.payees.find(p => p.name === 'Caltex Hillcrest').lastCategoryId ?? null, null, 'not learned before approval');
store.approveTransaction(tx5.id);
assert.equal(store.state.payees.find(p => p.name === 'Caltex Hillcrest').lastCategoryId, fuel, 'approval locked it in');

// ---- 11. manual category edit clears the auto flag ----
const res4 = store.importTransactions(acc, [{ date: '2026-07-11', amount: -900, payeeName: 'KFC Seaview', memo: '', importId: 'i6' }]);
assert.equal(res4.inserted, 1);
assert.equal(byImport('i6').autoCategorized, true);
store.updateTransaction(byImport('i6').id, { categoryId: junk });
assert.equal(byImport('i6').autoCategorized, undefined, 'user-chosen category is no longer a guess');

// ---- 12. learner reads memos too ----
store.resetAll();
const acc2 = store.addAccount({ name: 'C2', type: 'checking', balance: 0, date: '2026-06-01' });
const grp2 = store.addGroup('G');
const outings = store.addCategory(grp2, 'Outings');
const other = store.addCategory(grp2, 'Other');
for (let i = 0; i < 6; i++) {
  store.addTransaction({ accountId: acc2, date: `2026-06-${10 + i}`, payeeId: store.findOrCreatePayee(`Friend${i}`), categoryId: outings, amount: -1000 - i, memo: 'bowling night' });
  store.addTransaction({ accountId: acc2, date: `2026-06-${10 + i}`, payeeId: store.findOrCreatePayee(`Shop${i}`), categoryId: other, amount: -2000 - i, memo: 'stuff' });
}
const model2 = trainClassifier(store.state);
assert.equal(classify(model2, 'NewMate bowling'), outings, 'memo tokens were trained on');

console.log('categorize-check: all assertions passed');
