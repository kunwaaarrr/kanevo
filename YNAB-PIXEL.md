# YNAB Pixel Spec — extracted from the live app (app.ynab.com, Jul 2026)

All values measured from the production DOM (computed styles + CSS custom properties). This file is the
source of truth for the reskin. Views use the tokens in css/app.css which mirror these.

## Global

- Font: `Figtree, "Helvetica Neue", Helvetica, Arial, sans-serif`; base 16px; body text #191818.
- Text colors: primary #191818 · secondary #51504d · tertiary #696763 · quaternary #888681.
- Links/action labels: #475afa (active #464cd1). Primary buttons: bg #545bfe, active #464cd1, white label, radius 8px, padding 4px 16px, h32, 16px/500.
- Positive label #508316 (active #346011) · negative label #bf2e3b · warning label #6d5600.
- Separators: standard #dbd7cc · strong #acaaa5 · subdued rgba(0,0,0,.102).
- Input border #dbd7cc, focus border #545bfe. Checkbox border #acaaa5, selected fill #545bfe.
- Content bg white. Grouped/cream bg #f8f6f2 (inspector, Reflect body, group rows, table header zone).
- Selected table row #e2e3ff.

## Sidebar (320px, bg #1c1f58)

- Plan name 19.2px/700 white + email 12px rgba(255,255,255,.8) + ▾ chevron (opens plan menu).
- Nav items (Plan/Reflect/All Accounts): h40, radius 6, margin 0 5px 0 8px, 16px/500 white, icon left;
  selected bg #383ca3; hover/active #292c6c.
- Account group header: "CASH" 12px/500 white, letter-spacing 1.36px, total right-aligned; ▾ collapse chevron.
- Account rows: name + balance right, 14px; selected row #383ca3.
- Buttons "＋ Add Account" / "🏦 Bank Connections": full-width-ish, bg rgba(255,255,255,.15), radius 8,
  h28, 14px/500 white, padding 4px 16px.
- Collapse button (◧) pinned bottom-left.

## Plan (budget) screen

Header (white): circular ‹ › buttons (blurple outline circles), month "Jul 2026 ▾" 20px/700 with
"Enter a note…" placeholder 14px #51504d beneath. Centered lime RTA card: bg #c2f680, radius 8,
padding 8px 16px 12px; amount 21px/700 black; label "Ready to Assign" 14px/500 black; dark-green
"Assign ▾" split button (bg #508316, radius 8, white, h32). Top-right "👥 Add Member" light button (skip).

Filter chip row: All | Underfunded | Overfunded | Money Available | Snoozed — 12px, radius 5px,
padding 3px 12px, inactive bg rgba(199,196,189,.24) + transparent 1.5px border, active bg #d4d5ff +
1.5px solid #545bfe. Filter icon chip at the end.

Toolbar row: "⊕ Category Group" · "↺ Undo" · "↻ Redo" (disabled state gray) · "🕘 Recent Moves" —
all #475afa 14px links; right side: two view-density toggle buttons.

Table: checkbox column (12px sq, blurple when checked) on every row.
- Column headers: CATEGORY (left) | ASSIGNED | ACTIVITY | AVAILABLE (right-aligned), 12px/500 uppercase,
  letter-spacing .6px, #51504d, row h40.
- Group rows: h40, bg #f8f6f2, name 14px/700 #191818, chevron ▾, per-group totals in all 3 money cols.
- Category rows: h44, white, border-bottom subdued; name 16px/500 #191818 (emoji prefix); 4px progress
  track full row width under the name (track #f3eee2, fill green #93d53e funded / yellow #f8d655
  underfunded / striped red overspent); assigned/activity 16px right; AVAILABLE pill.
- Pills: border-radius 1000px, padding 2px 7px, 14px/500, h20: zero bg #f3eee2 text #696763;
  positive bg #aee865 text #191818; warning bg #f8d655 text #191818; negative bg #faada5 text #191818.
- Selected row: bg #e2e3ff, checkbox checked, assigned cell becomes inline input (white, blurple border,
  calculator icon), category name underlined/editable.
- Row hover: subtle gray.

Assign popover (under Assign ▾): two tabs "⚡Auto" | "Manually" (blurple underline on active);
Auto tab = stacked option rows (bg #f8f6f2, radius 6, label #475afa left, amount right):
Underfunded / Assigned Last Month / Spent Last Month / Average Assigned / Average Spent /
Reset Available Amounts / Reset Assigned Amounts. Manually = amount input + Assign/Remove toggle.

Month picker popover: year header with ‹ › circles, 4×3 month grid (Jan..Dec), current month = filled
blurple rounded square white text, months-with-data bold.

Recent Moves popover: "Recent Moves" title, intro card, then a 34-day list of money moves (each: date,
from → to, amount). Own copy.

Inspector (449px, bg #f8f6f2, white cards, only ≥1200px):
- Nothing selected: "July's Summary ▾" card (rows: Left Over from Last Month / Assigned in July /
  Activity / Available, last bold); "Cost to Be Me" card ("July's Targets $X" + light-blurple
  "Enter your expected income" button); "⚡ Auto-Assign ▾" card (same 7 option rows); "Assigned in
  Future Months ▾ $X" card with per-month rows.
- Category selected: header "🛒 Groceries" 19px/700 + ✏️ edit icon right; "Available Balance ▾" +
  pill right; breakdown rows (Cash Left Over From Last Month / Assigned This Month / Cash Spending /
  Credit Spending); "Target" card — segmented control [Weekly|Monthly|Yearly|Custom] (white active
  segment on #f3eee2 track, radius pill), "I need" money input, "Every" select (weekday for weekly /
  day-of-month for monthly / date for yearly), "Next month I want to" select ("Set aside another $X" /
  "Refill up to $X"), footer: 🗑 Delete (red, left) · Cancel · "Save Target" (blurple). No target yet:
  "How much do you need for X?" + own-copy line + light-blurple "Create Target" button.

## Register (account & All Accounts)

- Header: account name 24px/700 + ★ favorite; subline "💳 Checking · 🔒 Not Yet Reconciled" 12px
  #696763; top-right ✏️ (edit, blurple icon button) + "Reconcile" primary blurple button.
- Balances row: "$X ⓒ Cleared Balance  +  $X ⓒ Uncleared Balance  =  $X Working Balance";
  amounts 16px/700 green #508316 (negative red), labels 12px #696763 below, + and = separators #51504d.
- Toolbar: "⊕ Add Transaction" "🔗 Link Account" "📄 File Import" "↺ Undo" "↻ Redo" links #475afa 14px;
  right: "View ▾" link + search box (radius 6, border #dbd7cc, 🔍 "Search <account>").
- Columns exactly: ☐ | 🚩 | 📷 | DATE ▾ | PAYEE | CATEGORY | MEMO | OUTFLOW | INFLOW | ⓒ.
  Header 12px uppercase #51504d h32, col borders #dbd7cc verticals between money cols.
- Rows: h36, white, bottom border subdued; cleared icon: green filled Ⓒ cleared / gray outline
  uncleared / green 🔒 reconciled.
- Add/edit row: selected blue tint bg #e2e3ff-ish, each cell = white input radius 4 border #dbd7cc;
  date opens calendar popover (Su–Sa grid, ‹ Jul 2026 ›, "Repeat:" select underneath: Never/…);
  action row right-aligned below: "Cancel" (outline pill) "Save" (blurple pill) "Save and add another"
  (blurple pill).
- Category dropdown: "⊕ New Category" header row; grouped options ("Inflow" → "Ready to Assign" with
  green amount; then each group with categories + gray amounts right); footer full-width light-blurple
  "Split (Multiple Categories)" button.
- Payee dropdown: "Transfer to/from:" section listing accounts, then "Saved Payees".
- All Accounts: adds ACCOUNT column after 📷, no Reconcile/edit buttons, title "All Accounts".

## Reflect

- Top tab bar (white, borderless): Spending Breakdown | Spending Trends | Net Worth | Income v Expense |
  Age of Money — 16px, active = #191818 + 3px blurple underline, inactive #51504d.
- Body bg #f8f6f2, page title 24px/700, top-right "📄 Export" link (#475afa).
- Filter row: circular-chip group "‹ 📅 Jul 2026 ›" + "All Categories ▾" + "All Accounts ▾" — white
  pills, blurple text, radius 999.
- Cards: white, radius 8, padding 24, subtle border/shadow none.
- Spending Breakdown: left card ("Total Spending" label + big amount 28px/700; segmented toggle
  Categories|Groups top-right (white active segment on #f3eee2 track); donut, thick ring, warm-gray
  empty state, center "Total Spending $X"); right card: list header "Categories / Total Spending",
  rows with color dot + name + amount, empty state "No spending to show yet".
- Spending Trends: card with "Average Monthly Spending" big number + "Total Spending" secondary;
  monthly bar chart with dotted baseline + circle markers; below, table card: Month | Total Spending |
  Compared to Average ⓘ.
- Net Worth: card with summary strip (Net Worth big number; legend "▪ Assets" blurple $X, "▪ Debts"
  red -$X, "Change in Net Worth $X 0.0%"); chart: blurple asset bars (#545bfe), red debt bars/line
  (#ce5e66), net-worth line with circle markers, $ y-gridline labels left, mm/yy x labels; below,
  table card: Month | Net Worth | Monthly Change.
- Income v Expense: spreadsheet card; collapsible "Income" header (green #508316, ▾) with payee rows,
  "Total All Income Sources" tinted row, "Total Income"; "Expense" header (red #bf2e3b) with groups →
  categories, "Total Expenses"; "Net Income" section bottom; columns: <months> | AVERAGE | TOTAL
  (12px uppercase right-aligned), money 14px tabular.
- Age of Money: card with big AoM number ("X days" 28px/700) — playful empty-state card when <10 cash
  transactions (own copy, e.g. "Not enough data yet — YNAB needs 10 spending transactions"); line chart
  once data exists; below, "Understanding Age of Money" explainer card (own copy).

## Default starter categories (fresh plan)

Bills: 🏠 Rent/Mortgage · 📱 Phone & Internet · ⚡ Utilities
Needs: 🛒 Groceries · 🚗 Transportation · 🩺 Medical expenses · 😌 Emergency fund
Wants: 🍽 Dining out · 🍿 Entertainment · 🏖 Vacation · ❗ Stuff I forgot to plan for
(keep our richer demo seed; use these names for the "fresh start" path only if ever added)
