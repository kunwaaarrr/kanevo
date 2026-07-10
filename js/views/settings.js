import { store } from '../store.js';
import { toast } from '../app.js';
import { h } from '../util.js';

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
      <header class="settings-overview-head"><h1>Settings</h1></header>
      <div class="settings-cards">

        <section class="reflect-link-card">
          <h2>More views</h2>
          <a href="#/fifty"><span><i aria-hidden="true">%</i><b>50/30/20</b><small>Compare your plan with a simple allocation guide</small></span><strong aria-hidden="true">›</strong></a>
          <a href="#/forecast"><span><i aria-hidden="true">⌁</i><b>Forecast &amp; What-If</b><small>Project cash flow and test future changes</small></span><strong aria-hidden="true">›</strong></a>
          <a href="#/loans"><span><i aria-hidden="true">↓</i><b>Loan Planner</b><small>Explore payoff timing and extra payments</small></span><strong aria-hidden="true">›</strong></a>
        </section>

        <section class="settings-card">
          <h3>Budget</h3>
          <div class="set-row">
            <label for="set-budget-name">Budget name</label>
            <input id="set-budget-name" class="set-inline-input" type="text" value="${s.budgetName}">
          </div>
          <div class="set-row">
            <label for="set-currency">Currency symbol</label>
            <input id="set-currency" class="set-inline-input" type="text" maxlength="3" value="${s.currencySymbol}">
          </div>
          <div class="set-row">
            <label for="set-hide">Hide amounts (privacy mode)</label>
            <label class="switch">
              <input id="set-hide" type="checkbox" ${s.hideAmounts ? 'checked' : ''}>
              <span class="switch-track"></span>
            </label>
          </div>
        </section>

        <section class="settings-card">
          <h3>Display Options</h3>
          <div class="disp-group">
            <div class="disp-label">Theme</div>
            <label class="disp-radio"><input type="radio" name="disp-theme" value="light" ${theme === 'light' ? 'checked' : ''}>Light Theme</label>
            <label class="disp-radio"><input type="radio" name="disp-theme" value="dark" ${theme === 'dark' ? 'checked' : ''}>Dark Theme</label>
            <label class="disp-radio"><input type="radio" name="disp-theme" value="system" ${theme === 'system' ? 'checked' : ''}>Match System</label>
          </div>
          <div class="disp-group">
            <div class="disp-label">Balance Style</div>
            <label class="disp-radio disp-radio-preview">
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
            <label class="disp-radio disp-radio-preview">
              <input type="radio" name="disp-balance" value="mono" ${balance === 'mono' ? 'checked' : ''}>
              <span class="disp-radio-body">
                <span class="disp-radio-title">Differentiate Without Color</span>
                <span class="disp-preview" data-balance="mono">
                  <span class="pill overspent">-$10.00</span>
                  <span class="pill underfunded">$10.00</span>
                  <span class="pill pos">$10.00</span>
                </span>
              </span>
            </label>
          </div>
        </section>

        <section class="settings-card">
          <h3>The Four Rules</h3>
          <ol class="rules-list">
            <li><strong>Give Every Dollar a Job:</strong> assign every dollar you have to a category before you spend it.</li>
            <li><strong>Embrace Your True Expenses:</strong> break big irregular bills into small monthly savings now.</li>
            <li><strong>Roll With the Punches:</strong> overspend a category? Cover it by moving money from another, then move on.</li>
            <li><strong>Age Your Money:</strong> spend money you earned a while ago, not last week's paycheck, and you'll build a buffer.</li>
          </ol>
        </section>

        <section class="settings-card">
          <h3>Bank Syncing</h3>
          <div class="sync-card muted">
            <p>Basiq bank sync: coming soon. All data stays on this device.</p>
            <button class="btn secondary" disabled>Connect bank</button>
          </div>
        </section>

        <section class="settings-card">
          <h3>Data</h3>
          <div class="data-actions">
            <button id="set-export" class="btn secondary">Export budget (JSON)</button>
            <label class="btn secondary file-btn">Import budget<input id="set-import" type="file" accept="application/json" hidden></label>
            <button id="set-reset" class="btn danger">Reset all data</button>
          </div>
        </section>

        <section class="settings-card">
          <h3>About</h3>
          <p class="muted">Sapient Spend: a local-first budgeting app. Works offline (PWA). Your data never leaves this device.</p>
          <a class="link-btn" href="https://github.com/kunwaaarrr/sapient-spend" target="_blank" rel="noopener" style="margin-top:12px">⭐ Leave a review</a>
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
