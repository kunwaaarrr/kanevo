// seed.js — deterministic demo data, category templates, fake bank feed.
import { store } from './store.js';
import { uid, todayISO, addMonths } from './util.js';

// deterministic PRNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(0x5A9E71); // fixed seed
const rand = (min, max) => min + rnd() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];

const TODAY = '2026-07-07';
function isoAdd(iso, days) { return new Date(new Date(iso + 'T00:00:00').getTime() + days * 86400000).toISOString().slice(0, 10); }
function firstOfMonth(month) { return month + '-01'; }

// ---------- category templates (also exported) ----------
// general-purpose default structure for someone budgeting from scratch — kept separate
// from the event templates below and listed first so it's the one-tap "obvious" choice.
export const STARTER_TEMPLATE = { name: '⭐ Starter Budget (Recommended)', emoji: '⭐', groups: [
  { name: '🏠 Immediate Obligations', categories: ['🏠 Rent/Mortgage', '⚡ Electric', '💧 Water', '🌐 Internet', '🛒 Groceries', '🚗 Transport', '📱 Phone'] },
  { name: '🧾 True Expenses', categories: ['🚙 Insurance', '🔧 Car Maintenance', '🏥 Medical', '📺 Subscriptions', '👕 Clothing'] },
  { name: '✨ Quality of Life', categories: ['🍜 Dining Out', '🎬 Entertainment', '💪 Fitness', '✈️ Holiday'] },
  { name: '💰 Savings', categories: ['🚨 Emergency Fund', '📈 Investments'] },
]};

export const CATEGORY_TEMPLATES = [
  STARTER_TEMPLATE,
  { name: 'New Baby', emoji: '👶', groups: [
    { name: '👶 New Baby', categories: ['🍼 Formula & Feeding', '🧷 Diapers', '👕 Baby Clothes', '🛏️ Nursery', '🏥 Medical', '🧸 Toys'] },
  ]},
  { name: 'Wedding', emoji: '💍', groups: [
    { name: '💍 Wedding', categories: ['📸 Photographer', '🏰 Venue', '🍽️ Catering', '👗 Attire', '💐 Flowers', '🎵 Music', '💌 Invitations'] },
  ]},
  { name: 'Moving House', emoji: '📦', groups: [
    { name: '📦 Moving House', categories: ['🚚 Movers', '📦 Packing Supplies', '🔒 Bond/Deposit', '🔌 Utility Connection', '🧹 Cleaning', '🛋️ New Furniture'] },
  ]},
  { name: 'Holiday Season', emoji: '🎄', groups: [
    { name: '🎄 Holiday Season', categories: ['🎁 Gifts', '🍗 Food & Feast', '🎄 Decorations', '✈️ Travel', '🎉 Parties'] },
  ]},
];

// tap-to-add palette for the "add category" flows — common categories most budgets need.
export const COMMON_CATEGORIES = [
  '🛒 Groceries', '🍜 Dining Out', '⛽ Fuel/Transport', '🏠 Rent', '💡 Utilities',
  '📺 Subscriptions', '💪 Fitness', '👕 Clothing', '🏥 Medical', '🎬 Entertainment',
  '🎁 Gifts', '💰 Savings',
];

// ---------- demo dataset builder ----------
function buildDemo() {
  const accounts = [], categoryGroups = [], categories = [], transactions = [];
  const budget = {}, scheduled = [], payees = [], focusedViews = [];

  const mkAcct = (name, type, onBudget, loanInfo) => {
    const a = { id: uid(), name, type, onBudget, closed: false, note: '', sortOrder: accounts.length };
    if (loanInfo) a.loanInfo = loanInfo;
    accounts.push(a); return a.id;
  };
  const checking = mkAcct('Everyday Checking', 'checking', true);
  const savings = mkAcct('Savings', 'savings', true);
  const cash = mkAcct('Cash', 'cash', true);
  const visa = mkAcct('Visa Credit Card', 'creditCard', true);
  const home = mkAcct('Home Loan', 'mortgage', false, { interestRate: 5.99, minimumPayment: 245000 });
  const car = mkAcct('Car Loan', 'autoLoan', false, { interestRate: 7.49, minimumPayment: 41500 });
  const superAcct = mkAcct('Superannuation', 'asset', false);

  const mkGroup = (id, name) => { const g = { id, name, sortOrder: categoryGroups.length, hidden: false }; categoryGroups.push(g); return g; };
  const mkCat = (group, name, target = null, ccAccountId = undefined) => {
    const c = { id: uid(), groupId: group.id, name, sortOrder: categories.filter(x => x.groupId === group.id).length, hidden: false, note: '', target };
    if (ccAccountId) c.ccAccountId = ccAccountId;
    categories.push(c); return c;
  };

  // auto cc-payments group + Visa payment category
  const ccGroup = mkGroup('cc-payments', 'Credit Card Payments');
  const visaPay = mkCat(ccGroup, 'Visa Credit Card', null, visa);

  const gImm = mkGroup(uid(), 'Immediate Obligations');
  const cRent = mkCat(gImm, '🏠 Rent/Mortgage', { type: 'NEED', amount: 210000, cadence: 'monthly' });
  const cElec = mkCat(gImm, '⚡ Electric', { type: 'NEED', amount: 12000, cadence: 'monthly' });
  const cWater = mkCat(gImm, '💧 Water', { type: 'NEED', amount: 6000, cadence: 'monthly' });
  const cNet = mkCat(gImm, '🌐 Internet', { type: 'NEED', amount: 8000, cadence: 'monthly' });
  const cGroc = mkCat(gImm, '🛒 Groceries', { type: 'NEED', amount: 80000, cadence: 'monthly' });
  const cTrans = mkCat(gImm, '🚗 Transport', { type: 'NEED', amount: 24000, cadence: 'monthly' });
  const cPhone = mkCat(gImm, '📱 Phone', { type: 'NEED', amount: 5000, cadence: 'monthly' });

  const gTrue = mkGroup(uid(), 'True Expenses');
  const cCarIns = mkCat(gTrue, '🚙 Car Insurance', { type: 'NEED', amount: 120000, targetDate: addMonths(TODAY.slice(0, 7), 6), cadence: 'yearly' });
  const cCarMaint = mkCat(gTrue, '🔧 Car Maintenance', { type: 'NEED', amount: 10000, cadence: 'monthly' });
  const cMed = mkCat(gTrue, '🏥 Medical', { type: 'NEED', amount: 8000, cadence: 'monthly' });
  const cGifts = mkCat(gTrue, '🎁 Gifts', { type: 'NEED', amount: 5000, cadence: 'monthly' });
  const cSubs = mkCat(gTrue, '📺 Annual Subscriptions', { type: 'NEED', amount: 4000, cadence: 'monthly' });
  const cHomeMaint = mkCat(gTrue, '🏡 Home Maintenance', { type: 'NEED', amount: 6000, cadence: 'monthly' });

  const gQoL = mkGroup(uid(), 'Quality of Life');
  const cDining = mkCat(gQoL, '🍜 Dining Out', { type: 'NEED', amount: 40000, cadence: 'monthly' });
  const cEnt = mkCat(gQoL, '🎬 Entertainment', { type: 'NEED', amount: 6000, cadence: 'monthly' });
  const cCloth = mkCat(gQoL, '👕 Clothing', { type: 'NEED', amount: 8000, cadence: 'monthly' });
  const cFit = mkCat(gQoL, '💪 Fitness', { type: 'NEED', amount: 6000, cadence: 'monthly' });
  const cHoliday = mkCat(gQoL, '✈️ Holiday', { type: 'SAVINGS_BALANCE', amount: 500000, targetDate: addMonths(TODAY.slice(0, 7), 12) });

  const gFun = mkGroup(uid(), 'Just for Fun');
  const cGaming = mkCat(gFun, '🎮 Gaming', { type: 'NEED', amount: 3000, cadence: 'monthly' });
  const cCoffee = mkCat(gFun, '☕ Coffee', { type: 'NEED', amount: 6000, cadence: 'monthly' });

  // payees
  const mkPayee = (name, lastCategoryId = null) => { const p = { id: uid(), name, lastCategoryId, lat: null, lng: null }; payees.push(p); return p; };
  const pAcme = mkPayee('Acme Corp', null);
  const pLandlord = mkPayee('Property Manager', cRent.id);
  const pEnergy = mkPayee('Origin Energy', cElec.id);
  const pWater = mkPayee('Sydney Water', cWater.id);
  const pTelstra = mkPayee('Telstra', cNet.id);
  const pWoolies = mkPayee('Woolworths', cGroc.id);
  const pColes = mkPayee('Coles', cGroc.id);
  const pAldi = mkPayee('Aldi', cGroc.id);
  const pFuel = mkPayee('BP Fuel', cTrans.id);
  const pCafe = mkPayee('The Grounds Cafe', cCoffee.id);
  const pRestaurant = mkPayee('Sushi Train', cDining.id);
  const pThai = mkPayee('Thai Orchid', cDining.id);
  const pNetflix = mkPayee('Netflix', cSubs.id);
  const pClothStore = mkPayee('Cotton On', cCloth.id);
  const pMechanic = mkPayee('Ultra Tune', cCarMaint.id);
  const pTicketek = mkPayee('Ticketek', cEnt.id);
  const pGiftShop = mkPayee('Myer', cGifts.id);
  const grocPayees = [pWoolies, pColes, pAldi];

  const mkTx = (o) => {
    transactions.push({
      id: o.id || uid(), accountId: o.accountId, date: o.date, payeeId: o.payeeId || null,
      categoryId: o.categoryId ?? null, memo: o.memo || '', amount: o.amount,
      cleared: o.cleared || 'cleared', approved: o.approved !== false, flag: o.flag || null,
      transferAccountId: o.transferAccountId || null, transferTxId: o.transferTxId || null,
      importId: o.importId || null, attachments: [], subtransactions: o.subtransactions || null,
    });
    return transactions.at(-1);
  };
  const mkTransfer = (from, to, date, amount, categoryId) => {
    const id1 = uid(), id2 = uid();
    const toOnBudget = accounts.find(a => a.id === to).onBudget;
    mkTx({ id: id1, accountId: from, date, amount: -Math.abs(amount), categoryId: toOnBudget ? null : categoryId, transferAccountId: to, transferTxId: id2, cleared: 'cleared' });
    mkTx({ id: id2, accountId: to, date, amount: Math.abs(amount), categoryId: null, transferAccountId: from, transferTxId: id1, cleared: 'cleared' });
  };

  // starting balances
  mkTx({ accountId: savings, date: '2026-03-01', categoryId: 'inflow', amount: 800000, memo: 'Starting Balance' });
  mkTx({ accountId: cash, date: '2026-03-01', categoryId: 'inflow', amount: 90000, memo: 'Starting Balance' });

  // tracking / loan starting balances (no category)
  mkTx({ accountId: home, date: '2026-03-01', amount: -38500000, memo: 'Starting Balance', cleared: 'cleared' });
  mkTx({ accountId: car, date: '2026-03-01', amount: -1420000, memo: 'Starting Balance', cleared: 'cleared' });
  mkTx({ accountId: superAcct, date: '2026-03-01', amount: 4800000, memo: 'Starting Balance', cleared: 'cleared' });

  // ~4 months of history: March, April, May, June, July(current partial). Anchor months by first day.
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

  // fortnightly salary ~$3450 into checking, categorized INFLOW, starting 2026-03-06 every 14 days up to today
  let pay = '2026-03-06';
  const paydays = [];
  while (pay <= TODAY) { paydays.push(pay); pay = isoAdd(pay, 14); }
  for (const d of paydays) {
    mkTx({ accountId: checking, date: d, payeeId: pAcme.id, categoryId: 'inflow', amount: 345000, memo: 'Salary', cleared: 'cleared' });
  }

  // monthly rent $2100 (transfer? no — direct outflow) on the 3rd
  for (const m of months) {
    if (m === '2026-07') { /* rent for July paid on the 3rd, already past */ }
    mkTx({ accountId: checking, date: m + '-03', payeeId: pLandlord.id, categoryId: cRent.id, amount: -210000, memo: 'Rent', cleared: 'cleared' });
  }
  // utilities monthly
  for (const m of months) {
    mkTx({ accountId: checking, date: m + '-08', payeeId: pEnergy.id, categoryId: cElec.id, amount: -randInt(9000, 13000), memo: 'Electricity' });
    mkTx({ accountId: checking, date: m + '-10', payeeId: pTelstra.id, categoryId: cNet.id, amount: -8000, memo: 'Internet' });
    mkTx({ accountId: checking, date: m + '-12', payeeId: pTelstra.id, categoryId: cPhone.id, amount: -5000, memo: 'Phone' });
    if (m === '2026-03' || m === '2026-06') mkTx({ accountId: checking, date: m + '-14', payeeId: pWater.id, categoryId: cWater.id, amount: -randInt(5000, 7500), memo: 'Water' });
  }

  // groceries 2-3x/week $40-$180 across grocery payees, mostly checking, some on cash
  for (const m of months) {
    const daysInMonth = m === '2026-07' ? 7 : 28;
    for (let d = 2; d <= daysInMonth; d += randInt(2, 3)) {
      const day = String(Math.min(daysInMonth, d)).padStart(2, '0');
      const amt = -randInt(4000, 18000);
      const acc = rnd() < 0.15 ? cash : checking;
      const p = pick(grocPayees);
      mkTx({ accountId: acc, date: `${m}-${day}`, payeeId: p.id, categoryId: cGroc.id, amount: amt, memo: 'Groceries' });
    }
  }

  // dining: cafes/restaurants, some on the Visa
  const diningPayees = [pCafe, pRestaurant, pThai];
  for (const m of months) {
    const count = m === '2026-07' ? 4 : randInt(4, 7);
    for (let i = 0; i < count; i++) {
      const day = String(randInt(2, m === '2026-07' ? 7 : 27)).padStart(2, '0');
      const p = pick(diningPayees);
      const onVisa = rnd() < 0.5;
      const cat = p === pCafe ? cCoffee.id : cDining.id;
      const amt = -randInt(1200, 6500);
      mkTx({ accountId: onVisa ? visa : checking, date: `${m}-${day}`, payeeId: p.id, categoryId: cat, amount: amt, memo: p === pCafe ? 'Coffee' : 'Dinner' });
    }
  }

  // fuel ~2x/month
  for (const m of months) {
    const times = m === '2026-07' ? 1 : 2;
    for (let i = 0; i < times; i++) {
      const day = String(randInt(4, m === '2026-07' ? 6 : 25)).padStart(2, '0');
      mkTx({ accountId: checking, date: `${m}-${day}`, payeeId: pFuel.id, categoryId: cTrans.id, amount: -randInt(6000, 11000), memo: 'Fuel' });
    }
  }

  // CC payments (transfer checking -> Visa): pay only the earlier months so a ~$1,850 balance carries.
  mkTransfer(checking, visa, '2026-04-25', randInt(12000, 20000), visaPay.id);
  mkTransfer(checking, visa, '2026-05-25', randInt(12000, 20000), visaPay.id);
  // a few larger Visa purchases so the card carries real debt (~-$1,850)
  mkTx({ accountId: visa, date: '2026-05-18', payeeId: pClothStore.id, categoryId: cCloth.id, amount: -34900, memo: 'New jacket' });
  mkTx({ accountId: visa, date: '2026-06-09', payeeId: pMechanic.id, categoryId: cCarMaint.id, amount: -73000, memo: 'Car service' });
  mkTx({ accountId: visa, date: '2026-06-22', payeeId: pTicketek.id, categoryId: cEnt.id, amount: -18900, memo: 'Concert tickets' });
  mkTx({ accountId: visa, date: '2026-07-02', payeeId: pGiftShop.id, categoryId: cGifts.id, amount: -26500, memo: 'Birthday gift' });
  // loan payments monthly (transfer checking -> Home Loan / Car Loan)
  for (const m of ['2026-04', '2026-05', '2026-06', '2026-07']) {
    mkTransfer(checking, home, m + '-05', 245000, cRent.id);
    mkTransfer(checking, car, m + '-06', 41500, cTrans.id);
  }

  // ----- budget assignments per month so categories are funded -----
  // Dining assigned ~ to its spend (small buffer) so no big cushion carries into July.
  // Car Insurance NOT funded in prior months -> July shows a real remaining need (yellow).
  const monthlyPlan = [
    // Rent/Mortgage covers rent ($2,100) + home-loan payment ($2,450); Transport covers fuel + car-loan payment ($415)
    [cRent, 455000], [cElec, 12000], [cWater, 6000], [cNet, 8000], [cGroc, 80000], [cTrans, 66000], [cPhone, 5000],
    [cCarMaint, 10000], [cMed, 8000], [cGifts, 5000], [cSubs, 4000], [cHomeMaint, 6000],
    [cEnt, 6000], [cCloth, 8000], [cFit, 6000], [cHoliday, 40000],
    [cGaming, 3000], [cCoffee, 6000],
  ];
  for (const m of ['2026-03', '2026-04', '2026-05', '2026-06']) {
    budget[m] = {};
    for (const [c, amt] of monthlyPlan) budget[m][c.id] = amt;
    budget[m][cDining.id] = 22000;                  // ~matches spend, tiny buffer
    budget[m][visaPay.id] = randInt(12000, 22000);  // fund cc payment
  }

  // July (current): fund most categories, but underfund Car Insurance (yellow) and Dining Out (red = overspent).
  budget['2026-07'] = {};
  for (const [c, amt] of monthlyPlan) budget['2026-07'][c.id] = amt;
  budget['2026-07'][cCarIns.id] = 8000;  // needed ~$200; only $80 assigned, no carry -> underfunded (yellow)
  budget['2026-07'][cDining.id] = 15000; // small buffer + $150 vs big July dining spend -> overspent (red)
  budget['2026-07'][cGroc.id] = 80000;   // healthy groceries -> green

  // ensure Dining Out is overspent in July: spend well beyond the small available
  mkTx({ accountId: checking, date: '2026-07-05', payeeId: pRestaurant.id, categoryId: cDining.id, amount: -28000, memo: 'Birthday dinner' });
  mkTx({ accountId: checking, date: '2026-07-06', payeeId: pThai.id, categoryId: cDining.id, amount: -12500, memo: 'Takeaway' });

  // scheduled upcoming
  scheduled.push({ id: uid(), frequency: 'monthly', nextDate: '2026-08-03', accountId: checking, payeeId: pLandlord.id, categoryId: cRent.id, memo: 'Rent', amount: -210000, flag: null });
  scheduled.push({ id: uid(), frequency: 'monthly', nextDate: '2026-07-15', accountId: checking, payeeId: pNetflix.id, categoryId: cSubs.id, memo: 'Netflix', amount: -2299, flag: null });
  scheduled.push({ id: uid(), frequency: 'fortnightly', nextDate: isoAdd(paydays.at(-1), 14), accountId: checking, payeeId: pAcme.id, categoryId: 'inflow', memo: 'Salary', amount: 345000, flag: null });

  // 2 unapproved imported transactions in checking; one is a match candidate to a manual entry.
  // Manual entry (approved) that the import will match:
  const manualMatch = mkTx({ accountId: checking, date: '2026-07-04', payeeId: pWoolies.id, categoryId: cGroc.id, memo: 'Weekly shop', amount: -8750, cleared: 'cleared', approved: true });
  // Imported that matches it (same amount, within 10 days, no importId on manual -> will be a candidate):
  mkTx({ accountId: checking, date: '2026-07-05', payeeId: pWoolies.id, categoryId: null, memo: '', amount: -8750, cleared: 'cleared', approved: false, importId: 'seed-imp-1' });
  // Imported that does NOT match anything:
  mkTx({ accountId: checking, date: '2026-07-06', payeeId: pFuel.id, categoryId: null, memo: '', amount: -7200, cleared: 'cleared', approved: false, importId: 'seed-imp-2' });

  return {
    version: 1,
    settings: { budgetName: 'My Budget', currencySymbol: '$', hideAmounts: false },
    accounts, categoryGroups, categories, budget, transactions, scheduled, payees, focusedViews,
  };
}

export function maybeSeed() {
  if (!store.isFirstRun) return false;
  rnd = mulberry32(0x5A9E71); // reset PRNG for determinism
  store.importJSON(JSON.stringify(buildDemo()));
  return true;
}

// ---------- fake bank feed ----------
export function simulateBankFeed() {
  rnd = mulberry32((Date.now() & 0xffff) || 1); // varied but harmless
  const accts = store.state.accounts.filter(a => a.onBudget && !a.closed && a.type !== 'creditCard');
  if (!accts.length) return 0;
  const knownPayees = store.state.payees.map(p => p.name);
  const today = todayISO();

  // pick a recent manual tx to duplicate (so matching triggers)
  const recentManual = store.state.transactions
    .filter(t => !t.importId && t.approved && !t.transferAccountId && t.amount < 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  const byAccount = {};
  const push = (accId, tx) => { (byAccount[accId] ||= []).push(tx); };

  const n = Math.floor(rand(3, 7)); // 3-6
  for (let i = 0; i < n; i++) {
    const acc = pick(accts);
    const date = isoAdd(today, -Math.floor(rand(0, 5)));
    const payeeName = knownPayees.length ? pick(knownPayees) : 'Unknown';
    const amount = -Math.floor(rand(1500, 12000));
    push(acc.id, { date, amount, payeeName, importId: 'feed-' + uid() });
  }
  // guaranteed duplicate of a recent manual tx
  if (recentManual) {
    const p = recentManual.payeeId ? store.getPayee(recentManual.payeeId) : null;
    push(recentManual.accountId, {
      date: recentManual.date, amount: recentManual.amount,
      payeeName: p ? p.name : 'Bank', importId: 'feed-dup-' + uid(),
    });
  }

  let count = 0;
  for (const accId of Object.keys(byAccount)) {
    store.importTransactions(accId, byAccount[accId]);
    count += byAccount[accId].length;
  }
  return count;
}
