import { store, INFLOW } from '../store.js';
import { openModal, closeModal, toast, navigate } from '../app.js';
import { fmt, fmtExact, parseAmount, todayISO, fmtDate, h, esc, debounce } from '../util.js';
import { simulateBankFeed } from '../seed.js';

const FLAGS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', yearly: 'Yearly' };
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
let showMemoCol = true;
let showReconciled = true;
let compactRows = false;

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

// ---------- main render ----------
let lastRoot = null;
export function render(root, { accountId }) {
  lastRoot = root;
  curAccountId = accountId;
  const account = accountId ? store.state.accounts.find(a => a.id === accountId) : null;
  if (accountId && !account) { navigate('#/accounts'); return; }

  const txs = gatherTxs(accountId);
  const filtered = applyFilter(sortTxs(txs));
  const unapprovedCount = txs.filter(t => !t.approved).length;
  const scheduled = store.upcomingScheduled(accountId, 30);
  const bal = accountId ? store.accountBalances(accountId) : sumAllBalances();

  root.innerHTML = h`
    <div class="reg-head view-head">
      <div class="reg-head-main">
        <div class="reg-title-row">
          ${account ? `<button class="fav-star ${account.favorite ? 'active' : ''}" id="fav-toggle" title="Favorite">${account.favorite ? '★' : '☆'}</button>` : ''}
          <div class="view-title">${account ? account.name : 'All Accounts'}</div>
        </div>
        ${account ? renderSubline(account) : ''}
        ${account ? renderNote(account) : ''}
      </div>
      <div class="reg-head-actions">
        ${account ? `<button class="icon-btn" id="edit-account-btn" title="Edit account">✏️</button>` : ''}
        ${account ? `<button class="btn" id="reconcile-btn">Reconcile</button>` : ''}
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
      <div class="view-menu-wrap">
        <button class="link-btn" id="view-menu-btn"><span>View</span><span class="caret">▾</span></button>
        ${viewMenuOpen ? renderViewMenu() : ''}
      </div>
      <div class="reg-search-wrap">
        <span class="reg-search-ico">🔍</span>
        <input class="reg-search" id="reg-search" type="search" placeholder="Search ${esc(account ? account.name : 'All Accounts')}" value="${esc(search)}">
      </div>
    </div>

    ${unapprovedCount ? `<button class="approval-banner" id="approval-banner">${unapprovedCount} transaction${unapprovedCount === 1 ? '' : 's'} need approval</button>` : ''}

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
function renderViewMenu() {
  return h`<div class="view-menu">
    <label class="view-menu-item"><input type="checkbox" id="vm-memo" ${showMemoCol ? 'checked' : ''}> Show Memo column</label>
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
  if (delBtn) delBtn.onclick = () => {
    if (!confirm(`Delete ${selectedIds.size} transaction(s)?`)) return;
    selectedIds.forEach(id => store.deleteTransaction(id));
    selectedIds.clear();
    toast('Deleted');
  };
}

// ---------- scheduled section ----------
function renderScheduledSection(scheduled, accountId) {
  const rows = scheduled.map(s => {
    const payee = s.payeeId ? store.getPayee(s.payeeId) : null;
    const acc = store.state.accounts.find(a => a.id === s.accountId);
    return h`<div class="sched-row" data-id="${s.id}">
      <span class="sched-freq">${FREQ_LABEL[s.frequency] || s.frequency}</span>
      <span class="sched-date">${fmtDate(s.nextDate)}</span>
      ${!accountId ? `<span class="sched-acct">${acc ? acc.name : ''}</span>` : ''}
      <span class="sched-payee">${payee ? payee.name : '(no payee)'}</span>
      <span class="sched-memo muted">${s.memo || ''}</span>
      <span class="sched-amount ${s.amount > 0 ? 'pos-text' : ''}">${fmt(s.amount)}</span>
      <span class="sched-actions">
        <button class="icon-btn sched-enter" title="Enter now">✔️ Enter Now</button>
        <button class="icon-btn sched-edit" title="Edit">✏️</button>
        <button class="icon-btn sched-del" title="Delete">🗑️</button>
      </span>
    </div>`;
  });
  return h`<div class="sched-section">
    <button class="sched-head" id="sched-toggle">
      <span class="sched-caret">${scheduledOpen ? '▾' : '▸'}</span> Scheduled (${scheduled.length})
    </button>
    <div class="sched-list" ${scheduledOpen ? '' : 'hidden'}>${rows.join('') || '<div class="muted sched-empty">Nothing upcoming.</div>'}</div>
  </div>`;
}

function wireScheduled(root, accountId) {
  const toggle = root.querySelector('#sched-toggle');
  if (toggle) toggle.onclick = () => { scheduledOpen = !scheduledOpen; render(root, { accountId }); };
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
    };
    row.querySelector('.sched-del').onclick = () => {
      if (confirm('Delete this scheduled transaction?')) store.deleteScheduled(id);
    };
    row.querySelector('.sched-edit').onclick = () => openScheduledEditModal(s);
  });
}

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00');
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'fortnightly') d.setDate(d.getDate() + 14);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function openScheduledEditModal(s) {
  const accounts = store.state.accounts.filter(a => !a.closed);
  openModal(h`<h2>Edit Scheduled Transaction</h2>
    <div class="form-row"><label>Account</label>
      <select id="sc-account">${accounts.map(a => `<option value="${a.id}" ${a.id === s.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>Payee</label><input id="sc-payee" type="text" value="${esc(store.getPayee(s.payeeId)?.name || '')}"></div>
    <div class="form-row"><label>Memo</label><input id="sc-memo" type="text" value="${esc(s.memo || '')}"></div>
    <div class="form-row"><label>Amount</label><input id="sc-amount" type="text" value="${fmtExact(s.amount)}"></div>
    <div class="form-row"><label>Next Date</label><input id="sc-date" type="date" value="${s.nextDate}"></div>
    <div class="form-row"><label>Frequency</label>
      <select id="sc-freq">${Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${k === s.frequency ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="sc-cancel">Cancel</button>
      <button class="btn" id="sc-save">Save</button>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#sc-cancel').onclick = closeModal;
      modal.querySelector('#sc-save').onclick = () => {
        const name = modal.querySelector('#sc-payee').value.trim();
        const payee = name ? store.findOrCreatePayee(name) : null;
        store.updateScheduled(s.id, {
          accountId: modal.querySelector('#sc-account').value,
          payeeId: payee ? payee.id : null,
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
    <div class="form-row"><label>Name</label><input id="ea-name" type="text" value="${esc(account.name)}"></div>
    <div class="form-row"><label>Note</label><textarea id="ea-note" rows="3">${esc(account.note || '')}</textarea></div>
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
      modal.querySelector('#ea-close').onclick = () => {
        if (!confirm(`Close "${account.name}"? You can reopen it later from settings.`)) return;
        store.closeAccount(account.id);
        closeModal();
        navigate('#/accounts');
      };
    },
  });
}

function openReconcileModal(accountId) {
  const bal = store.accountBalances(accountId);
  openModal(h`<h2>Reconcile Account</h2>
    <p>Is your current account balance <strong>${fmt(bal.cleared)}</strong>?</p>
    <div class="modal-actions">
      <button class="btn secondary" id="rec-no">No</button>
      <button class="btn" id="rec-yes">Yes — Finish Reconciliation</button>
    </div>
    <div class="form-row" id="rec-no-block" hidden style="margin-top:14px">
      <label>Enter your current balance</label>
      <input id="rec-actual" type="text" placeholder="$0.00">
      <div class="modal-actions"><button class="btn" id="rec-adjust">Create Adjustment &amp; Finish</button></div>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#rec-yes').onclick = () => {
        store.reconcileAccount(accountId, bal.cleared);
        store.updateAccount(accountId, { lastReconciled: todayISO() });
        closeModal();
        toast('Account reconciled ✓');
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
        toast('Account reconciled ✓');
      };
    },
  });
}

// ---------- toolbar wiring ----------
function wireToolbar(root, accountId, account) {
  root.querySelector('#add-tx-btn').onclick = () => {
    if (isMobile()) { openAddTransactionModal(accountId); return; }
    editingId = 'new';
    editState = blankEdit(accountId);
    datePopoverOpen = false; categoryPopoverOpen = false; flagPopoverOpen = false;
    render(root, { accountId });
  };
  root.querySelector('#link-account-btn').onclick = () => openLinkAccountModal(accountId);
  root.querySelector('#file-import-btn').onclick = () => openFileImportModal();
  root.querySelector('#undo-btn').onclick = () => { if (store.canUndo()) store.undo(); };
  // Redo is permanently disabled — store has no redo stack. ponytail: add a redo stack if this ever matters.

  const searchEl = root.querySelector('#reg-search');
  searchEl.oninput = debounce(() => { search = searchEl.value; render(root, { accountId }); }, 200);

  const banner = root.querySelector('#approval-banner');
  if (banner) banner.onclick = () => { filter = 'unapproved'; render(root, { accountId }); };

  const viewBtn = root.querySelector('#view-menu-btn');
  viewBtn.onclick = e => { e.stopPropagation(); viewMenuOpen = !viewMenuOpen; render(root, { accountId }); };
  const vmMemo = root.querySelector('#vm-memo');
  if (vmMemo) vmMemo.onchange = () => { showMemoCol = vmMemo.checked; render(root, { accountId }); };
  const vmReconciled = root.querySelector('#vm-reconciled');
  if (vmReconciled) vmReconciled.onchange = () => { showReconciled = vmReconciled.checked; render(root, { accountId }); };
  const vmCompact = root.querySelector('#vm-compact');
  if (vmCompact) vmCompact.onchange = () => { compactRows = vmCompact.checked; render(root, { accountId }); };
}

function openLinkAccountModal(accountId) {
  openModal(h`<h2>Link Account</h2>
    <p class="muted" style="margin-bottom:14px">Your own copy — direct bank syncing via Basiq is coming soon. Until then, simulate a bank feed to see how imported transactions and matching work.</p>
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

function openFileImportModal() {
  openModal(h`<h2>File Import</h2>
    <div class="form-row"><label>Import plan backup (JSON)</label><input id="fi-file" type="file" accept=".json"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="fi-cancel">Cancel</button>
      <button class="btn" id="fi-import">Import</button>
    </div>`, {
    onOpen: modal => {
      modal.querySelector('#fi-cancel').onclick = closeModal;
      modal.querySelector('#fi-import').onclick = async () => {
        const file = modal.querySelector('#fi-file').files[0];
        if (!file) { toast('Choose a .json file first'); return; }
        if (!confirm('This will replace your current plan data. Continue?')) return;
        const text = await file.text();
        try {
          store.importJSON(text);
          closeModal();
          toast('Plan backup imported');
        } catch (e) {
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
        ${showAccount ? '<th>Account</th>' : ''}
        <th class="col-date" id="date-sort-th">Date <span class="sort-caret">${sortDir === 'asc' ? '▴' : '▾'}</span></th>
        <th>Payee</th><th>Category</th>
        ${showMemoCol ? '<th>Memo</th>' : ''}
        <th class="num">Outflow</th><th class="num">Inflow</th>
        <th class="col-clr">ⓒ</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${!txs.length && editingId !== 'new' ? '<div class="empty-state">No transactions.</div>' : ''}
  </div>`;
}

// Flag glyph: unset = subtle gray outline flag; set = filled colored flag. Color comes from the
// .flag-ico-<color> CSS class (same palette as the old flag-dot classes), not inlined here.
function flagIcon(flag) {
  const path = 'M1.5 4.5h8l3.5 4.25-3.5 4.25h-8Z';
  if (!flag) {
    return `<svg class="flag-ico flag-ico-none" viewBox="0 0 14 17.5" width="14" height="17.5">
      <path d="${path}" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg class="flag-ico flag-ico-${flag}" viewBox="0 0 14 17.5" width="14" height="17.5">
    <path d="${path}"/>
  </svg>`;
}

function clearedIcon(t) {
  if (t.cleared === 'reconciled') return `<span class="clr-icon clr-reconciled" title="Reconciled">🔒</span>`;
  if (t.cleared === 'cleared') return `<span class="clr-icon clr-cleared" data-clr="1" title="Cleared">Ⓒ</span>`;
  return `<span class="clr-icon clr-uncleared" data-clr="1" title="Uncleared">Ⓒ</span>`;
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
    ${showAccount ? `<td>${acc ? acc.name : ''}</td>` : ''}
    <td>${fmtDate(t.date)}</td>
    <td>${!t.approved ? '<span class="unapproved-dot"></span>' : ''}${payeeName}${isMatch ? ' <span class="match-badge">MATCH</span>' : ''}</td>
    <td>${cat || ''}</td>
    ${showMemoCol ? `<td class="muted">${t.memo || ''}</td>` : ''}
    <td class="num neg-text">${t.amount < 0 ? fmt(-t.amount) : ''}</td>
    <td class="num pos-text">${t.amount > 0 ? fmt(t.amount) : ''}</td>
    <td class="col-clr" data-action="cleared">${clearedIcon(t)}</td>
    ${!t.approved ? `<td class="approve-actions">
        <button class="icon-btn approve-btn" title="Approve">✓</button>
        <button class="icon-btn reject-btn" title="Reject">✕</button>
      </td>` : ''}
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
      opts.push(`<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} — ${avail}</option>`);
    }
    opts.push('</optgroup>');
  }
  return `<option value="">Select category...</option>${opts.join('')}`;
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
    <div class="cat-pop-list">${rows.join('')}</div>
    <button type="button" class="cat-pop-split-btn" id="cat-pop-split-btn">Split (Multiple Categories)</button>
  </div>`;
}

// flag picker popover: same family as the calendar/category dropdowns (radius 8, shadow, bg-alt hover)
function renderFlagPopover(selectedFlag) {
  const rows = [`<div class="flag-pop-item ${!selectedFlag ? 'selected' : ''}" data-flag="">${flagIcon(null)}<span>None</span></div>`];
  for (const f of FLAGS) {
    rows.push(`<div class="flag-pop-item ${f === selectedFlag ? 'selected' : ''}" data-flag="${f}">${flagIcon(f)}<span>${f[0].toUpperCase()}${f.slice(1)}</span></div>`);
  }
  return h`<div class="flag-popover" id="flag-popover">${rows.join('')}</div>`;
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
            <input type="text" id="ef-payee" placeholder="Payee" value="${esc(st.payeeText)}" autocomplete="off">
            <div class="autocomplete-list" id="ef-payee-ac" hidden></div>
          </div>
          <div class="ef-field ef-category">
            ${renderCategoryDropdown(st, mainAmount, month, isSplit)}
          </div>
          <div class="ef-field ef-memo"><input type="text" id="ef-memo" placeholder="Memo" value="${esc(st.memo)}" ${isSplit ? 'disabled' : ''}></div>
          <div class="ef-field ef-outflow"><input type="text" id="ef-outflow" placeholder="Outflow" value="${esc(st.outflow)}"></div>
          <div class="ef-field ef-inflow"><input type="text" id="ef-inflow" placeholder="Inflow" value="${esc(st.inflow)}"></div>
          <div class="ef-field ef-cleared"><label class="ef-cleared-label"><input type="checkbox" id="ef-cleared" ${st.cleared ? 'checked' : ''}> Cleared</label></div>
          <div class="ef-field ef-attach">
            <label class="btn secondary sm">📷 Attach<input type="file" id="ef-file" accept="image/*" capture hidden></label>
          </div>
        </div>
        ${st.attachments.length ? `<div class="ef-attachments">${st.attachments.map((a, i) => `<img src="${a}" class="ef-thumb" data-idx="${i}">`).join('')}</div>` : ''}
        <div class="ef-split-block" id="ef-split-block">
          ${isSplit ? renderSplitRows(st, mainAmount, month) : ''}
        </div>
        <div class="edit-form-actions">
          ${isSplit ? `<span class="split-remaining ${remaining !== 0 ? 'neg-text' : 'pos-text'}">Remaining: ${fmt(remaining)}</span>` : ''}
          <div class="ef-spacer"></div>
          ${id !== 'new' ? `<button class="btn danger sm" id="ef-delete">Delete</button>` : ''}
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
    <div class="cal-grid cal-dow">${DOW.map(d => `<div class="cal-cell cal-dow-cell">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div class="cal-repeat">
      <label>Repeat:</label>
      <select id="cal-repeat-select">
        <option value="none" ${repeatChoice === 'none' ? 'selected' : ''}>Never</option>
        <option value="weekly" ${repeatChoice === 'weekly' ? 'selected' : ''}>Weekly</option>
        <option value="fortnightly" ${repeatChoice === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
        <option value="monthly" ${repeatChoice === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="yearly" ${repeatChoice === 'yearly' ? 'selected' : ''}>Yearly</option>
      </select>
    </div>
  </div>`;
}

function renderCategoryDropdown(st, mainAmount, month, isSplit) {
  if (isSplit) return `<input type="text" value="Split (Multiple Categories)" disabled>`;
  const label = st.categoryId ? categoryName(st.categoryId) : 'Select category...';
  return h`<input type="text" id="ef-category-trigger" readonly value="${esc(label)}" placeholder="Select category...">
    ${categoryPopoverOpen ? renderCategoryPopover(st.categoryId, mainAmount > 0, month) : ''}`;
}

function renderSplitRows(st, mainAmount, month) {
  const rows = st.subtransactions.map((s, i) => h`<div class="split-row" data-idx="${i}">
    <select class="split-cat">${categoryOptionsHtml(s.categoryId, mainAmount > 0, month)}</select>
    <input type="text" class="split-amount" value="${s.amount ? fmtExact(Math.abs(s.amount)) : ''}" placeholder="$0.00">
    <input type="text" class="split-memo" value="${esc(s.memo || '')}" placeholder="Memo">
    <button class="icon-btn split-del" title="Remove">✕</button>
  </div>`);
  return `<div class="split-rows">${rows.join('')}</div><button class="btn secondary sm" id="split-add-row">+ Add split</button>`;
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
    if (rejectBtn) rejectBtn.onclick = e => { e.stopPropagation(); if (confirm('Delete this transaction?')) store.deleteTransaction(id); };
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
    img.onclick = () => {
      const idx = +img.dataset.idx;
      if (confirm('Remove this attachment?')) { editState.attachments.splice(idx, 1); render(root, { accountId }); }
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
    acEl.innerHTML = html;
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
  if (delBtn) delBtn.onclick = () => {
    if (confirm('Delete this transaction?')) { store.deleteTransaction(id); editingId = null; editState = null; }
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
  const doAfter = () => {
    if (repeatChoice !== 'none' && st.payeeText.trim()) {
      const payee = store.findOrCreatePayee(st.payeeText.trim());
      const amount = st.outflow ? -parseAmount(st.outflow) : parseAmount(st.inflow);
      store.addScheduled({
        frequency: repeatChoice, nextDate: advanceDate(st.date, repeatChoice),
        accountId: st.accountId || accountId, payeeId: payee.id, categoryId: st.categoryId, memo: st.memo, amount, flag: st.flag,
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
  };

  if (st.transferAccountId) {
    const amount = st.outflow ? parseAmount(st.outflow) : parseAmount(st.inflow);
    const fromAccountId = st.outflow ? (st.accountId || accountId) : st.transferAccountId;
    const toAccountId = st.outflow ? st.transferAccountId : (st.accountId || accountId);
    store.addTransfer({ fromAccountId, toAccountId, date: st.date, amount, memo: st.memo, categoryId: st.categoryId });
    doAfter();
    return;
  }
  const payee = st.payeeText.trim() ? store.findOrCreatePayee(st.payeeText.trim()) : null;
  const amount = st.outflow ? -parseAmount(st.outflow) : parseAmount(st.inflow);
  const tx = {
    accountId: st.accountId || accountId, date: st.date, payeeId: payee ? payee.id : null,
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
      `<div class="gallery-item"><img src="${a}"><button class="icon-btn gallery-del" data-idx="${i}">🗑️ Delete</button></div>`).join('')}</div>
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
function renderMobileList(txs, accountId) {
  if (!txs.length) return '<div class="empty-state">No transactions.</div>';
  const groups = [];
  let lastDate = null;
  for (const t of txs) {
    if (t.date !== lastDate) { groups.push({ date: t.date, items: [] }); lastDate = t.date; }
    groups.at(-1).items.push(t);
  }
  return h`<div class="reg-mobile-list">${groups.map(g => h`
    <div class="mobile-date-group">
      <div class="mobile-date-head">${fmtDate(g.date)}</div>
      ${g.items.map(t => renderMobileRow(t)).join('')}
    </div>`).join('')}</div>`;
}

function renderMobileRow(t) {
  const payee = t.payeeId ? store.getPayee(t.payeeId) : null;
  const payeeName = t.transferAccountId ? transferPayeeLabel(t) : (payee ? payee.name : '(no payee)');
  const cat = t.subtransactions ? 'Split' : (t.categoryId === INFLOW ? 'Ready to Assign' : (t.categoryId ? store.state.categories.find(c => c.id === t.categoryId)?.name : ''));
  return h`<div class="mobile-row ${!t.approved ? 'unapproved-row' : ''}" data-id="${t.id}">
    <div class="mobile-row-main">
      <div class="mobile-row-left">
        <div class="mobile-payee">${!t.approved ? '<span class="unapproved-dot"></span>' : ''}${payeeName}</div>
        <div class="mobile-sub muted">${[cat, t.memo].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="mobile-row-right">
        <div class="mobile-amount ${t.amount > 0 ? 'pos-text' : 'neg-text'}">${fmt(t.amount)}</div>
        <div class="mobile-clr">${clearedIcon(t)}</div>
      </div>
    </div>
  </div>`;
}

function wireMobileList(root, txs, accountId) {
  root.querySelectorAll('.mobile-row').forEach(row => {
    row.onclick = () => openAddTransactionModal(accountId, row.dataset.id);
  });
}

// ---------- add transaction modal (mobile / tab-bar +) ----------
export function openAddTransactionModal(presetAccountId, editTxId) {
  const editing = editTxId ? store.state.transactions.find(t => t.id === editTxId) : null;
  const accounts = store.state.accounts.filter(a => !a.closed);
  let isInflow = editing ? editing.amount > 0 : false;
  let amountCents = editing ? Math.abs(editing.amount) : 0;
  let payeeId = editing ? editing.payeeId : null;
  let categoryId = editing ? editing.categoryId : null;
  let suggestedHint = false;
  let geo = null;
  let recurring = 'none';

  const form = () => h`<h2>${editing ? 'Edit Transaction' : 'Add Transaction'}</h2>
    <div class="amt-toggle">
      <button type="button" class="amt-toggle-btn ${!isInflow ? 'active outflow' : ''}" id="at-outflow-tab">Outflow</button>
      <button type="button" class="amt-toggle-btn ${isInflow ? 'active inflow' : ''}" id="at-inflow-tab">Inflow</button>
    </div>
    <input class="big-amount-input ${isInflow ? 'pos-text' : 'neg-text'}" id="at-amount" type="text" value="${amountCents ? fmtExact(amountCents).replace('$', '') : ''}" placeholder="0.00">
    <div class="form-row"><label>Account</label>
      <select id="at-account">${accounts.map(a => `<option value="${a.id}" ${a.id === (editing ? editing.accountId : presetAccountId) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>Date</label><input id="at-date" type="date" value="${editing ? editing.date : todayISO()}"></div>
    <div class="form-row ef-payee">
      <label>Payee</label>
      <input id="at-payee" type="text" value="${esc(payeeId ? store.getPayee(payeeId).name : '')}" autocomplete="off">
      <div class="autocomplete-list" id="at-payee-ac" hidden></div>
      ${suggestedHint ? '<div class="suggested-hint">📍 suggested</div>' : ''}
    </div>
    <div class="form-row"><label>Category</label><select id="at-category">${categoryOptionsHtml(categoryId, isInflow)}</select></div>
    <div class="form-row"><label>Memo</label><input id="at-memo" type="text" value="${esc(editing ? editing.memo || '' : '')}"></div>
    <div class="form-row"><label>Make recurring</label>
      <select id="at-recurring">
        <option value="none">None</option>
        <option value="weekly">Weekly</option>
        <option value="fortnightly">Fortnightly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
    </div>
    <div class="modal-actions">
      ${editing ? '<button class="btn danger" id="at-delete" style="margin-right:auto">Delete</button>' : ''}
      <button class="btn secondary" id="at-cancel">Cancel</button>
      <button class="btn" id="at-save">Save</button>
    </div>`;

  const modal = openModal(form(), { onOpen: m => bind(m) });

  if (!editing && navigator.geolocation) {
    const timer = setTimeout(() => {}, 1500);
    navigator.geolocation.getCurrentPosition(
      pos => {
        clearTimeout(timer);
        geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const hit = store.nearestPayee(geo.lat, geo.lng);
        if (hit && !modal.querySelector('#at-payee').value) {
          payeeId = hit.id;
          categoryId = hit.lastCategoryId || categoryId;
          suggestedHint = true;
          modal.innerHTML = form();
          bind(modal);
        }
      },
      () => {},
      { timeout: 1500 },
    );
  }

  function bind(m) {
    m.querySelector('#at-cancel').onclick = closeModal;
    m.querySelector('#at-outflow-tab').onclick = () => { isInflow = false; m.innerHTML = form(); bind(m); };
    m.querySelector('#at-inflow-tab').onclick = () => { isInflow = true; m.innerHTML = form(); bind(m); };
    const amountEl = m.querySelector('#at-amount');
    amountEl.oninput = () => { amountCents = parseAmount(amountEl.value); };
    amountEl.onblur = () => { amountEl.value = amountCents ? fmtExact(amountCents).replace('$', '') : ''; };

    const payeeEl = m.querySelector('#at-payee');
    const acEl = m.querySelector('#at-payee-ac');
    payeeEl.oninput = () => {
      const q = payeeEl.value.trim();
      const items = store.payeeSuggestions(q);
      if (!items.length) { acEl.hidden = true; return; }
      acEl.innerHTML = items.map((p, i) => `<div class="ac-item" data-i="${i}">${esc(p.name)}</div>`).join('');
      acEl.hidden = false;
      acEl.querySelectorAll('.ac-item').forEach(el => {
        el.onmousedown = e => {
          e.preventDefault();
          const p = items[+el.dataset.i];
          payeeEl.value = p.name;
          payeeId = p.id;
          if (p.lastCategoryId) { categoryId = p.lastCategoryId; m.querySelector('#at-category').value = p.lastCategoryId; }
          acEl.hidden = true;
        };
      });
    };

    m.querySelector('#at-category').onchange = e => { categoryId = e.target.value || null; };
    m.querySelector('#at-recurring').onchange = e => { recurring = e.target.value; };

    m.querySelector('#at-save').onclick = () => {
      const name = payeeEl.value.trim();
      const payee = name ? store.findOrCreatePayee(name) : null;
      const accId = m.querySelector('#at-account').value;
      const date = m.querySelector('#at-date').value;
      const memo = m.querySelector('#at-memo').value;
      const cat = m.querySelector('#at-category').value || null;
      const amount = isInflow ? amountCents : -amountCents;
      const tx = { accountId: accId, date, payeeId: payee ? payee.id : null, categoryId: cat, memo, amount, cleared: 'uncleared', approved: true, flag: null };
      if (editing) store.updateTransaction(editing.id, tx);
      else store.addTransaction(tx);
      if (payee && geo) store.rememberPayeeContext(payee.id, cat, geo.lat, geo.lng);
      if (recurring !== 'none' && payee) {
        store.addScheduled({ frequency: recurring, nextDate: date, accountId: accId, payeeId: payee.id, categoryId: cat, memo, amount, flag: null });
      }
      closeModal();
      toast(editing ? 'Transaction updated' : 'Transaction added');
    };

    if (editing) m.querySelector('#at-delete').onclick = () => {
      if (confirm('Delete this transaction?')) { store.deleteTransaction(editing.id); closeModal(); }
    };
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
      <select id="aa-type">${Object.entries(TYPE_GROUPS).map(([g, opts]) =>
        `<optgroup label="${g}">${opts.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</optgroup>`).join('')}</select>
      <div class="muted note-hint">Bank syncing via Basiq coming soon — accounts are local for now.</div>
    </div>
    <div class="form-row"><label>Current Balance</label><input id="aa-balance" type="text" placeholder="$0.00"></div>
    ${LOAN_TYPES.has(type) ? `
    <div class="form-row"><label>Interest Rate (% APR)</label><input id="aa-rate" type="text" placeholder="e.g. 5.49"></div>
    <div class="form-row"><label>Minimum Payment</label><input id="aa-minpay" type="text" placeholder="$0.00"></div>` : ''}
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
