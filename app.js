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

function addLink(url, title, artist) {
  const entry = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
    url: url.trim(),
    title: (title || '').trim(),
    artist: (artist || '').trim(),
    addedAt: Date.now(),
    everShown: false,
  };
  state.links.push(entry);
  state.queue.push(entry.id); // included in the current cycle
  state.queue = shuffle(state.queue); // otherwise newly-added links line up in the order you added them
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

// Only worth waiting on the cloud if this device already has a sync code to
// resolve — a device that hasn't set up sync yet (or isn't cloud-enabled at
// all) has nothing incoming, so it should behave exactly like local-only mode.
let cloudReady = !(sync.isCloudEnabled() && sync.getStoredSyncCode());
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
        // Don't leave the app stuck waiting on a cloud that isn't answering —
        // fall back to whatever's already cached on this device.
        cloudReady = true;
        renderAll();
        maybeAutoPick();
      }
    );
  } catch (e) {
    console.error('Failed to start sync', e);
    setSyncStatus('error', 'Could not connect');
    cloudReady = true;
    renderAll();
    maybeAutoPick();
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
  currentArtist: document.getElementById('current-artist'),
  currentUrl: document.getElementById('current-url'),
  copyBtn: document.getElementById('copy-btn'),
  nextBtn: document.getElementById('next-btn'),
  copiedToast: document.getElementById('copied-toast'),
  openExternal: document.getElementById('open-external'),
  previewFrame: document.getElementById('preview-frame'),
  previewImage: document.getElementById('preview-image'),
  addForm: document.getElementById('add-form'),
  addSubmitBtn: document.getElementById('add-submit-btn'),
  editBanner: document.getElementById('edit-banner'),
  editBannerText: document.getElementById('edit-banner-text'),
  cancelEditBtn: document.getElementById('cancel-edit-btn'),
  urlInput: document.getElementById('url-input'),
  titleInput: document.getElementById('title-input'),
  artistInput: document.getElementById('artist-input'),
  artistDatalist: document.getElementById('artist-datalist'),
  filterSearch: document.getElementById('filter-search'),
  filterArtist: document.getElementById('filter-artist'),
  filterStatus: document.getElementById('filter-status'),
  countLabel: document.getElementById('count-label'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  linkTableBody: document.getElementById('link-table-body'),
  noResultsHint: document.getElementById('no-results-hint'),
  pagination: document.getElementById('pagination'),
  pageInfo: document.getElementById('page-info'),
  pagePrevBtn: document.getElementById('page-prev-btn'),
  pageNextBtn: document.getElementById('page-next-btn'),
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

  // Links exist but nothing is picked yet (e.g. state just arrived from a cloud
  // sync that never had a "current" link on this device) — pick one now instead
  // of leaving the screen stuck on nothing.
  if (!findLink(state.currentId)) {
    pickNextLink();
  }
  const link = findLink(state.currentId);
  if (!link) return;

  const shownCount = state.links.length - state.queue.length;
  els.progressLabel.textContent = `${shownCount} of ${state.links.length} shown`;
  els.resetCycleBtn.classList.toggle('hidden', state.links.length < 2);

  els.currentTitle.textContent = displayName(link);
  els.currentArtist.textContent = link.artist || '';
  els.currentArtist.classList.toggle('hidden', !link.artist);
  els.currentUrl.textContent = link.url;
  els.openExternal.href = link.url;
  loadPreview(link);
}

// Keyed by URL, not link id — a link can be edited to point somewhere new
// without its id changing, and the preview needs to follow the URL.
let lastPreviewUrl = null;
let previewRequestId = 0;

// Sites like OpenSea block being shown inside an <iframe> (X-Frame-Options), so
// try fetching the page's own preview image (og:image) through our serverless
// proxy first — the same trick Slack/Twitter "link unfurling" uses — and only
// fall back to an iframe if that comes back empty.
function loadPreview(link) {
  if (lastPreviewUrl === link.url) return;
  lastPreviewUrl = link.url;
  const requestId = ++previewRequestId;

  els.previewImage.classList.add('hidden');
  els.previewImage.removeAttribute('src');
  els.previewFrame.classList.add('hidden');
  els.previewFrame.src = 'about:blank';

  const showIframe = () => {
    if (requestId !== previewRequestId) return;
    els.previewFrame.src = link.url;
    els.previewFrame.classList.remove('hidden');
  };

  fetch('/api/preview?url=' + encodeURIComponent(link.url))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (requestId !== previewRequestId) return; // a newer link was picked meanwhile
      if (data && data.image) {
        els.previewImage.onerror = showIframe;
        els.previewImage.src = data.image;
        els.previewImage.classList.remove('hidden');
      } else {
        showIframe();
      }
    })
    .catch(showIframe);
}

// Shared with loadPreview's underlying data: url -> image URL, or null if none.
// Keeps the Manage table from re-fetching every thumbnail on every re-render
// (e.g. each time a filter changes).
const thumbnailCache = new Map();

// Only fetch a thumbnail once its row actually scrolls near the viewport —
// with up to 10 rows per page, there's no reason to fire off every fetch
// (including possibly-slow screenshot renders) the instant the page renders.
let thumbObserver = null;
function observeThumbnail(link, imgEl) {
  if (thumbnailCache.has(link.url)) {
    loadThumbnail(link, imgEl); // already fetched earlier — show it instantly, no need to wait
    return;
  }
  if (!thumbObserver) {
    thumbObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          thumbObserver.unobserve(entry.target);
          loadThumbnail(entry.target._link, entry.target);
        });
      },
      { rootMargin: '200px' } // start loading a bit before it's actually visible
    );
  }
  imgEl._link = link;
  thumbObserver.observe(imgEl);
}

function loadThumbnail(link, imgEl) {
  if (thumbnailCache.has(link.url)) {
    const cached = thumbnailCache.get(link.url);
    if (cached) imgEl.src = cached;
    else imgEl.classList.add('thumb-empty');
    return;
  }
  // &thumbnail=1: for pages with no og:image (e.g. a raw generative-art file
  // that's just a script), ask the server to fall back to a rendered
  // screenshot instead — worth the extra wait here since this only loads
  // once per link and gets cached, unlike the Link tab's live preview.
  fetch('/api/preview?thumbnail=1&url=' + encodeURIComponent(link.url))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const image = (data && data.image) || null;
      thumbnailCache.set(link.url, image);
      if (image) imgEl.src = image;
      else imgEl.classList.add('thumb-empty');
    })
    .catch(() => {
      thumbnailCache.set(link.url, null);
      imgEl.classList.add('thumb-empty');
    });
}

function uniqueArtists() {
  const set = new Set(state.links.map((l) => (l.artist || '').trim()).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function refreshArtistOptions() {
  const artists = uniqueArtists();

  // The "add link" autocomplete list — every artist you've used before.
  els.artistDatalist.innerHTML = artists.map((a) => `<option value="${escapeHtml(a)}"></option>`).join('');

  // The filter dropdown — keep whatever the user has selected, even if it
  // briefly doesn't match any current link (e.g. while they're deleting).
  const previousValue = els.filterArtist.value;
  els.filterArtist.innerHTML =
    '<option value="">All artists</option>' + artists.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  if (artists.includes(previousValue)) els.filterArtist.value = previousValue;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function matchesFilters(link) {
  const status = els.filterStatus.value;
  if (status === 'shown' && !link.everShown) return false;
  if (status === 'new' && link.everShown) return false;

  const artist = els.filterArtist.value;
  if (artist && (link.artist || '') !== artist) return false;

  const search = els.filterSearch.value.trim().toLowerCase();
  if (search) {
    const haystack = `${link.title} ${link.artist} ${link.url}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

const PAGE_SIZE = 10;
let managePage = 0;
let editingLinkId = null;

function renderManageList() {
  refreshArtistOptions();

  els.clearAllBtn.classList.toggle('hidden', state.links.length === 0);

  const visible = state.links.filter(matchesFilters);

  els.countLabel.textContent = state.links.length === 0
    ? 'No links saved yet'
    : visible.length === state.links.length
      ? `${state.links.length} link${state.links.length === 1 ? '' : 's'} saved`
      : `Showing ${visible.length} of ${state.links.length} links`;

  els.noResultsHint.classList.toggle('hidden', !(state.links.length > 0 && visible.length === 0));

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  managePage = Math.min(Math.max(managePage, 0), totalPages - 1);
  const pageItems = visible.slice(managePage * PAGE_SIZE, managePage * PAGE_SIZE + PAGE_SIZE);

  els.pagination.classList.toggle('hidden', totalPages <= 1);
  els.pageInfo.textContent = `Page ${managePage + 1} of ${totalPages}`;
  els.pagePrevBtn.disabled = managePage === 0;
  els.pageNextBtn.disabled = managePage >= totalPages - 1;

  els.linkTableBody.innerHTML = '';
  pageItems.forEach((link) => {
    const tr = document.createElement('tr');

    const thumbTd = document.createElement('td');
    thumbTd.className = 'col-thumb';
    const thumbImg = document.createElement('img');
    thumbImg.className = 'thumb';
    thumbImg.alt = '';
    thumbImg.loading = 'lazy';
    thumbTd.appendChild(thumbImg);
    observeThumbnail(link, thumbImg);

    const titleTd = document.createElement('td');
    titleTd.className = 'col-title';
    titleTd.textContent = link.title || '—';
    titleTd.title = link.title || '';

    const artistTd = document.createElement('td');
    artistTd.className = 'col-artist';
    artistTd.textContent = link.artist || '—';
    artistTd.title = link.artist || '';

    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge ' + (link.everShown ? 'shown' : 'new');
    badge.textContent = link.everShown ? 'Shown' : 'New';
    statusTd.appendChild(badge);

    const linkTd = document.createElement('td');
    linkTd.className = 'col-link';
    const a = document.createElement('a');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Open ↗';
    a.title = link.url;
    linkTd.appendChild(a);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'col-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = '✎';
    editBtn.setAttribute('aria-label', 'Edit link');
    editBtn.addEventListener('click', () => startEditingLink(link));
    actionsTd.appendChild(editBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', 'Delete link');
    removeBtn.addEventListener('click', () => {
      if (editingLinkId === link.id) exitEditMode();
      removeLink(link.id);
      renderAll();
    });
    actionsTd.appendChild(removeBtn);

    tr.append(thumbTd, titleTd, artistTd, statusTd, linkTd, actionsTd);
    els.linkTableBody.appendChild(tr);
  });
}

function renderAll() {
  renderRotator();
  renderManageList();
}

function startEditingLink(link) {
  editingLinkId = link.id;
  els.urlInput.value = link.url;
  els.titleInput.value = link.title;
  els.artistInput.value = link.artist;
  els.editBannerText.textContent = `Editing "${displayName(link)}"`;
  els.editBanner.classList.remove('hidden');
  els.addSubmitBtn.textContent = 'Save changes';
  switchView('manage');
  els.addForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  els.urlInput.focus();
}

function exitEditMode() {
  editingLinkId = null;
  els.editBanner.classList.add('hidden');
  els.addSubmitBtn.textContent = 'Add link';
}

els.cancelEditBtn.addEventListener('click', () => {
  exitEditMode();
  els.urlInput.value = '';
  els.titleInput.value = '';
  els.artistInput.value = '';
});

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

  if (editingLinkId) {
    const link = findLink(editingLinkId);
    if (link) {
      link.url = url;
      link.title = els.titleInput.value.trim();
      link.artist = els.artistInput.value.trim();
      saveState();
    }
    exitEditMode();
  } else {
    const wasEmpty = state.links.length === 0;
    addLink(url, els.titleInput.value, els.artistInput.value);
    if (wasEmpty) pickNextLink();
  }

  els.urlInput.value = '';
  els.titleInput.value = '';
  els.artistInput.value = '';
  renderAll();
});

[els.filterSearch, els.filterArtist, els.filterStatus].forEach((el) => {
  const handler = () => {
    managePage = 0;
    renderManageList();
  };
  el.addEventListener('input', handler);
  el.addEventListener('change', handler);
});

els.pagePrevBtn.addEventListener('click', () => {
  managePage -= 1;
  renderManageList();
});

els.pageNextBtn.addEventListener('click', () => {
  managePage += 1;
  renderManageList();
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
