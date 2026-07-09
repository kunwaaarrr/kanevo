import { store } from '../store.js';
import { toast, navigate } from '../app.js';
import { h, thisMonth } from '../util.js';

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
  root.innerHTML = h`<div class="view-head"><div class="view-title">Settings</div></div>
    <div class="settings-body">

      <section class="settings-card">
        <h3>More views</h3>
        <div class="settings-quick-links">
          <a class="btn subtle" href="#/fifty">50/30/20 Rule</a>
          <a class="btn subtle" href="#/forecast">Forecast &amp; What-Ifs</a>
          <a class="btn subtle" href="#/loans">Loan Planner</a>
        </div>
      </section>

      <section class="settings-card">
        <h3>Budget</h3>
        <div class="form-row">
          <label for="set-budget-name">Budget name</label>
          <input id="set-budget-name" type="text" value="${s.budgetName}">
        </div>
        <div class="form-row">
          <label for="set-currency">Currency symbol</label>
          <input id="set-currency" type="text" maxlength="3" value="${s.currencySymbol}">
        </div>
        <div class="form-row toggle-row">
          <label for="set-hide">Hide amounts (privacy mode)</label>
          <label class="switch">
            <input id="set-hide" type="checkbox" ${s.hideAmounts ? 'checked' : ''}>
            <span class="switch-track"></span>
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
      </section>

    </div>`;

  root.querySelector('#set-budget-name').onchange = e => store.updateSettings({ budgetName: e.target.value });
  root.querySelector('#set-currency').onchange = e => store.updateSettings({ currencySymbol: e.target.value });
  root.querySelector('#set-hide').onchange = e => store.updateSettings({ hideAmounts: e.target.checked });

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
