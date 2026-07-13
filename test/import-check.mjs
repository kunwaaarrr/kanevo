// node test/import-check.mjs — asserts sanitizeImport hardens the backup trust boundary.
import assert from 'node:assert/strict';

// localStorage shim BEFORE importing the store
const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { store } = await import('../js/store.js');
const S = store.sanitizeImport;
const KEYS = ['version', 'settings', 'accounts', 'categoryGroups', 'categories', 'budget', 'transactions', 'scheduled', 'payees', 'focusedViews'];

// (a) valid backup round-trips and keeps all keys
const good = store.exportJSON();
const restored = S(good);
for (const k of KEYS) assert.ok(k in restored, `restored keeps ${k}`);

// custom valid backup: values survive, unknown top-level keys dropped, moveLog preserved
const custom = S(JSON.stringify({
  version: 2, accounts: [{ id: 'a1' }], budget: { '2026-01': { c1: 500 } },
  moveLog: [{ type: 'assign' }], junkKey: 'nope',
}));
assert.equal(custom.version, 2);
assert.deepEqual(custom.accounts, [{ id: 'a1' }]);
assert.deepEqual(custom.moveLog, [{ type: 'assign' }]);
assert.ok(!('junkKey' in custom), 'unknown top-level key dropped');

// (b) __proto__ does not pollute and does not appear in state
const poll = S('{"__proto__":{"polluted":1}}');
assert.equal(({}).polluted, undefined, 'Object.prototype not polluted');
assert.equal(Object.getPrototypeOf(poll), Object.prototype, 'result is a plain object');
assert.ok(!Object.keys(poll.settings).includes('polluted'), 'no leaked key');
// nested danger keys stripped too
const nested = S(JSON.stringify({ settings: { __proto__: { x: 1 }, currencySymbol: '€' } }));
assert.equal(nested.settings.currencySymbol, '€');
assert.ok(!Object.prototype.hasOwnProperty.call(nested.settings, '__proto__') || Object.getPrototypeOf(nested.settings) === Object.prototype);

// (c) garbage string throws
assert.throws(() => S('not json at all {{{'), /valid backup/);

// (d) array input throws (chose: reject non-objects)
assert.throws(() => S('[]'), /valid backup/);
assert.throws(() => S('null'), /valid backup/);
assert.throws(() => S('42'), /valid backup/);

// (e) object missing accounts comes back with accounts: []
const missing = S(JSON.stringify({ version: 1, settings: {} }));
assert.deepEqual(missing.accounts, [], 'missing accounts defaults to []');
for (const k of KEYS) assert.ok(k in missing, `normalized has ${k}`);

// wrong-typed fields fall back to emptyState defaults
const wrong = S(JSON.stringify({ accounts: 'oops', settings: 'oops', version: 'oops' }));
assert.deepEqual(wrong.accounts, []);
assert.deepEqual(wrong.settings, { budgetName: 'My Budget', currencySymbol: '$', hideAmounts: false });
assert.equal(wrong.version, 1);

console.log('import-check: all assertions passed');
