// node test/sweep-check.mjs — asserts the import-sweep engine (pendingGroups/approveGroup/
// categorizeGroup/resuggestPending) against hand-computed expectations.
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
function setup() {
  reset();
  const acc = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-01-01' });
  const acc2 = store.addAccount({ name: 'Other', type: 'checking', balance: 0, date: '2026-01-01' });
  const grp = store.addGroup('Bills');
  const catA = store.addCategory(grp, 'Category A');
  const catB = store.addCategory(grp, 'Category B');
  return { acc, acc2, grp, catA, catB };
}
// addTransaction resolves payee by name -> id via findOrCreatePayee (matches import flow)
function payeeId(name) { return store.findOrCreatePayee(name); }

// ============================================================
// 1. pendingGroups
// ============================================================
{
  const { acc, acc2, catA, catB } = setup();
  const pWoolies = payeeId('Woolworths');
  const pColes = payeeId('Coles');

  // 3 unapproved Woolworths txns (mixed category -> should merge as null/allSameCategory false)
  store.addTransaction({ accountId: acc, date: '2026-01-01', payeeId: pWoolies, categoryId: catA, amount: -1000, approved: false, autoCategorized: true });
  store.addTransaction({ accountId: acc, date: '2026-01-02', payeeId: pWoolies, categoryId: catA, amount: -2000, approved: false, autoCategorized: true });
  store.addTransaction({ accountId: acc, date: '2026-01-03', payeeId: pWoolies, categoryId: catB, amount: -500, approved: false, autoCategorized: false });
  // case/trim-insensitive merge: "  woolworths  " and "WOOLWORTHS" via different payee record would be a different payeeId,
  // but same payee name normalized already handled by findOrCreatePayee (case-insensitive lookup) — verify via literal case variant
  const pWooliesVariant = payeeId('  WOOLWORTHS  ');
  assert.equal(pWooliesVariant, pWoolies, 'findOrCreatePayee normalizes case/trim so same payee id is reused');

  // 2 unapproved Coles txns, same category, both autoCategorized
  store.addTransaction({ accountId: acc, date: '2026-01-04', payeeId: pColes, categoryId: catA, amount: -300, approved: false, autoCategorized: true });
  store.addTransaction({ accountId: acc, date: '2026-01-05', payeeId: pColes, categoryId: catA, amount: -400, approved: false, autoCategorized: true });

  // approved txn from same account/payee — must be excluded
  store.addTransaction({ accountId: acc, date: '2026-01-06', payeeId: pWoolies, categoryId: catA, amount: -999, approved: true });

  // txn from a different account — must be excluded
  store.addTransaction({ accountId: acc2, date: '2026-01-07', payeeId: pWoolies, categoryId: catA, amount: -111, approved: false });

  // no-payee txns — each forms its own group
  const tNoPayee1 = store.addTransaction({ accountId: acc, date: '2026-01-08', payeeId: null, memo: 'ATM', categoryId: catA, amount: -5000, approved: false });
  const tNoPayee2 = store.addTransaction({ accountId: acc, date: '2026-01-09', payeeId: null, memo: 'Cash Withdrawal', categoryId: catA, amount: -6000, approved: false });

  // incoming transfer leg (transferAccountId set AND amount > 0) — excluded
  store.addTransfer({ fromAccountId: acc2, toAccountId: acc, date: '2026-01-10', amount: 15000 });
  // mark the outgoing leg's twin (incoming, on acc) unapproved to test exclusion path;
  // addTransfer sets approved:true by default, so force unapproved to actually hit the pendingGroups filter
  const incomingLeg = store.state.transactions.find(t => t.accountId === acc && t.transferAccountId === acc2 && t.amount > 0);
  store.updateTransaction(incomingLeg.id, { approved: false });

  const groups = store.pendingGroups(acc);

  // incoming transfer leg excluded even though unapproved
  assert.ok(!groups.some(g => g.memberIds.includes(incomingLeg.id)), 'incoming transfer leg excluded from pending groups');

  // approved txn excluded
  assert.ok(!groups.some(g => g.memberIds.some(id => {
    const tx = store.state.transactions.find(t => t.id === id);
    return tx.approved;
  })), 'approved txns excluded entirely');

  // other-account txn excluded
  assert.ok(!groups.some(g => g.memberIds.some(id => store.state.transactions.find(t => t.id === id).accountId !== acc)), 'other-account txns excluded');

  const woolies = groups.find(g => g.payeeName === 'Woolworths');
  assert.ok(woolies, 'Woolworths group exists');
  assert.equal(woolies.count, 3, 'Woolworths group has 3 members (case/trim merged)');
  assert.equal(woolies.totalAmount, -1000 + -2000 + -500, 'Woolworths totalAmount summed');
  assert.equal(woolies.memberIds.length, 3, 'Woolworths memberIds complete');
  assert.equal(woolies.categoryId, null, 'mixed categories -> categoryId null');
  assert.equal(woolies.allSameCategory, false, 'mixed categories -> allSameCategory false');
  assert.equal(woolies.autoCategorized, false, 'not all members autoCategorized -> group autoCategorized false');

  const coles = groups.find(g => g.payeeName === 'Coles');
  assert.ok(coles, 'Coles group exists');
  assert.equal(coles.count, 2, 'Coles group has 2 members');
  assert.equal(coles.categoryId, catA, 'same category -> categoryId set');
  assert.equal(coles.allSameCategory, true, 'same category -> allSameCategory true');
  assert.equal(coles.autoCategorized, true, 'all members autoCategorized -> group autoCategorized true');

  // no-payee txns each form their own group
  const noPayeeGroups = groups.filter(g => g.payeeId == null && g.count === 1);
  assert.ok(noPayeeGroups.some(g => g.memberIds.includes(tNoPayee1)), 'no-payee txn 1 forms its own group');
  assert.ok(noPayeeGroups.some(g => g.memberIds.includes(tNoPayee2)), 'no-payee txn 2 forms its own group');

  // sort order (attention-first tiers): (0) no category/mixed, (1) auto-categorized guess,
  // (2) user-confirmed; within a tier count desc, then payeeName ascending tiebreak.
  // Here: Woolworths (mixed → tier 0, count 3), Coles (AUTO guess → tier 1, count 2), then the
  // two no-payee singletons (user-set category, not auto → tier 2, count 1, name tiebreak).
  const idx = name => groups.findIndex(g => g.payeeName === name);
  const atmIdx = groups.findIndex(g => g.memberIds.includes(tNoPayee1));
  const cashIdx = groups.findIndex(g => g.memberIds.includes(tNoPayee2));
  assert.ok(idx('Woolworths') < idx('Coles'), 'tier 0 (mixed, needs attention) before tier 1 (AUTO guess)');
  assert.ok(idx('Coles') < atmIdx, 'tier 1 (AUTO guess) before tier 2 (user-confirmed) despite lower count');
  assert.ok(atmIdx < cashIdx, 'tie within tier 2 broken by payeeName ascending ("ATM" < "Cash Withdrawal")');

  // ---- cross-account: pendingGroups(null) merges across ALL accounts ----
  const allGroups = store.pendingGroups(null);

  // Woolworths has 3 unapproved members on acc + 1 unapproved member on acc2 (added above as the
  // "different account" exclusion case) — same normalized merchant should merge into one group.
  const wooliesAll = allGroups.find(g => g.payeeName === 'Woolworths');
  assert.ok(wooliesAll, 'cross-account Woolworths group exists');
  assert.equal(wooliesAll.count, 4, 'cross-account Woolworths group merges 3 (acc) + 1 (acc2) members');
  assert.equal(wooliesAll.totalAmount, -1000 + -2000 + -500 + -111, 'cross-account Woolworths totalAmount summed across accounts');
  assert.equal(wooliesAll.memberIds.length, 4, 'cross-account Woolworths memberIds complete');

  // per-account calls still exclude other accounts — behavior for a given accountId is unchanged
  const acc2Groups = store.pendingGroups(acc2);
  assert.ok(!acc2Groups.some(g => g.memberIds.some(id => store.state.transactions.find(t => t.id === id).accountId !== acc2)),
    'pendingGroups(acc2) still excludes acc txns');
  const acc2Woolies = acc2Groups.find(g => g.payeeName === 'Woolworths');
  assert.ok(acc2Woolies && acc2Woolies.count === 1, 'pendingGroups(acc2) sees only its own 1 Woolworths txn, not acc\'s 3');

  // incoming transfer leg still excluded in the null (cross-account) case
  assert.ok(!allGroups.some(g => g.memberIds.includes(incomingLeg.id)),
    'incoming transfer leg excluded from cross-account pendingGroups(null) too');

  console.log('1. pendingGroups: PASS (incl. cross-account accountId=null)');
}

// ============================================================
// 2. approveGroup
// ============================================================
{
  const { acc, catA, catB } = setup();
  const pTarget = payeeId('Target');
  const t1 = store.addTransaction({ accountId: acc, date: '2026-01-01', payeeId: pTarget, categoryId: catA, amount: -1000, approved: false });
  const t2 = store.addTransaction({ accountId: acc, date: '2026-01-02', payeeId: pTarget, categoryId: catA, amount: -2000, approved: false });
  // a transfer leg included in the member list — must NOT teach the payee even though it has payeeId+categoryId
  store.addTransfer({ fromAccountId: acc, toAccountId: store.state.accounts[1].id, date: '2026-01-03', amount: 500 });
  const transferLeg = store.state.transactions.find(t => t.accountId === acc && t.transferAccountId);
  store.updateTransaction(transferLeg.id, { payeeId: pTarget, categoryId: catB, approved: false });

  store.approveGroup([t1, t2, transferLeg.id]);

  assert.ok(store.state.transactions.find(t => t.id === t1).approved, 't1 approved');
  assert.ok(store.state.transactions.find(t => t.id === t2).approved, 't2 approved');
  assert.ok(store.state.transactions.find(t => t.id === transferLeg.id).approved, 'transfer leg approved');
  // teaching: last processed member with payeeId+categoryId+non-transfer wins; t1,t2 both catA -> lastCategoryId = catA
  assert.equal(store.getPayee(pTarget).lastCategoryId, catA, 'payee taught catA from non-transfer members (transfer member did not overwrite)');

  console.log('2. approveGroup: PASS');
}

// ============================================================
// 3. categorizeGroup
// ============================================================
{
  const { acc, catA, catB } = setup();
  const pShop = payeeId('Shop');
  const t1 = store.addTransaction({ accountId: acc, date: '2026-01-01', payeeId: pShop, categoryId: null, amount: -1000, approved: false, autoCategorized: true });
  const t2 = store.addTransaction({ accountId: acc, date: '2026-01-02', payeeId: pShop, categoryId: catA, amount: -2000, approved: false, autoCategorized: true });

  store.categorizeGroup([t1, t2], catB);

  assert.equal(store.state.transactions.find(t => t.id === t1).categoryId, catB, 't1 categoryId set');
  assert.equal(store.state.transactions.find(t => t.id === t2).categoryId, catB, 't2 categoryId set');
  assert.ok(!('autoCategorized' in store.state.transactions.find(t => t.id === t1)), 'autoCategorized flag deleted on t1');
  assert.ok(!('autoCategorized' in store.state.transactions.find(t => t.id === t2)), 'autoCategorized flag deleted on t2');
  // teaches without approval
  assert.ok(!store.state.transactions.find(t => t.id === t1).approved, 'categorizeGroup does not approve');
  assert.equal(store.getPayee(pShop).lastCategoryId, catB, 'payee taught even without approval');

  console.log('3. categorizeGroup: PASS');
}

// ============================================================
// 4. resuggestPending
// ============================================================
{
  const { acc, catA, catB } = setup();
  const pGym = payeeId('Gym Membership Co');

  // approved txn — resuggestPending must never touch it, even if uncategorized
  const approvedTx = store.addTransaction({ accountId: acc, date: '2026-01-01', payeeId: pGym, categoryId: null, amount: -5000, approved: true });

  // unapproved, user-confirmed category (categoryId set, autoCategorized falsy) — must never touch
  const confirmedTx = store.addTransaction({ accountId: acc, date: '2026-01-02', payeeId: pGym, categoryId: catA, amount: -5000, approved: false });

  // unapproved, autoCategorized guess — eligible, should be updated once payee is taught
  const guessTx = store.addTransaction({ accountId: acc, date: '2026-01-03', payeeId: pGym, categoryId: catA, amount: -5000, approved: false, autoCategorized: true });

  // unapproved, uncategorized — eligible
  const uncatTx = store.addTransaction({ accountId: acc, date: '2026-01-04', payeeId: pGym, categoryId: null, amount: -5000, approved: false });

  // teach the payee catB via categorizeGroup on a separate txn from the same payee
  const teachTx = store.addTransaction({ accountId: acc, date: '2026-01-05', payeeId: pGym, categoryId: null, amount: -5000, approved: false });
  store.categorizeGroup([teachTx], catB);
  assert.equal(store.getPayee(pGym).lastCategoryId, catB, 'payee taught catB');

  const before = {
    approved: { ...store.state.transactions.find(t => t.id === approvedTx) },
    confirmed: { ...store.state.transactions.find(t => t.id === confirmedTx) },
  };

  const changed = store.resuggestPending();

  assert.equal(changed, 2, 'resuggestPending reports 2 changed (guessTx + uncatTx; confirmedTx/approvedTx/teachTx untouched)');

  const approvedAfter = store.state.transactions.find(t => t.id === approvedTx);
  assert.deepEqual(approvedAfter, before.approved, 'approved txn completely untouched');

  const confirmedAfter = store.state.transactions.find(t => t.id === confirmedTx);
  assert.deepEqual(confirmedAfter, before.confirmed, 'user-confirmed unapproved txn (categoryId set, not autoCategorized) untouched');

  const guessAfter = store.state.transactions.find(t => t.id === guessTx);
  assert.equal(guessAfter.categoryId, catB, 'autoCategorized guess re-suggested to taught category');
  assert.equal(guessAfter.autoCategorized, true, 'still flagged autoCategorized after resuggest');

  const uncatAfter = store.state.transactions.find(t => t.id === uncatTx);
  assert.equal(uncatAfter.categoryId, catB, 'uncategorized txn assigned taught category');
  assert.equal(uncatAfter.autoCategorized, true, 'newly assigned as autoCategorized');

  // idempotency: running again with nothing eligible left changed for this payee -> 0 further changes from these txns
  const changed2 = store.resuggestPending();
  assert.equal(changed2, 0, 'second resuggestPending run is a no-op (nothing left to change)');

  console.log('4. resuggestPending: PASS');
}

// ============================================================
// 5. seed.js data integrity
// ============================================================
{
  const seed = await import('../js/seed.js');
  const { SETUP_QUESTIONS, PLAN_SUGGESTIONS, COMMON_CATEGORIES } = seed;

  // SETUP_QUESTIONS: each question has id/title/options; option ids unique across all questions
  assert.ok(Array.isArray(SETUP_QUESTIONS) && SETUP_QUESTIONS.length > 0, 'SETUP_QUESTIONS non-empty array');
  const allOptionIds = new Set();
  for (const q of SETUP_QUESTIONS) {
    assert.ok(q.id, `question has id: ${JSON.stringify(q)}`);
    assert.ok(q.title, `question ${q.id} has title`);
    assert.ok(Array.isArray(q.options) && q.options.length > 0, `question ${q.id} has options`);
    for (const opt of q.options) {
      assert.ok(opt.id, `option has id in question ${q.id}`);
      assert.ok(!allOptionIds.has(opt.id), `option id ${opt.id} unique across all questions`);
      allOptionIds.add(opt.id);
    }
  }

  // PLAN_SUGGESTIONS: every `when` valid; every group has >=1 category
  assert.ok(Array.isArray(PLAN_SUGGESTIONS) && PLAN_SUGGESTIONS.length > 0, 'PLAN_SUGGESTIONS non-empty array');
  const validWhen = w => w === 'always' || allOptionIds.has(w) || (Array.isArray(w) && w.length > 0 && w.every(id => allOptionIds.has(id)));
  for (const g of PLAN_SUGGESTIONS) {
    assert.ok(validWhen(g.when), `group "${g.group}" when=${JSON.stringify(g.when)} is valid`);
    assert.ok(Array.isArray(g.categories) && g.categories.length >= 1, `group "${g.group}" has >=1 category`);
    for (const c of g.categories) {
      assert.ok(validWhen(c.when), `category "${c.name}" in group "${g.group}" when=${JSON.stringify(c.when)} is valid`);
    }
  }

  // COMMON_CATEGORIES: non-empty array of non-empty strings, no duplicates
  assert.ok(Array.isArray(COMMON_CATEGORIES) && COMMON_CATEGORIES.length > 0, 'COMMON_CATEGORIES non-empty array');
  for (const c of COMMON_CATEGORIES) assert.ok(typeof c === 'string' && c.trim().length > 0, `COMMON_CATEGORIES entry non-empty string: ${JSON.stringify(c)}`);
  assert.equal(new Set(COMMON_CATEGORIES).size, COMMON_CATEGORIES.length, 'COMMON_CATEGORIES has no duplicates');

  console.log('5. seed.js data integrity: PASS (SETUP_QUESTIONS/PLAN_SUGGESTIONS/COMMON_CATEGORIES all valid)');
  console.log('   NOTE: STARTER_TEMPLATE does not exist in current js/seed.js — grep for "STARTER_TEMPLATE" across js/ returns zero hits.');
  console.log('   git history shows it was introduced in a394477 ("...starter budget") and removed in f0a24cf');
  console.log('   ("Replace starter preset with guided setup wizard in Edit Plan"), superseded by SETUP_QUESTIONS +');
  console.log('   PLAN_SUGGESTIONS + buildSuggestedPlan(). Verified CATEGORY_TEMPLATES (the closest surviving analog,');
  console.log('   shape groups[].categories) instead, since the requested export is gone (dead reference, not dead code).');
  const { CATEGORY_TEMPLATES } = seed;
  assert.ok(Array.isArray(CATEGORY_TEMPLATES) && CATEGORY_TEMPLATES.length > 0, 'CATEGORY_TEMPLATES non-empty');
  for (const t of CATEGORY_TEMPLATES) {
    assert.ok(Array.isArray(t.groups) && t.groups.length > 0, `template "${t.name}" has groups`);
    for (const g of t.groups) assert.ok(Array.isArray(g.categories) && g.categories.length > 0, `template "${t.name}" group "${g.name}" has non-empty categories`);
  }
  console.log('   CATEGORY_TEMPLATES: PASS (non-empty groups[].categories)');
}

console.log('\nAll sweep-check assertions passed.');
