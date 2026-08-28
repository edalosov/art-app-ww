import * as sync from './sync.js';

const STORAGE_KEY = 'artLinkRotator.v1';

/** @typedef {{id:string, url:string, title:string, addedAt:number, everShown:boolean}} LinkEntry */
/** state: { links: LinkEntry[], queue: string[], currentId: string|null, cycleNumber: number } */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { links: [], queue: [], currentId: null, cycleNumber: 1 };
    const parsed = JSON.parse(raw);
    return {
      links: Array.isArray(parsed.links) ? parsed.links : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      currentId: parsed.currentId || null,
      cycleNumber: parsed.cycleNumber || 1,
    };
  } catch (e) {
    console.error('Failed to load state, starting fresh.', e);
    return { links: [], queue: [], currentId: null, cycleNumber: 1 };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  pushToCloudIfConnected();
}

const state = loadState();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function findLink(id) {
  return state.links.find((l) => l.id === id) || null;
}

function rebuildQueue() {
  let ids = shuffle(state.links.map((l) => l.id));
  // avoid immediately repeating the link we just showed, when possible
  if (ids.length > 1 && ids[0] === state.currentId) {
    const swapWith = 1 + Math.floor(Math.random() * (ids.length - 1));
    [ids[0], ids[swapWith]] = [ids[swapWith], ids[0]];
  }
  state.queue = ids;
  state.cycleNumber += 1;
}

// Drop ids from the queue that no longer exist (link was deleted).
function pruneQueue() {
  const validIds = new Set(state.links.map((l) => l.id));
  state.queue = state.queue.filter((id) => validIds.has(id));
}

function pickNextLink() {
  pruneQueue();
  if (state.links.length === 0) {
    state.currentId = null;
    saveState();
    return;
  }
  if (state.queue.length === 0) {
    rebuildQueue();
  }
  const nextId = state.queue.shift();
  state.currentId = nextId;
  const link = findLink(nextId);
  if (link) link.everShown = true;
  saveState();
}

function addLink(url, title) {
  const entry = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
    url: url.trim(),
    title: (title || '').trim(),
    addedAt: Date.now(),
    everShown: false,
  };
  state.links.push(entry);
  state.queue.push(entry.id); // included in the current cycle
  saveState();
  return entry;
}

function removeLink(id) {
  state.links = state.links.filter((l) => l.id !== id);
  state.queue = state.queue.filter((qid) => qid !== id);
  if (state.currentId === id) {
    state.currentId = null;
    pickNextLink();
    return;
  }
  saveState();
}

function clearAllLinks() {
  state.links = [];
  state.queue = [];
  state.currentId = null;
  state.cycleNumber = 1;
  saveState();
}

// ---------- cloud sync ----------

let cloudReady = !sync.isCloudEnabled(); // if cloud isn't configured, there's nothing to wait for
let applyingRemoteUpdate = false;
let hasAutoPicked = false;

function pushToCloudIfConnected() {
  if (applyingRemoteUpdate) return; // don't echo a remote update straight back to the cloud
  const code = sync.getStoredSyncCode();
  if (!sync.isCloudEnabled() || !code) return;
  sync.push(code, {
    links: state.links,
    queue: state.queue,
    currentId: state.currentId,
    cycleNumber: state.cycleNumber,
  }).catch((e) => {
    console.error('Cloud sync push failed', e);
    setSyncStatus('error', 'Sync error — check your connection');
  });
}

function applyRemoteState(data) {
  applyingRemoteUpdate = true;
  state.links = Array.isArray(data.links) ? data.links : [];
  state.queue = Array.isArray(data.queue) ? data.queue : [];
  state.currentId = data.currentId || null;
  state.cycleNumber = data.cycleNumber || 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyingRemoteUpdate = false;
}

async function startSync(code) {
  setSyncStatus('connecting', 'Connecting…');
  try {
    await sync.connect(
      code,
      (data) => {
        if (data) {
          applyRemoteState(data);
        } else {
          // Nothing in the cloud yet under this code — seed it with what we have locally.
          pushToCloudIfConnected();
        }
        cloudReady = true;
        setSyncStatus('connected', 'Cloud sync on');
        renderAll();
        maybeAutoPick();
      },
      (err) => {
        console.error('Sync error', err);
        setSyncStatus('error', 'Sync error — check your connection');
      }
    );
  } catch (e) {
    console.error('Failed to start sync', e);
    setSyncStatus('error', 'Could not connect');
  }
}

// ---------- UI wiring ----------

const els = {
  tabBtns: document.querySelectorAll('.tab-btn'),
  views: document.querySelectorAll('.view'),
  emptyState: document.getElementById('empty-state'),
  rotatorContent: document.getElementById('rotator-content'),
  goManageBtn: document.getElementById('go-manage-btn'),
  progressLabel: document.getElementById('progress-label'),
  resetCycleBtn: document.getElementById('reset-cycle-btn'),
  currentTitle: document.getElementById('current-title'),
  currentUrl: document.getElementById('current-url'),
  copyBtn: document.getElementById('copy-btn'),
  nextBtn: document.getElementById('next-btn'),
  copiedToast: document.getElementById('copied-toast'),
  openExternal: document.getElementById('open-external'),
  previewFrame: document.getElementById('preview-frame'),
  addForm: document.getElementById('add-form'),
  urlInput: document.getElementById('url-input'),
  titleInput: document.getElementById('title-input'),
  countLabel: document.getElementById('count-label'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  linkList: document.getElementById('link-list'),
  syncPanel: document.getElementById('sync-panel'),
  syncStatusDot: document.getElementById('sync-status-dot'),
  syncStatusText: document.getElementById('sync-status-text'),
  syncSetup: document.getElementById('sync-setup'),
  syncConnected: document.getElementById('sync-connected'),
  syncGenerateBtn: document.getElementById('sync-generate-btn'),
  syncCodeInput: document.getElementById('sync-code-input'),
  syncJoinBtn: document.getElementById('sync-join-btn'),
  syncCodeDisplay: document.getElementById('sync-code-display'),
  syncCopyBtn: document.getElementById('sync-copy-btn'),
  syncDisconnectBtn: document.getElementById('sync-disconnect-btn'),
  syncDisabledNote: document.getElementById('sync-disabled-note'),
};

let currentView = null;

function switchView(name) {
  currentView = name;
  els.tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  els.views.forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  maybeAutoPick();
}

els.tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
els.goManageBtn.addEventListener('click', () => switchView('manage'));

function displayName(link) {
  return link.title || hostnameOf(link.url);
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function renderRotator() {
  if (state.links.length === 0) {
    els.emptyState.classList.remove('hidden');
    els.rotatorContent.classList.add('hidden');
    return;
  }
  els.emptyState.classList.add('hidden');
  els.rotatorContent.classList.remove('hidden');

  const link = findLink(state.currentId);
  if (!link) return;

  const shownCount = state.links.length - state.queue.length;
  els.progressLabel.textContent = `Cycle ${state.cycleNumber} · ${shownCount} of ${state.links.length} shown`;
  els.resetCycleBtn.classList.toggle('hidden', state.links.length < 2);

  els.currentTitle.textContent = displayName(link);
  els.currentUrl.textContent = link.url;
  els.openExternal.href = link.url;
  els.previewFrame.src = link.url;
}

function renderManageList() {
  els.countLabel.textContent = state.links.length
    ? `${state.links.length} link${state.links.length === 1 ? '' : 's'} saved`
    : 'No links saved yet';
  els.clearAllBtn.classList.toggle('hidden', state.links.length === 0);

  els.linkList.innerHTML = '';
  state.links.forEach((link) => {
    const li = document.createElement('li');
    li.className = 'link-item' + (link.everShown ? ' seen' : '');

    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.title = link.everShown ? 'Already shown' : 'Not shown yet';

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = displayName(link);
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = link.url;
    info.append(title, url);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', 'Delete link');
    removeBtn.addEventListener('click', () => {
      removeLink(link.id);
      renderAll();
    });

    li.append(dot, info, removeBtn);
    els.linkList.appendChild(li);
  });
}

function renderAll() {
  renderRotator();
  renderManageList();
}

els.addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = els.urlInput.value.trim();
  if (!url) return;
  try {
    new URL(url);
  } catch {
    alert('That doesn\'t look like a valid link.');
    return;
  }
  const wasEmpty = state.links.length === 0;
  addLink(url, els.titleInput.value);
  els.urlInput.value = '';
  els.titleInput.value = '';
  if (wasEmpty) pickNextLink();
  renderAll();
});

els.clearAllBtn.addEventListener('click', () => {
  if (confirm('Delete all saved links? This can\'t be undone.')) {
    clearAllLinks();
    renderAll();
  }
});

els.nextBtn.addEventListener('click', () => {
  pickNextLink();
  renderRotator();
});

els.resetCycleBtn.addEventListener('click', () => {
  state.queue = [];
  pickNextLink();
  renderRotator();
});

els.copyBtn.addEventListener('click', async () => {
  const link = findLink(state.currentId);
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link.url);
  } catch {
    // Fallback for browsers without Clipboard API access in this context.
    const ta = document.createElement('textarea');
    ta.value = link.url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  els.copiedToast.classList.remove('hidden');
  clearTimeout(els.copiedToast._timer);
  els.copiedToast._timer = setTimeout(() => els.copiedToast.classList.add('hidden'), 1500);
});

// ---------- sync panel wiring ----------

function setSyncStatus(kind, text) {
  els.syncStatusText.textContent = text;
  els.syncStatusDot.className = 'status-dot sync-' + kind;
}

function showSyncConnectedUI(code) {
  els.syncSetup.classList.add('hidden');
  els.syncConnected.classList.remove('hidden');
  els.syncCodeDisplay.textContent = code;
}

function showSyncSetupUI() {
  els.syncSetup.classList.remove('hidden');
  els.syncConnected.classList.add('hidden');
}

function confirmReplaceLocalIfNeeded() {
  if (state.links.length === 0) return true;
  return confirm(
    `This device already has ${state.links.length} saved link(s). Connecting will replace them with the synced list from your other device. Continue?`
  );
}

if (!sync.isCloudEnabled()) {
  els.syncDisabledNote.classList.remove('hidden');
  els.syncSetup.classList.add('hidden');
} else {
  const existingCode = sync.getStoredSyncCode();
  if (existingCode) {
    showSyncConnectedUI(existingCode);
    startSync(existingCode);
  } else {
    setSyncStatus('off', 'Cloud sync: not connected');
  }
}

els.syncGenerateBtn.addEventListener('click', async () => {
  const code = sync.generateSyncCode();
  showSyncConnectedUI(code);
  await startSync(code);
});

els.syncJoinBtn.addEventListener('click', async () => {
  const code = els.syncCodeInput.value.trim();
  if (!code) return;
  if (!confirmReplaceLocalIfNeeded()) return;
  showSyncConnectedUI(code);
  await startSync(code);
});

els.syncCopyBtn.addEventListener('click', async () => {
  const code = els.syncCodeDisplay.textContent;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    /* clipboard not available; user can still select the text manually */
  }
});

els.syncDisconnectBtn.addEventListener('click', async () => {
  await sync.disconnect();
  sync.forgetSyncCode();
  showSyncSetupUI();
  setSyncStatus('off', 'Cloud sync: not connected');
});

// ---------- boot ----------

// On an iPhone the app's whole point is "open it, get a link", so default straight
// to the rotator. On anything else (a laptop/desktop browser) default to Manage,
// since opening the site there is almost always to add/edit links, not to consume one.
const isHandheld = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
switchView(isHandheld ? 'rotator' : 'manage');

function maybeAutoPick() {
  if (hasAutoPicked || !cloudReady || currentView !== 'rotator') return;
  hasAutoPicked = true;
  if (state.links.length > 0) pickNextLink();
  renderAll();
}
maybeAutoPick();
renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}
