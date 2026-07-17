// node test/fastpath-check.mjs — store-level checks for the pending-review "Approve all" +
// undo-after-approve features (register.js UI is verified by reading the rendered templates).
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

// mirrors register.js's approveAllEligible(): categoryId set (not null/mixed) — INFLOW counts.
const eligibleOf = groups => groups.filter(g => g.categoryId != null);
// mirrors register.js's captureApproveSnapshot(): payees touched by these tx ids, with their prior lastCategoryId
function captureSnapshot(memberIds) {
  const payeeIds = new Set();
  for (const id of memberIds) {
    const tx = store.state.transactions.find(t => t.id === id);
    if (tx?.payeeId) payeeIds.add(tx.payeeId);
  }
  return {
    memberIds: memberIds.slice(),
    payees: [...payeeIds].map(id => ({ id, lastCategoryId: store.getPayee(id)?.lastCategoryId ?? null })),
  };
}

// ---- 1. approve-all-eligible selection: categorized groups approve, uncategorized/mixed stay pending ----
reset();
const acc = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const grp = store.addGroup('Bills');
const rent = store.addCategory(grp, 'Rent');
const power = store.addCategory(grp, 'Power');

const rentPayee = store.findOrCreatePayee('Landlord');
const rent1 = store.addTransaction({ accountId: acc, date: '2026-01-05', payeeId: rentPayee, categoryId: rent, amount: -1000, approved: false });
const rent2 = store.addTransaction({ accountId: acc, date: '2026-01-06', payeeId: rentPayee, categoryId: rent, amount: -1000, approved: false });

const inflowPayee = store.findOrCreatePayee('Employer');
const inflowTx = store.addTransaction({ accountId: acc, date: '2026-01-07', payeeId: inflowPayee, categoryId: INFLOW, amount: 5000, approved: false });

const uncatPayee = store.findOrCreatePayee('Mystery Shop');
const uncatTx = store.addTransaction({ accountId: acc, date: '2026-01-08', payeeId: uncatPayee, categoryId: null, amount: -500, approved: false });

const mixedPayee = store.findOrCreatePayee('Corner Store');
const mixed1 = store.addTransaction({ accountId: acc, date: '2026-01-09', payeeId: mixedPayee, categoryId: rent, amount: -300, approved: false });
const mixed2 = store.addTransaction({ accountId: acc, date: '2026-01-10', payeeId: mixedPayee, categoryId: power, amount: -300, approved: false });

const groups = store.pendingGroups(acc);
assert.equal(groups.length, 4, 'four merchant groups pending');
const eligible = eligibleOf(groups);
assert.equal(eligible.length, 2, 'rent group + inflow group are eligible (mixed and uncategorized are not)');
assert.ok(eligible.some(g => g.categoryId === rent), 'rent group eligible');
assert.ok(eligible.some(g => g.categoryId === INFLOW), 'INFLOW-categorized group counts as eligible');
assert.ok(!eligible.some(g => g.memberIds.includes(uncatTx)), 'uncategorized group excluded');
assert.ok(!eligible.some(g => g.memberIds.includes(mixed1)), 'mixed-category group excluded');

const eligibleIds = eligible.flatMap(g => g.memberIds);
store.approveGroup(eligibleIds);
const byId = id => store.state.transactions.find(t => t.id === id);
assert.ok(byId(rent1).approved && byId(rent2).approved, 'rent group approved');
assert.ok(byId(inflowTx).approved, 'inflow group approved');
assert.ok(!byId(uncatTx).approved, 'uncategorized group left untouched');
assert.ok(!byId(mixed1).approved && !byId(mixed2).approved, 'mixed group left untouched');
assert.equal(store.pendingGroups(acc).length, 2, 'two groups remain pending (uncategorized + mixed)');

// ---- 2. undoApprove restores approved flags + payee lastCategoryId exactly ----
reset();
const acc2 = store.addAccount({ name: 'Chk', type: 'checking', balance: 0, date: '2026-01-01' });
const grp2 = store.addGroup('Bills');
const catA = store.addCategory(grp2, 'A');
const catB = store.addCategory(grp2, 'B');

// payee was previously taught catA (e.g. from an earlier approve); this new import guesses catB
const payee = store.findOrCreatePayee('Gym');
store.rememberPayeeContext(payee, catA);
assert.equal(store.getPayee(payee).lastCategoryId, catA, 'payee starts taught catA');

const txA = store.addTransaction({ accountId: acc2, date: '2026-01-05', payeeId: payee, categoryId: catB, amount: -4000, approved: false });
const txB = store.addTransaction({ accountId: acc2, date: '2026-01-06', payeeId: payee, categoryId: catB, amount: -4000, approved: false });

const snapshot = captureSnapshot([txA, txB]);
assert.deepEqual(snapshot.payees, [{ id: payee, lastCategoryId: catA }], 'snapshot captured pre-approve payee category');

store.approveGroup([txA, txB]);
assert.ok(byId(txA).approved && byId(txB).approved, 'both approved');
assert.equal(store.getPayee(payee).lastCategoryId, catB, 'approving re-taught the payee to catB');

store.undoApprove(snapshot);
assert.ok(!byId(txA).approved && !byId(txB).approved, 'undo restores approved=false on exactly the snapshotted ids');
assert.equal(store.getPayee(payee).lastCategoryId, catA, 'undo restores the payee lastCategoryId exactly');

console.log('OK — all fastpath checks passed');
