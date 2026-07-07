# Feature Spec — 50/30/20 view & Forecast ("what-if") view

Both features are read-mostly layers over the existing store (SPEC.md). Money = integer cents,
months = "YYYY-MM". Pure logic lives in `js/lib/` so Node can test it without a DOM.

## Shared: category budget classes

Every non-hidden, non-CC-payment category gets a class: `'need' | 'want' | 'savings'`
(savings bucket = savings + debt repayment, per the 50/30/20 rule).

- Persisted on the category object as `budgetClass` via the existing `store.updateCategory(id, {budgetClass})`.
- When unset, `defaultClass(category, group)` in `js/lib/fifty.js` infers it:
  - group name matches /credit card|payment/i → 'need' (NerdWallet: MINIMUM debt payments are needs;
    only extra paydown is the savings bucket — users reclassify a dedicated "extra payments" category)
  - category has a SAVINGS_BALANCE target, or name matches /saving|holiday|emergency|invest/i → 'savings'
  - group matches /immediate|obligation|bill|need|true expense/i → 'need'
  - group matches /quality|fun|want/i → 'want'
  - fallback → 'want'
- Split percentages are adjustable in the view (default 50/30/20; preset 60/30/10; custom, must sum
  to 100). `fiftyThirtyTwenty` takes an optional `split = {need:50, want:30, savings:20}` argument;
  savings gets the rounding remainder.
- Loan payments ride inside whatever category their transfers are categorized to (e.g. Rent/Mortgage);
  classification is per category, no special-casing.

## js/lib/fifty.js (pure; imports nothing from the DOM)

```js
export function defaultClass(cat, group)                     // → 'need'|'want'|'savings'
export function classOf(cat, groupsById)                     // budgetClass ?? defaultClass
export function fiftyThirtyTwenty(state, month, split = { need: 50, want: 30, savings: 20 }) → {
  month,
  income,                       // INFLOW-categorized inflows to on-budget accounts in `month`
  incomeAvg3,                   // trailing 3 full months average (stability option for the UI)
  targets: { need, want, savings },        // 50/30/20 of income (integer cents, savings gets the rounding remainder)
  actuals: { need, want, savings },        // Σ -outflow activity of categories per class (on-budget, month)
  unallocated,                  // income − total outflows (positive leftover; counts toward savings in the "effective" line)
  effectiveSavings,             // actuals.savings + max(0, unallocated)
  pct: { need, want, savings }, // actual share of income, 0–100 (null when income = 0)
  rows: [{ id, name, groupName, cls, amount }],  // per-category month outflows for the class manager
}
```

Rounding: targets.need = round(income*.5), want = round(income*.3), savings = income − need − want.

## js/lib/forecast.js (pure)

Baseline = trailing average of the last **3 full calendar months** (exclude the current partial
month) of category activity; income baseline = same over INFLOW inflows. Categories with no
activity in the window baseline to 0 but still appear (so what-ifs can add them back via 'set').

```js
export function baseline(state, fromMonth) → {
  incomePerMonth,
  categories: [{ id, name, groupId, groupName, perMonth }],   // perMonth ≥ 0 (outflow magnitude)
  loans: [{ accountId, name, balance /*positive cents*/, rate, minimumPayment, linkedCategoryId }],
}
```

`linkedCategoryId`: the category most frequently used on historical transfer transactions into that
loan account (null if none) — used to shrink that category's expense when the loan pays off.

```js
overrides = {
  categories: { [catId]: { mode: 'off' } | { mode: 'set', value } | { mode: 'scale', pct } },  // pct 100 = unchanged
  income:     null | { mode: 'set', value } | { mode: 'scale', pct },
  loanExtra:  { [accountId]: centsPerMonth },
}

export function forecast(state, { months = 12, fromMonth, overrides }) → {
  months: ['2026-08', ...],                      // starts at the month AFTER fromMonth
  income: [cents...],
  rows: [{ id, name, groupId, groupName, base, values: [cents...] }],   // expense magnitudes after overrides
  totalExpense: [...], net: [...],               // net = income − totalExpense
  cash: [...],                                   // running cash: startCash + Σ net; startCash = Σ working balances of on-budget accounts
  loans: [{ accountId, name, payment, balances: [...], payoffMonth /* 'YYYY-MM' | null */, freedPerMonth }],
  events: [{ month, label }],                    // e.g. "Car Loan paid off — frees $415.00/mo"
}
```

Loan simulation per month: `bal = bal*(1 + rate/1200) − (minimumPayment + extra)`; in the payoff
month pay only the remainder. From the month AFTER payoff: if `linkedCategoryId` is set and that
category has NO explicit override, subtract `minimumPayment` (floor 0) from its projected value —
the freed payment shows up as profit. Overrides apply before payoff adjustments: off→0,
set→value, scale→round(base*pct/100). Income likewise. All arrays same length = `months`.

Edge rules: fewer than 3 full months of history → average whatever full months exist (≥1), else 0.
`forecast` must be import-safe in Node (no DOM), deterministic, and O(months × categories).

## Views

- `#/fifty` → `js/views/fifty.js` + `css/fifty.css` — month nav (reuse budget conventions), income
  header (toggle: this month / 3-month avg), three class cards (target vs actual, progress bar,
  over/under delta, class color: need = blurple family, want = orange/dandelion, savings = green),
  donut of actual split, a "what the rule says" calculator card (editable income input → 50/30/20
  amounts, defaults to detected income), and a classification manager (categories grouped by class,
  per-row class dropdown persisting via store.updateCategory → live recompute).
- `#/forecast` → `js/views/forecast.js` + `css/forecast.css` — spreadsheet grid: sticky first column,
  horizontal-scroll month columns; sections: Income row, expense rows grouped by category group,
  Total Expenses / Net / Cash rows (bold; negative cash cells tinted red), loan section with
  per-loan extra-payment input and a payoff badge in the payoff month's cell. Row what-if controls
  in the first column: on/off toggle, base amount click-to-edit ('set'), % stepper ('scale').
  Horizon selector 6/12/24 months. "Reset what-ifs" button. Changed rows highlighted
  (var(--blue-light) row tint). What-if state is module-local (scenarios are not persisted).
- Both usable at 375px (grid scrolls horizontally; cards stack).

## Tests

`test/features-check.mjs` (node, assert, localStorage shim like engine-check): baseline averaging
window, each override mode, loan payoff month + linked-category shrink + freed profit, cash
accumulation, 50/30/20 rounding identity (need+want+savings === income), defaultClass mapping.
