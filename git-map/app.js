const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let state = null;
let graphCommits = [];
let selectedSha = null;
let branchKind = 'local';
let graphScale = 1;
let toastTimer = null;
const minGraphScale = .35;
const maxGraphScale = 1.8;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const shortDate = value => {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setBusy(busy, label = '') {
  $('#localRefresh').disabled = busy;
  $('#githubRefresh').disabled = busy;
  $('#scanStatus').textContent = label || (busy ? 'Scanning…' : 'Ready');
}

async function refresh(fetchRemote = false) {
  setBusy(true, fetchRemote ? 'Fetching GitHub and rescanning…' : 'Rescanning local Git…');
  try {
    state = await api('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fetch: fetchRemote }),
    });
    graphCommits = state.commits;
    selectedSha = null;
    $('#workspace').classList.remove('has-detail');
    $('#detailPanel').innerHTML = '';
    renderAll();
    if (state.fetch) showToast(state.fetch.message);
    setBusy(false, `Updated ${shortDate(state.generatedAt)}`);
  } catch (error) {
    setBusy(false, 'Update failed');
    showToast(error.message);
  }
}

function renderOverview() {
  const { repo, worktrees, refs, commits } = state;
  const locals = refs.filter(ref => ref.kind === 'local');
  const remotes = refs.filter(ref => ref.kind === 'remote');
  const relation = repo.mainVsOrigin;
  let sentence = `You have ${worktrees.length} worktrees, ${locals.length} local branches and ${commits.length} visible commits. `;
  if (relation) {
    if (!relation.ahead && !relation.behind) {
      sentence += 'Your local main and GitHub main point to the same commit.';
    } else {
      sentence += `Your local main is ${relation.ahead} commit${relation.ahead === 1 ? '' : 's'} ahead and ${relation.behind} behind GitHub main.`;
    }
  }
  if (repo.status.dirtyCount) sentence += ` The main worktree also has ${repo.status.dirtyCount} uncommitted change${repo.status.dirtyCount === 1 ? '' : 's'}.`;
  $('#plainSummary').textContent = sentence;
  $('#repoPath').textContent = repo.displayPath;
  $('#statGrid').innerHTML = [
    ['Worktrees', worktrees.length, ''],
    ['Local branches', locals.length, ''],
    ['GitHub refs', remotes.length, ''],
    ['Main ahead', relation?.ahead ?? '–', relation?.ahead ? 'warn' : 'good'],
    ['Main behind', relation?.behind ?? '–', relation?.behind ? 'warn' : 'good'],
  ].map(([label, value, cls]) => `<div class="stat ${cls}"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function renderWorktrees() {
  $('#worktreeCount').textContent = state.worktrees.length;
  $('#worktreeList').innerHTML = state.worktrees.map(worktree => {
    const title = worktree.branch || `Detached at ${worktree.shortHead}`;
    const active = worktree.path === state.repo.path ? ' active' : '';
    return `<button class="worktree-card${active}" data-head="${esc(worktree.head)}">
      <span class="card-title">
        <strong>${esc(title)}</strong>
        ${worktree.detached ? '<span class="detached">DETACHED</span>' : worktree.dirtyCount ? `<span class="dirty">${worktree.dirtyCount} CHANGED</span>` : '<span class="ref-pill local">CLEAN</span>'}
      </span>
      <span class="card-meta"><span>${esc(worktree.shortHead)}</span><span>${worktree.locked ? 'locked' : 'ready'}</span></span>
      <span class="path" title="${esc(worktree.path)}">${esc(worktree.displayPath)}</span>
    </button>`;
  }).join('');
  $$('.worktree-card').forEach(card => card.addEventListener('click', () => selectCommit(card.dataset.head, true)));
}

function renderBranches() {
  const branches = state.refs.filter(ref => ref.kind === branchKind);
  $('#branchCount').textContent = branches.length;
  $('#branchList').innerHTML = branches.map(ref => {
    const relation = ref.kind === 'local' && ref.name !== 'main'
      ? `<span class="branch-relation"><b>${ref.vsMain.ahead}</b> ahead · <b>${ref.vsMain.behind}</b> behind main</span>`
      : '';
    return `<button class="branch-card" data-ref="${esc(ref.name)}" data-sha="${esc(ref.sha)}">
      <span class="card-title"><strong>${esc(ref.name)}</strong><span class="ref-pill ${ref.kind}">${ref.kind === 'local' ? 'LOCAL' : 'GITHUB'}</span></span>
      <span class="subject">${esc(ref.subject)}</span>
      <span class="card-meta"><span>${esc(ref.shortSha)}</span><span>${esc(shortDate(ref.date))}</span></span>
      ${relation}
    </button>`;
  }).join('');
  $$('.branch-card').forEach(card => card.addEventListener('click', async () => {
    $('#historyRef').value = card.dataset.ref;
    await loadHistory(card.dataset.ref);
    selectCommit(card.dataset.sha, true);
  }));
}

function cleanDecoration(ref) {
  return ref
    .replace(/^HEAD -> /, '')
    .replace(/^tag: /, '')
    .replace(/^origin\//, 'origin/');
}

function buildLayout(commits) {
  const active = [];
  const laneBySha = new Map();
  const rowBySha = new Map();
  const nodes = [];
  let maxLane = 0;

  const freeLane = preferred => {
    if (preferred != null && !active[preferred]) return preferred;
    const open = active.findIndex(value => !value);
    return open >= 0 ? open : active.length;
  };

  commits.forEach((commit, row) => {
    let lane = active.indexOf(commit.sha);
    if (lane < 0) lane = laneBySha.get(commit.sha) ?? freeLane();
    active[lane] = null;
    laneBySha.set(commit.sha, lane);
    rowBySha.set(commit.sha, row);
    const parentLanes = [];
    commit.parents.forEach((parent, index) => {
      let parentLane = active.indexOf(parent);
      if (parentLane < 0) {
        parentLane = laneBySha.get(parent);
        if (parentLane == null || active[parentLane]) parentLane = freeLane(index === 0 ? lane : null);
        active[parentLane] = parent;
        laneBySha.set(parent, parentLane);
      }
      parentLanes.push(parentLane);
      maxLane = Math.max(maxLane, parentLane);
    });
    nodes.push({ commit, row, lane, parentLanes });
    maxLane = Math.max(maxLane, lane);
  });
  return { nodes, rowBySha, laneBySha, maxLane };
}

function renderGraph() {
  const search = $('#commitSearch').value.trim().toLowerCase();
  const commits = search
    ? graphCommits.filter(commit => `${commit.sha} ${commit.subject} ${commit.author} ${commit.refs.join(' ')}`.toLowerCase().includes(search))
    : graphCommits;
  const canvas = $('#graphCanvas');
  if (!commits.length) {
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.innerHTML = '<div class="empty-state">No commits match that search.</div>';
    return;
  }

  const { nodes, rowBySha, laneBySha, maxLane } = buildLayout(commits);
  const laneWidth = 190;
  const rowHeight = 92;
  const nodeWidth = 172;
  const nodeHeight = 64;
  const left = 36;
  const top = 28;
  const width = Math.max(900, left * 2 + (maxLane + 1) * laneWidth + nodeWidth);
  const height = top * 2 + nodes.length * rowHeight;

  const edges = [];
  nodes.forEach(({ commit, row, lane }) => {
    const x1 = left + lane * laneWidth + nodeWidth / 2;
    const y1 = top + row * rowHeight + nodeHeight;
    commit.parents.forEach((parent, parentIndex) => {
      const parentRow = rowBySha.get(parent);
      if (parentRow == null) return;
      const parentLane = laneBySha.get(parent) ?? lane;
      const x2 = left + parentLane * laneWidth + nodeWidth / 2;
      const y2 = top + parentRow * rowHeight;
      const mid = y1 + Math.max(18, (y2 - y1) * .48);
      edges.push(`<path class="edge ${parentIndex ? 'merge-edge' : ''}" d="M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}"/>`);
    });
  });

  const nodeHtml = nodes.map(({ commit, row, lane }) => {
    const localRefs = commit.refs.filter(ref => !ref.includes('origin/'));
    const remoteRefs = commit.refs.filter(ref => ref.includes('origin/'));
    const refHtml = [...localRefs, ...remoteRefs].slice(0, 2).map(ref =>
      `<span class="node-ref ${ref.includes('origin/') ? 'remote' : ''}">${esc(cleanDecoration(ref))}</span>`
    ).join('');
    const classes = [
      'commit-node',
      commit.sha === selectedSha ? 'selected' : '',
      commit.sha === state.repo.head ? 'current' : '',
      commit.isMerge ? 'merge' : '',
    ].filter(Boolean).join(' ');
    return `<button class="${classes}" data-sha="${commit.sha}" style="left:${left + lane * laneWidth}px;top:${top + row * rowHeight}px">
      <span class="commit-top"><b>${commit.shortSha}</b><span>${esc(shortDate(commit.date).split(',')[0])}</span></span>
      <span class="commit-subject">${esc(commit.subject)}</span>
      ${refHtml ? `<span class="node-refs">${refHtml}</span>` : ''}
    </button>`;
  }).join('');

  canvas.dataset.naturalWidth = width;
  canvas.dataset.naturalHeight = height;
  canvas.style.width = `${Math.ceil(width * graphScale)}px`;
  canvas.style.height = `${Math.ceil(height * graphScale)}px`;
  canvas.innerHTML = `<div class="graph-stage" style="width:${width}px;height:${height}px;transform:scale(${graphScale})">
    <svg class="graph-edges" width="${width}" height="${height}" aria-hidden="true">${edges.join('')}</svg>
    ${nodeHtml}
  </div>`;
  $('#zoomLevel').textContent = `${Math.round(graphScale * 100)}%`;
  $$('.commit-node').forEach(node => node.addEventListener('click', () => selectCommit(node.dataset.sha)));
}

function setGraphScale(nextScale, focusX, focusY) {
  const viewport = $('#graphScroll');
  const oldScale = graphScale;
  const clamped = Math.min(maxGraphScale, Math.max(minGraphScale, nextScale));
  if (Math.abs(clamped - oldScale) < .001) return;

  const anchorX = (viewport.scrollLeft + (focusX ?? viewport.clientWidth / 2)) / oldScale;
  const anchorY = (viewport.scrollTop + (focusY ?? viewport.clientHeight / 2)) / oldScale;
  graphScale = clamped;
  renderGraph();
  viewport.scrollLeft = anchorX * graphScale - (focusX ?? viewport.clientWidth / 2);
  viewport.scrollTop = anchorY * graphScale - (focusY ?? viewport.clientHeight / 2);
}

function fitGraph() {
  const viewport = $('#graphScroll');
  const naturalWidth = Number($('#graphCanvas').dataset.naturalWidth);
  if (!naturalWidth) return;
  setGraphScale((viewport.clientWidth - 28) / naturalWidth, 0, 0);
  viewport.scrollLeft = 0;
}

function bindGraphNavigation() {
  const viewport = $('#graphScroll');
  let drag = null;

  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, input, select, a')) return;
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });

  viewport.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  });

  const stopDragging = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    viewport.classList.remove('dragging');
  };
  viewport.addEventListener('pointerup', stopDragging);
  viewport.addEventListener('pointercancel', stopDragging);

  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setGraphScale(
      graphScale * (event.deltaY < 0 ? 1.12 : .89),
      event.clientX - rect.left,
      event.clientY - rect.top
    );
  }, { passive: false });
}

async function selectCommit(sha, scrollIntoView = false) {
  selectedSha = sha;
  const workspace = $('#workspace');
  workspace.classList.add('has-detail');
  renderGraph();
  if (scrollIntoView) {
    const node = document.querySelector(`.commit-node[data-sha="${CSS.escape(sha)}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  $('#detailPanel').innerHTML = '<div class="detail-empty"><h2>Reading commit…</h2></div>';
  try {
    const detail = await api(`/api/commit/${encodeURIComponent(sha)}`);
    renderDetail(detail);
  } catch (error) {
    $('#detailPanel').innerHTML = `<div class="detail-empty"><button class="detail-close" id="closeDetail" type="button" aria-label="Close commit details">×</button><h2>Could not read commit</h2><p>${esc(error.message)}</p></div>`;
    $('#closeDetail').onclick = closeDetail;
  }
}

function closeDetail() {
  selectedSha = null;
  $('#workspace').classList.remove('has-detail');
  $('#detailPanel').innerHTML = '';
  renderGraph();
}

function renderDetail(detail) {
  const body = detail.body ? `<div class="detail-body">${esc(detail.body)}</div>` : '';
  const files = detail.files.map(file => `<div class="file-row">
    <span class="file-status">${esc(file.status)}</span>
    <code>${esc(file.path)}</code>
    <span class="file-delta"><span class="add">+${file.added}</span><span class="del">−${file.deleted}</span></span>
  </div>`).join('');
  $('#detailPanel').innerHTML = `
    <div class="detail-head">
      <button class="detail-close" id="closeDetail" type="button" aria-label="Close commit details">×</button>
      <span class="detail-sha">${detail.shortSha}</span>
      <h2>${esc(detail.subject)}</h2>
      <p>${esc(detail.author)} · ${esc(shortDate(detail.date))}</p>
    </div>
    ${body}
    <div class="detail-stats">
      <span class="mini-stat"><b>${detail.totals.files}</b> files</span>
      <span class="mini-stat add"><b>+${detail.totals.added}</b></span>
      <span class="mini-stat del"><b>−${detail.totals.deleted}</b></span>
    </div>
    <div class="detail-actions">
      <button class="btn ghost" id="copySha">Copy SHA</button>
      <button class="btn primary" id="copyAi">Copy AI brief</button>
    </div>
    <h3 class="files-title">Files changed</h3>
    <div class="file-list">${files || '<p>No file changes shown (often true for some merge commits).</p>'}</div>
    <h3 class="patch-title">Exact patch</h3>
    <details class="patch-box">
      <summary>Open code changes${detail.patchTruncated ? ' (large patch, shortened)' : ''}</summary>
      <pre class="patch">${esc(detail.patch || 'No patch content.')}</pre>
    </details>`;

  $('#closeDetail').onclick = closeDetail;
  $('#copySha').onclick = () => copyText(detail.sha, 'Commit SHA copied');
  $('#copyAi').onclick = () => {
    const fileSummary = detail.files.map(file => `${file.status} ${file.path} (+${file.added}/-${file.deleted})`).join('\n');
    const brief = `Explain this Kanevo commit to a non-technical vibe coder.\n\nCommit: ${detail.sha}\nTitle: ${detail.subject}\nAuthor/date: ${detail.author}, ${detail.date}\n\nMessage:\n${detail.body || '(no extra message)'}\n\nFiles:\n${fileSummary || '(none shown)'}`;
    copyText(brief, 'AI brief copied — paste it into Codex or ChatGPT');
  };
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast('Clipboard access was blocked by the browser.');
  }
}

function populateSelectors() {
  const localRefs = state.refs.filter(ref => ref.kind === 'local');
  const historyOptions = [
    '<option value="--all">Everything</option>',
    ...state.refs.map(ref => `<option value="${esc(ref.name)}">${ref.kind === 'remote' ? 'GitHub · ' : ''}${esc(ref.name)}</option>`),
  ];
  $('#historyRef').innerHTML = historyOptions.join('');
  const localOptions = localRefs.map(ref => `<option value="${esc(ref.name)}">${esc(ref.name)}</option>`).join('');
  $('#compareSource').innerHTML = localOptions;
  $('#compareTarget').innerHTML = localOptions;
  const sourceFallback = localRefs.find(ref => ref.name !== 'main')?.name || localRefs[0]?.name;
  $('#compareSource').value = sourceFallback || '';
  $('#compareTarget').value = localRefs.some(ref => ref.name === 'main') ? 'main' : localRefs[0]?.name || '';
}

async function loadHistory(ref) {
  setBusy(true, `Loading ${ref === '--all' ? 'all history' : ref}…`);
  try {
    const data = await api(`/api/history?ref=${encodeURIComponent(ref)}`);
    graphCommits = data.commits;
    selectedSha = null;
    $('#workspace').classList.remove('has-detail');
    $('#detailPanel').innerHTML = '';
    renderGraph();
    setBusy(false, `Showing ${graphCommits.length} commits`);
  } catch (error) {
    setBusy(false, 'Could not load history');
    showToast(error.message);
  }
}

async function runCompare() {
  const source = $('#compareSource').value;
  const target = $('#compareTarget').value;
  if (!source || !target || source === target) {
    showToast('Choose two different local branches.');
    return;
  }
  $('#compareBtn').disabled = true;
  $('#compareResult').innerHTML = '<p>Comparing branches…</p>';
  try {
    const result = await api(`/api/compare?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`);
    const commits = result.commits.map(commit => `<div class="compare-commit"><code>${esc(commit.sha)}</code><span>${esc(commit.subject)}</span></div>`).join('');
    const commands = result.reviewCommands.map(command => `<code>${esc(command)}</code>`).join('');
    $('#compareResult').innerHTML = `
      <div class="compare-summary">
        <span class="mini-stat add"><b>${result.sourceAhead}</b> commits would come in</span>
        <span class="mini-stat"><b>${result.sourceBehind}</b> commits exist only in ${esc(target)}</span>
      </div>
      ${result.commits.length
        ? `<div class="compare-commits">${commits}</div>`
        : `<p>${esc(source)} has no commits that are missing from ${esc(target)}.</p>`}
      <div class="command-box">
        <strong>Safe review commands (these do not merge)</strong>
        ${commands}
        <button class="btn ghost compact" id="copyReview">Copy review commands</button>
      </div>`;
    $('#copyReview').onclick = () => copyText(result.reviewCommands.join('\n'), 'Review commands copied');
  } catch (error) {
    $('#compareResult').innerHTML = `<p>${esc(error.message)}</p>`;
  } finally {
    $('#compareBtn').disabled = false;
  }
}

function renderGithub() {
  const github = state.github;
  if (!github.available) {
    $('#githubContent').innerHTML = `<p>Remote: <a href="${esc(github.url)}" target="_blank" rel="noopener">${esc(github.owner && github.repo ? `${github.owner}/${github.repo}` : github.url)}</a></p>
      <p>Click “Fetch GitHub + update” to query the live public repository and recent workflows.</p>`;
    return;
  }
  const runs = github.workflowRuns.map(run => `<a class="workflow" href="${esc(run.url)}" target="_blank" rel="noopener">
    <strong>${esc(run.name)}</strong>
    <span class="${run.conclusion === 'success' ? 'success' : run.conclusion === 'failure' ? 'failure' : ''}">${esc(run.conclusion || run.status)} · ${esc(run.branch)} · ${esc(run.sha)}</span>
    <span>${esc(shortDate(run.createdAt))}</span>
  </a>`).join('');
  $('#githubContent').innerHTML = `<p><a href="${esc(github.url)}" target="_blank" rel="noopener">${esc(`${github.owner}/${github.repo}`)}</a> · ${esc(github.visibility)} · default ${esc(github.defaultBranch)} · pushed ${esc(shortDate(github.pushedAt))}</p>
    <div class="workflow-grid">${runs || '<p>No recent workflow runs returned.</p>'}</div>`;
}

function renderAll() {
  renderOverview();
  renderWorktrees();
  renderBranches();
  populateSelectors();
  renderGraph();
  renderGithub();
}

function bindStaticEvents() {
  $('#localRefresh').onclick = () => refresh(false);
  $('#githubRefresh').onclick = () => refresh(true);
  $('#historyRef').onchange = event => loadHistory(event.target.value);
  $('#commitSearch').oninput = renderGraph;
  $('#compareBtn').onclick = runCompare;
  $('#zoomOut').onclick = () => setGraphScale(graphScale / 1.2);
  $('#zoomIn').onclick = () => setGraphScale(graphScale * 1.2);
  $('#fitGraph').onclick = fitGraph;
  $('#resetGraph').onclick = () => {
    graphScale = 1;
    renderGraph();
    $('#graphScroll').scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  };
  $('#toggleSummary').onclick = () => {
    const collapsed = $('#mainContent').classList.toggle('summary-collapsed');
    $('#toggleSummary').textContent = collapsed ? 'Show summary' : 'Hide summary';
    $('#toggleSummary').setAttribute('aria-expanded', String(!collapsed));
  };
  $('#toggleSidebar').onclick = () => {
    const collapsed = $('#workspace').classList.toggle('left-collapsed');
    $('#toggleSidebar').textContent = collapsed ? 'Show sidebar' : 'Hide sidebar';
    $('#toggleSidebar').setAttribute('aria-expanded', String(!collapsed));
  };
  bindGraphNavigation();
  $$('.tiny-toggle').forEach(button => button.addEventListener('click', () => {
    branchKind = button.dataset.branchKind;
    $$('.tiny-toggle').forEach(item => item.classList.toggle('active', item === button));
    renderBranches();
  }));
}

async function boot() {
  bindStaticEvents();
  if (location.protocol === 'file:') {
    document.body.classList.add('file-mode');
    $('#localRefresh').disabled = true;
    $('#githubRefresh').disabled = true;
    $('#scanStatus').textContent = 'Launcher required';
    $('#repoPath').textContent = 'Direct-file preview';
    $('#graphCanvas').innerHTML = `<div class="launch-required">
      <span class="launch-icon">↗</span>
      <h2>Open the live Git Map</h2>
      <p>A standalone HTML file cannot read your repository or run Git. Use the Kanevo launcher, then this map can scan and update normally.</p>
      <a class="btn primary" href="http://127.0.0.1:8765/">Open live map</a>
      <small>Or double-click “Open Kanevo Git Map.command” in the Kanevo folder.</small>
    </div>`;
    return;
  }
  setBusy(true, 'Scanning repository…');
  try {
    state = await api('/api/state');
    graphCommits = state.commits;
    renderAll();
    setBusy(false, `Updated ${shortDate(state.generatedAt)}`);
  } catch (error) {
    setBusy(false, 'Could not scan');
    $('#plainSummary').textContent = error.message;
  }
}

boot();
