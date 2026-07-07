import { store } from '../store.js';
import { navigate } from '../app.js';
import { fmt, fmtExact, fmtDate, h } from '../util.js';

const STEP = 25, MAX_EXTRA = 2000;
let extraCents = null; // module-local slider state, reset when accountId changes
let curAccountId;

function simulate(balance, rate, payment) {
  const r = rate / 1200;
  const points = [{ month: 0, balance }];
  let bal = balance, months = 0, totalInterest = 0;
  if (payment <= bal * r) return { points, months: Infinity, totalInterest: Infinity };
  while (bal > 0 && months < 1000) {
    const interest = bal * r;
    bal = bal + interest - payment;
    totalInterest += interest;
    months++;
    points.push({ month: months, balance: Math.max(0, bal) });
  }
  return { points, months, totalInterest };
}

function niceStep(maxVal, ticks = 4) {
  const raw = maxVal / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
  return step;
}

function burndownSvg(baseline, withExtra) {
  const W = 640, H = 220, padL = 60, padB = 26, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxMonth = Math.max(baseline.points.at(-1).month, withExtra.points.at(-1).month) || 1;
  const maxBal = baseline.points[0].balance || 1;
  const step = niceStep(maxBal);
  const yMax = Math.ceil(maxBal / step) * step;
  const x = m => padL + (m / maxMonth) * plotW;
  const y = b => padT + plotH - (b / yMax) * plotH;

  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const areaPath = pts => `${path(pts)} L${x(pts.at(-1).month).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const gridlines = [];
  for (let v = 0; v <= yMax; v += step) {
    gridlines.push(`<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="ln-grid"/>`);
    gridlines.push(`<text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="ln-ylabel" text-anchor="end">${fmt(v)}</text>`);
  }
  const yearMonths = [];
  for (let m = 0; m <= maxMonth; m += 12) yearMonths.push(m);
  if (yearMonths.at(-1) !== maxMonth) yearMonths.push(maxMonth);
  const xlabels = yearMonths.map(m =>
    `<text x="${x(m).toFixed(1)}" y="${H - 6}" class="ln-xlabel" text-anchor="middle">Yr ${Math.round(m / 12)}</text>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="burndown-svg" preserveAspectRatio="xMidYMid meet">
    ${gridlines.join('')}
    <path d="${areaPath(withExtra.points)}" class="area-extra"/>
    <path d="${path(baseline.points)}" class="line-baseline"/>
    <path d="${path(withExtra.points)}" class="line-extra"/>
    ${xlabels}
  </svg>`;
}

function accountCard(a) {
  const stats = store.loanStats(a.id, 0);
  const bal = store.accountBalances(a.id).working;
  return h`<a class="loan-card" href="#/loans/${a.id}">
    <div class="loan-card-name">${a.name}</div>
    <div class="loan-card-bal neg-text">${fmt(bal)}</div>
    <div class="loan-card-row"><span class="muted">Rate</span><span>${a.loanInfo.interestRate}%</span></div>
    <div class="loan-card-row"><span class="muted">Min payment</span><span>${fmt(a.loanInfo.minimumPayment)}/mo</span></div>
    <div class="loan-card-row"><span class="muted">Payoff at minimum</span><span>${stats.months === Infinity ? 'Never' : fmtDate(stats.payoffDate)}</span></div>
  </a>`;
}

function renderGrid(root) {
  const loans = store.state.accounts.filter(a => a.loanInfo && !a.closed);
  root.innerHTML = h`<div class="view-head"><div class="view-title">Loan Planner</div></div>
    <div class="loans-body">
      ${loans.length
        ? [`<div class="loan-grid">${loans.map(accountCard).join('')}</div>`]
        : `<div class="empty-state">
             <p>Add a loan account to start planning.</p>
             <p class="muted">Use "＋ Add Account" and choose a loan type (mortgage, auto, student, personal).</p>
           </div>`}
    </div>`;
}

function monthsToYM(n) {
  const y = Math.floor(n / 12), m = n % 12;
  if (n === Infinity) return 'Never';
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

function renderSimulator(root, account) {
  if (curAccountId !== account.id) { curAccountId = account.id; extraCents = 0; }
  const base = store.loanStats(account.id, 0);
  const withExtra = store.loanStats(account.id, extraCents);
  const balance = Math.abs(store.accountBalances(account.id).working);
  const rate = account.loanInfo.interestRate;
  const payment = account.loanInfo.minimumPayment;

  const degenerate = withExtra.months === Infinity;

  root.innerHTML = h`<div class="view-head">
      <div>
        <div class="view-title">${account.name}</div>
        <div class="muted">${rate}% APR · min payment ${fmt(payment)}/mo · balance <span class="neg-text">${fmt(balance)}</span></div>
      </div>
    </div>
    <div class="loans-body">
      <div class="extra-payment-card">
        <label for="extra-slider">Extra monthly payment</label>
        <div class="extra-controls">
          <input type="range" id="extra-slider" min="0" max="${MAX_EXTRA}" step="${STEP}" value="${extraCents / 100}">
          <div class="extra-amount-wrap">$<input type="number" id="extra-input" min="0" max="${MAX_EXTRA}" step="${STEP}" value="${extraCents / 100}"></div>
        </div>
      </div>
      ${degenerate
        ? `<div class="empty-state"><p>Payment too low to ever pay off.</p><p class="muted">Increase the extra monthly payment to see a payoff date.</p></div>`
        : [`
      <div class="loan-stats-grid">
        <div class="stat-card">
          <div class="stat-label">Payoff Date</div>
          <div class="stat-value">${fmtDate(base.payoffDate)} <span class="arrow">→</span> ${fmtDate(withExtra.payoffDate)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Interest</div>
          <div class="stat-value">${fmt(base.totalInterest)} <span class="arrow">→</span> ${fmt(withExtra.totalInterest)}</div>
        </div>
        <div class="stat-card savings-card">
          <div class="stat-label">Savings</div>
          <div class="stat-value">You'd save ${fmt(withExtra.interestSaved)} in interest and be debt-free ${monthsToYM(withExtra.timeSavedMonths)} sooner</div>
        </div>
      </div>
      <div class="burndown-card">
        <div class="burndown-legend"><span class="dot dot-baseline"></span>Baseline <span class="dot dot-extra"></span>With extra payment</div>
        ${burndownSvg(simulate(balance, rate, payment), simulate(balance, rate, payment + extraCents))}
      </div>`]}
      <a class="register-link" href="#/account/${account.id}">View account register →</a>
    </div>`;

  const slider = root.querySelector('#extra-slider');
  const numInput = root.querySelector('#extra-input');
  const onChange = val => {
    extraCents = Math.max(0, Math.min(MAX_EXTRA, Math.round(val / STEP) * STEP)) * 100;
    renderSimulator(root, account);
  };
  slider.oninput = () => onChange(+slider.value);
  numInput.onchange = () => onChange(+numInput.value || 0);
  if (document.activeElement !== slider && document.activeElement !== numInput) slider.focus({ preventScroll: true });
}

export function render(root, { accountId }) {
  if (!accountId) { curAccountId = undefined; renderGrid(root); return; }
  const account = store.state.accounts.find(a => a.id === accountId);
  if (!account || !account.loanInfo) { navigate('#/loans'); return; }
  renderSimulator(root, account);
}
