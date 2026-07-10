import { store } from '../store.js';
import { toast } from '../app.js';
import { h, thisMonth, ICONS } from '../util.js';

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
  root.innerHTML = h`<div class="settings-overview">
    <div class="settings-inner">
      <header class="settings-overview-head mobile-page-head">
        <a class="settings-back mobile-head-action" href="#/budget/${thisMonth()}" aria-label="Back to Plan">‹</a>
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
            <div class="settings-option-head"><span class="settings-row-icon" aria-hidden="true">${ICONS.settings}</span><span><strong>Theme</strong><small>Choose how Sapient Spend looks</small></span></div>
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
          <label class="settings-action-row file-btn"><span class="settings-row-icon" aria-hidden="true">↑</span><span class="settings-row-copy"><strong>Import backup</strong><small>Restore a previously exported budget</small></span><span class="settings-chevron" aria-hidden="true">›</span><input id="set-import" type="file" accept="application/json" hidden></label>
          <button id="set-reset" class="settings-action-row settings-danger-row"><span class="settings-row-icon" aria-hidden="true">×</span><span class="settings-row-copy"><strong>Reset all data</strong><small>Permanently erase this budget</small></span><span class="settings-chevron" aria-hidden="true">›</span></button>
        </section>

        <section class="settings-card">
          <h2 class="settings-card-title">About</h2>
          <div class="settings-row settings-about-row"><span class="settings-app-mark" aria-hidden="true">S</span><span class="settings-row-copy"><strong>Sapient Spend</strong><small>Local-first, private, and available offline</small></span><span class="settings-version">v1</span></div>
          <a class="settings-action-row" href="https://github.com/kunwaaarrr/sapient-spend" target="_blank" rel="noopener"><span class="settings-row-icon settings-row-icon-text" aria-hidden="true">★</span><span class="settings-row-copy"><strong>View the project</strong><small>Source code and feedback on GitHub</small></span><span class="settings-chevron" aria-hidden="true">›</span></a>
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

  root.querySelector('#set-export').onclick = () => {
    download(`sapientspend-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON());
  };
  root.querySelector('#set-import').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Import will replace your current budget data. Continue?')) { e.target.value = ''; return; }
    file.text().then(text => {
      store.importJSON(text);
      toast('Budget imported');
    });
  };
  root.querySelector('#set-reset').onclick = () => {
    if (!confirm('Reset ALL data? This cannot be undone.')) return;
    if (!confirm('Really reset everything? Your entire budget will be permanently deleted.')) return;
    store.resetAll();
    location.reload();
  };
}
