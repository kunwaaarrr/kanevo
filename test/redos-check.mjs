// node test/redos-check.mjs — asserts untrusted CSV/payee input can't cause super-linear hangs.
// The TLD regex in cleanPayeeName is quadratic (unanchored greedy label + trailing $); before
// the input cap it took 17.5s on a 100KB single-token cell. These bound the worst cases.
import assert from 'node:assert/strict';

const { parseCSV, cleanPayeeName } = await import('../js/lib/csv.js');
const { suggestCategory } = await import('../js/lib/categorize.js');

function elapsed(fn) {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

// worst case for the quadratic TLD test: many word chars, a dot, no valid TLD, no spaces
const evilPayee = 'a'.repeat(200_000) + '.';
const msPayee = elapsed(() => cleanPayeeName(evilPayee));
assert.ok(msPayee < 200, `cleanPayeeName slow on pathological cell: ${msPayee.toFixed(1)}ms`);

// oversized whole-file paste must be truncated, not walked in full
const huge = 'date,desc,amount\n' + ('x'.repeat(1000) + ',y,1.00\n').repeat(60_000); // ~60MB
const msParse = elapsed(() => parseCSV(huge));
assert.ok(msParse < 2000, `parseCSV slow on oversized input: ${msParse.toFixed(1)}ms`);

// suggestCategory: memo is untrusted; a few BUCKETS patterns are O(n^2) over it
const evilMemo = 'city of '.repeat(60_000); // ~480KB
const state = { categories: [{ id: 'c1', name: 'Transport' }] };
const msMemo = elapsed(() => suggestCategory(state, 'shop', -500, null, evilMemo));
assert.ok(msMemo < 200, `suggestCategory slow on pathological memo: ${msMemo.toFixed(1)}ms`);

// cap doesn't corrupt normal payees
assert.equal(cleanPayeeName('DIRECT DEBIT NETFLIX.COM 123456'), 'Netflix');
assert.equal(cleanPayeeName('UBER *TRIP HELP.UBER.COM'), 'Uber Trip');

console.log(`redos-check passed (payee ${msPayee.toFixed(1)}ms, parse ${msParse.toFixed(1)}ms, memo ${msMemo.toFixed(1)}ms)`);
