# Kanevo — Build Spec (contract for all modules)

Local-only YNAB clone. No build step, no dependencies. ES modules + localStorage. Money is **integer cents** everywhere. Months are `"YYYY-MM"`, dates `"YYYY-MM-DD"`.

## Files

```
index.html            app shell: sidebar, mobile tab bar, view container, modal root (owned by shell)
css/app.css           design tokens + shell/layout + shared components (pill, modal, toast, buttons, forms)
css/budget.css        budget view styles
css/register.css      accounts/register styles
css/reports.css       reports styles
css/loans.css         loan planner styles
js/util.js            fmt, dates, dom helpers (owned by shell)
js/app.js             router, modal/toast, sidebar render (owned by shell)
js/store.js           ALL data + budget engine (Opus agent)
js/seed.js            demo data, category templates, fake bank feed (Opus agent)
js/views/budget.js    budget view (Sonnet agent)
js/views/register.js  accounts + transaction register (Sonnet agent)
js/views/reports.js   4 reports (Sonnet agent)
js/views/loans.js     loan planner (Sonnet agent)
js/views/settings.js  settings (part of loans agent)
test/engine-check.mjs node-runnable assert self-check for store engine
manifest.json, sw.js  PWA offline (owned by shell)
```

Views use ONLY CSS variables from app.css for colors/fonts. No hardcoded hex in view CSS.

## Data model (state)

```js
state = {
  version: 1,
  settings: { budgetName:'My Budget', currencySymbol:'$', hideAmounts:false },
  accounts: [{ id, name, type, onBudget, closed:false, note:'', sortOrder,
               // type ∈ 'checking','savings','cash','creditCard' (on-budget)
               //        'mortgage','autoLoan','studentLoan','personalLoan','asset','liability' (tracking)
               loanInfo: { interestRate /* annual %, e.g. 5.49 */, minimumPayment /* cents */ } /* loans only */ }],
  categoryGroups: [{ id, name, sortOrder, hidden:false }],   // 'cc-payments' group auto-managed
  categories: [{ id, groupId, name, sortOrder, hidden:false, note:'',
                 target: null | { type:'NEED'|'SAVINGS_BALANCE'|'SAVINGS_MONTHLY'|'DEBT_PAYMENT',
                                  amount, targetDate /* 'YYYY-MM' optional */, cadence:'monthly'|'yearly' },
                 ccAccountId /* set on auto credit-card payment categories */ }],
  budget: { 'YYYY-MM': { [categoryId]: assignedCents } },
  transactions: [{ id, accountId, date, payeeId:null, categoryId:null, memo:'',
                   amount /* signed cents, outflow negative */,
                   cleared:'uncleared'|'cleared'|'reconciled', approved:true, flag:null|'red'|'orange'|'yellow'|'green'|'blue'|'purple',
                   transferAccountId:null, transferTxId:null, importId:null,
                   attachments:[/* jpeg dataURLs */],
                   subtransactions:null | [{ categoryId, amount, memo }] }],
  scheduled: [{ id, frequency:'weekly'|'fortnightly'|'monthly'|'yearly', nextDate,
                accountId, payeeId, categoryId, memo, amount, flag }],
  payees: [{ id, name, lastCategoryId:null, lat:null, lng:null }],
  focusedViews: [{ id, name, categoryIds:[] }],
}
```

Special category ids (constants exported from store.js):
- `INFLOW = 'inflow'` — "Ready to Assign" inflow category.
- Transfers: both sides have `transferAccountId`/`transferTxId`, payee shown as `Transfer : <Account>`. Transfer between two on-budget accounts has `categoryId:null` and no budget impact. Transfer on-budget → tracking/loan account counts as outflow needing a category (loan payments use the DEBT category / cc payment rules below).

## store.js API (exact exports)

```js
export const INFLOW = 'inflow';
export const store = {
  get state(),                       // live reference, treat read-only outside store
  subscribe(fn), unsubscribe(fn),    // fn() after every mutation (also fires persistence, debounced 300ms, key 'kanevo/v1')
  undo(), canUndo(),                 // in-memory snapshot stack (20), every public mutation pushes

  // accounts
  addAccount({name, type, balance, date}),  // balance -> starting-balance tx (INFLOW if on-budget & positive; tracking accts: categoryId null)
                                            // creditCard: auto-create payment category in 'cc-payments' group
  updateAccount(id, patch), closeAccount(id), reopenAccount(id),

  // categories
  addGroup(name), renameGroup(id, name), hideGroup(id), deleteGroup(id),
  addCategory(groupId, name), updateCategory(id, patch), hideCategory(id), deleteCategory(id), // delete asks store to reassign txns to null
  moveCategory(id, groupId, index), moveGroup(id, index),
  setTarget(categoryId, targetOrNull),

  // budgeting
  assign(month, categoryId, cents),                 // set absolute assigned
  moveMoney(month, fromCatIdOrNull, toCatIdOrNull, cents),  // null = Ready to Assign
  autoAssign(month),                                // fill neededThisMonth for every category in order until RTA exhausted; returns cents assigned

  // transactions
  addTransaction(tx), updateTransaction(id, patch), deleteTransaction(id),
  addTransfer({fromAccountId, toAccountId, date, amount /*positive cents*/, memo, categoryId}),
  approveTransaction(id), toggleCleared(id), reconcileAccount(accountId, actualBalanceCents),
  importTransactions(accountId, bankTxns),  // [{date, amount, payeeName, importId}]
      // MATCH: existing tx same account, importId null, same amount, |date diff| <= 10 days, approved manual entry
      //  -> merge: keep manual payee/category/memo, set importId, approved=true. Else insert with approved=false.
  matchCandidates(accountId),               // unapproved imports paired with their would-be manual match (for UI)

  // scheduled
  addScheduled(s), updateScheduled(id, patch), deleteScheduled(id),
  processDueScheduled(),                    // materialize nextDate <= today as unapproved txns, advance nextDate; call on boot
  upcomingScheduled(accountId|null, days),

  // payees
  getPayee(id), findOrCreatePayee(name), renamePayee(id, name), payeeSuggestions(prefix),
  nearestPayee(lat, lng),                   // within 250m else null
  rememberPayeeContext(payeeId, categoryId, lat, lng),

  // focused views
  saveFocusedView(name, categoryIds), deleteFocusedView(id),

  // computed (recompute lazily per mutation; cache internally)
  monthData(month),   // see shape below
  readyToAssign(month),
  ageOfMoney(),                              // integer days or null if <10 cash outflows
  accountBalances(accountId),                // {cleared, uncleared, working} cents (working = cleared+uncleared)
  netWorthSeries(),                          // [{month, assets, liabilities, netWorth}] from first tx month to current
  spendingBreakdown({fromMonth, toMonth, groupBy:'category'|'group'|'payee', categoryIds?, accountIds?}), // [{id, name, amount}] outflows only, sorted desc
  incomeVsExpense({fromMonth, toMonth}),     // {months:[...], income:{payeeRows...}, expense:{groupRows:{categoryRows}}, netRow}月 by month + totals
  ageOfMoneySeries(),                        // [{month, aom}]
  loanStats(accountId, extraMonthlyCents),   // {balance, rate, minimumPayment, months, payoffDate, totalInterest,
                                             //  withExtra:{months, payoffDate, totalInterest, interestSaved, timeSavedMonths}}
  updateSettings(patch),                     // e.g. {hideAmounts:true, budgetName:'X'}
  exportJSON(), importJSON(text), resetAll(),
}
```

store.js must be import-safe in Node (no `document`/`window` at module scope; guard `localStorage` behind `typeof localStorage !== 'undefined'`) so `node test/engine-check.mjs` can shim and test the engine.

`monthData(month)` returns:
```js
{ month, rta, ageOfMoney,
  totals: { assigned, activity, available },
  groups: [{ id, name, hidden, categories: [{
      id, name, groupId, hidden,
      assigned, activity, available,
      target,                      // raw target or null
      goal: null | { needed,      // cents still needed THIS month
                     fundedPct,   // 0..100 for progress bar
                     status:'funded'|'underfunded'|'overspent'|'zero'|'spent-none' },
      pillClass: 'pos'|'zero'|'underfunded'|'overspent',  // available pill color
  }]}] }
```

## Engine rules (the money math — implement exactly)

**Activity** `activity(c,m)` = Σ amounts of txns (and subtransactions) in month m with category c, across on-budget accounts. INFLOW txns are not category activity.

**Carryover** `carry(c,m) = max(available(c, m−1), 0)`. Negative available does not carry into the category.

**Available** `available(c,m) = carry(c,m) + assigned(c,m) + activity(c,m)` (+ for CC payment categories, see below).

**Overspending split.** If `available(c,m) < 0`: `over = −available`; `creditPortion = min(over, creditSpending(c,m))` where creditSpending = Σ outflows on creditCard accounts in c,m; `cashPortion = over − creditPortion`. Cash portion reduces the NEXT month's RTA. Credit portion simply remains as card debt (it never reduces RTA and never carries).

**Ready to Assign**
```
RTA(m) = Σ_{m'≤m} inflowToRTA(m') − Σ_{m'≤m} totalAssigned(m') − Σ_{m'<m} cashOverspending(m')
```
`inflowToRTA` = INFLOW-categorized inflows to on-budget accounts. Assignments in months > m are ignored until reached (documented simplification).

**Credit cards.** Each CC account has an auto payment category (group `cc-payments`). Per month, process that card's spending txns in date order keeping a running `avail` per spending category (start = carry+assigned+prior activity this month, order by date):
- covered = clamp(outflow, 0, max(0, runningAvail)); runningAvail −= outflow.
- CC payment category gets `+covered` as its activity ("money moved for payment").
- Payments (transfer checking→card, positive amount to card) add `−payment` to the CC payment category activity (reducing its available) and reduce card debt.
- Inflows/refunds on the card with a category c: `−refund` from payment category, `+` back to c via normal activity.

**Age of Money.** FIFO over cash on-budget accounts (checking/savings/cash). Queue inflows (date, remaining). Each cash outflow consumes oldest inflows; its age = amount-weighted mean of (outflowDate − inflowDate) in days. AoM = round(mean of the last 10 outflow ages). Transfers between cash accounts don't count; transfers cash→CC (payments) and cash→tracking DO count as outflows.

**Targets → neededThisMonth(c,m)** (`avail0 = carry + assigned`):
- NEED, cadence monthly, no date: `max(0, amount − avail0)`
- NEED/SAVINGS_BALANCE with targetDate: `monthsLeft = months from m to targetDate inclusive; max(0, ceil((amount − max(0, available(c,m−1)) − assigned)/1) split: needed = max(0, round((amount − carry)/monthsLeft) − assigned)`
- NEED cadence yearly, no date: `max(0, round(amount/12) − assigned)`
- SAVINGS_MONTHLY / DEBT_PAYMENT: `max(0, amount − assigned)`
- goal.status: overspent if available<0; funded if needed==0; zero if no target and available==0 and no activity; else underfunded. fundedPct = 100 when needed 0, else clamp(100 * fundedSoFar/requiredThisMonth).

**Auto-Assign:** in group/category sort order, `assign += min(needed, rtaRemaining)`; skip hidden; stop at 0. Returns total.

**Loan simulation** `loanStats`: monthly rate r = rate/1200; simulate balance*(1+r) − payment monthly until ≤0 (cap 1000 months); do twice (min payment vs min+extra).

**Reconcile:** given actual balance, if it equals cleared balance mark all cleared→reconciled; else create an adjustment tx (payee "Reconciliation Balance Adjustment", INFLOW or null category) then mark reconciled.

## Shell contract (already written — use it)

- `js/util.js` exports: `fmt(cents)` (respects hideAmounts → '••••'), `fmtExact(cents)` (never hidden, for inputs), `parseAmount(str)->cents`, `todayISO()`, `thisMonth()`, `addMonths(month,n)`, `monthLabel(month)`, `daysBetween(a,b)`, `fmtDate(iso)`, `esc(s)` (HTML escape), `h(strings,...vals)` tagged template (escapes vals), `debounce(fn,ms)`, `uid()`.
- `js/app.js` exports: `openModal(html, {onOpen})->modalEl`, `closeModal()`, `toast(msg, {undoable})`, `navigate(hash)`, and boots the router.
- Routes: `#/budget/YYYY-MM`, `#/accounts`, `#/account/<id>`, `#/reports/<spending|net-worth|income-expense|age-of-money>`, `#/loans`, `#/loans/<id>`, `#/settings`.
- Each view module: `export function render(root, params)` — full re-render; app.js calls it on route change AND store change. Preserve in-progress edits by checking `document.activeElement` / rendering edit state from module-local vars.
- Views attach events via delegation on `root` inside render (root is emptied each time; listeners added with `root.addEventListener` must guard against duplicates — prefer `root.onclick = ...` style or bind on freshly created children).

## Look & feel

Desktop: dark navy left sidebar (budget name, nav: Budget / Reflect / All Accounts, account list with balances grouped Budget/Loans/Tracking, Add Account button). Main area white. Budget view: month picker, RTA banner pill (green/red/gray), Age of Money, toolbar (Auto-Assign, focused-view filter, hide-amounts eye, undo), category table with Assigned/Activity/Available columns, inline assigned editing, available pills, target progress bars, right inspector panel on wide screens.
Mobile (<768px): sidebar hidden; bottom tab bar: Budget · Accounts · ➕ (add transaction) · Reflect · More. Everything must be fully usable at 375px wide.
