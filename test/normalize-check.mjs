// node test/normalize-check.mjs — merchant-name normalization + attention-first pending sort.
import assert from 'node:assert/strict';

const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { normalizeMerchant } = await import('../js/lib/categorize.js');
const { store } = await import('../js/store.js');

// ---- 1. normalizeMerchant cases ----
assert.equal(normalizeMerchant('WOOLWORTHS 1234 SYDNEY'), 'woolworths', 'digit-anchored token cuts store# + location');
assert.equal(normalizeMerchant('Shell *4821'), 'shell', 'punctuation noise stripped, then digit-cut');
assert.equal(normalizeMerchant('7-Eleven'), '7-eleven', 'hyphenated token is not a standalone digit token, no cut');
assert.equal(normalizeMerchant('Store 22'), 'store', 'standalone 2+ digit token cuts');
assert.equal(normalizeMerchant('1234'), '1234', 'empty-cut safety: cutting everything falls back to cleaned original');
assert.equal(normalizeMerchant('  Woolworths   1234  '), 'woolworths', 'extra whitespace collapsed');

// ---- 2. cross-payee grouping: normalized key, raw display name of first member ----
store.resetAll();
const acc = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
const grp = store.addGroup('Spending');
const cat1 = store.addCategory(grp, 'Custom99'); // deliberately not matching any BUCKETS dictionary regex

const p1234 = store.findOrCreatePayee('Woolworths 1234');
const p5678 = store.findOrCreatePayee('WOOLWORTHS 5678');
store.addTransaction({ accountId: acc, date: '2026-01-05', payeeId: p1234, categoryId: cat1, amount: -1000, approved: false });
store.addTransaction({ accountId: acc, date: '2026-01-06', payeeId: p5678, categoryId: cat1, amount: -2000, approved: false });

let groups = store.pendingGroups(acc);
assert.equal(groups.length, 1, 'two differently-numbered Woolworths stores merge into one pending group');
assert.equal(groups[0].count, 2, 'group count sums both members');
assert.equal(groups[0].totalAmount, -3000, 'group total sums both amounts');
assert.equal(groups[0].payeeName, 'Woolworths 1234', 'displayed name is the raw name of the first member\'s payee');
// payee records themselves are untouched — no renaming/merging
assert.equal(store.getPayee(p1234).name, 'Woolworths 1234');
assert.equal(store.getPayee(p5678).name, 'WOOLWORTHS 5678');

// ---- 3. normalized suggestion fallback via resuggestPending ----
store.resetAll();
const acc2 = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
const grp2 = store.addGroup('Spending');
const cat2 = store.addCategory(grp2, 'Custom99'); // still no dictionary match, isolates the fallback

const taughtPayeeId = store.findOrCreatePayee('Woolworths 1234');
const taughtTxId = store.addTransaction({ accountId: acc2, date: '2026-01-05', payeeId: taughtPayeeId, categoryId: cat2, amount: -1000, approved: false });
store.approveTransaction(taughtTxId); // approval teaches the payee its category
assert.equal(store.getPayee(taughtPayeeId).lastCategoryId, cat2, 'payee taught');

const newPayeeId = store.findOrCreatePayee('Woolworths 9999'); // never taught directly
const pendingTxId = store.addTransaction({ accountId: acc2, date: '2026-01-07', payeeId: newPayeeId, categoryId: null, amount: -1500, approved: false });
const changed = store.resuggestPending();
assert.ok(changed >= 1, 'resuggestPending reports a change');
const pendingTx = store.state.transactions.find(t => t.id === pendingTxId);
assert.equal(pendingTx.categoryId, cat2, 'normalized cross-payee match supplies the category');
assert.equal(pendingTx.autoCategorized, true, 'fallback match is marked as a guess, not user-confirmed');
// the new payee's own record is untouched — teaching stays per-payee
assert.equal(store.getPayee(newPayeeId).lastCategoryId, null, 'resuggest does not teach the payee itself');

// ---- 4. tiered sort: needs-attention, then guesses, then confirmed; count desc, payeeName asc within tier ----
store.resetAll();
const acc3 = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
const grp3 = store.addGroup('Spending');
const cat3 = store.addCategory(grp3, 'Custom99');

const pZed = store.findOrCreatePayee('Zed Uncertain');
store.addTransaction({ accountId: acc3, date: '2026-01-01', payeeId: pZed, categoryId: null, amount: -100, approved: false }); // tier 0: no category

const pBeta = store.findOrCreatePayee('Beta Guess');
store.addTransaction({ accountId: acc3, date: '2026-01-01', payeeId: pBeta, categoryId: cat3, amount: -100, approved: false, autoCategorized: true });
store.addTransaction({ accountId: acc3, date: '2026-01-02', payeeId: pBeta, categoryId: cat3, amount: -100, approved: false, autoCategorized: true }); // tier 1, count 2

const pAlpha = store.findOrCreatePayee('Alpha Guess');
store.addTransaction({ accountId: acc3, date: '2026-01-01', payeeId: pAlpha, categoryId: cat3, amount: -100, approved: false, autoCategorized: true }); // tier 1, count 1

const pYankee = store.findOrCreatePayee('Yankee Confirmed');
store.addTransaction({ accountId: acc3, date: '2026-01-01', payeeId: pYankee, categoryId: cat3, amount: -100, approved: false }); // tier 2: user-confirmed (no autoCategorized flag)

const order = store.pendingGroups(acc3).map(g => g.payeeName);
assert.deepEqual(order, ['Zed Uncertain', 'Beta Guess', 'Alpha Guess', 'Yankee Confirmed'],
  'attention-needed first, then guesses (count desc), then confirmed; payeeName asc breaks ties');

// ---- 5. non-regression: user-confirmed and approved txns untouched ----
store.resetAll();
const acc4 = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
const grp4 = store.addGroup('Spending');
const catA = store.addCategory(grp4, 'A');
const catB = store.addCategory(grp4, 'B');
const pConfirmed = store.findOrCreatePayee('Confirmed Payee');
const confirmedTxId = store.addTransaction({ accountId: acc4, date: '2026-01-01', payeeId: pConfirmed, categoryId: catA, amount: -500, approved: false }); // user-confirmed, no autoCategorized flag
const approvedTxId = store.addTransaction({ accountId: acc4, date: '2026-01-01', payeeId: pConfirmed, categoryId: catB, amount: -700, approved: true });
store.resuggestPending();
assert.equal(store.state.transactions.find(t => t.id === confirmedTxId).categoryId, catA, 'user-confirmed category left alone by resuggestPending');
assert.equal(store.state.transactions.find(t => t.id === approvedTxId).categoryId, catB, 'approved transaction untouched');
const finalGroups = store.pendingGroups(acc4);
assert.equal(finalGroups.length, 1, 'only the still-unapproved confirmed txn shows up; the approved one is excluded');
assert.equal(finalGroups[0].categoryId, catA, 'the pending group keeps the user-confirmed category');

console.log('normalize-check: all assertions passed');
