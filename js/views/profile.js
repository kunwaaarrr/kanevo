import { store } from '../store.js';
import { fmt, h, ICONS } from '../util.js';

export function render(root) {
  const openAccounts = store.state.accounts.filter(account => !account.closed);
  const total = openAccounts.reduce((sum, account) => sum + store.accountBalances(account.id).working, 0);
  root.innerHTML = h`<div class="profile-view">
    <header class="profile-head mobile-page-head"><h1 class="mobile-page-title">Profile</h1></header>
    <main class="profile-content">
      <section class="profile-hero">
        <span class="profile-avatar" aria-hidden="true">${ICONS.profile}</span>
        <div><span>Your Kanevo</span><strong>Local profile</strong><small>Private to this device</small></div>
      </section>

      <section class="profile-card">
        <a class="profile-row" href="#/accounts"><span class="profile-row-icon">${ICONS.accounts}</span><span><strong>Accounts</strong><small>${openAccounts.length} open · ${fmt(total)} total</small></span><b aria-hidden="true">›</b></a>
        <a class="profile-row" href="#/settings"><span class="profile-row-icon">${ICONS.settings}</span><span><strong>Settings</strong><small>Appearance, budget and preferences</small></span><b aria-hidden="true">›</b></a>
      </section>

      <section class="profile-card">
        <a class="profile-row" href="#/settings"><span class="profile-row-icon">${ICONS.eye}</span><span><strong>Privacy &amp; data</strong><small>Privacy mode, backups and local data</small></span><b aria-hidden="true">›</b></a>
        <a class="profile-row" href="#/settings"><span class="profile-row-icon">${ICONS.download}</span><span><strong>Bank connections</strong><small>Imports and future bank syncing</small></span><b aria-hidden="true">›</b></a>
      </section>

      <section class="profile-card">
        <a class="profile-row" href="https://github.com/kunwaaarrr/kanevo" target="_blank" rel="noopener"><span class="profile-row-icon">${ICONS.flag}</span><span><strong>Help &amp; feedback</strong><small>Support and feature requests</small></span><b aria-hidden="true">›</b></a>
        <a class="profile-row" href="#/settings"><span class="profile-row-icon profile-about-icon">K</span><span><strong>About Kanevo</strong><small>Version, privacy promise and project details</small></span><b aria-hidden="true">›</b></a>
      </section>
    </main>
  </div>`;
}
