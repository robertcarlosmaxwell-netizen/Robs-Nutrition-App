'use strict';

/* ---------- Storage ----------
   Every key carries a version suffix. A schema change needs a read-both-shapes
   fallback, never a silent reinterpretation of old data. */
const KEYS = {
  config: 'nt_config_v1',
  settings: 'nt_settings_v1',
};

// Safari caps localStorage at roughly 5 MB per origin. The meter counts
// characters of the nt_* keys; WebKit's exact accounting is not documented, so
// treat the figure as an estimate and act well before it reaches the cap.
const STORAGE_CAP_MB = 5;
const STORAGE_WARN_MB = 2;

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Failed to load ' + key, e);
    return fallback;
  }
}

/* Writes only when the serialised form actually changed, so persisting on
   every state change (and again on hide) costs nothing when nothing moved.
   A failed write is never swallowed: it returns false and puts up the
   storage-full alert, and the caller leaves the unsaved state on screen. */
const lastWritten = new Map();
function saveJson(key, value) {
  const json = JSON.stringify(value);
  if (lastWritten.get(key) === json) return true;
  try {
    localStorage.setItem(key, json);
    lastWritten.set(key, json);
    renderStorage();
    return true;
  } catch (e) {
    console.error('Failed to save ' + key, e);
    showStorageFull(e);
    return false;
  }
}

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
}

function showStorageFull(e) {
  const el = document.getElementById('storageAlert');
  el.textContent = isQuotaError(e)
    ? 'Storage full, entry not saved. Export a backup.'
    : 'Could not save to this device: ' + ((e && e.message) || 'unknown error') + '. Export a backup.';
  el.hidden = false;
}

function storageChars() {
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('nt_')) n += k.length + (localStorage.getItem(k) || '').length;
  }
  return n;
}

function renderStorage() {
  const line = document.getElementById('storageLine');
  const meter = document.getElementById('storageMeter');
  if (!line || !meter) return;
  const mb = storageChars() / 1e6;
  const shown = mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1);
  line.textContent = `${shown} MB of ~${STORAGE_CAP_MB} MB used`;
  meter.firstElementChild.style.width = Math.min(100, (mb / STORAGE_CAP_MB) * 100) + '%';
  meter.classList.toggle('warn', mb >= STORAGE_WARN_MB);
  renderIsolation();
}

/* Both apps are served from the same github.io origin. iOS is believed to give
   each home-screen app its own storage; this line checks it on the real phone.
   The Workout App's keys all start with wt_. */
function renderIsolation() {
  const el = document.getElementById('isolationLine');
  if (!el) return;
  let others = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('wt_')) others++;
  }
  el.textContent = others
    ? `Workout App data is visible here (${others} keys): the two apps share storage and the ~5 MB cap.`
    : 'No Workout App data visible here: storage is separate (or the Workout App has never run in this container).';
}

/* ---------- Config ----------
   The proxy URL plus token is a capability, so it is entered on the device and
   kept in localStorage, never in the public repo. */
function loadConfig() {
  const c = loadJson(KEYS.config, {}) || {};
  return {
    url: c.url || '',
    token: c.token || '',
    lastSyncedAt: c.lastSyncedAt || null,
    lastError: c.lastError || null,
    lastPing: c.lastPing || null,
  };
}

function isProxyUrl(url) {
  return /^https:\/\/script\.google\.com\//.test(url);
}

/* ---------- Dates ----------
   Keys are yyyy-mm-dd in the phone's LOCAL calendar. A Date becomes a key
   through its local parts, never toISOString() (UTC, so wrong near midnight).
   Day arithmetic happens on keys in UTC, where there is no DST. */
function localDateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDaysKey(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return localDateKey(new Date());
}

function fmtLongDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ---------- State ---------- */
let config = loadConfig();
let viewDate = todayStr();
let currentView = 'today';

// Seed lastWritten from what's already stored so the first persist is a no-op.
Object.values(KEYS).forEach(k => {
  const raw = localStorage.getItem(k);
  if (raw != null) lastWritten.set(k, raw);
});

function persistAll() {
  saveJson(KEYS.config, config);
}

/* ---------- Tab navigation ---------- */
const views = {
  today: document.getElementById('view-today'),
  add: document.getElementById('view-add'),
  foods: document.getElementById('view-foods'),
  trends: document.getElementById('view-trends'),
  settings: document.getElementById('view-settings'),
};
const tabBtns = document.querySelectorAll('.tab-btn');
const headerTitle = document.getElementById('headerTitle');
const headerSubtitle = document.getElementById('headerSubtitle');

const titles = {
  today: 'Today',
  add: 'Add food',
  foods: 'Foods',
  trends: 'Trends',
  settings: 'Settings',
};

function renderHeader() {
  headerTitle.textContent = titles[currentView];
  headerSubtitle.textContent = currentView === 'today' ? fmtLongDate(viewDate) : '';
}

function setView(name) {
  currentView = name;
  Object.entries(views).forEach(([k, el]) => el.classList.toggle('active', k === name));
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  renderHeader();
  if (name === 'settings') { renderSyncStatus(); renderStorage(); }
}

tabBtns.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

/* ---------- Toast ---------- */
let toastTimer;
function showToast(msg, { error = false } = {}) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 3200 : 1800);
}

/* ---------- Proxy ----------
   POST as text/plain: a CORS "simple request" with no preflight, which Apps
   Script cannot answer. Every call has a timeout, and errors say what failed. */
let PING_TIMEOUT_MS = 15 * 1000;   // `let` so the tests can shorten it

async function callProxy(action, params, timeoutMs) {
  if (!config.url) throw new Error('no proxy URL set');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: config.token, action }, params || {})),
        redirect: 'follow',
        signal: abort.signal,
      });
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 20)) {
        throw new Error(`no response after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw new Error('network error' + (err && err.message ? ': ' + err.message : ''));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let body;
    try { body = JSON.parse(await res.text()); }
    catch (e) { throw new Error('proxy returned something other than JSON (is access set to Anyone?)'); }
    if (!body || body.ok !== true) throw new Error((body && body.error) || 'proxy refused the request');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const syncUrlInput = document.getElementById('syncUrlInput');
const syncTokenInput = document.getElementById('syncTokenInput');
const syncStatusEl = document.getElementById('syncStatus');
let pingInFlight = false;

function describePing(p) {
  if (!p.sheet || !p.sheet.ok) {
    return { ok: false, text: `Proxy reached, but the sheet is not: ${(p.sheet && p.sheet.error) || 'no sheet info'}.` };
  }
  if (!p.timeZoneOk) {
    return {
      ok: false,
      text: `Proxy and sheet reached, but time zones are wrong: script ${p.scriptTimeZone}, sheet ${p.sheet.timeZone}. Both must be ${p.expectedTimeZone}.`,
    };
  }
  return { ok: true, text: `Connected. Sheet reachable; time zones match (${p.scriptTimeZone}).` };
}

function renderSyncStatus() {
  const set = (cls, text) => {
    syncStatusEl.className = 'sync-status' + (cls ? ' ' + cls : '');
    syncStatusEl.textContent = text;
  };
  if (pingInFlight) return set('', 'Testing connection…');
  if (!config.url) return set('', 'Not set up. Paste the nutrition-proxy URL and shared secret, then Save.');
  if (config.lastError) return set('err', `Failed: ${config.lastError}`);
  if (config.lastPing) {
    const d = describePing(config.lastPing);
    return set(d.ok ? 'ok' : 'err', d.text);
  }
  set('', 'Saved. Not tested yet.');
}

async function pingProxy() {
  if (!config.url) { showToast('Add the proxy URL first', { error: true }); return false; }
  if (pingInFlight) return false;
  pingInFlight = true;
  renderSyncStatus();
  try {
    const body = await callProxy('ping', null, PING_TIMEOUT_MS);
    config.lastPing = {
      at: new Date().toISOString(),
      service: body.service,
      scriptTimeZone: body.scriptTimeZone,
      expectedTimeZone: body.expectedTimeZone,
      timeZoneOk: !!body.timeZoneOk,
      sheet: body.sheet || null,
    };
    config.lastError = null;
    const d = describePing(config.lastPing);
    showToast(d.ok ? 'Connected' : 'Connected, with a problem', { error: !d.ok });
    return d.ok;
  } catch (err) {
    config.lastError = err.message;
    config.lastPing = null;
    showToast(`Failed: ${err.message}`, { error: true });
    return false;
  } finally {
    pingInFlight = false;
    persistAll();
    renderSyncStatus();
  }
}

document.getElementById('syncSaveBtn').addEventListener('click', () => {
  const url = syncUrlInput.value.trim();
  if (url && !isProxyUrl(url)) {
    showToast('That should be a https://script.google.com/... URL', { error: true });
    return;
  }
  config.url = url;
  config.token = syncTokenInput.value.trim();
  config.lastError = null;
  config.lastPing = null;
  if (!saveJson(KEYS.config, config)) return;
  renderSyncStatus();
  showToast(url ? 'Saved' : 'Sync turned off');
});

document.getElementById('pingBtn').addEventListener('click', () => pingProxy());

/* ---------- Lifecycle ----------
   iOS resumes a frozen home-screen app instead of re-running app.js, so a day
   that rolled over while it slept would still show yesterday. */
let followToday = true;   // false once Rob picks another date (M1)

window.addEventListener('pageshow', () => {
  if (followToday && viewDate !== todayStr()) {
    viewDate = todayStr();
    renderHeader();
  }
});

// Backgrounding is when iOS is most likely to kill the page; pagehide covers
// navigation and teardown. Both are deduped, so they only write real changes.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistAll();
});
window.addEventListener('pagehide', persistAll);

/* ---------- Updates ----------
   A new service worker reloads the page straight away, except while an entry
   or review screen is open: then it waits behind a banner so edits survive. */
let swUpdatePending = false;
let swReloading = false;
// M1+ screens that hold unsaved input register here (by name) while open.
const openEditors = new Set();

function isEditing() {
  return openEditors.size > 0;
}

// Indirected so the update flow can be tested without a real navigation.
function reloadApp() {
  window.location.reload();
}

function applyPendingUpdate() {
  if (swReloading) return;
  swReloading = true;
  showToast('Updating…');
  setTimeout(() => reloadApp(), 250);
}

function showUpdateBanner() {
  if (document.getElementById('updateBanner')) return;
  const bar = document.createElement('button');
  bar.id = 'updateBanner';
  bar.className = 'update-banner';
  bar.dataset.role = 'update-banner';
  bar.textContent = 'Update ready. Tap to refresh.';
  bar.addEventListener('click', applyPendingUpdate);
  document.body.appendChild(bar);
}

// Called when an editor closes, so a deferred update lands at a safe moment.
function applyUpdateIfDeferred() {
  if (swUpdatePending && !isEditing()) applyPendingUpdate();
}

if ('serviceWorker' in navigator) {
  // On a genuine first install there's no controller and controllerchange fires
  // immediately; reloading then would be pointless.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (isEditing()) {
      swUpdatePending = true;
      showUpdateBanner();
      return;
    }
    applyPendingUpdate();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((reg) => {
        // iOS resumes a frozen page rather than reloading it, so ask on every foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

/* ---------- Boot ---------- */
syncUrlInput.value = config.url;
syncTokenInput.value = config.token;
renderHeader();
renderSyncStatus();
renderStorage();
