import { store, INFLOW } from '../store.js';
import { openModal, closeModal, toast, navigate, confirmSheet } from '../app.js';
import { fmt, fmtExact, parseAmount, todayISO, fmtDate, h, esc, raw, debounce, addMonths, ICONS } from '../util.js';
import { simulateBankFeed } from '../seed.js';
import { parseStatement, buildTxns } from '../lib/csv.js';
import { normalizeMerchant } from '../lib/categorize.js';
import { openLearnedMerchantsSheet } from './budget.js';

const FLAGS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const FREQ_LABEL = {
  weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly',
  every2months: 'Every 2 Months', quarterly: 'Every 3 Months', twiceayear: 'Every 6 Months',
  yearly: 'Yearly',
};
const FREQ_MONTHS = { monthly: 1, every2months: 2, quarterly: 3, twiceayear: 6, yearly: 12 };
const TYPE_LABEL = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash', creditCard: 'Credit Card',
  mortgage: 'Mortgage', autoLoan: 'Auto Loan', studentLoan: 'Student Loan', personalLoan: 'Personal Loan',
  asset: 'Asset', liability: 'Liability',
};
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
// ---------- module-local UI state (survives store re-renders) ----------
let curAccountId; // account currently rendered (null = all)
let search = '';
let filter = 'all'; // all | uncleared | unapproved | scheduled
let scheduledOpen = true;
let editingId = null;   // tx id being edited inline, or 'new'
let editState = null;   // { date, payeeText, payeeId, categoryId, memo, outflow, inflow, cleared, flag, attachments, subtransactions, presetAccountId }
let autocompleteOpen = false;
let clipGalleryTx = null;
let datePopoverOpen = false;
let datePopoverMonth = null; // 'YYYY-MM' shown in calendar
let categoryPopoverOpen = false; // category dropdown popover, main row only (not split rows)
let flagPopoverOpen = false; // flag picker popover, main row only
let repeatChoice = 'none';
let selectedIds = new Set();
let sortDir = 'desc'; // date sort
let viewMenuOpen = false;
// ponytail: same plain-localStorage pattern as the sidebar prefs in app.js (not the budget store).
let showMemoCol = localStorage.getItem('ss-reg-show-memo') !== '0';
let showReconciled = localStorage.getItem('ss-reg-show-reconciled') !== '0';
let compactRows = localStorage.getItem('ss-reg-compact-rows') === '1';

function isMobile() { return window.innerWidth < 768; }

function blankEdit(presetAccountId) {
  return {
    date: todayISO(), payeeText: '', payeeId: null, categoryId: null, memo: '',
    outflow: '', inflow: '', cleared: false, flag: null, attachments: [],
    subtransactions: null, accountId: presetAccountId || curAccountId || null,
  };
}

function txToEdit(tx) {
  const payee = tx.payeeId ? store.getPayee(tx.payeeId) : null;
  return {
    date: tx.date, payeeText: tx.transferAccountId ? transferPayeeLabel(tx) : (payee ? payee.name : ''),
    payeeId: tx.payeeId, categoryId: tx.categoryId, memo: tx.memo || '',
    outflow: tx.amount < 0 ? fmtExact(-tx.amount).replace('$', '') : '',
    inflow: tx.amount > 0 ? fmtExact(tx.amount).replace('$', '') : '',
    cleared: tx.cleared !== 'uncleared', flag: tx.flag, attachments: tx.attachments || [],
    subtransactions: tx.subtransactions ? tx.subtransactions.map(s => ({ ...s })) : null,
    accountId: tx.accountId, transferAccountId: tx.transferAccountId || null,
  };
}

function transferPayeeLabel(tx) {
  const other = store.state.accounts.find(a => a.id === tx.transferAccountId);
  return `Transfer: ${other ? other.name : '?'}`;
}

// ---------- mobile Accounts overview ----------
// Desktop keeps the dense All Accounts register. On phones, Accounts is a
// navigation surface of its own, matching the supplied mobile flow.
export function renderAccountsOverview(root) {
  const groups = [
    { label: 'Cash', filter: a => a.onBudget && !a.closed && a.type !== 'creditCard' },
    { label: 'Credit', filter: a => a.onBudget && !a.closed && a.type === 'creditCard' },
    { label: 'Loans', filter: a => !a.onBudget && !a.closed && a.loanInfo },
    { label: 'Tracking', filter: a => !a.onBudget && !a.closed && !a.loanInfo },
  ];
  const introHidden = localStorage.getItem('ss-accounts-intro-dismissed') === '1';
  const groupHtml = groups.map(group => {
    const accounts = store.state.accounts.filter(group.filter).sort((a, b) => a.sortOrder - b.sortOrder);
    if (!accounts.length) return '';
    const total = accounts.reduce((sum, account) => sum + store.accountBalances(account.id).working, 0);
    const rows = accounts.map(account => {
      const balance = store.accountBalances(account.id).working;
      return h`<button class="accounts-row" data-account-id="${account.id}">
        <span class="accounts-glyph" aria-hidden="true">${accountGlyph(account)}</span>
        <span class="accounts-row-name">${account.name}</span>
        <span class="accounts-row-balance ${balance < 0 ? 'neg-text' : 'pos-text'}">${fmt(balance)}</span>
      </button>`;
    });
    return h`<section class="accounts-group">
      <div class="accounts-group-head"><h2>${group.label}</h2><span class="${total < 0 ? 'neg-text' : ''}">${fmt(total)}</span></div>
      <div class="accounts-card">${rows}</div>
    </section>`;
  });

  root.innerHTML = h`<div class="accounts-overview">
    <header class="accounts-overview-head mobile-page-head">
      <h1 class="mobile-page-title">Accounts</h1>
      <div class="accounts-head-actions mobile-page-actions">
        <button id="accounts-add-top" class="accounts-head-icon mobile-head-action" aria-label="Add account">${ICONS.add}</button>
        <button id="accounts-more" class="accounts-head-icon accounts-head-more mobile-head-action" aria-label="More account options">${ICONS.moreVertical}</button>
      </div>
    </header>
    ${introHidden ? '' : raw(`<section class="accounts-intro">
      <button id="accounts-intro-close" class="accounts-intro-close" aria-label="Dismiss">×</button>
      <div class="accounts-intro-icon" aria-hidden="true">◉</div>
      <h2>Private by design</h2>
      <p>Your balances and transactions stay on this device until you choose otherwise.</p>
      <button id="accounts-intro-action" class="accounts-intro-action">See how local data works</button>
    </section>`)}
    <div class="accounts-groups">${groupHtml}</div>
    <div class="accounts-overview-actions">
      <button id="accounts-add-bottom" class="accounts-wide-action"><span aria-hidden="true">${ICONS.addCircle}</span> Add Account</button>
      <button id="accounts-bank" class="accounts-wide-action"><span aria-hidden="true">${ICONS.accounts}</span> Manage Bank Connections</button>
    </div>
  </div>`;

  root.querySelectorAll('[data-account-id]').forEach(row => {
    row.onclick = () => {
      const account = store.state.accounts.find(item => item.id === row.dataset.accountId);
      navigate(account?.loanInfo ? `#/loan-account/${row.dataset.accountId}` : `#/account/${row.dataset.accountId}`);
    };
  });
  root.querySelector('#accounts-add-top').onclick = openAddAccountModal;
  root.querySelector('#accounts-add-bottom').onclick = openAddAccountModal;
  root.querySelector('#accounts-bank').onclick = openBankConnectionsInfo;
  root.querySelector('#accounts-more').onclick = openAccountsMore;
  root.querySelector('#accounts-intro-action')?.addEventListener('click', () => {
    const modal = openModal(h`<h2>Your data stays local</h2>
      <p class="muted">Kanevo stores your plan in this browser, works offline, and only exports data when you choose to create a backup.</p>
      <div class="modal-actions"><button class="btn" id="local-info-close">Got it</button></div>`);
    modal.querySelector('#local-info-close').onclick = closeModal;
  });
  root.querySelector('#accounts-intro-close')?.addEventListener('click', () => {
    localStorage.setItem('ss-accounts-intro-dismissed', '1');
    renderAccountsOverview(root);
  });
}

function accountGlyph(account) {
  if (account.loanInfo) return '⌂';
  if (account.type === 'creditCard') return '▰';
  if (account.type === 'savings') return '◇';
  if (account.type === 'cash') return '$';
  if (!account.onBudget) return '↗';
  return '▣';
}

function openBankConnectionsInfo() {
  const modal = openModal(h`<h2>Bank Connections</h2>
    <p class="muted">Secure bank syncing is planned. For now, Kanevo remains local-first and you can import or enter transactions manually.</p>
    <div class="modal-actions"><button class="btn" id="bank-info-close">Got it</button></div>`);
  modal.querySelector('#bank-info-close').onclick = closeModal;
}

function openAccountsMore() {
  const modal = openModal(h`<h2 class="mobile-options-title">Account options</h2>
    <div class="mobile-options-menu">
      <button class="mobile-options-row" id="accounts-more-add"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.addCircle}</span>Add an account</span></button>
      <button class="mobile-options-row" id="accounts-more-bank"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.accounts}</span>Bank connections</span></button>
      <button class="mobile-options-row" id="accounts-more-spending"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.spending}</span>Open all spending</span></button>
    </div>`);
  modal.classList.add('mobile-options-modal');
  modal.querySelector('#accounts-more-add').onclick = () => { closeModal(); openAddAccountModal(); };
  modal.querySelector('#accounts-more-bank').onclick = () => { closeModal(); openBankConnectionsInfo(); };
  modal.querySelector('#accounts-more-spending').onclick = () => { closeModal(); navigate('#/spending'); };
}

// ---------- mobile Spending feed ----------
let spendingSearchOpen = false;
let spendingOnlyUncleared = false;
let spendingScheduledOpen = false;
let spendingQuery = '';

export function renderSpendingOverview(root) {
  const all = sortTxs(gatherTxs(null));
  const pending = store.pendingGroups(null);
  const scheduled = store.upcomingScheduled(null, 365);
  const unclearedCount = all.filter(transaction => transaction.cleared === 'uncleared').length;
  const query = spendingQuery.trim().toLowerCase();
  const filtered = all.filter(transaction => {
    if (spendingOnlyUncleared && transaction.cleared !== 'uncleared') return false;
    if (!query) return true;
    const payee = spendingPayee(transaction).toLowerCase();
    const category = spendingCategory(transaction).toLowerCase();
    const account = store.state.accounts.find(item => item.id === transaction.accountId)?.name?.toLowerCase() || '';
    return payee.includes(query) || category.includes(query) || account.includes(query) || (transaction.memo || '').toLowerCase().includes(query);
  });

  root.innerHTML = h`<div class="spending-overview">
    <header class="spending-overview-head mobile-page-head">
      <h1 class="mobile-page-title">Spending</h1>
      <div class="spending-head-actions mobile-page-actions">
        <button id="spending-search-toggle" class="spending-head-icon mobile-head-action" aria-label="Search transactions">${ICONS.search}</button>
        <button id="spending-more" class="spending-head-icon mobile-head-action" aria-label="More spending options">${ICONS.moreVertical}</button>
      </div>
    </header>
    ${spendingSearchOpen ? h`<div class="spending-search-row mobile-search-shell">
      <span class="mobile-search-icon" aria-hidden="true">${ICONS.search}</span>
      <input id="spending-search-input" type="search" placeholder="Search transactions" value="${spendingQuery}">
      <button id="spending-search-close" aria-label="Close search">${ICONS.close}</button>
    </div>` : ''}
    ${pending.length ? h`<button class="mobile-account-approval spending-review-banner" id="spending-review-banner">
      <span><strong>${pending.reduce((sum, g) => sum + g.count, 0)}</strong> to review — ${pendingPreview(pending)}</span><span aria-hidden="true">›</span>
    </button>` : ''}
    ${scheduled.length ? h`<button class="spending-scheduled-link ${spendingScheduledOpen ? 'active' : ''}" id="spending-scheduled-toggle">
      <span><i aria-hidden="true">${ICONS.clock}</i> Upcoming scheduled</span>
      <span><strong>${scheduled.length}</strong><b class="spending-scheduled-chevron ${spendingScheduledOpen ? 'open' : ''}" aria-hidden="true">${ICONS.chevronDown}</b></span>
    </button>` : ''}
    ${spendingScheduledOpen ? h`<section class="spending-scheduled-panel">
      <div class="spending-scheduled-list">${scheduled.map(item => renderSchedCard(item, null))}</div>
    </section>` : ''}
    ${unclearedCount ? h`<button class="spending-uncleared ${spendingOnlyUncleared ? 'active' : ''}" id="spending-uncleared">
      <span>${spendingOnlyUncleared ? 'Showing' : 'Show'} <strong>${unclearedCount}</strong> uncleared transaction${unclearedCount === 1 ? '' : 's'}</span>
      <span aria-hidden="true">›</span>
    </button>` : ''}
    <div class="spending-feed">${filtered.length ? spendingFeedHtml(filtered) : raw('<div class="spending-empty">No transactions match this view.</div>')}</div>
  </div>`;

  root.querySelector('#spending-search-toggle').onclick = () => {
    spendingSearchOpen = !spendingSearchOpen;
    if (!spendingSearchOpen) spendingQuery = '';
    renderSpendingOverview(root);
  };
  root.querySelector('#spending-search-close')?.addEventListener('click', () => {
    spendingSearchOpen = false; spendingQuery = ''; renderSpendingOverview(root);
  });
  const searchInput = root.querySelector('#spending-search-input');
  if (searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput.oninput = debounce(() => { spendingQuery = searchInput.value; renderSpendingOverview(root); }, 120);
  }
  root.querySelector('#spending-uncleared')?.addEventListener('click', () => {
    spendingOnlyUncleared = !spendingOnlyUncleared;
    renderSpendingOverview(root);
  });
  root.querySelector('#spending-scheduled-toggle')?.addEventListener('click', () => {
    spendingScheduledOpen = !spendingScheduledOpen;
    renderSpendingOverview(root);
  });
  root.querySelector('#spending-more').onclick = () => openSpendingMore(root);
  root.querySelectorAll('[data-spending-tx]').forEach(row => {
    row.onclick = () => {
      const transaction = store.state.transactions.find(item => item.id === row.dataset.spendingTx);
      if (transaction) openAddTransactionModal(transaction.accountId, transaction.id);
    };
  });
  wireMobileApproveEdit(root, null, () => renderSpendingOverview(root));
  root.querySelector('#spending-review-banner')?.addEventListener('click', () => { location.hash = '#/review'; });
  wireScheduled(root, null, () => renderSpendingOverview(root));
}

function spendingFeedHtml(transactions) {
  const groups = [];
  for (const transaction of transactions) {
    let group = groups.find(item => item.date === transaction.date);
    if (!group) { group = { date: transaction.date, rows: [] }; groups.push(group); }
    group.rows.push(transaction);
  }
  return groups.map(group => h`<section class="spending-date-group">
    <div class="mobile-date-head">${fmtDate(group.date)}</div>
    <div class="mobile-date-card">${group.rows.map(transaction => renderMobileRow(transaction, { spending: true }))}</div>
  </section>`);
}

function spendingPayee(transaction) {
  if (transaction.transferAccountId) return transferPayeeLabel(transaction);
  return transaction.payeeId ? (store.getPayee(transaction.payeeId)?.name || 'Payee Needed') : 'Payee Needed';
}

function spendingCategory(transaction) {
  if (transaction.subtransactions?.length) return 'Split';
  if (transaction.categoryId === INFLOW) return 'Ready to Assign';
  return transaction.categoryId ? (store.state.categories.find(category => category.id === transaction.categoryId)?.name || '') : '';
}

function openSpendingMore(root) {
  const modal = openModal(h`<h2 class="mobile-options-title">Spending options</h2>
    <div class="mobile-options-menu">
      <button class="mobile-options-row" id="spending-more-filter"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.filter}</span>${spendingOnlyUncleared ? 'Show all transactions' : 'Show uncleared only'}</span></button>
      <button class="mobile-options-row" id="spending-more-scheduled"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.clock}</span>${spendingScheduledOpen ? 'Hide scheduled transactions' : 'Scheduled transactions'}</span></button>
      <button class="mobile-options-row" id="spending-more-add"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.addCircle}</span>Add a transaction</span></button>
      <button class="mobile-options-row" id="spending-more-learned"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.tag}</span>Learned merchants</span><span aria-hidden="true">›</span></button>
      <button class="mobile-options-row" id="spending-more-settings"><span class="mobile-options-row-main"><span class="mobile-options-icon" aria-hidden="true">${ICONS.settings}</span>Settings &amp; privacy</span><span aria-hidden="true">›</span></button>
    </div>`);
  modal.classList.add('mobile-options-modal');
  modal.querySelector('#spending-more-filter').onclick = () => { closeModal(); spendingOnlyUncleared = !spendingOnlyUncleared; renderSpendingOverview(root); };
  modal.querySelector('#spending-more-scheduled').onclick = () => { closeModal(); spendingScheduledOpen = !spendingScheduledOpen; renderSpendingOverview(root); };
  modal.querySelector('#spending-more-add').onclick = () => { closeModal(); openAddTransactionModal(); };
  modal.querySelector('#spending-more-learned').onclick = () => { closeModal(); openLearnedMerchantsSheet(); };
  modal.querySelector('#spending-more-settings').onclick = () => { closeModal(); navigate('#/settings'); };
}

// ---------- cross-account pending review (#/review) ----------
// "Woolworths ×6 · Shell ×2 · 3 more" — top two groups by count, ×N only for repeats
function pendingPreview(groups) {
  const top = groups.slice(0, 2).map(g => g.count > 1 ? `${g.payeeName} ×${g.count}` : g.payeeName).join(' · ');
  const more = groups.length - 2;
  return more > 0 ? `${top} · ${more} more` : top;
}

export function renderReview(root) {
  const pending = store.pendingGroups(null);
  root.innerHTML = h`<div class="spending-overview">
    <header class="settings-overview-head mobile-page-head">
      <button id="review-back" class="settings-back mobile-head-action" aria-label="Back">‹</button>
      <h1 class="mobile-page-title">Review</h1>
      <span class="settings-head-spacer" aria-hidden="true"></span>
    </header>
    ${pending.length ? renderPendingSection(pending, { showAccount: true }) : h`<div class="spending-empty">
      <p>All caught up — nothing to review.</p>
      <a class="link-btn" href="#/spending" style="margin-top:10px">Back to Spending</a>
    </div>`}
  </div>`;
  root.querySelector('#review-back').onclick = () => history.back();
  wirePendingSection(root, null, pending, () => renderReview(root));
}

// ---------- main render ----------
let lastRoot = null;
export function render(root, { accountId }) {
  lastRoot = root;
  curAccountId = accountId;
  const account = accountId ? store.state.accounts.find(a => a.id === accountId) : null;
  if (accountId && !account) { navigate('#/accounts'); return; }
  if (isMobile() && account?.loanInfo) { navigate(`#/loan-account/${account.id}`); return; }

  const txs = gatherTxs(accountId);
  const filtered = applyFilter(sortTxs(txs));
  const unapprovedCount = txs.filter(t => !t.approved).length;
  const scheduled = store.upcomingScheduled(accountId, 30);
  const bal = accountId ? store.accountBalances(accountId) : sumAllBalances();

  if (isMobile() && account) {
    renderMobileAccountDetail(root, { account, accountId, bal, filtered, scheduled, unapprovedCount });
    return;
  }

  root.innerHTML = h`
    <div class="reg-head view-head">
      <div class="reg-head-main">
        <div class="reg-title-row">
          ${account ? h`<button class="fav-star ${account.favorite ? 'active' : ''}" id="fav-toggle" title="Favorite">${account.favorite ? '★' : '☆'}</button>` : ''}
          <div class="view-title">${account ? account.name : 'All Accounts'}</div>
        </div>
        ${account ? renderSubline(account) : ''}
        ${account ? renderNote(account) : ''}
      </div>
      <div class="reg-head-actions">
        ${account ? raw(`<button class="icon-btn" id="edit-account-btn" title="Edit account">✏️</button>`) : ''}
        ${account ? raw(`<button class="btn" id="reconcile-btn">Reconcile</button>`) : ''}
        ${isMobile() ? h`<div class="view-menu-wrap view-menu-wrap-mobile">
          <button class="icon-btn view-menu-trigger-mobile" id="view-menu-btn" title="View options">⋮</button>
          ${viewMenuOpen ? renderViewMenu(true) : ''}
        </div>` : ''}
      </div>
    </div>

    <div class="reg-balances-row">
      <div class="reg-balances">
        <div class="bal-item"><span class="bal-val ${bal.cleared < 0 ? 'neg-text' : 'pos-text'}">${fmt(bal.cleared)} <span class="bal-clr-ico">ⓒ</span></span><span class="bal-label">Cleared Balance</span></div>
        <span class="bal-op">+</span>
        <div class="bal-item"><span class="bal-val ${bal.uncleared < 0 ? 'neg-text' : 'pos-text'}">${fmt(bal.uncleared)} <span class="bal-clr-ico">ⓒ</span></span><span class="bal-label">Uncleared Balance</span></div>
        <span class="bal-op">=</span>
        <div class="bal-item working"><span class="bal-val ${bal.working < 0 ? 'neg-text' : 'pos-text'}">${fmt(bal.working)}</span><span class="bal-label">Working Balance</span></div>
      </div>
    </div>

    <div class="reg-toolbar">
      <button class="link-btn" id="add-tx-btn"><span>⊕</span><span>Add Transaction</span></button>
      <button class="link-btn" id="link-account-btn"><span>🔗</span><span>Link Account</span></button>
      <button class="link-btn" id="file-import-btn"><span>📄</span><span>File Import</span></button>
      <button class="link-btn" id="undo-btn" ${store.canUndo() ? '' : 'disabled'}><span>↺</span><span>Undo</span></button>
      <button class="link-btn" id="redo-btn" disabled><span>↻</span><span>Redo</span></button>
      <div class="reg-toolbar-spacer"></div>
      ${!isMobile() ? h`<div class="view-menu-wrap">
        <button class="link-btn" id="view-menu-btn"><span>View</span><span class="caret">▾</span></button>
        ${viewMenuOpen ? renderViewMenu(false) : ''}
      </div>` : ''}
      <div class="reg-search-wrap">
        <span class="reg-search-ico">${ICONS.search}</span>
        <input class="reg-search" id="reg-search" type="search" placeholder="Search ${account ? account.name : 'All Accounts'}" value="${search}">
      </div>
    </div>

    ${unapprovedCount ? h`<button class="approval-banner" id="approval-banner">${unapprovedCount} transaction${unapprovedCount === 1 ? '' : 's'} need approval</button>` : ''}

    ${selectedIds.size ? renderBulkBar() : ''}

    ${scheduled.length ? renderScheduledSection(scheduled, accountId) : ''}

    ${isMobile() ? renderMobileList(filtered, accountId) : renderTable(filtered, accountId)}
  `;

  wireHead(root, account, accountId);
  wireToolbar(root, accountId, account);
  wireScheduled(root, accountId);
  wireBulkBar(root, accountId);
  if (isMobile()) wireMobileList(root, filtered, accountId);
  else wireTable(root, filtered, accountId);

  if (clipGalleryTx) openAttachmentGallery(clipGalleryTx);
}

function renderMobileAccountDetail(root, { account, accountId, bal, filtered, scheduled, unapprovedCount }) {
  const pending = store.pendingGroups(accountId);
  const typeLabel = TYPE_LABEL[account.type] || account.type;
  const reconTitle = account.lastReconciled ? `Balance verified ${fmtDate(account.lastReconciled)}` : 'Balance not verified yet';
  const reconCopy = account.lastReconciled
    ? 'On that date, you confirmed the cleared balance here matched your bank. Verify it again whenever you want to confirm your records are still accurate.'
    : `Compare the cleared balance of ${fmt(bal.cleared)} here with the balance in your bank app. If they match, mark it verified. Kanevo does not access your bank or move any money.`;
  const txLabel = `${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`;

  root.innerHTML = h`<div class="mobile-account-detail">
    <header class="mobile-account-head mobile-page-head">
      <button id="mobile-account-back" class="mobile-account-back mobile-head-action" aria-label="Back to accounts"><span aria-hidden="true">${ICONS.chevronDown}</span></button>
      <div class="mobile-account-head-copy">
        <div class="mobile-account-kicker">${typeLabel}</div>
        <h1>${account.name}</h1>
      </div>
      <button id="edit-account-btn" class="mobile-account-head-action mobile-head-action" aria-label="Edit account">${ICONS.edit}</button>
      <div class="view-menu-wrap mobile-account-menu-wrap">
        <button id="view-menu-btn" class="mobile-account-head-action mobile-head-action" aria-label="Account view options">${ICONS.moreVertical}</button>
        ${viewMenuOpen ? renderViewMenu(true) : ''}
      </div>
    </header>

    <div class="mobile-account-content">
      <section class="mobile-account-hero">
        <div class="mobile-account-hero-top">
          <span class="mobile-account-glyph" aria-hidden="true">${accountGlyph(account)}</span>
          <button class="mobile-account-favourite ${account.favorite ? 'active' : ''}" id="fav-toggle" aria-label="${account.favorite ? 'Remove from favourites' : 'Add to favourites'}">${account.favorite ? '★' : '☆'}</button>
        </div>
        <div class="mobile-account-balance ${bal.working < 0 ? 'neg-text' : 'pos-text'}">${fmt(bal.working)}</div>
        <div class="mobile-account-balance-label">Working balance</div>
        <div class="mobile-account-balance-grid">
          <div><span>Cleared</span><strong class="${bal.cleared < 0 ? 'neg-text' : ''}">${fmt(bal.cleared)}</strong></div>
          <div><span>Uncleared</span><strong class="${bal.uncleared < 0 ? 'neg-text' : ''}">${fmt(bal.uncleared)}</strong></div>
        </div>
        <div class="mobile-account-note reg-note" id="reg-note" contenteditable="true" data-placeholder="Add a note">${account.note || ''}</div>
      </section>

      <section class="mobile-account-reconcile-card" aria-label="Balance verification">
        <span class="mobile-account-reconcile-icon" aria-hidden="true">${account.lastReconciled ? '✓' : '!'}</span>
        <div><strong>${reconTitle}</strong><p>${reconCopy}</p></div>
        <button id="reconcile-btn"><span>${account.lastReconciled ? 'Verify again' : 'Verify balance'}</span><b aria-hidden="true">›</b></button>
      </section>

      <section class="mobile-account-actions" aria-label="Account actions">
        <button id="add-tx-btn"><span>${ICONS.addCircle}</span><strong>Add transaction</strong></button>
        <button id="undo-btn" ${store.canUndo() ? '' : 'disabled'}><span>${ICONS.undo}</span><strong>Undo change</strong></button>
        <button id="file-import-btn"><span>${ICONS.download}</span><strong>Import statement</strong></button>
        <button id="link-account-btn"><span>${ICONS.accounts}</span><strong>Link bank</strong></button>
      </section>
      <button id="redo-btn" hidden disabled>Redo</button>

      ${unapprovedCount ? h`<button class="mobile-account-approval" id="approval-banner"><span><strong>${unapprovedCount}</strong> transaction${unapprovedCount === 1 ? '' : 's'} need approval</span><span aria-hidden="true">›</span></button>` : ''}

      ${renderPendingSection(pending)}

      ${scheduled.length ? renderScheduledSection(scheduled, accountId) : ''}

      <section class="mobile-account-transactions">
        <div class="mobile-account-section-head"><h2>Transactions</h2><span>${txLabel}</span></div>
        <label class="mobile-account-search">
          <span aria-hidden="true">${ICONS.search}</span>
          <input class="reg-search" id="reg-search" type="search" aria-label="Search ${account.name}" placeholder="Search transactions" value="${search}">
        </label>
        ${renderMobileList(filtered, accountId, { showApproveActions: false })}
      </section>
    </div>
  </div>`;

  root.querySelector('#mobile-account-back').onclick = () => navigate('#/accounts');
  wireHead(root, account, accountId);
  wireToolbar(root, accountId, account);
  wirePendingSection(root, accountId, pending, () => render(root, { accountId }));
  wireScheduled(root, accountId);
  wireBulkBar(root, accountId);
  wireMobileList(root, filtered, accountId);
  if (clipGalleryTx) openAttachmentGallery(clipGalleryTx);
}

function renderSubline(account) {
  const typeLabel = TYPE_LABEL[account.type] || account.type;
  const recon = account.lastReconciled ? `Last reconciled ${fmtDate(account.lastReconciled)}` : 'Not Yet Reconciled';
  return h`<div class="reg-subline">💳 ${typeLabel} · 🔒 ${recon}</div>`;
}

function sumAllBalances() {
  const accs = store.state.accounts.filter(a => a.onBudget && !a.closed);
  return accs.reduce((s, a) => {
    const b = store.accountBalances(a.id);
    return { cleared: s.cleared + b.cleared, uncleared: s.uncleared + b.uncleared, working: s.working + b.working };
  }, { cleared: 0, uncleared: 0, working: 0 });
}

function renderNote(account) {
  return h`<div class="reg-note" id="reg-note" contenteditable="true" data-placeholder="Add a note...">${account.note || ''}</div>`;
}

function gatherTxs(accountId) {
  const all = store.state.transactions;
  const list = accountId ? all.filter(t => t.accountId === accountId) : all.filter(t => {
    const acc = store.state.accounts.find(a => a.id === t.accountId);
    return acc && acc.onBudget;
  });
  return list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function sortTxs(txs) {
  const list = txs.slice();
  list.sort((a, b) => sortDir === 'asc' ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id) : b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return list;
}

function applyFilter(txs) {
  let list = txs;
  if (filter === 'uncleared') list = list.filter(t => t.cleared === 'uncleared');
  else if (filter === 'unapproved') list = list.filter(t => !t.approved);
  else if (filter === 'scheduled') list = []; // scheduled shown in its own section only
  if (!showReconciled) list = list.filter(t => t.cleared !== 'reconciled');
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(t => {
      const payee = t.payeeId ? store.getPayee(t.payeeId)?.name : (t.transferAccountId ? transferPayeeLabel(t) : '');
      const amountStr = fmtExact(t.amount).toLowerCase();
      return (payee || '').toLowerCase().includes(q) || (t.memo || '').toLowerCase().includes(q) || amountStr.includes(q);
    });
  }
  return list;
}

// ---------- view menu ----------
function renderViewMenu(mobile) {
  return h`<div class="view-menu">
    <label class="view-menu-item"><input type="checkbox" id="vm-memo" ${showMemoCol ? 'checked' : ''}> Show ${mobile ? 'memo' : 'Memo column'}</label>
    <label class="view-menu-item"><input type="checkbox" id="vm-reconciled" ${showReconciled ? 'checked' : ''}> Show Reconciled</label>
    <label class="view-menu-item"><input type="checkbox" id="vm-compact" ${compactRows ? 'checked' : ''}> Compact rows</label>
  </div>`;
}

// ---------- bulk selection bar ----------
function renderBulkBar() {
  return h`<div class="bulk-bar"><span>${selectedIds.size} selected</span>
    <button class="link-btn" id="bulk-approve">Approve</button>
    <button class="link-btn" id="bulk-delete">Delete</button>
  </div>`;
}

function wireBulkBar(root, accountId) {
  const approveBtn = root.querySelector('#bulk-approve');
  if (approveBtn) approveBtn.onclick = () => {
    selectedIds.forEach(id => store.approveTransaction(id));
    selectedIds.clear();
    toast('Approved');
  };
  const delBtn = root.querySelector('#bulk-delete');
  if (delBtn) delBtn.onclick = async () => {
    if (!(await confirmSheet({ title: `Delete ${selectedIds.size} transaction(s)?`, confirmLabel: 'Delete', danger: true }))) return;
    selectedIds.forEach(id => store.deleteTransaction(id));
    selectedIds.clear();
    toast('Deleted');
  };
}

// ---------- scheduled section ----------
// 16px stroke icons for the mobile card's edit/delete — ICONS (util.js) has no pencil/trash, so inline them.
const SCHED_ICO_EDIT = raw('<svg class="sched-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19.5 3 20.5l1-4L16.5 3.5z"/></svg>');
const SCHED_ICO_DEL = raw('<svg class="sched-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/><path d="M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L18 7"/><path d="M10 11v5.5M14 11v5.5"/></svg>');

// Desktop keeps the existing 7-column grid row; mobile gets a compact folded card. Both keep the
// outer .sched-row + data-id and the .sched-enter/.sched-edit/.sched-del classes wireScheduled() binds.
function renderSchedRow(s, accountId) {
  const payee = s.payeeId ? store.getPayee(s.payeeId) : null;
  const acc = store.state.accounts.find(a => a.id === s.accountId);
  return h`<div class="sched-row" data-id="${s.id}">
    <span class="sched-freq">${FREQ_LABEL[s.frequency] || s.frequency}</span>
    <span class="sched-date">${fmtDate(s.nextDate)}</span>
    ${!accountId ? h`<span class="sched-acct">${acc ? acc.name : ''}</span>` : ''}
    <span class="sched-payee">${payee ? payee.name : '(no payee)'}</span>
    <span class="sched-memo muted">${s.memo || ''}</span>
    <span class="sched-amount ${s.amount > 0 ? 'pos-text' : ''}">${fmt(s.amount)}</span>
    <span class="sched-actions">
      <button class="icon-btn sched-enter" title="Enter now">✔️ Enter Now</button>
      <button class="icon-btn sched-edit" title="Edit">✏️</button>
      <button class="icon-btn sched-del" title="Delete">🗑️</button>
    </span>
  </div>`;
}

function renderSchedCard(s, accountId) {
  const payee = s.payeeId ? store.getPayee(s.payeeId) : null;
  const acc = store.state.accounts.find(a => a.id === s.accountId);
  const frequency = FREQ_LABEL[s.frequency] || s.frequency;
  const context = [acc?.name, s.memo].filter(Boolean).join(' · ');
  return h`<div class="sched-row sched-card" data-id="${s.id}">
    <div class="sched-card-top">
      <span class="sched-card-icon" aria-hidden="true">${ICONS.clock}</span>
      <div class="sched-card-info">
        <div class="sched-card-payee">${payee ? payee.name : '(no payee)'}</div>
        <div class="sched-card-schedule"><span>${frequency}</span><strong>Next: ${fmtDate(s.nextDate)}</strong></div>
        ${context ? h`<div class="sched-card-meta">${context}</div>` : ''}
      </div>
      <div class="sched-card-amt ${s.amount > 0 ? 'pos-text' : 'neg-text'}">${fmt(s.amount)}</div>
    </div>
    <div class="sched-card-actions">
      <button class="sched-enter">Enter now <span aria-hidden="true">›</span></button>
      <span class="sched-card-spacer"></span>
      <button class="icon-btn sched-edit" aria-label="Edit scheduled transaction">${SCHED_ICO_EDIT}</button>
      <button class="icon-btn sched-del" aria-label="Delete scheduled transaction">${SCHED_ICO_DEL}</button>
    </div>
  </div>`;
}

function renderScheduledSection(scheduled, accountId) {
  const mobile = isMobile();
  const rows = scheduled.map(s => mobile ? renderSchedCard(s, accountId) : renderSchedRow(s, accountId));
  return h`<div class="sched-section">
    <button class="sched-head" id="sched-toggle">
      <span class="sched-caret">${scheduledOpen ? '▾' : '▸'}</span> Scheduled (${scheduled.length})
    </button>
    <div class="sched-list" ${scheduledOpen ? '' : 'hidden'}>${rows.length ? rows : raw('<div class="muted sched-empty">Nothing upcoming.</div>')}</div>
  </div>`;
}

function wireScheduled(root, accountId, rerender = () => render(root, { accountId })) {
  const toggle = root.querySelector('#sched-toggle');
  if (toggle) toggle.onclick = () => { scheduledOpen = !scheduledOpen; rerender(); };
  root.querySelectorAll('.sched-row').forEach(row => {
    const id = row.dataset.id;
    const s = store.state.scheduled.find(x => x.id === id);
    if (!s) return;
    row.querySelector('.sched-enter').onclick = () => {
      store.addTransaction({
        accountId: s.accountId, date: todayISO(), payeeId: s.payeeId, categoryId: s.categoryId,
        memo: s.memo, amount: s.amount, cleared: 'uncleared', approved: true, flag: s.flag,
      });
      store.updateScheduled(id, { nextDate: advanceDate(s.nextDate, s.frequency) });
      toast('Transaction entered');
      rerender();
    };
    row.querySelector('.sched-del').onclick = async () => {
      if (!(await confirmSheet({ title: 'Delete this scheduled transaction?', confirmLabel: 'Delete', danger: true }))) return;
      store.deleteScheduled(id);
      rerender();
    };
    row.querySelector('.sched-edit').onclick = () => openScheduledEditModal(s);
  });
}

function advanceDate(dateStr, frequency) {
  if (frequency === 'weekly' || frequency === 'fortnightly') {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + (frequency === 'weekly' ? 7 : 14));
    return d.toISOString().slice(0, 10);
  }
  const months = FREQ_MONTHS[frequency] || 1; // default: monthly (matches prior fallback behavior)
  const [y, m, day] = dateStr.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nmZero = total % 12;
  const clamped = Math.min(day, new Date(ny, nmZero + 1, 0).getDate());
  return `${ny}-${String(nmZero + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function openScheduledEditModal(s) {
  const accounts = store.state.accounts.filter(a => !a.closed);
  openModal(h`<h2>Edit Scheduled Transaction</h2>
    <div class="form-row"><label>Account</label>
      <select id="sc-account">${raw(accounts.map(a => `<option value="${a.id}" ${a.id === s.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join(''))}</select>
    </div>
    <div class="form-row"><label>Payee</label><input id="sc-payee" type="text" value="${store.getPayee(s.payeeId)?.name || ''}"></div>
    <div class="form-row"><label>Memo</label><input id="sc-memo" type="text" value="${s.memo || ''}"></div>
    <div class="form-row"><label>Amount</label><input id="sc-amount" type="text" value="${fmtExact(s.amount)}"></div>
    <div class="form-row"><label>Next Date</label><input id="sc-date" type="date" value="${s.nextDate}"></div>
    <div class="form-row"><label>Frequency</label>
      <select id="sc-freq">${raw(Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${k === s.frequency ? 'selected' : ''}>${v}</option>`).join(''))}</select>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="sc-cancel">Cancel</button>
      <button class="btn" id="sc-save">Save</button>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#sc-cancel').onclick = closeModal;
      modal.querySelector('#sc-save').onclick = () => {
        const name = modal.querySelector('#sc-payee').value.trim();
        const payeeId = name ? store.findOrCreatePayee(name) : null; // returns the id string
        store.updateScheduled(s.id, {
          accountId: modal.querySelector('#sc-account').value,
          payeeId,
          memo: modal.querySelector('#sc-memo').value,
          amount: parseAmount(modal.querySelector('#sc-amount').value),
          nextDate: modal.querySelector('#sc-date').value,
          frequency: modal.querySelector('#sc-freq').value,
        });
        closeModal();
        toast('Scheduled transaction updated');
      };
    },
  });
}

// ---------- header wiring ----------
function wireHead(root, account, accountId) {
  const note = root.querySelector('#reg-note');
  if (note) note.onblur = () => store.updateAccount(accountId, { note: note.textContent.trim() });

  const favBtn = root.querySelector('#fav-toggle');
  if (favBtn) favBtn.onclick = () => store.updateAccount(accountId, { favorite: !account.favorite });

  const editBtn = root.querySelector('#edit-account-btn');
  if (editBtn) editBtn.onclick = () => openEditAccountModal(account);

  const reconcileBtn = root.querySelector('#reconcile-btn');
  if (reconcileBtn) reconcileBtn.onclick = () => openReconcileModal(accountId);
}

function openEditAccountModal(account) {
  openModal(h`<h2>Edit Account</h2>
    <div class="form-row"><label>Name</label><input id="ea-name" type="text" value="${account.name}"></div>
    <div class="form-row"><label>Note</label><textarea id="ea-note" rows="3">${account.note || ''}</textarea></div>
    <div class="modal-actions">
      <button class="btn danger" id="ea-close" style="margin-right:auto">Close Account</button>
      <button class="btn secondary" id="ea-cancel">Cancel</button>
      <button class="btn" id="ea-save">Save</button>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#ea-cancel').onclick = closeModal;
      modal.querySelector('#ea-save').onclick = () => {
        store.updateAccount(account.id, { name: modal.querySelector('#ea-name').value.trim(), note: modal.querySelector('#ea-note').value });
        closeModal();
        toast('Account updated');
      };
      modal.querySelector('#ea-close').onclick = async () => {
        if (!(await confirmSheet({ title: `Close "${account.name}"?`, body: 'You can reopen it later from settings.', confirmLabel: 'Close Account', danger: true }))) return;
        store.closeAccount(account.id);
        closeModal();
        navigate('#/accounts');
      };
    },
  });
}

function openReconcileModal(accountId) {
  const bal = store.accountBalances(accountId);
  openModal(h`<div class="reconcile-modal-content"><h2>Verify your balance</h2>
    <p class="reconcile-explainer">Look at this account in your bank app. Does its cleared balance match <strong>${fmt(bal.cleared)}</strong> here?</p>
    <p class="muted reconcile-help">If it matches, Kanevo records that you verified these cleared transactions. It does not connect to or change anything at your bank.</p>
    <div class="modal-actions reconcile-choice-actions">
      <button class="btn secondary" id="rec-no">No, balances differ</button>
      <button class="btn" id="rec-yes">Yes, they match</button>
    </div>
    <div class="form-row" id="rec-no-block" hidden style="margin-top:14px">
      <label>Balance shown by your bank</label>
      <input id="rec-actual" type="text" placeholder="$0.00">
      <p class="muted reconcile-help">We will add one adjustment transaction for the difference, then mark the balance verified.</p>
      <div class="modal-actions"><button class="btn" id="rec-adjust">Add adjustment and finish</button></div>
    </div></div>`, {
    onOpen: modal => {
      modal.querySelector('#rec-yes').onclick = () => {
        store.reconcileAccount(accountId, bal.cleared);
        store.updateAccount(accountId, { lastReconciled: todayISO() });
        closeModal();
        toast('Balance verified ✓');
      };
      modal.querySelector('#rec-no').onclick = () => {
        modal.querySelector('#rec-no-block').hidden = false;
        modal.querySelector('#rec-actual').focus();
      };
      modal.querySelector('#rec-adjust').onclick = () => {
        const cents = parseAmount(modal.querySelector('#rec-actual').value);
        store.reconcileAccount(accountId, cents);
        store.updateAccount(accountId, { lastReconciled: todayISO() });
        closeModal();
        toast('Balance verified ✓');
      };
    },
  });
}

// ---------- toolbar wiring ----------
function wireToolbar(root, accountId, account) {
  const addBtn = root.querySelector('#add-tx-btn');
  if (addBtn) addBtn.onclick = () => {
    if (isMobile()) { openAddTransactionModal(accountId); return; }
    editingId = 'new';
    editState = blankEdit(accountId);
    datePopoverOpen = false; categoryPopoverOpen = false; flagPopoverOpen = false;
    render(root, { accountId });
  };
  const linkBtn = root.querySelector('#link-account-btn');
  if (linkBtn) linkBtn.onclick = () => openLinkAccountModal(accountId);
  const importBtn = root.querySelector('#file-import-btn');
  if (importBtn) importBtn.onclick = () => openFileImportModal(accountId);
  const undoBtn = root.querySelector('#undo-btn');
  if (undoBtn) undoBtn.onclick = () => { if (store.canUndo()) store.undo(); };
  // Redo is permanently disabled — store has no redo stack. ponytail: add a redo stack if this ever matters.

  const searchEl = root.querySelector('#reg-search');
  if (searchEl) searchEl.oninput = debounce(() => { search = searchEl.value; render(root, { accountId }); }, 200);

  const banner = root.querySelector('#approval-banner');
  if (banner) banner.onclick = () => {
    filter = 'unapproved';
    render(root, { accountId });
    // banner sits above the fold on mobile; nothing else signals the re-render happened, so
    // scroll the (freshly re-rendered) list into view.
    root.querySelector('.mobile-account-transactions, .reg-mobile-list, .reg-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const viewBtn = root.querySelector('#view-menu-btn');
  if (viewBtn) viewBtn.onclick = e => { e.stopPropagation(); viewMenuOpen = !viewMenuOpen; render(root, { accountId }); };
  const vmMemo = root.querySelector('#vm-memo');
  if (vmMemo) vmMemo.onchange = () => { showMemoCol = vmMemo.checked; localStorage.setItem('ss-reg-show-memo', showMemoCol ? '1' : '0'); render(root, { accountId }); };
  const vmReconciled = root.querySelector('#vm-reconciled');
  if (vmReconciled) vmReconciled.onchange = () => { showReconciled = vmReconciled.checked; localStorage.setItem('ss-reg-show-reconciled', showReconciled ? '1' : '0'); render(root, { accountId }); };
  const vmCompact = root.querySelector('#vm-compact');
  if (vmCompact) vmCompact.onchange = () => { compactRows = vmCompact.checked; localStorage.setItem('ss-reg-compact-rows', compactRows ? '1' : '0'); render(root, { accountId }); };
}

function openLinkAccountModal(accountId) {
  openModal(h`<h2>Link Account</h2>
    <p class="muted" style="margin-bottom:14px">Your own copy. Direct bank syncing via Basiq is coming soon. Until then, simulate a bank feed to see how imported transactions and matching work.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="la-cancel">Cancel</button>
      <button class="btn" id="la-simulate">Simulate bank feed</button>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#la-cancel').onclick = closeModal;
      modal.querySelector('#la-simulate').onclick = () => {
        const targetAccountId = accountId || store.state.accounts.find(a => a.onBudget && !a.closed)?.id;
        if (!targetAccountId) { toast('No account to sync'); closeModal(); return; }
        const bankTxns = simulateBankFeed(targetAccountId);
        store.importTransactions(targetAccountId, bankTxns);
        closeModal();
        toast(`${bankTxns.length} transactions imported`);
      };
    },
  });
}

// exported for the Settings view, which hands over an already-picked statement file
export function openFileImportModal(accountId, initialFile) {
  const accounts = store.state.accounts.filter(a => !a.closed);
  const defaultAcc = accountId || accounts[0]?.id;
  openModal(h`<h2>File Import</h2>
    <div class="form-row"><label>Bank statement (CSV) or plan backup (JSON)</label><input id="fi-file" type="file"></div>
    <div id="fi-csv" hidden>
      <div class="form-row"><label>Into account</label>
        <select id="fi-account">${raw(accounts.map(a => `<option value="${a.id}" ${a.id === defaultAcc ? 'selected' : ''}>${esc(a.name)}</option>`).join(''))}</select>
      </div>
      <div id="fi-mapping"></div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input id="fi-flip" type="checkbox" style="width:auto">Flip signs (statement shows spending as positive)</label></div>
      <div id="fi-preview"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="fi-cancel">Cancel</button>
      <button class="btn" id="fi-import">Import</button>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#fi-cancel').onclick = closeModal;
      let csv = null; // { rows, columns, dataStart } once a CSV is chosen

      const ROLES = [['date', 'Date'], ['amount', 'Amount'], ['debit', 'Debit'], ['credit', 'Credit'], ['description', 'Payee / description'], ['memo', 'Memo']];
      const colLabel = c => csv.headers?.[c]?.trim() || `Column ${c + 1} (${(csv.rows[csv.dataStart]?.[c] ?? '').slice(0, 18)})`;

      const renderCsv = () => {
        const width = Math.max(...csv.rows.slice(csv.dataStart, csv.dataStart + 5).map(r => r.length), 0);
        modal.querySelector('#fi-mapping').innerHTML = ROLES.map(([role, label]) => h`<div class="form-row"><label>${label}</label>
          <select data-role="${role}"><option value="">—</option>${raw(Array.from({ length: width }, (_, c) =>
            `<option value="${c}" ${csv.columns[role] === c ? 'selected' : ''}>${esc(colLabel(c))}</option>`).join(''))}</select></div>`).join('');
        modal.querySelectorAll('#fi-mapping select').forEach(sel => sel.onchange = () => {
          csv.columns[sel.dataset.role] = sel.value === '' ? undefined : +sel.value;
          renderPreview();
        });
        renderPreview();
      };

      const renderPreview = () => {
        const { txns, skipped } = buildTxns(csv.rows, csv.columns, { dataStart: csv.dataStart, flip: modal.querySelector('#fi-flip').checked });
        modal.querySelector('#fi-preview').innerHTML = txns.length
          ? h`<table class="fi-preview-table" style="width:100%;font-size:13px;margin:6px 0"><tbody>${raw(txns.slice(0, 5).map(t =>
              `<tr><td>${esc(fmtDate(t.date))}</td><td>${esc(t.payeeName || '—')}</td><td style="text-align:right">${esc(fmtExact(t.amount))}</td></tr>`).join(''))}</tbody></table>
            <p class="muted" style="font-size:13px">${txns.length} transaction${txns.length === 1 ? '' : 's'} ready${skipped ? ` · ${skipped} row${skipped === 1 ? '' : 's'} skipped (no date/amount)` : ''}</p>`
          : h`<p class="muted" style="font-size:13px">No transactions detected — check the column mapping above.</p>`;
      };

      modal.querySelector('#fi-flip').onchange = () => { if (csv) renderPreview(); };
      let pickedFile = null;
      // .json = plan backup; anything else (csv, txt, whatever the bank exports) tries the statement parser
      const handleFile = async file => {
        pickedFile = file;
        if (/\.json$/i.test(file.name) || file.type === 'application/json') {
          csv = null;
          modal.querySelector('#fi-csv').hidden = true;
        } else {
          try { csv = parseStatement(await file.text()); }
          catch { toast('Could not read that file as a statement'); return; }
          modal.querySelector('#fi-csv').hidden = false;
          renderCsv();
        }
      };
      modal.querySelector('#fi-file').onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]); };
      if (initialFile) {
        try { const dt = new DataTransfer(); dt.items.add(initialFile); modal.querySelector('#fi-file').files = dt.files; } catch { /* cosmetic only */ }
        handleFile(initialFile);
      }

      modal.querySelector('#fi-import').onclick = async () => {
        const file = pickedFile;
        if (!file) { toast('Choose a file first'); return; }
        if (csv) {
          const targetId = modal.querySelector('#fi-account').value;
          if (!targetId) { toast('Add an account first, then import your statement'); return; }
          const { txns } = buildTxns(csv.rows, csv.columns, { dataStart: csv.dataStart, flip: modal.querySelector('#fi-flip').checked });
          if (!txns.length) { toast('No transactions to import — check the column mapping'); return; }
          const { inserted, merged, skipped } = store.importTransactions(targetId, txns);
          closeModal();
          toast(`${inserted} imported${merged ? `, ${merged} matched to existing` : ''}${skipped ? `, ${skipped} already imported` : ''}`);
          return;
        }
        if (!(await confirmSheet({ title: 'Replace your current plan data?', body: 'This will overwrite everything currently in Kanevo with the imported backup.', confirmLabel: 'Replace', danger: true }))) return;
        try {
          store.importJSON(await file.text());
          closeModal();
          toast('Plan backup imported');
        } catch {
          toast('Could not read that file');
        }
      };
    },
  });
}

// ---------- desktop table ----------
function renderTable(txs, accountId) {
  const showAccount = !accountId;
  const rows = [];
  if (editingId === 'new') rows.push(renderEditRow('new', editState, accountId));
  for (const t of txs) {
    if (editingId === t.id) rows.push(renderEditRow(t.id, editState, accountId));
    else rows.push(renderReadRow(t, showAccount));
  }
  const allChecked = txs.length > 0 && txs.every(t => selectedIds.has(t.id));
  return h`<div class="reg-table-wrap">
    <table class="reg-table ${compactRows ? 'compact' : ''}">
      <thead><tr>
        <th class="col-check"><input type="checkbox" id="select-all-cb" ${allChecked ? 'checked' : ''}></th>
        <th class="col-flag"></th>
        <th class="col-clip">📷</th>
        ${showAccount ? raw('<th>Account</th>') : ''}
        <th class="col-date" id="date-sort-th">Date <span class="sort-caret">${sortDir === 'asc' ? '▴' : '▾'}</span></th>
        <th>Payee</th><th>Category</th>
        ${showMemoCol ? raw('<th>Memo</th>') : ''}
        <th class="num">Outflow</th><th class="num">Inflow</th>
        <th class="col-clr">ⓒ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${!txs.length && editingId !== 'new' ? raw('<div class="empty-state">No transactions.</div>') : ''}
  </div>`;
}

// Flag glyph: unset = subtle gray outline flag; set = filled colored flag. Color comes from the
// .flag-ico-<color> CSS class (same palette as the old flag-dot classes), not inlined here.
function flagIcon(flag) {
  const path = 'M1.5 4.5h8l3.5 4.25-3.5 4.25h-8Z';
  if (!flag) {
    return raw(`<svg class="flag-ico flag-ico-none" viewBox="0 0 14 17.5" width="14" height="17.5">
      <path d="${path}" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`);
  }
  return raw(`<svg class="flag-ico flag-ico-${flag}" viewBox="0 0 14 17.5" width="14" height="17.5">
    <path d="${path}"/>
  </svg>`);
}

function clearedIcon(t) {
  if (t.cleared === 'reconciled') return raw(`<span class="clr-icon clr-reconciled" title="Reconciled">🔒</span>`);
  if (t.cleared === 'cleared') return raw(`<span class="clr-icon clr-cleared" data-clr="1" title="Cleared">Ⓒ</span>`);
  return raw(`<span class="clr-icon clr-uncleared" data-clr="1" title="Uncleared">Ⓒ</span>`);
}

function renderReadRow(t, showAccount) {
  const payee = t.payeeId ? store.getPayee(t.payeeId) : null;
  const payeeName = t.transferAccountId ? transferPayeeLabel(t) : (payee ? payee.name : '(no payee)');
  const cat = t.subtransactions ? 'Split' : (t.categoryId === INFLOW ? 'Ready to Assign' : (t.categoryId ? store.state.categories.find(c => c.id === t.categoryId)?.name : ''));
  const acc = showAccount ? store.state.accounts.find(a => a.id === t.accountId) : null;
  const isMatch = !t.approved && store.matchCandidates(t.accountId).some(m => m.imported?.id === t.id && m.match);
  return h`<tr class="reg-row ${!t.approved ? 'unapproved-row' : ''}" data-id="${t.id}">
    <td class="col-check" data-action="check"><input type="checkbox" class="row-cb" ${selectedIds.has(t.id) ? 'checked' : ''}></td>
    <td class="col-flag flag-cell" data-action="flag">${flagIcon(t.flag)}</td>
    <td class="col-clip" data-action="clip">${(t.attachments && t.attachments.length) ? '📷' : ''}</td>
    ${showAccount ? h`<td>${acc ? acc.name : ''}</td>` : ''}
    <td>${fmtDate(t.date)}</td>
    <td>${!t.approved ? raw('<span class="unapproved-dot"></span>') : ''}${payeeName}${isMatch ? raw(' <span class="match-badge">MATCH</span>') : ''}</td>
    <td>${cat || ''}${cat && t.autoCategorized && !t.approved ? raw(' <span class="auto-badge" title="Auto-categorized — approving confirms it">AUTO</span>') : ''}</td>
    ${showMemoCol ? h`<td class="muted">${t.memo || ''}</td>` : ''}
    <td class="num neg-text">${t.amount < 0 ? fmt(-t.amount) : ''}</td>
    <td class="num pos-text">${t.amount > 0 ? fmt(t.amount) : ''}</td>
    <td class="col-clr" data-action="cleared">${clearedIcon(t)}</td>
    ${!t.approved ? raw(`<td class="approve-actions">
        <button class="icon-btn approve-btn" title="Approve">✓</button>
        <button class="icon-btn reject-btn" title="Reject">✕</button>
      </td>`) : ''}
  </tr>`;
}

function categoryOptionsHtml(selectedId, isInflow, month) {
  // used by native <select> fallbacks: split rows + the mobile add-transaction modal
  const groups = store.state.categoryGroups.filter(g => !g.hidden);
  const md = store.monthData(month || todayISO().slice(0, 7));
  const opts = [];
  if (isInflow) {
    const rta = md.rta;
    opts.push(`<optgroup label="Inflow"><option value="${INFLOW}" ${selectedId === INFLOW ? 'selected' : ''}>Ready to Assign (${fmt(rta)})</option></optgroup>`);
  }
  for (const g of groups) {
    const mdGroup = md.groups.find(x => x.id === g.id);
    const cats = store.state.categories.filter(c => c.groupId === g.id && !c.hidden);
    if (!cats.length) continue;
    opts.push(`<optgroup label="${esc(g.name)}">`);
    for (const c of cats) {
      const mc = mdGroup?.categories.find(x => x.id === c.id);
      const avail = mc ? fmt(mc.available) : '';
      opts.push(`<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} (${avail})</option>`);
    }
    opts.push('</optgroup>');
  }
  return raw(`<option value="">Select category...</option>${opts.join('')}`);
}

function categoryName(id) {
  if (id === INFLOW) return 'Ready to Assign';
  const c = store.state.categories.find(x => x.id === id);
  return c ? c.name : '';
}

// custom category dropdown: "⊕ New Category" header, grouped options w/ amounts, footer Split button
function renderCategoryPopover(selectedId, isInflow, month) {
  const groups = store.state.categoryGroups.filter(g => !g.hidden);
  const md = store.monthData(month || todayISO().slice(0, 7));
  const rows = [`<div class="cat-pop-new" id="cat-pop-new">⊕ New Category</div>`];
  if (isInflow) {
    rows.push(`<div class="cat-pop-group-label">Inflow</div>`);
    rows.push(`<div class="cat-pop-item ${selectedId === INFLOW ? 'selected' : ''}" data-cat="${INFLOW}"><span>Ready to Assign</span><span class="cat-pop-amt pos-text">${fmt(md.rta)}</span></div>`);
  }
  for (const g of groups) {
    const mdGroup = md.groups.find(x => x.id === g.id);
    const cats = store.state.categories.filter(c => c.groupId === g.id && !c.hidden);
    if (!cats.length) continue;
    rows.push(`<div class="cat-pop-group-label">${esc(g.name)}</div>`);
    for (const c of cats) {
      const mc = mdGroup?.categories.find(x => x.id === c.id);
      const avail = mc ? fmt(mc.available) : '';
      rows.push(`<div class="cat-pop-item ${c.id === selectedId ? 'selected' : ''}" data-cat="${c.id}"><span>${esc(c.name)}</span><span class="cat-pop-amt muted">${avail}</span></div>`);
    }
  }
  return h`<div class="cat-popover" id="cat-popover">
    <div class="cat-pop-list">${raw(rows.join(''))}</div>
    <button type="button" class="cat-pop-split-btn" id="cat-pop-split-btn">Split (Multiple Categories)</button>
  </div>`;
}

// flag picker popover: same family as the calendar/category dropdowns (radius 8, shadow, bg-alt hover)
function renderFlagPopover(selectedFlag) {
  const rows = [`<div class="flag-pop-item ${!selectedFlag ? 'selected' : ''}" data-flag="">${flagIcon(null)}<span>None</span></div>`];
  for (const f of FLAGS) {
    rows.push(`<div class="flag-pop-item ${f === selectedFlag ? 'selected' : ''}" data-flag="${f}">${flagIcon(f)}<span>${f[0].toUpperCase()}${f.slice(1)}</span></div>`);
  }
  return h`<div class="flag-popover" id="flag-popover">${raw(rows.join(''))}</div>`;
}

function otherOpenAccounts(excludeId) {
  return store.state.accounts.filter(a => !a.closed && a.id !== excludeId);
}

function renderEditRow(id, st, accountId) {
  const showAccount = !accountId;
  const isSplit = !!st.subtransactions;
  const splitTotal = isSplit ? st.subtransactions.reduce((s, x) => s + x.amount, 0) : 0;
  const mainAmount = st.outflow ? -parseAmount(st.outflow) : (st.inflow ? parseAmount(st.inflow) : 0);
  const remaining = mainAmount - splitTotal;
  const month = (st.date || todayISO()).slice(0, 7);
  const colCount = 9 + (showAccount ? 1 : 0) + (showMemoCol ? 1 : 0);

  return h`<tr class="reg-edit-row" data-id="${id}">
    <td colspan="${colCount}">
      <div class="edit-form">
        <div class="edit-form-main">
          <div class="ef-field ef-flag">
            <div class="flag-picker-trigger" id="ef-flag-trigger">${flagIcon(st.flag)}</div>
            ${flagPopoverOpen ? renderFlagPopover(st.flag) : ''}
          </div>
          <div class="ef-field ef-date">
            <input type="text" id="ef-date" readonly value="${fmtDate(st.date)}">
            ${datePopoverOpen ? renderDatePopover(st.date) : ''}
          </div>
          <div class="ef-field ef-payee">
            <input type="text" id="ef-payee" placeholder="Payee" value="${st.payeeText}" autocomplete="off">
            <div class="autocomplete-list" id="ef-payee-ac" hidden></div>
          </div>
          <div class="ef-field ef-category">
            ${renderCategoryDropdown(st, mainAmount, month, isSplit)}
          </div>
          <div class="ef-field ef-memo"><input type="text" id="ef-memo" placeholder="Memo" value="${st.memo}" ${isSplit ? 'disabled' : ''}></div>
          <div class="ef-field ef-outflow"><input type="text" id="ef-outflow" placeholder="Outflow" value="${st.outflow}"></div>
          <div class="ef-field ef-inflow"><input type="text" id="ef-inflow" placeholder="Inflow" value="${st.inflow}"></div>
          <div class="ef-field ef-cleared"><label class="ef-cleared-label"><input type="checkbox" id="ef-cleared" ${st.cleared ? 'checked' : ''}> Cleared</label></div>
          <div class="ef-field ef-attach">
            <label class="btn secondary sm">📷 Attach<input type="file" id="ef-file" accept="image/*" capture hidden></label>
          </div>
        </div>
        ${st.attachments.length ? h`<div class="ef-attachments">${st.attachments.map((a, i) => h`<img src="${a}" class="ef-thumb" data-idx="${i}">`)}</div>` : ''}
        <div class="ef-split-block" id="ef-split-block">
          ${isSplit ? renderSplitRows(st, mainAmount, month) : ''}
        </div>
        <div class="edit-form-actions">
          ${isSplit ? h`<span class="split-remaining ${remaining !== 0 ? 'neg-text' : 'pos-text'}">Remaining: ${fmt(remaining)}</span>` : ''}
          <div class="ef-spacer"></div>
          ${id !== 'new' ? raw(`<button class="btn danger sm" id="ef-delete">Delete</button>`) : ''}
          <button class="btn secondary" id="ef-cancel">Cancel</button>
          <button class="btn" id="ef-save">Save</button>
          <button class="btn" id="ef-save-another">Save and add another</button>
        </div>
      </div>
    </td>
  </tr>`;
}

function renderDatePopover(dateStr) {
  const cur = dateStr || todayISO();
  const today = todayISO();
  const month = datePopoverMonth || cur.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell cal-empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const selected = iso === cur;
    const isToday = iso === today;
    cells.push(`<button type="button" class="cal-cell cal-day ${selected ? 'selected' : ''} ${isToday ? 'today' : ''}" data-date="${iso}">${d}</button>`);
  }
  return h`<div class="date-popover" id="date-popover">
    <div class="cal-nav"><button type="button" id="cal-prev">‹</button><span>${MONTH_NAMES[m - 1]} ${y}</span><button type="button" id="cal-next">›</button></div>
    <div class="cal-grid cal-dow">${DOW.map(d => h`<div class="cal-cell cal-dow-cell">${d}</div>`)}</div>
    <div class="cal-grid">${raw(cells.join(''))}</div>
    <div class="cal-repeat">
      <label>Repeat:</label>
      <select id="cal-repeat-select">
        <option value="none" ${repeatChoice === 'none' ? 'selected' : ''}>Never</option>
        <option value="weekly" ${repeatChoice === 'weekly' ? 'selected' : ''}>Weekly</option>
        <option value="fortnightly" ${repeatChoice === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
        <option value="monthly" ${repeatChoice === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="every2months" ${repeatChoice === 'every2months' ? 'selected' : ''}>Every 2 Months</option>
        <option value="quarterly" ${repeatChoice === 'quarterly' ? 'selected' : ''}>Every 3 Months</option>
        <option value="twiceayear" ${repeatChoice === 'twiceayear' ? 'selected' : ''}>Every 6 Months</option>
        <option value="yearly" ${repeatChoice === 'yearly' ? 'selected' : ''}>Yearly</option>
      </select>
    </div>
  </div>`;
}

function renderCategoryDropdown(st, mainAmount, month, isSplit) {
  if (isSplit) return raw(`<input type="text" value="Split (Multiple Categories)" disabled>`);
  const label = st.categoryId ? categoryName(st.categoryId) : 'Select category...';
  return h`<input type="text" id="ef-category-trigger" readonly value="${label}" placeholder="Select category...">
    ${categoryPopoverOpen ? renderCategoryPopover(st.categoryId, mainAmount > 0, month) : ''}`;
}

function renderSplitRows(st, mainAmount, month) {
  const rows = st.subtransactions.map((s, i) => h`<div class="split-row" data-idx="${i}">
    <select class="split-cat">${categoryOptionsHtml(s.categoryId, mainAmount > 0, month)}</select>
    <input type="text" class="split-amount" inputmode="decimal" value="${s.amount ? fmtExact(Math.abs(s.amount)) : ''}" placeholder="$0.00">
    <input type="text" class="split-memo" value="${s.memo || ''}" placeholder="Memo">
    <button class="icon-btn split-del" title="Remove">✕</button>
  </div>`);
  return h`<div class="split-rows">${rows}</div><button class="btn secondary sm" id="split-add-row">+ Add split</button>`;
}

function wireTable(root, txs, accountId) {
  const selectAllCb = root.querySelector('#select-all-cb');
  if (selectAllCb) selectAllCb.onchange = () => {
    if (selectAllCb.checked) txs.forEach(t => selectedIds.add(t.id));
    else txs.forEach(t => selectedIds.delete(t.id));
    render(root, { accountId });
  };

  const dateSortTh = root.querySelector('#date-sort-th');
  if (dateSortTh) dateSortTh.onclick = () => { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; render(root, { accountId }); };

  root.querySelectorAll('.reg-row').forEach(row => {
    const id = row.dataset.id;
    const t = store.state.transactions.find(x => x.id === id);
    if (!t) return;
    row.querySelector('[data-action="cleared"]')?.addEventListener('click', e => {
      e.stopPropagation();
      if (t.cleared !== 'reconciled') store.toggleCleared(id);
    });
    row.querySelector('[data-action="flag"]')?.addEventListener('click', e => {
      e.stopPropagation();
      cycleFlag(t);
    });
    row.querySelector('[data-action="clip"]')?.addEventListener('click', e => {
      e.stopPropagation();
      if (t.attachments && t.attachments.length) { clipGalleryTx = id; render(root, { accountId }); }
    });
    row.querySelector('[data-action="check"]')?.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      render(root, { accountId });
    });
    const approveBtn = row.querySelector('.approve-btn');
    if (approveBtn) approveBtn.onclick = e => { e.stopPropagation(); store.approveTransaction(id); };
    const rejectBtn = row.querySelector('.reject-btn');
    if (rejectBtn) rejectBtn.onclick = async e => {
      e.stopPropagation();
      if (!(await confirmSheet({ title: 'Delete this transaction?', confirmLabel: 'Delete', danger: true }))) return;
      store.deleteTransaction(id);
    };
    row.onclick = e => {
      if (e.target.closest('[data-action]') || e.target.closest('.approve-actions')) return;
      editingId = id;
      editState = txToEdit(t);
      datePopoverOpen = false; categoryPopoverOpen = false; flagPopoverOpen = false;
      render(root, { accountId });
    };
  });

  root.querySelectorAll('.reg-edit-row').forEach(row => wireEditRow(root, row, accountId));
}

function cycleFlag(t) {
  const idx = t.flag ? FLAGS.indexOf(t.flag) : -1;
  const next = idx === FLAGS.length - 1 ? null : FLAGS[idx + 1];
  store.updateTransaction(t.id, { flag: next });
}

async function fileToJpegDataUrl(file) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 800 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), hh = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hh;
  canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
  URL.revokeObjectURL(img.src);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function wireEditRow(root, row, accountId) {
  const id = row.dataset.id;
  const dateEl = row.querySelector('#ef-date');
  const payeeEl = row.querySelector('#ef-payee');
  const acEl = row.querySelector('#ef-payee-ac');
  const categoryTrigger = row.querySelector('#ef-category-trigger');
  const memoEl = row.querySelector('#ef-memo');
  const outflowEl = row.querySelector('#ef-outflow');
  const inflowEl = row.querySelector('#ef-inflow');
  const clearedEl = row.querySelector('#ef-cleared');
  const fileEl = row.querySelector('#ef-file');
  const flagTrigger = row.querySelector('#ef-flag-trigger');

  const sync = () => {
    editState.payeeText = payeeEl.value;
    editState.memo = memoEl.value;
    editState.outflow = outflowEl.value;
    editState.inflow = inflowEl.value;
    editState.cleared = clearedEl.checked;
  };

  memoEl.oninput = sync;
  clearedEl.onchange = sync;
  outflowEl.oninput = () => { sync(); if (outflowEl.value) { inflowEl.value = ''; editState.inflow = ''; } };
  inflowEl.oninput = () => { sync(); if (inflowEl.value) { outflowEl.value = ''; editState.outflow = ''; } };
  outflowEl.onblur = () => { const c = parseAmount(outflowEl.value); outflowEl.value = c ? fmtExact(c).replace('$', '') : ''; sync(); };
  inflowEl.onblur = () => { const c = parseAmount(inflowEl.value); inflowEl.value = c ? fmtExact(c).replace('$', '') : ''; sync(); };

  flagTrigger.onclick = e => {
    e.stopPropagation();
    datePopoverOpen = false; categoryPopoverOpen = false;
    flagPopoverOpen = !flagPopoverOpen;
    render(root, { accountId });
  };
  const flagPopover = row.querySelector('#flag-popover');
  if (flagPopover) {
    flagPopover.querySelectorAll('.flag-pop-item').forEach(item => {
      item.onclick = e => {
        e.stopPropagation();
        editState.flag = item.dataset.flag || null;
        flagPopoverOpen = false;
        render(root, { accountId });
      };
    });
  }

  // date popover
  dateEl.onclick = e => {
    e.stopPropagation();
    sync();
    datePopoverMonth = editState.date.slice(0, 7);
    datePopoverOpen = !datePopoverOpen;
    render(root, { accountId });
  };
  const popover = row.querySelector('#date-popover');
  if (popover) {
    popover.querySelector('#cal-prev').onclick = e => {
      e.stopPropagation();
      const [y, m] = datePopoverMonth.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      datePopoverMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      render(root, { accountId });
    };
    popover.querySelector('#cal-next').onclick = e => {
      e.stopPropagation();
      const [y, m] = datePopoverMonth.split('-').map(Number);
      const d = new Date(y, m, 1);
      datePopoverMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      render(root, { accountId });
    };
    popover.querySelectorAll('.cal-day').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        sync();
        editState.date = btn.dataset.date;
        datePopoverOpen = false;
        render(root, { accountId });
      };
    });
    popover.querySelector('#cal-repeat-select').onclick = e => e.stopPropagation();
    popover.querySelector('#cal-repeat-select').onchange = e => { repeatChoice = e.target.value; };
  }

  // category popover
  if (categoryTrigger) {
    categoryTrigger.onclick = e => {
      e.stopPropagation();
      sync();
      categoryPopoverOpen = !categoryPopoverOpen;
      render(root, { accountId });
    };
    const catPopover = row.querySelector('#cat-popover');
    if (catPopover) {
      catPopover.querySelectorAll('.cat-pop-item').forEach(item => {
        item.onclick = e => {
          e.stopPropagation();
          sync();
          editState.categoryId = item.dataset.cat;
          categoryPopoverOpen = false;
          render(root, { accountId });
        };
      });
      catPopover.querySelector('#cat-pop-new').onclick = e => {
        e.stopPropagation();
        createCategoryViaPrompt(root, accountId);
      };
      catPopover.querySelector('#cat-pop-split-btn').onclick = e => {
        e.stopPropagation();
        categoryPopoverOpen = false;
        toggleSplit(root, accountId);
      };
    }
  }

  fileEl.onchange = async () => {
    const file = fileEl.files[0];
    if (!file) return;
    const dataUrl = await fileToJpegDataUrl(file);
    editState.attachments.push(dataUrl);
    render(root, { accountId });
  };

  row.querySelectorAll('.ef-thumb').forEach(img => {
    img.onclick = async () => {
      const idx = +img.dataset.idx;
      if (!(await confirmSheet({ title: 'Remove this attachment?', confirmLabel: 'Remove', danger: true }))) return;
      editState.attachments.splice(idx, 1);
      render(root, { accountId });
    };
  });

  // payee autocomplete
  const excludeAcct = editState.accountId || accountId;
  const showSuggestions = () => {
    sync();
    const q = payeeEl.value.trim();
    const suggestions = store.payeeSuggestions(q).map(p => ({ type: 'payee', id: p.id, label: p.name }));
    const transferOpts = otherOpenAccounts(excludeAcct)
      .filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()))
      .map(a => ({ type: 'transfer', id: a.id, label: a.name }));
    if (!suggestions.length && !transferOpts.length) { acEl.hidden = true; return; }
    let html = '';
    let i = 0;
    const items = [];
    if (transferOpts.length) {
      html += `<div class="ac-group-label">Transfer to/from:</div>`;
      for (const t of transferOpts) { html += `<div class="ac-item" data-i="${i}">${esc(t.label)}</div>`; items.push(t); i++; }
    }
    if (suggestions.length) {
      html += `<div class="ac-group-label">Saved Payees</div>`;
      for (const p of suggestions) { html += `<div class="ac-item" data-i="${i}">${esc(p.label)}</div>`; items.push(p); i++; }
    }
    acEl.innerHTML = raw(html);
    acEl.hidden = false;
    autocompleteOpen = true;
    acEl.querySelectorAll('.ac-item').forEach(el => {
      el.onmousedown = e => {
        e.preventDefault();
        const it = items[+el.dataset.i];
        if (it.type === 'payee') {
          const p = store.getPayee(it.id);
          editState.payeeText = p.name;
          editState.payeeId = p.id;
          editState.transferAccountId = null;
          if (p.lastCategoryId && !editState.categoryId) editState.categoryId = p.lastCategoryId;
        } else {
          editState.payeeText = `Transfer: ${it.label}`;
          editState.payeeId = null;
          editState.transferAccountId = it.id;
        }
        acEl.hidden = true;
        autocompleteOpen = false;
        render(root, { accountId });
      };
    });
  };
  payeeEl.oninput = showSuggestions;
  payeeEl.onfocus = showSuggestions;

  // split rows (toggled via category popover's "Split" footer button)
  wireSplitRows(root, row, accountId);

  row.querySelector('#ef-cancel').onclick = () => { editingId = null; editState = null; datePopoverOpen = false; render(root, { accountId }); };
  row.querySelector('#ef-save').onclick = () => { sync(); saveEdit(root, id, accountId, { addAnother: false }); };
  const saveAnotherBtn = row.querySelector('#ef-save-another');
  if (saveAnotherBtn) saveAnotherBtn.onclick = () => { sync(); saveEdit(root, id, accountId, { addAnother: true }); };
  const delBtn = row.querySelector('#ef-delete');
  if (delBtn) delBtn.onclick = async () => {
    if (!(await confirmSheet({ title: 'Delete this transaction?', confirmLabel: 'Delete', danger: true }))) return;
    store.deleteTransaction(id);
    editingId = null; editState = null;
  };
}

function createCategoryViaPrompt(root, accountId) {
  const groups = store.state.categoryGroups.filter(g => !g.hidden);
  if (!groups.length) { toast('Add a category group first'); return; }
  const name = prompt('New category name:');
  if (!name || !name.trim()) return;
  const groupList = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
  const pick = groups.length === 1 ? '1' : prompt(`Which group?\n${groupList}`, '1');
  const idx = Math.min(Math.max(parseInt(pick, 10) || 1, 1), groups.length) - 1;
  const catId = store.addCategory(groups[idx].id, name.trim());
  editState.categoryId = catId;
  categoryPopoverOpen = false;
  render(root, { accountId });
}

function toggleSplit(root, accountId) {
  if (editState.subtransactions) {
    editState.subtransactions = null;
  } else {
    const mainAmount = editState.outflow ? -parseAmount(editState.outflow) : (editState.inflow ? parseAmount(editState.inflow) : 0);
    editState.subtransactions = [{ categoryId: null, amount: mainAmount, memo: '' }, { categoryId: null, amount: 0, memo: '' }];
  }
  render(root, { accountId });
}

function wireSplitRows(root, row, accountId) {
  const block = row.querySelector('#ef-split-block');
  if (!block) return;
  block.querySelectorAll('.split-row').forEach(sr => {
    const idx = +sr.dataset.idx;
    sr.querySelector('.split-cat').onchange = e => { editState.subtransactions[idx].categoryId = e.target.value || null; };
    sr.querySelector('.split-amount').onblur = e => {
      const outflowSign = editState.outflow ? -1 : 1;
      editState.subtransactions[idx].amount = outflowSign * parseAmount(e.target.value);
      render(root, { accountId });
    };
    sr.querySelector('.split-memo').oninput = e => { editState.subtransactions[idx].memo = e.target.value; };
    sr.querySelector('.split-del').onclick = () => {
      editState.subtransactions.splice(idx, 1);
      render(root, { accountId });
    };
  });
  const addRow = block.querySelector('#split-add-row');
  if (addRow) addRow.onclick = () => {
    editState.subtransactions.push({ categoryId: null, amount: 0, memo: '' });
    render(root, { accountId });
  };
}

function saveEdit(root, id, accountId, { addAnother }) {
  const st = editState;
  // Single guard for the whole row (transfer or normal): both branches below re-derive their own
  // signed amount from this same raw value, so this is the one place a $0 save gets blocked.
  const rawAmount = st.outflow ? parseAmount(st.outflow) : parseAmount(st.inflow);
  if (!rawAmount) { toast('Enter an amount'); return; }
  const doAfter = () => {
    if (repeatChoice !== 'none' && st.payeeText.trim()) {
      const payeeId = store.findOrCreatePayee(st.payeeText.trim()); // returns the id string
      const amount = st.outflow ? -rawAmount : rawAmount;
      store.addScheduled({
        frequency: repeatChoice, nextDate: advanceDate(st.date, repeatChoice),
        accountId: st.accountId || accountId, payeeId, categoryId: st.categoryId, memo: st.memo, amount, flag: st.flag,
      });
    }
    repeatChoice = 'none';
    datePopoverOpen = false; categoryPopoverOpen = false; flagPopoverOpen = false;
    if (addAnother) {
      editingId = 'new';
      editState = blankEdit(accountId);
    } else {
      editingId = null; editState = null;
    }
    render(root, { accountId });
    toast(id === 'new' ? 'Transaction added' : 'Transaction updated');
  };

  if (st.transferAccountId) {
    const fromAccountId = st.outflow ? (st.accountId || accountId) : st.transferAccountId;
    const toAccountId = st.outflow ? st.transferAccountId : (st.accountId || accountId);
    store.addTransfer({ fromAccountId, toAccountId, date: st.date, amount: rawAmount, memo: st.memo, categoryId: st.categoryId });
    doAfter();
    return;
  }
  const payeeId = st.payeeText.trim() ? store.findOrCreatePayee(st.payeeText.trim()) : null; // returns the id string
  const amount = st.outflow ? -rawAmount : rawAmount;
  const tx = {
    accountId: st.accountId || accountId, date: st.date, payeeId,
    categoryId: st.subtransactions ? null : st.categoryId, memo: st.memo, amount,
    cleared: st.cleared ? 'cleared' : 'uncleared', approved: true, flag: st.flag,
    attachments: st.attachments, subtransactions: st.subtransactions,
  };
  if (id === 'new') store.addTransaction(tx);
  else store.updateTransaction(id, tx);
  doAfter();
}

// ---------- attachment gallery ----------
function openAttachmentGallery(txId) {
  const t = store.state.transactions.find(x => x.id === txId);
  clipGalleryTx = null;
  if (!t) return;
  const renderGallery = () => h`<h2>Attachments</h2>
    <div class="gallery-grid">${t.attachments.map((a, i) =>
      h`<div class="gallery-item"><img src="${a}"><button class="icon-btn gallery-del" data-idx="${i}">🗑️ Delete</button></div>`)}</div>
    <div class="modal-actions"><button class="btn secondary" id="gal-close">Close</button></div>`;
  const modal = openModal(renderGallery(), {
    onOpen: m => bind(m),
  });
  function bind(m) {
    m.querySelector('#gal-close').onclick = closeModal;
    m.querySelectorAll('.gallery-del').forEach(btn => {
      btn.onclick = () => {
        const idx = +btn.dataset.idx;
        const attachments = t.attachments.slice();
        attachments.splice(idx, 1);
        store.updateTransaction(txId, { attachments });
        t.attachments = attachments;
        if (!attachments.length) { closeModal(); return; }
        modal.innerHTML = renderGallery();
        bind(modal);
      };
    });
  }
}

// ---------- mobile list ----------
function renderMobileList(txs, accountId, { showApproveActions = true } = {}) {
  if (!txs.length) return raw('<div class="empty-state">No transactions.</div>');
  const groups = [];
  let lastDate = null;
  for (const t of txs) {
    if (t.date !== lastDate) { groups.push({ date: t.date, items: [] }); lastDate = t.date; }
    groups.at(-1).items.push(t);
  }
  return h`<div class="reg-mobile-list ${compactRows ? 'compact' : ''}">${groups.map(g => h`
    <div class="mobile-date-group">
      <div class="mobile-date-head">${fmtDate(g.date)}</div>
      <div class="mobile-date-card">${g.items.map(t => renderMobileRow(t, { showApproveActions }))}</div>
    </div>`)}</div>`;
}

function renderMobileRow(t, { spending = false, showApproveActions = true } = {}) {
  const payee = t.payeeId ? store.getPayee(t.payeeId) : null;
  const payeeName = t.transferAccountId ? transferPayeeLabel(t) : (payee ? payee.name : '(no payee)');
  const cat = t.subtransactions ? 'Split' : (t.categoryId === INFLOW ? 'Ready to Assign' : (t.categoryId ? store.state.categories.find(c => c.id === t.categoryId)?.name : ''));
  const category = cat || 'Uncategorised';
  const account = spending ? (store.state.accounts.find(a => a.id === t.accountId)?.name || '') : '';
  const categoryPill = h`<span class="mobile-category-pill ${t.amount > 0 ? 'inflow' : ''}">${category}</span>`;
  const memo = showMemoCol && t.memo ? h`<span class="mobile-memo">${t.memo}</span>` : '';
  const accountLabel = account ? h`<div class="mobile-row-account">${account}</div>` : '';
  return h`<div class="mobile-row ${!t.approved ? 'unapproved-row' : ''}" data-id="${t.id}" data-spending-tx="${spending ? t.id : ''}">
    <div class="mobile-row-main">
      <div class="mobile-row-left">
        <div class="mobile-payee">${!t.approved ? raw('<span class="unapproved-dot"></span>') : ''}${payeeName}</div>
        <div class="mobile-sub">${categoryPill}${cat && t.autoCategorized && !t.approved ? raw(' <span class="suggested-label">✦ suggested</span>') : ''}${memo}</div>
      </div>
      <div class="mobile-row-side">
        <div class="mobile-row-right">
          <div class="mobile-amount ${t.amount > 0 ? 'pos-text' : 'neg-text'}">${fmt(t.amount)}</div>
          <span class="mobile-clr-sep"></span>
          <div class="mobile-clr">${clearedIcon(t)}</div>
        </div>
        ${accountLabel}
      </div>
    </div>
    ${!t.approved && showApproveActions ? h`<div class="mobile-row-approve-actions">
      <button type="button" class="pending-approve-btn" data-approve="${t.id}">Approve</button>
      <button type="button" class="pending-edit-btn" data-edit="${t.id}">${ICONS.edit}<span>Edit</span></button>
    </div>` : ''}
  </div>`;
}

function wireMobileList(root, txs, accountId) {
  root.querySelectorAll('.mobile-row').forEach(row => {
    row.onclick = () => openAddTransactionModal(accountId, row.dataset.id);
  });
  wireMobileApproveEdit(root, accountId);
}

// shared by the register mobile list and the Spending feed — desktop's ✓/✕ approve-actions column
// has no mobile equivalent, so unapproved mobile rows get their own Approve/Edit row (delete lives
// inside the transaction editor, opened by Edit — not here).
function wireMobileApproveEdit(root, accountId, rerender = () => render(root, { accountId })) {
  root.querySelectorAll('[data-approve]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const tx = store.state.transactions.find(t => t.id === btn.dataset.approve);
      store.approveTransaction(btn.dataset.approve);
      // "review together" nudge: a one-off approve in the feed, with more still pending from the
      // same merchant, offers a jump to that group's card in pending review. Not for transfers
      // or payee-less rows — they don't group by merchant.
      if (tx && tx.payeeId && !tx.transferAccountId) {
        const payee = store.getPayee(tx.payeeId);
        const group = payee && store.pendingGroups(tx.accountId)
          .find(g => normalizeMerchant(g.payeeName) === normalizeMerchant(payee.name));
        if (group && group.count >= 1) {
          toast(`Approved · ${group.count} more from ${payee.name}`, {
            actionLabel: 'Review together ›',
            onAction: () => { expandedPendingGroups.add(group.key); location.hash = '#/review'; },
          });
        }
      }
      rerender();
    };
  });
  root.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openAddTransactionModal(accountId, btn.dataset.edit); };
  });
}

// ---------- mobile pending review (grouped unapproved-transaction cards) ----------
// Account detail's chronological list hides its per-row approve actions (renderMobileList's
// showApproveActions: false) in favor of this: one card per merchant instead of one per row, so
// a 1,000-row import with 400 repeats becomes a handful of cards. Spending feed (cross-account,
// pendingGroups needs a single accountId) keeps the per-row Approve/Edit from renderMobileRow.
// which stacked (count > 1) pending cards are expanded to show member rows — keyed by group key
// so it survives rerenders within a view. Collapsing everything on view switch is fine (ponytail:
// no persistence needed, group keys are stable within a view but not worth carrying across views).
let expandedPendingGroups = new Set();

function pendingCategoryLabel(g) {
  if (g.categoryId === INFLOW) return 'Ready to Assign';
  if (g.categoryId) return categoryName(g.categoryId);
  return g.count > 1 && !g.allSameCategory ? 'Mixed categories' : 'Uncategorised';
}

// member mini-rows shown when a stacked (count > 1) card is expanded — date, optionally account
// (cross-account Spending context only; redundant in single-account detail so omitted there), amount,
// and a per-member Edit that opens the transaction editor for that specific txn.
function renderPendingMembers(g) {
  return h`<div class="pending-card-members">${g.memberIds.map(id => {
    const tx = store.state.transactions.find(t => t.id === id);
    if (!tx) return '';
    return h`<div class="pending-member-row">
      <span class="pending-member-date">${fmtDate(tx.date)}</span>
      ${tx.memo ? h`<span class="pending-member-memo">${tx.memo}</span>` : ''}
      <span class="pending-member-amt ${tx.amount > 0 ? 'pos-text' : 'neg-text'}">${fmt(tx.amount)}</span>
      <button type="button" class="pending-member-edit" data-member-edit="${id}" aria-label="Edit transaction">${ICONS.edit}</button>
    </div>`;
  })}</div>`;
}

function renderPendingCard(g, { showAccount = false } = {}) {
  const label = pendingCategoryLabel(g);
  const needsCategory = g.categoryId == null; // uncategorised or mixed — either way, picking sets all members
  const suggested = g.categoryId && g.autoCategorized;
  const stacked = g.count > 1;
  const expanded = stacked && expandedPendingGroups.has(g.key);
  return h`<div class="pending-card ${stacked ? 'stacked' : ''} ${g.count >= 3 ? 'stacked-deep' : ''} ${expanded ? 'expanded' : ''} ${needsCategory ? 'needs-category' : ''}" data-pending-card="${g.key}">
    <div class="pending-card-top">
      <div class="pending-card-info">
        <div class="pending-card-payee">${g.payeeName}</div>
        <div class="pending-card-sub">
          ${needsCategory
            ? h`<button type="button" class="pill-cta" data-pill-group="${g.key}">＋ Choose category</button>`
            : h`<button type="button" class="mobile-category-pill ${g.categoryId === INFLOW ? 'inflow' : ''}" data-pill-group="${g.key}">${label}</button>`}
          ${suggested ? raw('<span class="suggested-label">✦ suggested</span>') : ''}
        </div>
      </div>
      <div class="pending-card-amt">
        <span class="${g.totalAmount > 0 ? 'pos-text' : 'neg-text'}">${fmt(g.totalAmount)}</span>
        ${showAccount || g.count > 1 ? h`<div class="pending-card-meta">
          ${showAccount ? h`<span class="pending-card-acct">${store.state.accounts.find(a => a.id === g.accountId)?.name || ''}</span>` : ''}
          ${g.count > 1 ? h`<span class="pending-card-count">×${g.count}</span>` : ''}
        </div>` : ''}
      </div>
    </div>
    ${expanded ? renderPendingMembers(g) : ''}
    <div class="pending-card-actions">
      <button type="button" class="pending-approve-btn" data-approve-group="${g.key}">Approve</button>
      <button type="button" class="pending-edit-btn" data-edit-group="${g.key}">${ICONS.edit}<span>Edit</span></button>
    </div>
  </div>`;
}

function renderPendingNudge() {
  return h`<div class="pending-nudge">
    <p>It's a good idea to add categories now so we can auto-sort these — but you can always add them later after importing.</p>
    <button type="button" id="pending-nudge-btn">Add categories</button>
  </div>`;
}

// eligible for "Approve all" = has a single, non-mixed category (INFLOW counts — pendingGroups
// nulls categoryId out the moment a group's members disagree, so this is just "not null").
function approveAllEligible(groups) { return groups.filter(g => g.categoryId != null); }

function renderPendingSection(groups, { showAccount = false } = {}) {
  if (!groups.length) return '';
  const noCategories = !store.state.categories.some(c => !c.hidden);
  const eligible = approveAllEligible(groups);
  const remaining = groups.length - eligible.length;
  return h`<section class="pending-section">
    <div class="pending-section-head">
      <h2>Pending review</h2>
      <div class="pending-section-actions">
        ${eligible.length ? h`<button type="button" class="pending-approve-all-btn" id="pending-approve-all">Approve all (${eligible.length})</button>` : ''}
        <button type="button" class="link-btn" id="pending-autosort">Auto-sort</button>
      </div>
    </div>
    ${eligible.length && remaining ? h`<p class="pending-remaining-note muted">${remaining} group${remaining === 1 ? '' : 's'} still need${remaining === 1 ? 's' : ''} a category</p>` : ''}
    ${noCategories ? renderPendingNudge() : ''}
    <div class="pending-list">${groups.map(g => renderPendingCard(g, { showAccount }))}</div>
  </section>`;
}

// snapshot for undoApprove: which txns to un-approve + each affected payee's category before teaching
function captureApproveSnapshot(memberIds) {
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

// Lightweight category-list modal for a multi-row group: sets the category on every member,
// leaves them pending so the user can then Approve. (Singleton groups skip this — Edit opens the
// full transaction editor instead.)
function openPendingCategoryPicker(g, onDone) {
  const rows = [];
  if (g.totalAmount > 0) rows.push(`<div class="txe-cat-item" data-cat="${INFLOW}"><span>Ready to Assign</span></div>`);
  for (const grp of store.state.categoryGroups.filter(x => !x.hidden)) {
    const cats = store.state.categories.filter(c => c.groupId === grp.id && !c.hidden);
    if (!cats.length) continue;
    rows.push(`<div class="txe-cat-group-label">${esc(grp.name)}</div>`);
    for (const c of cats) rows.push(`<div class="txe-cat-item" data-cat="${c.id}"><span>${esc(c.name)}</span></div>`);
  }
  const modal = openModal(h`<h2>Categorize ${g.payeeName}</h2>
    <p class="muted" style="margin-bottom:10px">Sets the category on all ${g.count} transactions. They stay pending until you approve.</p>
    <div class="txe-list">${raw(rows.join('') || '<div class="txe-list-empty muted">No categories yet.</div>')}</div>
    <div class="modal-actions"><button class="btn secondary" id="cp-cancel">Cancel</button></div>`);
  modal.querySelector('#cp-cancel').onclick = closeModal;
  modal.querySelectorAll('[data-cat]').forEach(item => {
    item.onclick = () => { store.categorizeGroup(g.memberIds, item.dataset.cat); closeModal(); onDone(); };
  });
}

function wirePendingSection(root, accountId, groups, rerender) {
  root.querySelector('#pending-autosort')?.addEventListener('click', () => {
    const n = store.resuggestPending();
    toast(n ? `Sorted ${n} transaction${n === 1 ? '' : 's'}` : 'Nothing new to sort');
    rerender();
  });
  root.querySelector('#pending-nudge-btn')?.addEventListener('click', () => navigate('#/budget'));
  root.querySelector('#pending-approve-all')?.addEventListener('click', () => {
    const eligible = approveAllEligible(groups);
    if (!eligible.length) return;
    const memberIds = eligible.flatMap(g => g.memberIds);
    const snapshot = captureApproveSnapshot(memberIds);
    store.approveGroup(memberIds);
    toast(`Approved ${memberIds.length} transaction${memberIds.length === 1 ? '' : 's'}`, {
      onAction: () => { store.undoApprove(snapshot); rerender(); },
    });
    rerender();
  });
  root.querySelectorAll('[data-approve-group]').forEach(btn => {
    btn.onclick = () => {
      const g = groups.find(x => x.key === btn.dataset.approveGroup);
      if (!g) return;
      const snapshot = captureApproveSnapshot(g.memberIds);
      if (g.memberIds.length === 1) store.approveTransaction(g.memberIds[0]);
      else store.approveGroup(g.memberIds);
      toast(`Approved ${g.count} × ${g.payeeName}`, {
        onAction: () => { store.undoApprove(snapshot); rerender(); },
      });
      rerender();
    };
  });
  root.querySelectorAll('[data-edit-group]').forEach(btn => {
    btn.onclick = () => {
      const g = groups.find(x => x.key === btn.dataset.editGroup);
      if (!g) return;
      if (g.memberIds.length === 1) {
        // cross-account (accountId null in Spending): use the member txn's own account, not the
        // section's accountId param. openAddTransactionModal ignores presetAccountId when editing
        // an existing txn anyway, but pass the real one so that stays true if that ever changes.
        const tx = store.state.transactions.find(t => t.id === g.memberIds[0]);
        openAddTransactionModal(tx ? tx.accountId : accountId, g.memberIds[0]);
      } else openPendingCategoryPicker(g, rerender);
    };
  });
  root.querySelectorAll('[data-pill-group]').forEach(pill => {
    pill.onclick = () => {
      const g = groups.find(x => x.key === pill.dataset.pillGroup);
      if (g) openPendingCategoryPicker(g, rerender);
    };
  });
  root.querySelectorAll('[data-member-edit]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const tx = store.state.transactions.find(t => t.id === btn.dataset.memberEdit);
      if (tx) openAddTransactionModal(tx.accountId, tx.id);
    };
  });
  // stacked-card expand/collapse — any tap outside a button (Approve/Edit, the category pill, a
  // member's own Edit) toggles the member list. e.target.closest('button') covers all of those.
  root.querySelectorAll('.pending-card.stacked').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const key = card.dataset.pendingCard;
      if (expandedPendingGroups.has(key)) expandedPendingGroups.delete(key);
      else expandedPendingGroups.add(key);
      rerender();
    });
  });
}

// ---------- add/edit transaction editor (mobile / tab-bar +) ----------
// Full-screen, YNAB-flow-shaped editor: tappable rows open in-place picker panels
// instead of native <select>s. Desktop never calls this — it uses the inline table editor above.
function accountName(id) {
  const a = store.state.accounts.find(x => x.id === id);
  return a ? a.name : '';
}

export function openAddTransactionModal(presetAccountId, editTxId) {
  const editing = editTxId ? store.state.transactions.find(t => t.id === editTxId) : null;
  let isInflow = editing ? editing.amount > 0 : false;
  let amountCents = editing ? Math.abs(editing.amount) : 0;
  let accountId = editing ? editing.accountId : (presetAccountId || curAccountId || store.state.accounts.find(a => !a.closed)?.id || null);
  let date = editing ? editing.date : todayISO();
  let payeeId = editing ? editing.payeeId : null;
  let payeeText = payeeId ? (store.getPayee(payeeId)?.name || '') : '';
  let categoryId = editing ? editing.categoryId : null;
  let memo = editing ? (editing.memo || '') : '';
  let cleared = editing ? editing.cleared !== 'uncleared' : false;
  let flag = editing ? editing.flag : null;
  // ponytail: no Photo/attachments row — not in this task's field list; existing attachments are
  // carried through untouched on save so editing a tx here never silently drops its photos.
  const attachments = editing ? (editing.attachments || []) : [];
  let recurring = 'none';
  let panel = null; // null | 'payee' | 'category' | 'account' | 'date' | 'flag' | 'repeat'
  let payeeQuery = '';
  let categoryQuery = '';
  let dateCursor = date.slice(0, 7);
  let suggestedHint = false;
  let geo = null;

  function rowPayee() {
    return h`<button type="button" class="txe-row" id="txe-row-payee">
      <span class="txe-row-ico">${ICONS.profile}</span>
      <span class="txe-row-body">
        <span class="txe-row-label">Payee</span>
        <span class="txe-row-value ${!payeeText ? 'txe-placeholder' : ''}">${payeeText || 'Choose Payee'}</span>
      </span>
      ${suggestedHint ? raw('<span class="txe-suggested-badge" title="Suggested from your location">📍</span>') : ''}
      <span class="txe-row-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
    </button>`;
  }
  function rowCategory() {
    const label = categoryId === INFLOW ? 'Ready to Assign' : (categoryId ? categoryName(categoryId) : 'Select category');
    return h`<button type="button" class="txe-row" id="txe-row-category">
      <span class="txe-row-ico">${ICONS.tag}</span>
      <span class="txe-row-body"><span class="txe-row-label">Category</span><span class="txe-row-value ${!categoryId ? 'txe-placeholder' : ''}">${label}</span></span>
      <span class="txe-row-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
    </button>`;
  }
  function rowAccount() {
    return h`<button type="button" class="txe-row" id="txe-row-account">
      <span class="txe-row-ico">${ICONS.accounts}</span>
      <span class="txe-row-body"><span class="txe-row-label">Account</span><span class="txe-row-value">${accountName(accountId)}</span></span>
      <span class="txe-row-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
    </button>`;
  }
  function rowDate() {
    return h`<button type="button" class="txe-row" id="txe-row-date">
      <span class="txe-row-ico">${ICONS.calendar}</span>
      <span class="txe-row-body"><span class="txe-row-label">Date</span><span class="txe-row-value">${fmtDate(date)}</span></span>
      <span class="txe-row-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
    </button>`;
  }
  function rowMemo() {
    return h`<div class="txe-row txe-row-input">
      <span class="txe-row-ico">${ICONS.edit}</span>
      <span class="txe-row-body"><span class="txe-row-label">Memo</span>
        <input type="text" id="txe-memo" class="txe-inline-input" value="${memo}" placeholder="Add a memo">
      </span>
    </div>`;
  }
  function rowCleared() {
    return h`<label class="txe-row txe-row-switch" for="txe-cleared">
      <span class="txe-row-ico">Ⓒ</span>
      <span class="txe-row-body"><span class="txe-row-label-solo">Cleared</span></span>
      <span class="txe-switch"><input type="checkbox" id="txe-cleared" ${cleared ? 'checked' : ''}><span class="txe-switch-track"></span></span>
    </label>`;
  }
  function rowFlag() {
    return h`<button type="button" class="txe-row" id="txe-row-flag">
      <span class="txe-row-ico">${ICONS.flag}</span>
      <span class="txe-row-body"><span class="txe-row-label">Flag</span><span class="txe-row-value">${flag ? flag[0].toUpperCase() + flag.slice(1) : 'None'}</span></span>
      <span class="txe-row-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
    </button>`;
  }
  function rowRepeat() {
    const labels = { none: 'Never repeat', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', every2months: 'Every 2 months', quarterly: 'Every 3 months', twiceayear: 'Every 6 months', yearly: 'Yearly' };
    return h`<button type="button" class="txe-row" id="txe-row-repeat">
      <span class="txe-row-ico">${ICONS.repeat}</span>
      <span class="txe-row-body"><span class="txe-row-label">Repeat</span><span class="txe-row-value">${labels[recurring]}</span></span>
      <span class="txe-row-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
    </button>`;
  }

  function payeeListItemsHtml() {
    const q = payeeQuery.trim().toLowerCase();
    const recency = {};
    for (const t of store.state.transactions) {
      if (t.payeeId && (!recency[t.payeeId] || t.date > recency[t.payeeId])) recency[t.payeeId] = t.date;
    }
    const all = store.state.payees.slice().sort((a, b) =>
      (recency[b.id] || '').localeCompare(recency[a.id] || '') || a.name.localeCompare(b.name));
    const filtered = q ? all.filter(p => p.name.toLowerCase().includes(q)) : all;
    const exact = q && all.some(p => p.name.toLowerCase() === q);
    const rows = [];
    if (q && !exact) rows.push(`<div class="txe-list-item txe-new-payee" data-new="1">⊕ New payee: "${esc(payeeQuery.trim())}"</div>`);
    for (const p of filtered) rows.push(`<div class="txe-list-item ${p.id === payeeId ? 'selected' : ''}" data-payee="${p.id}">${esc(p.name)}</div>`);
    return raw(rows.join('') || '<div class="txe-list-empty muted">No payees yet.</div>');
  }
  function payeePanelHtml() {
    return h`<input type="text" class="txe-search" id="txe-payee-search" placeholder="Search or add a payee" value="${payeeQuery}">
      <div class="txe-list" id="txe-payee-list">${payeeListItemsHtml()}</div>`;
  }

  function categoryListItemsHtml() {
    const q = categoryQuery.trim().toLowerCase();
    const month = (date || todayISO()).slice(0, 7);
    const md = store.monthData(month);
    const groups = store.state.categoryGroups.filter(g => !g.hidden);
    const rows = [];
    if (isInflow && (!q || 'ready to assign'.includes(q))) {
      rows.push(`<div class="txe-cat-group-label">Inflow</div>
        <div class="txe-cat-item ${categoryId === INFLOW ? 'selected' : ''}" data-cat="${INFLOW}"><span>Ready to Assign</span><span class="txe-cat-amt pos-text">${fmt(md.rta)}</span></div>`);
    }
    for (const g of groups) {
      const mdGroup = md.groups.find(x => x.id === g.id);
      const cats = store.state.categories.filter(c => c.groupId === g.id && !c.hidden && (!q || c.name.toLowerCase().includes(q)));
      if (!cats.length) continue;
      rows.push(`<div class="txe-cat-group-label">${esc(g.name)}</div>`);
      for (const c of cats) {
        const mc = mdGroup?.categories.find(x => x.id === c.id);
        const avail = mc ? fmt(mc.available) : '';
        rows.push(`<div class="txe-cat-item ${c.id === categoryId ? 'selected' : ''}" data-cat="${c.id}"><span>${esc(c.name)}</span><span class="txe-cat-amt muted">${avail}</span></div>`);
      }
    }
    return raw(rows.join('') || '<div class="txe-list-empty muted">No matches.</div>');
  }
  function categoryPanelHtml() {
    return h`<input type="text" class="txe-search" id="txe-cat-search" placeholder="Search categories" value="${categoryQuery}">
      <div class="txe-list" id="txe-cat-list">${categoryListItemsHtml()}</div>`;
  }

  function accountPanelHtml() {
    const accs = store.state.accounts.filter(a => !a.closed);
    const onB = accs.filter(a => a.onBudget);
    const off = accs.filter(a => !a.onBudget);
    const row = a => {
      const bal = store.accountBalances(a.id).working;
      return raw(`<div class="txe-list-item ${a.id === accountId ? 'selected' : ''}" data-acct="${a.id}"><span>${esc(a.name)}</span><span class="txe-acct-bal ${bal < 0 ? 'neg-text' : 'pos-text'}">${fmt(bal)}</span></div>`);
    };
    return h`<div class="txe-list">${onB.map(row)}${off.length ? h`<div class="txe-cat-group-label">Tracking</div>${off.map(row)}` : ''}</div>`;
  }

  function datePanelHtml() {
    const cur = date;
    const today = todayISO();
    const [y, m] = dateCursor.split('-').map(Number);
    const startDow = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell cal-empty"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push(`<button type="button" class="cal-cell cal-day ${iso === cur ? 'selected' : ''} ${iso === today ? 'today' : ''}" data-date="${iso}">${d}</button>`);
    }
    return h`<div class="cal-nav"><button type="button" id="txe-cal-prev">‹</button><span>${MONTH_NAMES[m - 1]} ${y}</span><button type="button" id="txe-cal-next">›</button></div>
      <div class="cal-grid cal-dow">${DOW.map(d => h`<div class="cal-cell cal-dow-cell">${d}</div>`)}</div>
      <div class="cal-grid">${raw(cells.join(''))}</div>`;
  }

  function flagPanelHtml() {
    const rows = [`<div class="txe-list-item txe-flag-item ${!flag ? 'selected' : ''}" data-flag="">${flagIcon(null)}<span>None</span></div>`];
    for (const f of FLAGS) rows.push(`<div class="txe-list-item txe-flag-item ${f === flag ? 'selected' : ''}" data-flag="${f}">${flagIcon(f)}<span>${f[0].toUpperCase()}${f.slice(1)}</span></div>`);
    return h`<div class="txe-list">${raw(rows.join(''))}</div>`;
  }

  function repeatPanelHtml() {
    const options = [['none', 'Never repeat'], ['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly'], ['every2months', 'Every 2 months'], ['quarterly', 'Every 3 months'], ['twiceayear', 'Every 6 months'], ['yearly', 'Yearly']];
    return h`<div class="txe-list">${options.map(([value, label]) => h`<button class="txe-list-item ${recurring === value ? 'selected' : ''}" data-repeat="${value}"><span>${label}</span>${recurring === value ? raw('<b>✓</b>') : ''}</button>`)}</div>`;
  }

  function renderPanel() {
    const titles = { payee: 'Choose payee', category: 'Choose category', account: 'Choose account', date: 'Choose date', flag: 'Choose flag', repeat: 'Repeat transaction' };
    const body = panel === 'payee' ? payeePanelHtml()
      : panel === 'category' ? categoryPanelHtml()
      : panel === 'account' ? accountPanelHtml()
      : panel === 'date' ? datePanelHtml()
      : panel === 'flag' ? flagPanelHtml()
      : panel === 'repeat' ? repeatPanelHtml() : '';
    return h`<div class="txe-panel-layer txe-panel-${panel}" id="txe-panel-layer">
      <button type="button" class="txe-panel-scrim" id="txe-panel-dismiss" aria-label="Close picker"></button>
      <div class="txe-panel" id="txe-panel" role="dialog" aria-modal="true" aria-labelledby="txe-panel-title">
        <div class="txe-panel-head">
          <button type="button" class="txe-back" id="txe-panel-back">‹</button>
          <div class="txe-panel-title" id="txe-panel-title">${titles[panel] || ''}</div>
        </div>
        <div class="txe-panel-body">${body}</div>
      </div>
    </div>`;
  }

  function view() {
    return h`<div class="txe ${isInflow ? 'txe-inflow' : 'txe-outflow'}">
      <div class="txe-topbar">
        <button type="button" class="txe-close" id="txe-close" aria-label="Close">✕</button>
        <div class="txe-title">${editing ? 'Edit Transaction' : 'Add Transaction'}</div>
        <div class="txe-topbar-spacer"></div>
      </div>
      <div class="txe-amtband">
        <div class="amt-toggle txe-toggle">
          <button type="button" class="amt-toggle-btn ${!isInflow ? 'active outflow' : ''}" id="txe-outflow-tab">− Outflow</button>
          <button type="button" class="amt-toggle-btn ${isInflow ? 'active inflow' : ''}" id="txe-inflow-tab">+ Inflow</button>
        </div>
        <input class="big-amount-input txe-amount ${isInflow ? 'pos-text' : 'neg-text'}" id="txe-amount" type="text" inputmode="decimal"
          value="${amountCents ? fmtExact(amountCents).replace('$', '') : ''}" placeholder="0.00">
      </div>
      <div class="txe-body">
        <div class="txe-card">${rowPayee()}${rowCategory()}${rowAccount()}${rowDate()}</div>
        <div class="txe-card">${rowMemo()}</div>
        <div class="txe-card">${rowCleared()}${rowFlag()}${rowRepeat()}</div>
        ${editing ? raw('<button type="button" class="txe-delete-row" id="txe-delete">Delete Transaction</button>') : ''}
      </div>
      <div class="txe-footer"><button type="button" class="btn txe-save" id="txe-save">✓ Save</button></div>
      ${panel ? renderPanel() : ''}
    </div>`;
  }

  function wirePayeeItems(listEl) {
    listEl.querySelectorAll('[data-payee]').forEach(el => {
      el.onclick = () => {
        payeeId = el.dataset.payee;
        const p = store.getPayee(payeeId);
        payeeText = p ? p.name : '';
        if (p?.lastCategoryId && !categoryId) categoryId = p.lastCategoryId;
        suggestedHint = false;
        panel = null;
        rerender();
      };
    });
    const newEl = listEl.querySelector('[data-new]');
    if (newEl) newEl.onclick = () => {
      payeeText = payeeQuery.trim();
      payeeId = null;
      suggestedHint = false;
      panel = null;
      rerender();
    };
  }
  function wireCategoryItems(listEl) {
    listEl.querySelectorAll('[data-cat]').forEach(el => {
      el.onclick = () => { categoryId = el.dataset.cat; panel = null; rerender(); };
    });
  }

  function wirePanel(m) {
    m.querySelector('#txe-panel-back').onclick = () => { panel = null; rerender(); };
    m.querySelector('#txe-panel-dismiss').onclick = () => { panel = null; rerender(); };
    if (panel === 'payee') {
      const searchEl = m.querySelector('#txe-payee-search');
      const listEl = m.querySelector('#txe-payee-list');
      searchEl.focus();
      searchEl.oninput = () => { payeeQuery = searchEl.value; listEl.innerHTML = payeeListItemsHtml(); wirePayeeItems(listEl); };
      wirePayeeItems(listEl);
    } else if (panel === 'category') {
      const searchEl = m.querySelector('#txe-cat-search');
      const listEl = m.querySelector('#txe-cat-list');
      searchEl.focus();
      searchEl.oninput = () => { categoryQuery = searchEl.value; listEl.innerHTML = categoryListItemsHtml(); wireCategoryItems(listEl); };
      wireCategoryItems(listEl);
    } else if (panel === 'account') {
      m.querySelectorAll('[data-acct]').forEach(el => { el.onclick = () => { accountId = el.dataset.acct; panel = null; rerender(); }; });
    } else if (panel === 'date') {
      m.querySelector('#txe-cal-prev').onclick = () => { dateCursor = addMonths(dateCursor, -1); rerender(); };
      m.querySelector('#txe-cal-next').onclick = () => { dateCursor = addMonths(dateCursor, 1); rerender(); };
      m.querySelectorAll('.cal-day').forEach(btn => { btn.onclick = () => { date = btn.dataset.date; panel = null; rerender(); }; });
    } else if (panel === 'flag') {
      m.querySelectorAll('[data-flag]').forEach(el => { el.onclick = () => { flag = el.dataset.flag || null; panel = null; rerender(); }; });
    } else if (panel === 'repeat') {
      m.querySelectorAll('[data-repeat]').forEach(el => { el.onclick = () => { recurring = el.dataset.repeat; panel = null; rerender(); }; });
    }
  }

  function bind(m, { initial = false } = {}) {
    m.querySelector('#txe-close').onclick = closeModal;
    m.querySelector('#txe-outflow-tab').onclick = () => { isInflow = false; rerender(); };
    m.querySelector('#txe-inflow-tab').onclick = () => { isInflow = true; rerender(); };

    const amountEl = m.querySelector('#txe-amount');
    amountEl.oninput = () => { amountCents = parseAmount(amountEl.value); };
    amountEl.onblur = () => { amountEl.value = amountCents ? fmtExact(amountCents).replace('$', '') : ''; };
    if (initial && !editing) amountEl.focus();

    m.querySelector('#txe-row-payee').onclick = () => { panel = 'payee'; payeeQuery = ''; rerender(); };
    m.querySelector('#txe-row-category').onclick = () => { panel = 'category'; categoryQuery = ''; rerender(); };
    m.querySelector('#txe-row-account').onclick = () => { panel = 'account'; rerender(); };
    m.querySelector('#txe-row-date').onclick = () => { panel = 'date'; dateCursor = date.slice(0, 7); rerender(); };
    m.querySelector('#txe-row-flag').onclick = () => { panel = 'flag'; rerender(); };
    m.querySelector('#txe-row-repeat').onclick = () => { panel = 'repeat'; rerender(); };

    m.querySelector('#txe-memo').oninput = e => { memo = e.target.value; };
    m.querySelector('#txe-cleared').onchange = e => { cleared = e.target.checked; };

    const delBtn = m.querySelector('#txe-delete');
    if (delBtn) delBtn.onclick = async () => {
      if (!(await confirmSheet({ title: 'Delete this transaction?', confirmLabel: 'Delete', danger: true }))) return;
      store.deleteTransaction(editing.id);
      closeModal();
    };

    m.querySelector('#txe-save').onclick = save;

    if (panel) wirePanel(m);
  }

  function save() {
    if (!amountCents) { toast('Enter an amount'); return; }
    const name = payeeText.trim();
    // findOrCreatePayee already returns the payee's id (a string), not a payee object — no `.id` here.
    const payeeIdResolved = name ? store.findOrCreatePayee(name) : null;
    const amount = isInflow ? amountCents : -amountCents;
    const tx = {
      accountId, date, payeeId: payeeIdResolved, categoryId, memo, amount,
      cleared: cleared ? 'cleared' : 'uncleared', approved: true, flag, attachments,
    };
    if (editing) store.updateTransaction(editing.id, tx);
    else store.addTransaction(tx);
    if (payeeIdResolved && geo) store.rememberPayeeContext(payeeIdResolved, categoryId, geo.lat, geo.lng);
    if (recurring !== 'none' && payeeIdResolved) {
      store.addScheduled({ frequency: recurring, nextDate: date, accountId, payeeId: payeeIdResolved, categoryId, memo, amount, flag });
    }
    closeModal();
    toast(editing ? 'Transaction updated' : 'Transaction added');
  }

  function rerender() { modal.innerHTML = view(); bind(modal); }

  const modal = openModal(view(), { onOpen: m => bind(m, { initial: true }) });
  modal.classList.add('txe-modal');

  if (!editing && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const hit = store.nearestPayee(geo.lat, geo.lng);
        if (hit && !payeeId) {
          payeeId = hit.id;
          payeeText = hit.name;
          if (hit.lastCategoryId) categoryId = hit.lastCategoryId;
          suggestedHint = true;
          rerender();
        }
      },
      () => {},
      { timeout: 1500 },
    );
  }
}

// ---------- add account modal ----------
export function openAddAccountModal() {
  const TYPE_GROUPS = {
    Budget: [['checking', 'Checking'], ['savings', 'Savings'], ['cash', 'Cash'], ['creditCard', 'Credit Card']],
    Loans: [['mortgage', 'Mortgage'], ['autoLoan', 'Auto Loan'], ['studentLoan', 'Student Loan'], ['personalLoan', 'Personal Loan']],
    Tracking: [['asset', 'Asset'], ['liability', 'Liability']],
  };
  const LOAN_TYPES = new Set(['mortgage', 'autoLoan', 'studentLoan', 'personalLoan']);

  const form = type => h`<h2>Add Account</h2>
    <div class="form-row"><label>Name</label><input id="aa-name" type="text" placeholder="e.g. Everyday Checking"></div>
    <div class="form-row"><label>Type</label>
      <select id="aa-type">${raw(Object.entries(TYPE_GROUPS).map(([g, opts]) =>
        `<optgroup label="${g}">${opts.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</optgroup>`).join(''))}</select>
      <div class="muted note-hint">Bank syncing via Basiq coming soon. Accounts are local for now.</div>
    </div>
    <div class="form-row"><label>Current Balance</label><input id="aa-balance" type="text" placeholder="$0.00"></div>
    ${LOAN_TYPES.has(type) ? raw(`
    <div class="form-row"><label>Interest Rate (% APR)</label><input id="aa-rate" type="text" placeholder="e.g. 5.49"></div>
    <div class="form-row"><label>Minimum Payment</label><input id="aa-minpay" type="text" placeholder="$0.00"></div>`) : ''}
    <div class="form-row"><label>Date</label><input id="aa-date" type="date" value="${todayISO()}"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="aa-cancel">Cancel</button>
      <button class="btn" id="aa-save">Add Account</button>
    </div>`;

  let curType = 'checking';
  const modal = openModal(form(curType), { onOpen: m => bind(m) });
  function bind(m) {
    m.querySelector('#aa-cancel').onclick = closeModal;
    m.querySelector('#aa-type').onchange = e => { curType = e.target.value; modal.innerHTML = form(curType); bind(modal); };
    m.querySelector('#aa-save').onclick = () => {
      const name = m.querySelector('#aa-name').value.trim();
      if (!name) { toast('Enter an account name'); return; }
      const type = m.querySelector('#aa-type').value;
      const balance = parseAmount(m.querySelector('#aa-balance').value);
      const date = m.querySelector('#aa-date').value;
      const accId = store.addAccount({ name, type, balance, date }); // returns the new account's id
      if (LOAN_TYPES.has(type)) {
        const rate = parseFloat(m.querySelector('#aa-rate').value) || 0;
        const minimumPayment = parseAmount(m.querySelector('#aa-minpay').value);
        store.updateAccount(accId, { loanInfo: { interestRate: rate, minimumPayment } });
      }
      closeModal();
      toast('Account added');
      navigate(`#/account/${accId}`);
    };
  }
}

// ---------- outside click: close autocompletes / popovers / menus ----------
document.addEventListener('click', e => {
  if (!e.target.closest('.ef-payee') && !e.target.closest('.autocomplete-list')) {
    document.querySelectorAll('.autocomplete-list').forEach(el => (el.hidden = true));
  }
  let needsRerender = false;
  if (!e.target.closest('.ef-date') && datePopoverOpen) { datePopoverOpen = false; needsRerender = true; }
  if (!e.target.closest('.ef-category') && categoryPopoverOpen) { categoryPopoverOpen = false; needsRerender = true; }
  if (!e.target.closest('.ef-flag') && flagPopoverOpen) { flagPopoverOpen = false; needsRerender = true; }
  if (!e.target.closest('.view-menu-wrap') && viewMenuOpen) { viewMenuOpen = false; needsRerender = true; }
  if (needsRerender && lastRoot) render(lastRoot, { accountId: curAccountId });
});
