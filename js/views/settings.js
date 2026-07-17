import { store } from '../store.js';
import { toast } from '../app.js';
import { h, thisMonth, ICONS } from '../util.js';
import { openFileImportModal } from './register.js';

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function render(root, params) {
  const s = store.state.settings;
  const theme = s.theme || 'light';
  const balance = s.balanceStyle || 'default';
  const amountStyle = s.amountStyle || 'velvet';
  root.innerHTML = h`<div class="settings-overview">
    <div class="settings-inner">
      <header class="settings-overview-head mobile-page-head">
        <a class="settings-back mobile-head-action" href="${innerWidth < 768 ? '#/profile' : `#/budget/${thisMonth()}`}" aria-label="${innerWidth < 768 ? 'Back to Profile' : 'Back to Plan'}">‹</a>
        <h1 class="mobile-page-title">Settings</h1>
        <span class="settings-head-spacer" aria-hidden="true"></span>
      </header>
      <div class="settings-cards">

        <section class="settings-card">
          <h2 class="settings-card-title">Budget &amp; privacy</h2>
          <div class="settings-row">
            <span class="settings-row-icon" aria-hidden="true">${ICONS.plan}</span>
            <label class="settings-row-copy" for="set-budget-name"><strong>Budget name</strong><small>Name shown throughout your plan</small></label>
            <input id="set-budget-name" class="set-inline-input" type="text" value="${s.budgetName}">
          </div>
          <div class="settings-row">
            <span class="settings-row-icon settings-row-icon-text" aria-hidden="true">$</span>
            <label class="settings-row-copy" for="set-currency"><strong>Currency</strong><small>Symbol used for every amount</small></label>
            <input id="set-currency" class="set-inline-input" type="text" maxlength="3" value="${s.currencySymbol}">
          </div>
          <div class="settings-row">
            <span class="settings-row-icon" aria-hidden="true">${ICONS.eye}</span>
            <label class="settings-row-copy" for="set-hide"><strong>Privacy mode</strong><small>Hide monetary amounts throughout the app</small></label>
            <label class="switch">
              <input id="set-hide" type="checkbox" ${s.hideAmounts ? 'checked' : ''}>
              <span class="switch-track"></span>
            </label>
          </div>
        </section>

        <section class="settings-card">
          <h2 class="settings-card-title">Appearance</h2>
          <div class="settings-option-block">
            <div class="settings-option-head"><span class="settings-row-icon" aria-hidden="true">${ICONS.settings}</span><span><strong>Theme</strong><small>Choose how Kanevo looks</small></span></div>
            <div class="settings-segmented" role="radiogroup" aria-label="Theme">
              <label><input type="radio" name="disp-theme" value="light" ${theme === 'light' ? 'checked' : ''}><span>Light</span></label>
              <label><input type="radio" name="disp-theme" value="dark" ${theme === 'dark' ? 'checked' : ''}><span>Dark</span></label>
              <label><input type="radio" name="disp-theme" value="system" ${theme === 'system' ? 'checked' : ''}><span>System</span></label>
            </div>
          </div>
          <div class="settings-option-block">
            <div class="settings-option-head"><span class="settings-row-icon settings-row-icon-text" aria-hidden="true">Aa</span><span><strong>Balance style</strong><small>How positive and negative amounts differ</small></span></div>
            <div class="settings-choice-grid">
            <label class="settings-choice">
              <input type="radio" name="disp-balance" value="default" ${balance === 'default' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="disp-radio-title">Default</span>
                <span class="disp-preview" data-balance="default">
                  <span class="pill overspent">-$10.00</span>
                  <span class="pill underfunded">$10.00</span>
                  <span class="pill pos">$10.00</span>
                </span>
              </span>
            </label>
            <label class="settings-choice">
              <input type="radio" name="disp-balance" value="mono" ${balance === 'mono' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="disp-radio-title">Without colour</span>
                <span class="disp-preview" data-balance="mono">
                  <span class="pill overspent">-$10.00</span>
                  <span class="pill underfunded">$10.00</span>
                  <span class="pill pos">$10.00</span>
                </span>
              </span>
            </label>
            </div>
          </div>
          <div class="settings-option-block">
            <div class="settings-option-head"><span class="settings-row-icon settings-row-icon-text" aria-hidden="true">Aa</span><span><strong>Amount style</strong><small>How amounts and bars look in dark mode</small></span></div>
            <small>Solid</small>
            <div class="settings-choice-grid">
            <label class="settings-choice">
              <input type="radio" name="disp-amount-style" value="velvet" ${amountStyle === 'velvet' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="amt-prev amt-prev--velvet">
                  <span class="amt-prev-row"><span class="amt-prev-name">🏠 Rent</span><span class="amt-prev-pill pos">$2,450</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">📱 Phone</span><span class="amt-prev-pill warn">$5</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">🍜 Dining</span><span class="amt-prev-pill neg">−$178</span></span>
                </span>
                <span class="disp-radio-title">Velvet<span class="disp-default-badge">Default</span></span>
              </span>
            </label>
            <label class="settings-choice">
              <input type="radio" name="disp-amount-style" value="bright" ${amountStyle === 'bright' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="amt-prev amt-prev--bright">
                  <span class="amt-prev-row"><span class="amt-prev-name">🏠 Rent</span><span class="amt-prev-pill pos">$2,450</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">📱 Phone</span><span class="amt-prev-pill warn">$5</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">🍜 Dining</span><span class="amt-prev-pill neg">−$178</span></span>
                </span>
                <span class="disp-radio-title">Bright</span>
              </span>
            </label>
            </div>
            <small>Subtle</small>
            <div class="settings-choice-grid">
            <label class="settings-choice">
              <input type="radio" name="disp-amount-style" value="soft" ${amountStyle === 'soft' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="amt-prev amt-prev--soft">
                  <span class="amt-prev-row"><span class="amt-prev-name">🏠 Rent</span><span class="amt-prev-pill pos">$2,450</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">📱 Phone</span><span class="amt-prev-pill warn">$5</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">🍜 Dining</span><span class="amt-prev-pill neg">−$178</span></span>
                </span>
                <span class="disp-radio-title">Soft tint</span>
              </span>
            </label>
            <label class="settings-choice">
              <input type="radio" name="disp-amount-style" value="outline" ${amountStyle === 'outline' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="amt-prev amt-prev--outline">
                  <span class="amt-prev-row"><span class="amt-prev-name">🏠 Rent</span><span class="amt-prev-pill pos">$2,450</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">📱 Phone</span><span class="amt-prev-pill warn">$5</span></span>
                  <span class="amt-prev-row"><span class="amt-prev-name">🍜 Dining</span><span class="amt-prev-pill neg">−$178</span></span>
                </span>
                <span class="disp-radio-title">Outline</span>
              </span>
            </label>
            </div>
          </div>
        </section>

        <section class="settings-card">
          <h2 class="settings-card-title">Connections</h2>
          <div class="settings-row settings-row-disabled">
            <span class="settings-row-icon" aria-hidden="true">${ICONS.accounts}</span>
            <span class="settings-row-copy"><strong>Bank connections</strong><small>Secure automatic transaction syncing</small></span>
            <span class="settings-status">Coming soon</span>
          </div>
        </section>

        <section class="settings-card">
          <h2 class="settings-card-title">Your data</h2>
          <button id="set-export" class="settings-action-row"><span class="settings-row-icon" aria-hidden="true">↓</span><span class="settings-row-copy"><strong>Export backup</strong><small>Save a portable JSON copy</small></span><span class="settings-chevron" aria-hidden="true">›</span></button>
          <label class="settings-action-row file-btn"><span class="settings-row-icon" aria-hidden="true">↑</span><span class="settings-row-copy"><strong>Import backup or bank CSV</strong><small>Restore a backup, or bring in bank transactions</small></span><span class="settings-chevron" aria-hidden="true">›</span><input id="set-import" type="file" hidden></label>
          <button id="set-reset" class="settings-action-row settings-danger-row"><span class="settings-row-icon" aria-hidden="true">×</span><span class="settings-row-copy"><strong>Reset all data</strong><small>Permanently erase this budget</small></span><span class="settings-chevron" aria-hidden="true">›</span></button>
        </section>

        <section class="settings-card">
          <h2 class="settings-card-title">About</h2>
          <div class="settings-row settings-about-row"><span class="settings-app-mark" aria-hidden="true">K</span><span class="settings-row-copy"><strong>Kanevo</strong><small>Local-first, private, and available offline</small></span><span class="settings-version">v1</span></div>
          <a class="settings-action-row" href="https://github.com/kunwaaarrr/kanevo" target="_blank" rel="noopener"><span class="settings-row-icon settings-row-icon-text" aria-hidden="true">★</span><span class="settings-row-copy"><strong>View the project</strong><small>Source code and feedback on GitHub</small></span><span class="settings-chevron" aria-hidden="true">›</span></a>
        </section>

      </div>
    </div>
  </div>`;

  root.querySelector('#set-budget-name').onchange = e => store.updateSettings({ budgetName: e.target.value });
  root.querySelector('#set-currency').onchange = e => store.updateSettings({ currencySymbol: e.target.value });
  root.querySelector('#set-hide').onchange = e => store.updateSettings({ hideAmounts: e.target.checked });

  // Display Options — updateSettings notifies subscribers, so app.js re-applies the
  // html[data-theme]/[data-balance] attributes and the whole app re-skins instantly.
  root.querySelectorAll('input[name="disp-theme"]').forEach(r =>
    r.onchange = e => store.updateSettings({ theme: e.target.value }));
  root.querySelectorAll('input[name="disp-balance"]').forEach(r =>
    r.onchange = e => store.updateSettings({ balanceStyle: e.target.value }));
  root.querySelectorAll('input[name="disp-amount-style"]').forEach(r =>
    r.onchange = e => store.updateSettings({ amountStyle: e.target.value }));

  root.querySelector('#set-export').onclick = () => {
    download(`kanevo-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON());
  };
  root.querySelector('#set-import').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // allow re-picking the same file
    // bank statements route to the register's import modal; only .json is a backup restore
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      openFileImportModal(null, file);
      return;
    }
    if (!confirm('Import will replace your current budget data. Continue?')) return;
    file.text().then(text => {
      store.importJSON(text);
      toast('Budget imported');
    }).catch(() => toast('That file isn’t a valid backup'));
  };
  root.querySelector('#set-reset').onclick = () => {
    if (!confirm('Reset ALL data? This cannot be undone.')) return;
    if (!confirm('Really reset everything? Your entire budget will be permanently deleted.')) return;
    store.resetAll();
    location.reload();
  };
}
