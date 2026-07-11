// node test/csv-check.mjs — asserts CSV statement parsing against real-world bank formats.
import assert from 'node:assert/strict';

const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { parseCSV, parseMoney, parseDate, parseStatement, buildTxns, cleanPayeeName } = await import('../js/lib/csv.js');
const { store } = await import('../js/store.js');

function statement(text) {
  const { rows, columns, dataStart } = parseStatement(text);
  return buildTxns(rows, columns, { dataStart });
}

// ---- 1. money parsing ----
assert.equal(parseMoney('$1,234.56'), 123456);
assert.equal(parseMoney('-6.90'), -690);
assert.equal(parseMoney('(12.50)'), -1250);
assert.equal(parseMoney('12.50 DR'), -1250);
assert.equal(parseMoney('12.50 CR'), 1250);
assert.equal(parseMoney('45.00-'), -4500);
assert.equal(parseMoney('1.234,56'), 123456, 'European decimal comma');
assert.equal(parseMoney('1,234'), 123400, 'lone comma with 3 trailing digits = thousands');
assert.equal(parseMoney('12,5'), 1250, 'lone comma with non-3 trailing = decimal');
assert.equal(parseMoney('AUD 5.00'), 500);
assert.equal(parseMoney(''), null);
assert.equal(parseMoney('N/A'), null);

// ---- 2. date parsing ----
assert.equal(parseDate('2026-01-31'), '2026-01-31');
assert.equal(parseDate('31/01/2026'), '2026-01-31');
assert.equal(parseDate('01/31/2026'), '2026-01-31', 'day>12 disambiguates');
assert.equal(parseDate('31-01-26'), '2026-01-31');
assert.equal(parseDate('12 Jan 2026'), '2026-01-12');
assert.equal(parseDate('Jan 12, 2026'), '2026-01-12');
assert.equal(parseDate('20260131'), '2026-01-31');
assert.equal(parseDate('05/06/2026', true), '2026-06-05', 'ambiguous day-first');
assert.equal(parseDate('05/06/2026', false), '2026-05-06', 'ambiguous month-first');
assert.equal(parseDate('garbage'), null);

// ---- 3. CBA-style: headerless, amount + balance columns ----
const cba = statement(
`31/12/2025,"-6.90","WOOLWORTHS 1234 SYDNEY NS","+1,234.56"
30/12/2025,"+500.00","Salary Deposit ACME PTY LTD","+1,241.46"
29/12/2025,"-45.20","BP FUEL STATION","+741.46"`);
assert.equal(cba.txns.length, 3);
assert.deepEqual(cba.txns[0], { date: '2025-12-31', amount: -690, payeeName: 'Woolworths', memo: '', importId: 'csv:-690:2025-12-31:1' });
assert.equal(cba.txns[1].amount, 50000, 'balance column not mistaken for amount');

// ---- 4. header + debit/credit columns (Westpac-style), preamble junk ----
const wbc = statement(
`Westpac Banking Corporation
Account: 123-456 My Everyday

Date,Narrative,Debit Amount,Credit Amount,Balance
15/06/2026,EFTPOS COLES 0842,54.30,,1200.00
16/06/2026,PAYROLL ACME,,2500.00,3700.00
17/06/2026,ATM WITHDRAWAL,100.00,,3600.00
,TOTALS,154.30,2500.00,`);
assert.equal(wbc.txns.length, 3, 'preamble and totals rows skipped');
assert.equal(wbc.skipped, 1);
assert.equal(wbc.txns[0].amount, -5430, 'debit is an outflow');
assert.equal(wbc.txns[1].amount, 250000, 'credit is an inflow');
assert.equal(wbc.txns[0].payeeName, 'Coles', 'rail prefix and store number stripped');

// ---- 5. semicolon delimiter + comma decimals + non-English headers (content fallback) ----
const eu = statement(
`Datum;Beschreibung;Betrag
15.06.2026;REWE MARKT GMBH;-23,45
16.06.2026;GEHALT JUNI;1.900,00`);
assert.equal(eu.txns.length, 2);
assert.equal(eu.txns[0].amount, -2345);
assert.equal(eu.txns[1].amount, 190000);
assert.equal(eu.txns[0].payeeName, 'Rewe Markt');

// ---- 6. quoted fields with embedded commas and newlines, CRLF ----
const quoted = statement(
'Date,Description,Amount\r\n' +
'01/07/2026,"SMITH, JONES & CO","-1,050.00"\r\n' +
'02/07/2026,"LINE ONE\nLINE TWO",25.00\r\n');
assert.equal(quoted.txns.length, 2);
assert.equal(quoted.txns[0].payeeName, 'Smith Jones', 'trailing "& CO" trimmed');
assert.equal(quoted.txns[0].amount, -105000);
assert.equal(quoted.txns[1].payeeName, 'Line One Line Two');

// ---- 7. US month-first dates (day>12 anywhere in column decides for the whole file) ----
const us = statement(
`Date,Description,Amount
06/05/2026,COFFEE SHOP,-4.50
12/31/2026,BOOKSTORE,-20.00`);
assert.equal(us.txns[0].date, '2026-06-05', 'whole column resolved as MDY');
assert.equal(us.txns[1].date, '2026-12-31');

// ---- 8. memo column + duplicate rows get distinct importIds ----
const memo = statement(
`Date,Payee,Amount,Reference
01/07/2026,UBER TRIP,-15.00,Ref 111
01/07/2026,UBER TRIP,-15.00,Ref 222`);
assert.equal(memo.txns[0].memo, 'Ref 111');
assert.notEqual(memo.txns[0].importId, memo.txns[1].importId, 'same amount+date rows stay distinct');

// ---- 9. flip signs for statements that show spending as positive ----
const flipped = (() => {
  const { rows, columns, dataStart } = parseStatement(`Date,Description,Amount\n01/07/2026,SHOP,4.50`);
  return buildTxns(rows, columns, { dataStart, flip: true });
})();
assert.equal(flipped.txns[0].amount, -450);

// ---- 10. store round-trip: import, re-import dedupes, manual tx matches ----
store.resetAll();
const acc = store.addAccount({ name: 'Checking', type: 'checking', balance: 0, date: '2026-06-01' });
store.addTransaction({ accountId: acc, date: '2026-06-15', amount: -5430 }); // manual entry the bank feed should match
const r1 = store.importTransactions(acc, wbc.txns);
assert.deepEqual({ inserted: r1.inserted, merged: r1.merged, skipped: r1.skipped }, { inserted: 2, merged: 1, skipped: 0 });
const r2 = store.importTransactions(acc, wbc.txns);
assert.deepEqual({ inserted: r2.inserted, merged: r2.merged, skipped: r2.skipped }, { inserted: 0, merged: 0, skipped: 3 }, 're-import is a no-op');
const imported = store.state.transactions.find(t => t.importId === wbc.txns[1].importId);
assert.equal(imported.amount, 250000);
assert.equal(store.state.payees.some(p => p.name === 'Payroll Acme'), true, 'payee auto-created with cleaned name');

// ---- 11. tab-delimited ----
const tabs = statement('Date\tDescription\tAmount\n01/07/2026\tSHOP\t-4.50');
assert.equal(tabs.txns[0].amount, -450);

// ---- 12. BOM + garbage-only file doesn't throw ----
assert.equal(statement('﻿Date,Description,Amount\n01/07/2026,SHOP,-1.00').txns[0].amount, -100);
assert.deepEqual(statement('hello\nworld').txns, []);

// ---- 13. payee cleanup rules ----
assert.equal(cleanPayeeName('WOOLWORTHS 1234 SYDNEY NS AUS Card xx1234'), 'Woolworths');
assert.equal(cleanPayeeName('UBER *TRIP HELP.UBER.COM'), 'Uber Trip');
assert.equal(cleanPayeeName('SQ *BLUE BOTTLE COFFEE'), 'Blue Bottle Coffee');
assert.equal(cleanPayeeName('PAYPAL *STEAM GAMES 4029357733'), 'Steam Games');
assert.equal(cleanPayeeName('DIRECT DEBIT NETFLIX.COM 123456789'), 'Netflix');
assert.equal(cleanPayeeName('EFTPOS PURCHASE ALDI 42 KOGARAH'), 'Aldi');
assert.equal(cleanPayeeName('VISA PURCHASE - COLES 0842 KOGARAH NSW'), 'Coles');
assert.equal(cleanPayeeName('BP FUEL STATION KOGARAH'), 'BP Fuel Station Kogarah', 'short all-caps words like BP survive');
assert.equal(cleanPayeeName('ANZ ATM WITHDRAWAL FEE'), 'ANZ ATM Withdrawal Fee');
assert.equal(cleanPayeeName('TRANSFER TO SAVINGS ACCOUNT'), 'Savings Account');
assert.equal(cleanPayeeName('MCDONALDS 0423 CARD 4321'), 'Mcdonalds');
assert.equal(cleanPayeeName('AMAZON AU MARKETPLACE AMZN.COM.AU'), 'Amazon AU Marketplace', 'domain dropped next to real name');
assert.equal(cleanPayeeName('NETFLIX.COM'), 'Netflix', 'lone domain keeps merchant label');
assert.equal(cleanPayeeName('Salary Deposit ACME PTY LTD'), 'Salary Deposit ACME', 'mixed case not re-cased, PTY LTD trimmed');
assert.equal(cleanPayeeName('7-ELEVEN 2196 SYDNEY'), '7-Eleven', 'digits inside name tokens survive');
assert.equal(cleanPayeeName('GOOGLE *YouTubePremium g.co/helppay#'), 'YouTubePremium');
assert.equal(cleanPayeeName('xx1234 5678'), 'xx1234 5678', 'falls back to raw when cleaning empties it');
assert.equal(cleanPayeeName(''), '');
// end-to-end: statement descriptions arrive cleaned
const cleaned = statement(
`Date,Description,Amount
05/07/2026,"WOOLWORTHS 1234 SYDNEY NS AUS Card xx1234",-87.50
06/07/2026,UBER *TRIP HELP.UBER.COM,-15.00`);
assert.equal(cleaned.txns[0].payeeName, 'Woolworths');
assert.equal(cleaned.txns[1].payeeName, 'Uber Trip');

// ---- 14. real NetBank shape: noisy descriptions must not classify as a money column ----
// regression: "Card xx1234 AUD 11.95 Value Date: 04/07/2026" once parsed as money, so the
// description column was never mapped and every payee came through empty
// (rows are fictional but mirror the CBA NetBank export structure exactly)
const netbank = statement(
`07/07/2026,"-11.95","WIDGETCO ST LOUISVILLE KY USA Card xx1234 AUD 11.95 Value Date: 04/07/2026","+265.01"
07/07/2026,"-9.75","MCDONALDS SEAVIEW SEAVIEW WA AUS Card xx1234 Value Date: 03/07/2026","+276.96"
07/07/2026,"-24.35","DD *DOORDASH NOODLEHUT MELBOURNE VI AUS Card xx1234 Value Date: 04/07/2026","+311.06"
07/07/2026,"-1.11","International Transaction Fee Value Date: 04/07/2026","+355.07"`);
assert.equal(netbank.txns.length, 4);
assert.equal(netbank.txns.filter(t => t.payeeName).length, 4, 'every row keeps a payee');
assert.equal(netbank.txns[1].payeeName, 'Mcdonalds Seaview', 'suburb not repeated');
assert.equal(netbank.txns[2].payeeName, 'Doordash Noodlehut Melbourne');
assert.equal(netbank.txns[3].payeeName, 'International Transaction Fee');
assert.equal(netbank.txns[0].amount, -1195, 'amount column still the real one, not balance');
assert.equal(netbank.txns[0].date, '2026-07-04', 'embedded Value Date beats the settlement date');
assert.equal(netbank.txns[1].date, '2026-07-03');
assert.equal(netbank.txns[3].date, '2026-07-04', 'fee row uses its Value Date too');

// ---- 15. earliest-date rule across shapes ----
// separate Value Date column (whatever it's called) is picked up by the row scan
const vdcol = statement(
`Date,Value Date,Description,Amount
07/07/2026,04/07/2026,SHOP A,-10.00
08/07/2026,08/07/2026,SHOP B,-20.00`);
assert.equal(vdcol.txns[0].date, '2026-07-04', 'value-date column wins when earlier');
assert.equal(vdcol.txns[1].date, '2026-07-08', 'same date is fine');
// unrelated old dates in the text must not yank the transaction into the past
const oldref = statement(
`Date,Description,Amount
07/07/2026,"INVOICE 01/01/2020 ACME UTILITIES",-50.00
07/07/2026,"FLIGHT QF404 DEPARTING 12/08/2026 QANTAS",-500.00`);
assert.equal(oldref.txns[0].date, '2026-07-07', 'date older than a month before settlement ignored');
assert.equal(oldref.txns[1].date, '2026-07-07', 'future date ignored');

console.log('csv-check: all assertions passed');
