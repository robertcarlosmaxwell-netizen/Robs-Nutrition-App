'use strict';

/* ======================================================================
   Storage
   Every key carries a version suffix. A schema change needs a
   read-both-shapes fallback, never a silent reinterpretation of old data.
   ====================================================================== */
const KEYS = {
  config: 'nt_config_v1',
  settings: 'nt_settings_v1',
  entries: 'nt_entries_v1',
  customFoods: 'nt_customfoods_v1',
  recipes: 'nt_recipes_v1',
  recents: 'nt_recents_v1',
  foodCache: 'nt_foodcache_v1',
  dayState: 'nt_daystate_v1',
  draft: 'nt_draft_v1',
  zeroed: 'nt_zeroed_v1',
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
    if (isQuotaError(e) && key !== KEYS.foodCache && pruneFoodCache({ aggressive: true })) {
      // The food cache is disposable: free it and try once more, so cached
      // foods can never crowd out entries.
      try {
        localStorage.setItem(key, json);
        lastWritten.set(key, json);
        renderStorage();
        return true;
      } catch (e2) { e = e2; }
    }
    showStorageFull(e);
    return false;
  }
}

function removeKey(key) {
  try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ }
  lastWritten.delete(key);
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

/* Both apps are served from the same github.io origin. Verified 2026-10-11
   that iOS gives each home-screen app its own storage; this line keeps
   checking. The Workout App's keys all start with wt_. */
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

/* ======================================================================
   Small helpers
   ====================================================================== */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + '-' + Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function round(n, d = 0) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/* Parses a typed number. Blank means unknown (null), never zero. */
function parseNum(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return null;
  // "1/2" and "1 1/2" for servings
  const frac = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (frac) {
    const whole = frac[1] ? Number(frac[1]) : 0;
    const den = Number(frac[3]);
    return den ? whole + Number(frac[2]) / den : null;
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function fmtQty(n) {
  if (n == null) return '';
  return String(round(n, 2));
}

/* "50 g", "1 CONTAINER (150 g)", "1.5 × 4 oz (113 g)". */
function fmtServing(qty, label) {
  if (label === 'g' || label === 'ml') return `${fmtQty(qty)} ${label}`;
  return qty === 1 ? label : `${fmtQty(qty)} × ${label}`;
}

function fmtKcal(n) {
  return n == null ? '—' : Math.round(n).toLocaleString('en-US');
}

function fmtG(n) {
  if (n == null) return '—';
  return n < 10 ? String(round(n, 1)) : String(Math.round(n));
}

/* ======================================================================
   Dates
   Keys are yyyy-mm-dd in the phone's LOCAL calendar. A Date becomes a key
   through its local parts, never toISOString() (UTC, so wrong near
   midnight). Day arithmetic happens on keys in UTC, where there is no DST.
   ====================================================================== */
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

function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function fmtLongDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtShortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isValidDateKey(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/* ======================================================================
   Nutrients
   N = {kcal, protein, carbs, fat, satFat, fiber}. Each a number or null.
   A missing nutrient is null, never 0 (the blank-is-not-zero rule).
   ====================================================================== */
const NUTS = ['kcal', 'protein', 'carbs', 'fat', 'satFat', 'fiber'];
const NUT_LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', satFat: 'Sat fat', fiber: 'Fiber' };

function emptyN() {
  const o = {};
  NUTS.forEach(k => { o[k] = null; });
  return o;
}

function cleanN(n) {
  const o = {};
  NUTS.forEach(k => {
    const v = n ? n[k] : null;
    o[k] = v == null || !isFinite(Number(v)) ? null : Number(v);
  });
  return o;
}

function scaleN(n, f) {
  const o = {};
  NUTS.forEach(k => { o[k] = n == null || n[k] == null ? null : round(n[k] * f, 3); });
  return o;
}

function nullsIn(n) {
  return NUTS.filter(k => !n || n[k] == null);
}

/* Day-style totals: each nutrient sums its non-null values, and
   `incomplete` counts the items left out of at least one total. */
function sumDayStyle(list) {
  const totals = {};
  NUTS.forEach(k => { totals[k] = 0; });
  let incomplete = 0;
  list.forEach(item => {
    const n = item.nutrients;
    let missing = false;
    NUTS.forEach(k => {
      if (n && n[k] != null) totals[k] += n[k];
      else missing = true;
    });
    if (missing) incomplete++;
  });
  NUTS.forEach(k => { totals[k] = round(totals[k], 3); });
  return { totals, incomplete };
}

/* Recipe-style totals: a nutrient any line lacks is null for the whole
   recipe. A recipe is a single food once saved, and a partial sum would
   pass for a complete number on every day it is logged. */
function sumStrict(list) {
  const totals = {};
  NUTS.forEach(k => { totals[k] = 0; });
  list.forEach(item => {
    NUTS.forEach(k => {
      const v = item.nutrients ? item.nutrients[k] : null;
      totals[k] = totals[k] == null || v == null ? null : totals[k] + v;
    });
  });
  NUTS.forEach(k => { if (totals[k] != null) totals[k] = round(totals[k], 3); });
  return totals;
}

/* ======================================================================
   Settings and targets
   ====================================================================== */
const MODES = ['lose', 'maintain', 'gain'];
const MODE_LABEL = { lose: 'Lose', maintain: 'Maintain', gain: 'Gain' };
const TARGET_KEYS = ['kcal', 'protein', 'fat', 'fiber', 'satFat'];

function defaultSettings() {
  // Seeded 2026-10-10 from Rob (spec section 9). Maintain copies Lose so a
  // switch never lands on an empty screen; Gain ships blank on purpose.
  const lose = { kcal: 2070, protein: 129, fat: 69, fiber: 38, satFat: null };
  return {
    mode: 'lose',
    targets: {
      lose: Object.assign({}, lose),
      maintain: Object.assign({}, lose),
      gain: { kcal: null, protein: null, fat: null, fiber: null, satFat: null },
    },
    maintainBandPct: 10,
    goalWeight: 170,
    goalDate: '2027-01-01',
    maxLossRate: 2.0,
    calorieFloor: null,
    underLogKcal: 1200,
    installedOn: null,
    updatedAt: null,
  };
}

function loadSettings() {
  const def = defaultSettings();
  const s = loadJson(KEYS.settings, null);
  if (!s || typeof s !== 'object') return def;
  const out = Object.assign({}, def, s);
  out.targets = {};
  MODES.forEach(m => {
    out.targets[m] = Object.assign({}, def.targets[m], (s.targets && s.targets[m]) || {});
  });
  if (!MODES.includes(out.mode)) out.mode = 'lose';
  return out;
}

/* ======================================================================
   Config (proxy URL + token)
   The proxy URL plus token is a capability, so it is entered on the device
   and kept in localStorage, never in the public repo.
   ====================================================================== */
function loadConfig() {
  const c = loadJson(KEYS.config, {}) || {};
  return {
    url: c.url || '',
    token: c.token || '',
    lastSyncedAt: c.lastSyncedAt || null,
    lastError: c.lastError || null,
    lastPing: c.lastPing || null,
    needsFullSync: !!c.needsFullSync,
    fdcKey: c.fdcKey || '',
  };
}

function isProxyUrl(url) {
  return /^https:\/\/script\.google\.com\//.test(url);
}

/* ======================================================================
   State
   ====================================================================== */
let config = loadConfig();
let settings = loadSettings();
let entries = loadJson(KEYS.entries, []) || [];
let customFoods = loadJson(KEYS.customFoods, []) || [];
let recipes = loadJson(KEYS.recipes, []) || [];
let recents = loadJson(KEYS.recents, []) || [];
let foodCache = loadJson(KEYS.foodCache, {}) || {};
let dayState = loadJson(KEYS.dayState, {}) || {};
// Rob's per-food choices about blank nutrients: {foodId: {fiber: true|false}}.
// true = count a blank as 0; false = keep it unknown even where the meat rule
// would fill it.
let zeroed = loadJson(KEYS.zeroed, {}) || {};
let viewDate = todayStr();
let followToday = true;   // false once Rob picks another date
let currentView = 'today';
let preferredMeal = null;   // set by tapping an empty meal on Today; used by the Add tab

// Seed lastWritten from what's already stored so the first persist is a no-op.
// A key that was never stored reads back as its default, so the default
// counts as already written; nothing is written until something changes.
Object.values(KEYS).forEach(k => {
  const raw = localStorage.getItem(k);
  if (raw != null) lastWritten.set(k, raw);
});
[[KEYS.config, config], [KEYS.entries, entries], [KEYS.customFoods, customFoods], [KEYS.recipes, recipes],
  [KEYS.recents, recents], [KEYS.foodCache, foodCache], [KEYS.dayState, dayState], [KEYS.zeroed, zeroed]].forEach(([k, v]) => {
  if (!lastWritten.has(k)) lastWritten.set(k, JSON.stringify(v));
});

if (!settings.installedOn) {
  settings.installedOn = todayStr();
  saveJson(KEYS.settings, settings);
}

/* Saves `next` under `key` and only then adopts it, so a failed write leaves
   both memory and screen exactly as they were. Returns true on success. */
function commit(key, next, adopt) {
  if (!saveJson(key, next)) return false;
  adopt(next);
  return true;
}
const commitEntries = (next) => commit(KEYS.entries, next, v => { entries = v; });
const commitDayState = (next) => commit(KEYS.dayState, next, v => { dayState = v; });
const commitSettings = (next) => commit(KEYS.settings, next, v => { settings = v; });
const commitCustomFoods = (next) => commit(KEYS.customFoods, next, v => { customFoods = v; });
const commitRecipes = (next) => commit(KEYS.recipes, next, v => { recipes = v; });
const commitRecents = (next) => commit(KEYS.recents, next, v => { recents = v; });
const commitZeroed = (next) => commit(KEYS.zeroed, next, v => { zeroed = v; });

function persistAll() {
  saveJson(KEYS.config, config);
  saveJson(KEYS.settings, settings);
  saveJson(KEYS.entries, entries);
  saveJson(KEYS.customFoods, customFoods);
  saveJson(KEYS.recipes, recipes);
  saveJson(KEYS.recents, recents);
  saveJson(KEYS.dayState, dayState);
}

/* ======================================================================
   Day state: complete flag, and the mode and calorie setting in effect.
   A day is stamped with the mode when it is first edited and keeps it, so
   switching mode never reinterprets a past day.
   ====================================================================== */
function modeFor(date) {
  const ds = dayState[date];
  return ds && ds.mode ? ds.mode : settings.mode;
}

function calorieFor(date) {
  const ds = dayState[date];
  if (ds && ds.mode) return ds.calorieSetting == null ? null : ds.calorieSetting;
  return settings.targets[settings.mode].kcal;
}

function stampedDayState(date, changes, base = dayState) {
  const prev = base[date] || {};
  const ds = Object.assign({ complete: false }, prev, changes || {});
  if (!ds.mode) {
    ds.mode = settings.mode;
    ds.calorieSetting = settings.targets[settings.mode].kcal;
  }
  ds.updatedAt = nowIso();
  if (!('syncedAt' in ds)) ds.syncedAt = null;
  return Object.assign({}, base, { [date]: ds });
}

function isComplete(date) {
  return !!(dayState[date] && dayState[date].complete);
}

function setComplete(date, complete) {
  if (!commitDayState(stampedDayState(date, { complete }))) return false;
  renderToday();
  return true;
}

/* ======================================================================
   Foods
   Food (normalized): {id, source, sourceId, name, brand, upc, baseUnit,
   per100g, servings:[{label, grams, per}], defaultServing, incomplete}
   ====================================================================== */
function foodFromCustom(c) {
  const per = cleanN(c.per);
  const grams = c.servingGrams != null && c.servingGrams > 0 ? c.servingGrams : null;
  return {
    id: 'custom:' + c.id,
    source: 'custom',
    sourceId: c.id,
    name: c.name,
    brand: c.brand || '',
    upc: c.upc || '',
    baseUnit: grams ? 'g' : null,
    per100g: grams ? scaleN(per, 100 / grams) : null,
    servings: [{ label: c.servingLabel || 'serving', grams, per }],
    defaultServing: 0,
    incomplete: nullsIn(per),
  };
}

function foodFromRecipe(r) {
  return {
    id: 'recipe:' + r.id,
    source: 'recipe',
    sourceId: r.id,
    name: r.name,
    brand: '',
    upc: '',
    baseUnit: null,
    per100g: null,
    servings: [{ label: 'serving', grams: null, per: cleanN(r.perServing) }],
    defaultServing: 0,
    incomplete: nullsIn(r.perServing),
  };
}

/* Every way a food can be measured: its own servings, plus grams (or ml)
   whenever there is a per-100 basis. Grams are always offered when known. */
/* Blank-is-not-zero, with two deliberate exceptions (Rob, 2026-10-11):
   - the meat rule: plain USDA meat, poultry and fish (generic entries, not
     branded, not breaded or sauced) have no fiber, so a BLANK fiber counts
     as 0. A listed value is never overridden, and only fiber is filled;
   - Rob's own choice per food: "count this as 0", or "keep it unknown".
   Either way the zero is recorded on the entry (`zeroed`), never silent. */
const MEAT_CATEGORIES = ['Poultry Products', 'Beef Products', 'Pork Products', 'Finfish and Shellfish Products', 'Lamb, Veal, and Game Products'];
const NOT_PLAIN_MEAT = /bread|batter|coated|flour|stuffed|sauce|glaze|gravy|nugget|meatball|sausage|marinade|with /i;

function meatRuleApplies(food) {
  return !!food && food.source === 'fdc'
    && (food.dataType === 'Foundation' || food.dataType === 'SR Legacy')
    && MEAT_CATEGORIES.includes(food.category)
    && !NOT_PLAIN_MEAT.test(food.name || '');
}

/* Nutrients to count as 0 when blank for this food (a Food, or just an id
   for an entry whose food is gone), and why: {fiber: 'meat'|'choice'}. */
function zeroedFor(foodOrId) {
  const id = typeof foodOrId === 'string' ? foodOrId : foodOrId && foodOrId.id;
  const own = (id && zeroed[id]) || {};
  const out = {};
  if (typeof foodOrId === 'object' && meatRuleApplies(foodOrId) && own.fiber !== false) out.fiber = 'meat';
  Object.keys(own).forEach(k => { if (own[k] === true && NUTS.includes(k)) out[k] = 'choice'; });
  return out;
}

function setZeroed(foodId, nutrient, on) {
  const next = Object.assign({}, zeroed, { [foodId]: Object.assign({}, zeroed[foodId] || {}, { [nutrient]: !!on }) });
  return commitZeroed(next);
}

/* Fills the zeroed blanks and reports which ones it filled, with the reason. */
function applyZeroed(per, foodOrId) {
  const z = zeroedFor(foodOrId);
  const keys = Object.keys(z);
  if (!per || !keys.length) return { per, filled: [], why: {} };
  const out = Object.assign({}, per);
  const filled = [];
  const why = {};
  keys.forEach(k => { if (out[k] == null) { out[k] = 0; filled.push(k); why[k] = z[k]; } });
  return { per: out, filled, why };
}

function servingOptions(food) {
  const opts = (food.servings || []).map(s => ({ label: s.label, grams: s.grams == null ? null : s.grams, per: s.per ? cleanN(s.per) : null }))
    .filter(s => s.per || (s.grams != null && food.per100g));
  opts.forEach(s => {
    if (!s.per && s.grams != null && food.per100g) s.per = scaleN(food.per100g, s.grams / 100);
  });
  if (food.per100g && food.baseUnit) {
    opts.push({ label: food.baseUnit, grams: food.baseUnit === 'g' ? 1 : null, per: scaleN(food.per100g, 0.01), unit: true });
  }
  opts.forEach(s => {
    const z = applyZeroed(s.per, food);
    s.per = z.per;
    s.zeroed = z.filled;
    s.zeroedWhy = z.why;
  });
  return opts;
}

function resolveFood(foodId) {
  if (!foodId) return null;
  if (foodId.startsWith('custom:')) {
    const c = customFoods.find(x => 'custom:' + x.id === foodId);
    return c ? foodFromCustom(c) : null;
  }
  if (foodId.startsWith('recipe:')) {
    const r = recipes.find(x => 'recipe:' + x.id === foodId);
    return r ? foodFromRecipe(r) : null;
  }
  const hit = foodCache[foodId];
  return hit ? hit.food : null;
}

/* The food cache keeps FDC foods Rob has used, for offline logging. It is
   bounded (300 foods, 90 days unused) and never drops a food in recents. */
const FOOD_CACHE_MAX = 300;
const FOOD_CACHE_DAYS = 90;

function cacheFood(food) {
  if (!food || food.source !== 'fdc') return;
  foodCache = Object.assign({}, foodCache, { [food.id]: { food, lastUsed: todayStr() } });
  pruneFoodCache();
  saveJson(KEYS.foodCache, foodCache);
}

function pruneFoodCache({ aggressive = false } = {}) {
  const keep = new Set(recents.map(r => r.foodId));
  const cutoff = addDaysKey(todayStr(), -FOOD_CACHE_DAYS);
  let ids = Object.keys(foodCache);
  const before = ids.length;
  const next = {};
  ids.filter(id => keep.has(id) || (!aggressive && foodCache[id].lastUsed >= cutoff))
    .sort((a, b) => (foodCache[b].lastUsed || '').localeCompare(foodCache[a].lastUsed || ''))
    .forEach((id, i) => { if (keep.has(id) || i < FOOD_CACHE_MAX) next[id] = foodCache[id]; });
  const removed = before - Object.keys(next).length;
  if (removed > 0) {
    foodCache = next;
    try { localStorage.setItem(KEYS.foodCache, JSON.stringify(foodCache)); lastWritten.set(KEYS.foodCache, JSON.stringify(foodCache)); }
    catch (e) { /* caller handles the original failure */ }
  }
  return removed > 0;
}

/* ======================================================================
   Entries
   A logged entry stores a snapshot of its nutrients, so editing a food
   later never rewrites history. `basis` is one unit of the serving it was
   logged in, so changing the quantity rescales from it.
   ====================================================================== */
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

function defaultMeal() {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  if (m < 10 * 60 + 30) return 'breakfast';
  if (m < 14 * 60 + 30) return 'lunch';
  if (m < 17 * 60) return 'snack';
  if (m < 21 * 60) return 'dinner';
  return 'snack';
}

function liveEntries() {
  return entries.filter(e => !e.deletedAt);
}

function entriesFor(date) {
  return entries.filter(e => !e.deletedAt && e.date === date)
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function confidenceFor(food) {
  return food.source === 'quick' ? 'estimated' : 'exact';
}

function buildEntry({ food, serving, qty, meal, date, note }) {
  const t = nowIso();
  return {
    id: uid(),
    date,
    time: nowHHMM(),
    meal,
    foodId: food.id,
    name: food.name,
    brand: food.brand || '',
    qty,
    servingLabel: serving.label,
    grams: serving.grams == null ? null : round(serving.grams * qty, 1),
    basis: { label: serving.label, grams: serving.grams == null ? null : serving.grams, per: cleanN(serving.per) },
    nutrients: scaleN(serving.per, qty),
    zeroed: (serving.zeroed || []).slice(),
    source: food.source,
    confidence: confidenceFor(food),
    note: note || '',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    syncedAt: null,
  };
}

/* Adds entries and stamps their days in one go. */
function addEntries(list) {
  if (!list.length) return true;
  if (!commitEntries(entries.concat(list))) return false;
  let ds = dayState;
  [...new Set(list.map(e => e.date))].forEach(d => { ds = stampedDayState(d, null, ds); });
  commitDayState(ds);
  return true;
}

function updateEntry(id, changes) {
  const next = entries.map(e => (e.id === id ? Object.assign({}, e, changes, { updatedAt: nowIso(), syncedAt: e.syncedAt || null }) : e));
  if (!commitEntries(next)) return false;
  const e = next.find(x => x.id === id);
  if (e) commitDayState(stampedDayState(e.date));
  return true;
}

/* Deleting leaves a tombstone, kept permanently (spec section 5). */
function deleteEntry(id) {
  const t = nowIso();
  return updateEntry(id, { deletedAt: t });
}

/* ======================================================================
   Recents: last-used serving, quantity and meal per food, and the dates
   it was used in the last 30 days for frequency. Bounded at 200.
   ====================================================================== */
const RECENTS_MAX = 200;

function touchRecent(food, servingLabel, qty, meal) {
  const today = todayStr();
  const cutoff = addDaysKey(today, -30);
  const prev = recents.find(r => r.foodId === food.id);
  const uses = ((prev && prev.uses) || []).filter(d => d >= cutoff).concat(today).slice(-60);
  const rec = { foodId: food.id, name: food.name, brand: food.brand || '', servingLabel, qty, meal, lastUsed: nowIso(), uses };
  const next = [rec].concat(recents.filter(r => r.foodId !== food.id)).slice(0, RECENTS_MAX);
  commitRecents(next);
}

function rankedRecents() {
  const cutoff = addDaysKey(todayStr(), -30);
  return recents
    .map(r => ({ r, freq: (r.uses || []).filter(d => d >= cutoff).length }))
    .sort((a, b) => b.freq - a.freq || (b.r.lastUsed || '').localeCompare(a.r.lastUsed || ''))
    .map(x => x.r);
}

/* ======================================================================
   Tab navigation and header
   ====================================================================== */
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
const modeChip = document.getElementById('modeChip');

const titles = { today: 'Today', add: 'Add food', foods: 'Foods', trends: 'Trends', settings: 'Settings' };

function renderHeader() {
  headerTitle.textContent = currentView === 'today' && viewDate !== todayStr() ? 'Day' : titles[currentView];
  headerSubtitle.textContent = currentView === 'today' || currentView === 'add' ? fmtLongDate(viewDate) : '';
  modeChip.hidden = currentView !== 'today';
  modeChip.textContent = MODE_LABEL[settings.mode];
}

function setView(name) {
  currentView = name;
  if (name !== 'add') preferredMeal = null;
  Object.entries(views).forEach(([k, el]) => el.classList.toggle('active', k === name));
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  renderHeader();
  if (name === 'today') renderToday();
  if (name === 'add') renderAdd();
  if (name === 'foods') renderFoods();
  if (name === 'settings') { renderSettings(); renderSyncStatus(); renderStorage(); }
  if (typeof window.scrollTo === 'function') try { window.scrollTo(0, 0); } catch (e) { /* not supported */ }
}

tabBtns.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

/* ======================================================================
   Toast
   ====================================================================== */
let toastTimer;
function showToast(msg, { error = false } = {}) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 3200 : 1800);
}

/* ======================================================================
   Sheets
   One stack of bottom sheets. A sheet that holds input registers as an
   editor (so an app update waits), asks before discarding edits, and can
   offer a draft that survives iOS reloading the page.
   ====================================================================== */
const sheetStack = [];

/*
 * openSheet({ title, sub, tall, editor, isDirty, getDraft, draftKind, render })
 * render(body, ctl) builds the content; ctl.setActions([{label, cls, onClick}])
 * sets the footer. Returns ctl, with ctl.close() and ctl.requestClose().
 */
function openSheet(opts) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet${opts.tall ? ' tall' : ''}" role="dialog" data-role="sheet">
    <div class="sheet-head">
      <div class="sheet-title"><span data-role="sheet-title"></span><div class="sheet-sub" data-role="sheet-sub"></div></div>
      <button class="icon-btn" data-role="sheet-close" aria-label="Close">×</button>
    </div>
    <div class="sheet-body"></div>
    <div class="sheet-actions" hidden></div>
  </div>`;
  const body = backdrop.querySelector('.sheet-body');
  const actionsEl = backdrop.querySelector('.sheet-actions');
  const key = 'sheet-' + uid();
  const ctl = {
    key,
    opts,
    el: backdrop,
    body,
    closed: false,
    setTitle(t, sub) {
      backdrop.querySelector('[data-role="sheet-title"]').textContent = t;
      backdrop.querySelector('[data-role="sheet-sub"]').textContent = sub || '';
    },
    setActions(list) {
      actionsEl.innerHTML = '';
      actionsEl.hidden = !list.length;
      list.forEach(a => {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.cls || 'btn-secondary');
        b.textContent = a.label;
        if (a.role) b.dataset.role = a.role;
        b.addEventListener('click', a.onClick);
        actionsEl.appendChild(b);
      });
    },
    close() {
      if (ctl.closed) return;
      ctl.closed = true;
      backdrop.remove();
      const i = sheetStack.indexOf(ctl);
      if (i >= 0) sheetStack.splice(i, 1);
      if (opts.editor) openEditors.delete(key);
      if (opts.getDraft && !sheetStack.some(s => s.opts.getDraft)) removeKey(KEYS.draft);
      if (opts.onClose) opts.onClose();
      applyUpdateIfDeferred();
    },
    requestClose() {
      if (opts.isDirty && opts.isDirty()) {
        confirmSheet({
          title: 'Discard changes?',
          body: 'What you entered here has not been saved.',
          confirmLabel: 'Discard',
          danger: true,
          onConfirm: () => ctl.close(),
        });
      } else {
        ctl.close();
      }
    },
  };
  ctl.setTitle(opts.title || '', opts.sub || '');
  backdrop.querySelector('[data-role="sheet-close"]').addEventListener('click', () => ctl.requestClose());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) ctl.requestClose(); });
  document.body.appendChild(backdrop);
  sheetStack.push(ctl);
  if (opts.editor) openEditors.add(key);
  opts.render(body, ctl);
  return ctl;
}

function confirmSheet({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm, cancelLabel = 'Cancel' }) {
  return openSheet({
    title,
    render(el, ctl) {
      el.innerHTML = `<div class="small" style="line-height:1.5;" data-role="confirm-body"></div>`;
      el.firstElementChild.textContent = body || '';
      ctl.setActions([
        { label: cancelLabel, cls: 'btn-secondary', role: 'confirm-cancel', onClick: () => ctl.close() },
        { label: confirmLabel, cls: danger ? 'btn-danger' : 'btn-primary', role: 'confirm-ok', onClick: () => { ctl.close(); onConfirm(); } },
      ]);
    },
  });
}

function topSheet() {
  return sheetStack[sheetStack.length - 1] || null;
}

/* ======================================================================
   Drafts survive a reload
   Taking a photo hands control to the camera, and iOS can reload the page
   on return. The open editor's state is saved on hide and restored on boot.
   ====================================================================== */
const draftRestorers = {};

function saveDraft() {
  const s = sheetStack.find(x => x.opts.getDraft && !x.closed);
  if (!s) return;
  const data = s.opts.getDraft();
  if (data) saveJson(KEYS.draft, { kind: s.opts.draftKind, data, savedAt: nowIso() });
}

function restoreDraft() {
  const d = loadJson(KEYS.draft, null);
  if (!d || !d.kind || !draftRestorers[d.kind]) { if (d) removeKey(KEYS.draft); return; }
  try {
    draftRestorers[d.kind](d.data);
    showToast('Restored unsaved review');
  } catch (e) {
    console.error('Draft restore failed', e);
    removeKey(KEYS.draft);
  }
}

/* ======================================================================
   Proxy
   POST as text/plain: a CORS "simple request" with no preflight, which
   Apps Script cannot answer. Every call has a timeout, and errors say what
   failed.
   ====================================================================== */
let PING_TIMEOUT_MS = 15 * 1000;     // `let` so the tests can shorten these
let LOOKUP_TIMEOUT_MS = 15 * 1000;

async function callProxy(action, params, timeoutMs, externalSignal) {
  if (!config.url) throw new Error('no proxy URL set (Settings)');
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
  const onExternal = () => abort.abort();
  if (externalSignal) externalSignal.addEventListener('abort', onExternal);
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
        if (timedOut) throw new Error(`no response after ${Math.round(timeoutMs / 1000)}s`);
        const e = new Error('cancelled'); e.cancelled = true; throw e;
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
    if (externalSignal) externalSignal.removeEventListener('abort', onExternal);
  }
}

/* ======================================================================
   USDA FoodData Central, called directly from the phone
   Apps Script's route to FDC timed out on Rob's first real search (M1,
   2026-10-11) while FDC answered this Mac in half a second, and FDC allows
   cross-origin calls (Access-Control-Allow-Origin: *, checked the same day).
   So with a key in Settings the app asks FDC itself, and falls back to the
   proxy only if that fails. The key lives in nt_config_v1 on the phone,
   never in the repo.

   The normalizer below is a copy of Proxy/Code.gs normalizeFdcFood_; a test
   checks the two give identical output on every fixture.
   ====================================================================== */
const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';
const FDC_NUMBERS = { protein: '203', fat: '204', carbs: '205', fiber: '291', satFat: '606' };
const FDC_LABEL_KEYS = { kcal: 'calories', protein: 'protein', carbs: 'carbohydrates', fat: 'fat', satFat: 'saturatedFat', fiber: 'fiber' };

function fdcNutrients(raw) {
  const out = {};
  (raw.foodNutrients || []).forEach(x => {
    let num, amount, unit;
    if (x.nutrient) { num = x.nutrient.number; amount = x.amount; unit = x.nutrient.unitName; }
    else { num = x.nutrientNumber; amount = x.value; unit = x.unitName; }
    if (num == null || amount == null || isNaN(Number(amount))) return;
    out[String(num)] = { amount: Number(amount), unit: String(unit || '').toLowerCase() };
  });
  return out;
}

function fdcClean(v) {
  if (v == null || isNaN(v)) return null;
  return Math.round(Math.max(0, Number(v)) * 1000) / 1000;
}

function fdcEnergy(n) {
  if (n['208'] && n['208'].unit === 'kcal') return n['208'].amount;
  if (n['958'] && n['958'].unit === 'kcal') return n['958'].amount;
  if (n['957'] && n['957'].unit === 'kcal') return n['957'].amount;
  if (n['268'] && n['268'].unit === 'kj') return n['268'].amount / 4.184;
  if (n['208'] && n['208'].unit === 'kj') return n['208'].amount / 4.184;
  return null;
}

function fdcScale(per100, amount) {
  const out = {};
  NUTS.forEach(k => { out[k] = per100[k] == null ? null : Math.round(per100[k] * amount / 100 * 1000) / 1000; });
  return out;
}

function fdcAmount(a) {
  const n = Number(a);
  return isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}

function fdcPortionLabel(p) {
  const desc = p.portionDescription && !/quantity not specified/i.test(p.portionDescription) ? p.portionDescription : '';
  const unit = p.measureUnit && p.measureUnit.name ? p.measureUnit.name : '';
  let base;
  if (desc) base = desc;
  else if (unit === 'RACC') base = 'serving';
  else base = [fdcAmount(p.amount || 1), unit && unit !== 'undetermined' ? unit : '', p.modifier || ''].join(' ').replace(/\s+/g, ' ').trim();
  return base + ' (' + fdcAmount(p.gramWeight) + ' g)';
}

function normalizeFdcFood(raw, detail) {
  const n = fdcNutrients(raw);
  const per100 = { kcal: fdcClean(fdcEnergy(n)) };
  Object.keys(FDC_NUMBERS).forEach(k => {
    const hit = n[FDC_NUMBERS[k]];
    per100[k] = hit ? fdcClean(hit.amount) : null;
  });
  if (per100.kcal == null) return null;

  const unitRaw = String(raw.servingSizeUnit || '').toLowerCase();
  const baseUnit = /^(ml|mlt)$/.test(unitRaw) ? 'ml' : 'g';
  const servings = [];
  if (raw.servingSize && /^(g|grm|ml|mlt)$/.test(unitRaw)) {
    const size = Number(raw.servingSize);
    const hh = raw.householdServingFullText ? String(raw.householdServingFullText).trim() : '';
    const per = fdcScale(per100, size);
    if (raw.labelNutrients) {
      NUTS.forEach(k => {
        const l = raw.labelNutrients[FDC_LABEL_KEYS[k]];
        if (l && l.value != null && !isNaN(Number(l.value))) per[k] = fdcClean(l.value);
      });
    }
    servings.push({ label: (hh ? hh + ' ' : '') + '(' + fdcAmount(size) + ' ' + baseUnit + ')', grams: baseUnit === 'g' ? size : null, per });
  }
  (raw.foodPortions || [])
    .filter(p => p && Number(p.gramWeight) > 0)
    .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0))
    .forEach(p => {
      const g = Number(p.gramWeight);
      servings.push({ label: fdcPortionLabel(p), grams: g, per: fdcScale(per100, g) });
    });

  let name = String(raw.description || '').trim();
  if (raw.dataType === 'Branded' && name === name.toUpperCase()) {
    name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  const category = typeof raw.foodCategory === 'string' ? raw.foodCategory
    : (raw.foodCategory && raw.foodCategory.description) || raw.brandedFoodCategory || '';

  return {
    id: 'fdc:' + raw.fdcId,
    source: 'fdc',
    sourceId: String(raw.fdcId),
    dataType: raw.dataType || '',
    category: String(category),
    name,
    brand: raw.brandOwner || raw.brandName || '',
    upc: raw.gtinUpc || '',
    baseUnit,
    per100g: per100,
    servings,
    defaultServing: servings.length ? 0 : -1,
    incomplete: NUTS.filter(k => per100[k] == null),
    detail: !!detail,
  };
}

/* One FDC request with a timeout. Error messages are built here, so the URL
   (which carries the key) can never end up on screen. */
async function fdcRequest(path, { signal, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
  const onExternal = () => abort.abort();
  if (signal) signal.addEventListener('abort', onExternal);
  const sep = path.includes('?') ? '&' : '?';
  try {
    let res;
    try {
      // A plain GET with no custom headers: a CORS "simple request", no preflight.
      res = await fetch(FDC_BASE + path + sep + 'api_key=' + encodeURIComponent(config.fdcKey), { signal: abort.signal });
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 20)) {
        if (timedOut) throw new Error(`USDA did not answer after ${Math.round(timeoutMs / 1000)}s`);
        const e = new Error('cancelled'); e.cancelled = true; throw e;
      }
      throw new Error('could not reach USDA');
    }
    if (res.status === 429) throw new Error('USDA rate limited');
    if (res.status === 403) throw new Error('USDA rejected the API key (Settings)');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`USDA HTTP ${res.status}`);
    try { return JSON.parse(await res.text()); }
    catch (e) { throw new Error('USDA returned something other than JSON'); }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternal);
  }
}

// Session cache only (memory, never storage), so retyping a query is instant.
const fdcSessionCache = new Map();

async function fdcSearchDirect(query, signal) {
  const key = 's:' + query.toLowerCase();
  if (fdcSessionCache.has(key)) return fdcSessionCache.get(key);
  // Generic foods first (Foundation and SR Legacy), then Branded, as the proxy does.
  // GET, not POST: a JSON POST makes the browser send a CORS preflight first,
  // which doubles the calls against the key's hourly limit and fails outright
  // whenever FDC answers it with an error (seen 2026-10-11). The OpenAPI spec
  // gives dataType as a comma-separated list (style: form, explode: false).
  const searchPath = (types, size) => '/foods/search?query=' + encodeURIComponent(query)
    + '&dataType=' + types.map(encodeURIComponent).join(',') + '&pageSize=' + size;
  const [generic, branded] = await Promise.all([
    fdcRequest(searchPath(['Foundation', 'SR Legacy'], 10), { signal }),
    fdcRequest(searchPath(['Branded'], 15), { signal }),
  ]);
  const foods = [];
  [generic, branded].forEach(b => ((b && b.foods) || []).forEach(f => { const n = normalizeFdcFood(f, false); if (n) foods.push(n); }));
  fdcSessionCache.set(key, foods);
  return foods;
}

async function fdcGetFoodDirect(fdcId) {
  const key = 'f:' + fdcId;
  if (fdcSessionCache.has(key)) return fdcSessionCache.get(key);
  const raw = await fdcRequest('/food/' + encodeURIComponent(fdcId));
  if (!raw) throw new Error('USDA has no food ' + fdcId);
  const food = normalizeFdcFood(raw, true);
  if (!food) throw new Error('USDA food ' + fdcId + ' has no calories');
  fdcSessionCache.set(key, food);
  return food;
}

/* Direct first when a key is set; the proxy if that fails or there's no key.
   Says which failed when both do. */
async function searchFoodsRemote(query, signal) {
  let directErr = null;
  if (config.fdcKey) {
    try { return await fdcSearchDirect(query, signal); }
    catch (err) { if (err.cancelled) throw err; directErr = err; }
  }
  if (!config.url) throw directErr || new Error('USDA search needs a key or the proxy (Settings)');
  try {
    const body = await callProxy('searchFoods', { query }, LOOKUP_TIMEOUT_MS, signal);
    return body.foods || [];
  } catch (err) {
    if (err.cancelled || !directErr) throw err;
    throw new Error(`${directErr.message}; proxy: ${err.message}`);
  }
}

async function getFoodRemote(fdcId) {
  let directErr = null;
  if (config.fdcKey) {
    try { return await fdcGetFoodDirect(fdcId); }
    catch (err) { directErr = err; }
  }
  if (!config.url) throw directErr || new Error('no USDA key or proxy (Settings)');
  try {
    return (await callProxy('getFood', { fdcId }, LOOKUP_TIMEOUT_MS)).food;
  } catch (err) {
    if (!directErr) throw err;
    throw new Error(`${directErr.message}; proxy: ${err.message}`);
  }
}

/* ======================================================================
   Food search (shared by the Add tab and the recipe ingredient picker)
   Debounced 300 ms in memory, no storage writes. Local foods (custom,
   recipes, cached) show first and work offline; USDA results follow.
   ====================================================================== */
let SEARCH_DEBOUNCE_MS = 300;

function localMatches(query, { includeRecipes }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (name, brand) => {
    const hay = (name + ' ' + (brand || '')).toLowerCase();
    return words.every(w => hay.includes(w));
  };
  const out = [];
  customFoods.filter(c => hit(c.name, c.brand)).forEach(c => out.push(foodFromCustom(c)));
  if (includeRecipes) recipes.filter(r => hit(r.name, '')).forEach(r => out.push(foodFromRecipe(r)));
  Object.values(foodCache).filter(x => hit(x.food.name, x.food.brand)).forEach(x => out.push(x.food));
  return out.slice(0, 12);
}

function foodSubline(food) {
  const parts = [];
  if (food.brand) parts.push(food.brand);
  const s = food.servings && food.servings[0];
  if (food.source === 'recipe') parts.push('recipe');
  if (food.source === 'custom') parts.push('custom');
  if (s && s.per && s.per.kcal != null) parts.push(`${fmtKcal(s.per.kcal)} kcal / ${s.label}`);
  else if (food.per100g && food.per100g.kcal != null) parts.push(`${fmtKcal(food.per100g.kcal)} kcal / 100 ${food.baseUnit || 'g'}`);
  return parts.join(' · ');
}

function foodRowHtml(food, key) {
  // Generic USDA foods (Foundation, SR Legacy) are tagged; branded ones show their brand.
  const tag = food.dataType && food.dataType !== 'Branded' ? '<span class="tag src">USDA</span>' : '';
  const z = zeroedFor(food);
  const missing = (food.incomplete || []).filter(k => !z[k]);
  const inc = missing.length ? `<span class="tag warn">missing ${escapeHtml(missing.map(k => NUT_LABEL[k].toLowerCase()).join(', '))}</span>` : '';
  return `<button class="item" data-action="pick" data-key="${escapeHtml(key)}">
    <div class="item-main"><div class="item-name">${escapeHtml(food.name)}${tag}${inc}</div>
    <div class="item-sub">${escapeHtml(foodSubline(food))}</div></div>
  </button>`;
}

/*
 * mountSearch(container, { includeRecipes, onPick(food), extraEmpty(el) })
 * Builds a search box with its own debounce, cancellation and status line.
 */
function mountSearch(container, { includeRecipes = true, onPick, placeholder = 'Search foods' }) {
  container.innerHTML = `<div class="search-box"><input type="text" data-role="search-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></div>
    <div class="search-status" data-role="search-status"></div>
    <div data-role="search-results"></div>`;
  const input = container.querySelector('[data-role="search-input"]');
  const status = container.querySelector('[data-role="search-status"]');
  const results = container.querySelector('[data-role="search-results"]');
  const shown = new Map();
  let timer = null;
  let seq = 0;
  let inflight = null;

  function setStatus(text, err) {
    status.textContent = text || '';
    status.classList.toggle('err', !!err);
  }

  function draw(local, remote) {
    shown.clear();
    let html = '';
    if (local.length) {
      html += `<div class="group-title">Your foods</div><div class="list">`;
      local.forEach((f, i) => { const k = 'l' + i; shown.set(k, f); html += foodRowHtml(f, k); });
      html += `</div>`;
    }
    if (remote && remote.length) {
      html += `<div class="group-title">USDA FoodData Central</div><div class="list">`;
      remote.forEach((f, i) => { const k = 'r' + i; shown.set(k, f); html += foodRowHtml(f, k); });
      html += `</div>`;
    }
    results.innerHTML = html;
  }

  async function run(query) {
    const my = ++seq;
    if (inflight) inflight.abort();
    const local = localMatches(query, { includeRecipes });
    draw(local, null);
    if (!config.url && !config.fdcKey) { setStatus(local.length ? 'USDA search needs a USDA key or the proxy (Settings).' : 'No matches in your foods. USDA search needs a USDA key or the proxy (Settings).', !local.length); return; }
    if (navigator.onLine === false) { setStatus('Offline: showing your foods only.'); return; }
    setStatus('Searching USDA…');
    inflight = new AbortController();
    try {
      const found = await searchFoodsRemote(query, inflight.signal);
      if (my !== seq) return;
      const localIds = new Set(local.map(f => f.id));
      const remote = found.filter(f => !localIds.has(f.id));
      draw(local, remote);
      setStatus(remote.length || local.length ? '' : `No matches for "${query}".`);
    } catch (err) {
      if (my !== seq || err.cancelled) return;
      setStatus(`USDA search failed: ${err.message}`, true);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.replace(/\s+/g, ' ').trim();
    if (q.length < 2) {
      seq++;
      if (inflight) inflight.abort();
      results.innerHTML = '';
      setStatus('');
      if (api.onEmpty) api.onEmpty(true);
      return;
    }
    if (api.onEmpty) api.onEmpty(false);
    timer = setTimeout(() => run(q), SEARCH_DEBOUNCE_MS);
  });

  results.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="pick"]');
    if (!btn) return;
    const food = shown.get(btn.dataset.key);
    if (food) onPick(food);
  });

  const api = { input, onEmpty: null, clear() { input.value = ''; results.innerHTML = ''; setStatus(''); } };
  return api;
}

/* Gets full detail (portions, printed label values) for an FDC search
   result. Falls back to the search version, grams only, when offline. */
async function ensureDetail(food) {
  if (food.source !== 'fdc' || food.detail) return { food };
  const cached = foodCache[food.id];
  if (cached && cached.food.detail) return { food: cached.food };
  try {
    return { food: await getFoodRemote(food.sourceId) };
  } catch (err) {
    return { food, warning: `Serving sizes unavailable (${err.message}). Grams work.` };
  }
}

/* ======================================================================
   Entry sheet: quantity, serving, meal, live preview.
   Modes: 'new' (log a food), 'edit' (an existing entry), 'ingredient'
   (a recipe line; no meal or date).
   ====================================================================== */
function previewHtml(n) {
  return `<div class="preview" data-role="preview">${NUTS.map(k => {
    const v = n ? n[k] : null;
    const val = v == null ? '—' : k === 'kcal' ? fmtKcal(v) : fmtG(v) + ' g';
    return `<div class="pv${v == null ? ' null' : ''}" data-nut="${k}"><div class="pv-val">${val}</div><div class="pv-name">${NUT_LABEL[k]}</div></div>`;
  }).join('')}</div>`;
}

function openEntrySheet({ mode, food, entry, line, date, meal, warning, onIngredient, restore }) {
  let opts = food ? servingOptions(food) : [];
  // Which serving and quantity to start on: an edit's own, the last-used for
  // this food, or the food's default.
  let idx = -1;
  let qty = null;
  if (restore) { idx = restore.idx; qty = restore.qty; }
  else if (mode === 'edit' && entry) {
    idx = opts.findIndex(o => o.label === entry.servingLabel);
    qty = entry.qty;
  } else if (mode === 'ingredient' && line) {
    idx = opts.findIndex(o => o.label === line.servingLabel);
    qty = line.qty;
  } else {
    const rec = food && recents.find(r => r.foodId === food.id);
    if (rec) { idx = opts.findIndex(o => o.label === rec.servingLabel); qty = rec.qty; }
  }
  const editBasis = (mode === 'edit' && entry && idx < 0) || (mode === 'ingredient' && line && idx < 0);
  if (!editBasis && idx < 0) {
    idx = food && food.defaultServing >= 0 && food.defaultServing < opts.length ? food.defaultServing : 0;
    qty = opts[idx] && opts[idx].unit ? 100 : 1;
  }
  // An entry whose food is gone (or a serving no longer offered) can still
  // change quantity, from its stored basis.
  const src = entry || line;
  const foodId = food ? food.id : src && src.foodId;
  const rawBasis = editBasis ? { label: src.basis ? src.basis.label : src.servingLabel, grams: src.basis ? src.basis.grams : null, per: src.basis ? src.basis.per : null } : null;
  let choices;
  // Rebuilt when Rob counts a blank as 0, so the preview and save follow.
  const buildChoices = () => {
    opts = food ? servingOptions(food) : [];
    let basisOpt = null;
    if (rawBasis) {
      const z = applyZeroed(rawBasis.per, food || foodId);
      basisOpt = Object.assign({}, rawBasis, { per: z.per, zeroed: z.filled, zeroedWhy: z.why });
    }
    choices = basisOpt ? [basisOpt].concat(opts) : opts;
  };
  buildChoices();
  if (rawBasis) idx = 0;

  const state = {
    qty: qty == null ? 1 : qty,
    idx,
    meal: meal || (entry && entry.meal) || preferredMeal || defaultMeal(),
    date: date || (entry && entry.date) || viewDate,
  };
  if (restore) { state.meal = restore.meal || state.meal; state.date = restore.date || state.date; }
  const initial = JSON.stringify([state.qty, state.idx, state.meal, state.date]);
  const name = food ? food.name : (entry || line).name;
  const brand = food ? food.brand : (entry || line).brand;

  const current = () => {
    const s = choices[state.idx];
    const q = parseNum(state.qtyText != null ? state.qtyText : state.qty);
    return { s, q, n: s && q != null && q > 0 ? scaleN(s.per, q) : null };
  };

  const ctl = openSheet({
    title: name,
    sub: brand || '',
    editor: true,
    draftKind: mode === 'ingredient' ? null : 'entry',
    getDraft: mode === 'ingredient' ? null : () => ({ mode, food, entryId: entry ? entry.id : null, idx: state.idx, qty: state.qtyText != null ? state.qtyText : state.qty, meal: state.meal, date: state.date }),
    isDirty: () => JSON.stringify([parseNum(state.qtyText != null ? state.qtyText : state.qty), state.idx, state.meal, state.date]) !== initial || (!!restore),
    render(body, c) {
      const mealSel = mode === 'ingredient' ? '' : `<div class="field"><label>Meal</label><select data-role="meal">${MEALS.map(m => `<option value="${m}"${m === state.meal ? ' selected' : ''}>${MEAL_LABEL[m]}</option>`).join('')}</select></div>`;
      const dateLine = mode === 'ingredient' ? '' : `<div class="hint" data-role="entry-date">Logging to ${escapeHtml(fmtLongDate(state.date))}.</div>`;
      body.innerHTML = `
        ${warning ? `<div class="warn-text">${escapeHtml(warning)}</div>` : ''}
        <div class="grid2" style="margin-top:6px;">
          <div class="field"><label>Quantity</label><input type="text" inputmode="decimal" data-role="qty" class="big-input" value="${escapeHtml(fmtQty(state.qty))}"></div>
          <div class="field"><label>Unit</label><select data-role="serving">${choices.map((o, i) => `<option value="${i}"${i === state.idx ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></div>
        </div>
        ${mealSel}
        <div data-role="preview-wrap"></div>
        <div class="hint" data-role="incomplete-note"></div>
        ${dateLine}`;
      const qtyEl = body.querySelector('[data-role="qty"]');
      const servEl = body.querySelector('[data-role="serving"]');
      const mealEl = body.querySelector('[data-role="meal"]');
      const canZero = !!foodId && foodId !== 'quick';
      const paint = () => {
        const { n, q, s } = current();
        body.querySelector('[data-role="preview-wrap"]').innerHTML = q == null || q <= 0 ? '<div class="warn-text">Enter a quantity above zero.</div>' : previewHtml(n);
        const miss = n ? nullsIn(n) : [];
        const chosen = (s && s.zeroed) || [];
        const why = (s && s.zeroedWhy) || {};
        let html = '';
        if (miss.length) {
          html += `Not listed for this food: ${escapeHtml(miss.map(k => NUT_LABEL[k].toLowerCase()).join(', '))}. Shown as unknown, not zero.`;
          if (canZero) html += miss.map(k => `<button class="btn btn-secondary btn-sm btn-block" style="margin-top:6px;" data-zero="${k}">Count ${NUT_LABEL[k].toLowerCase()} as 0 for this food</button>`).join('');
        }
        if (chosen.length) {
          html += `<div style="margin-top:6px;" data-role="zeroed-note">${chosen.map(k => `${escapeHtml(NUT_LABEL[k])} counted as 0 ${why[k] === 'meat' ? '(meat: USDA leaves it blank)' : 'for this food (your choice)'}.
            <button class="btn btn-ghost btn-sm" data-unzero="${k}">Undo ${NUT_LABEL[k].toLowerCase()}</button>`).join(' ')}</div>`;
        }
        body.querySelector('[data-role="incomplete-note"]').innerHTML = html;
      };
      body.querySelector('[data-role="incomplete-note"]').addEventListener('click', (ev) => {
        const z = ev.target.closest('[data-zero]');
        const u = ev.target.closest('[data-unzero]');
        if (!z && !u) return;
        if (!setZeroed(foodId, (z || u).dataset[z ? 'zero' : 'unzero'], !!z)) return;
        buildChoices();
        paint();
      });
      qtyEl.addEventListener('input', () => { state.qtyText = qtyEl.value; paint(); });
      servEl.addEventListener('change', () => {
        const prev = choices[state.idx];
        state.idx = Number(servEl.value);
        const next = choices[state.idx];
        // Switching between grams and a serving keeps the amount sensible.
        if (prev && next && prev.grams && next.grams && prev.grams !== next.grams) {
          const q = parseNum(qtyEl.value);
          if (q != null) { const nq = round(q * prev.grams / next.grams, 2); qtyEl.value = fmtQty(nq); state.qtyText = qtyEl.value; }
        }
        paint();
      });
      if (mealEl) mealEl.addEventListener('change', () => { state.meal = mealEl.value; });
      paint();

      const save = () => {
        const { s, q } = current();
        if (!s || q == null || q <= 0) { showToast('Enter a quantity above zero', { error: true }); return; }
        if (mode === 'ingredient') {
          onIngredient({
            foodId: food ? food.id : line.foodId,
            source: food ? food.source : line.source,
            name, brand: brand || '',
            raw: name,
            qty: q,
            servingLabel: s.label,
            grams: s.grams == null ? null : round(s.grams * q, 1),
            basis: { label: s.label, grams: s.grams, per: cleanN(s.per) },
            nutrients: scaleN(s.per, q),
            zeroed: (s.zeroed || []).slice(),
            confidence: 'exact',
          });
          c.close();
          return;
        }
        if (mode === 'edit') {
          const changes = {
            qty: q,
            meal: state.meal,
            servingLabel: s.label,
            grams: s.grams == null ? null : round(s.grams * q, 1),
            basis: { label: s.label, grams: s.grams, per: cleanN(s.per) },
            nutrients: scaleN(s.per, q),
            zeroed: (s.zeroed || []).slice(),
          };
          if (!updateEntry(entry.id, changes)) return;
          c.close();
          showToast('Saved');
          renderToday();
          return;
        }
        const e = buildEntry({ food, serving: s, qty: q, meal: state.meal, date: state.date });
        if (!addEntries([e])) return;
        cacheFood(food);
        touchRecent(food, s.label, q, state.meal);
        c.close();
        showToast(`Added to ${MEAL_LABEL[state.meal].toLowerCase()}: ${fmtKcal(e.nutrients.kcal)} kcal`);
        renderToday();
        if (currentView === 'add') renderAddLists();
      };
      const actions = [{ label: 'Cancel', cls: 'btn-secondary', onClick: () => c.requestClose() }];
      if (mode === 'edit') actions.push({ label: 'Delete', cls: 'btn-danger', role: 'entry-delete', onClick: () => askDeleteEntry(entry, () => c.close()) });
      actions.push({ label: mode === 'edit' ? 'Save' : mode === 'ingredient' ? (line ? 'Update' : 'Add to recipe') : 'Add', cls: 'btn-primary', role: 'entry-save', onClick: save });
      c.setActions(actions);
    },
  });
  return ctl;
}

draftRestorers.entry = (d) => {
  if (d.mode === 'edit') {
    const entry = entries.find(e => e.id === d.entryId && !e.deletedAt);
    if (!entry) return;
    openEntrySheet({ mode: 'edit', entry, food: resolveFood(entry.foodId), restore: { idx: d.idx, qty: d.qty, meal: d.meal, date: d.date } });
  } else if (d.food) {
    openEntrySheet({ mode: 'new', food: d.food, restore: { idx: d.idx, qty: d.qty, meal: d.meal, date: d.date } });
  }
};

function askDeleteEntry(entry, after) {
  confirmSheet({
    title: 'Delete this entry?',
    body: `${entry.name}, ${fmtKcal(entry.nutrients.kcal)} kcal, from ${MEAL_LABEL[entry.meal].toLowerCase()} on ${fmtShortDate(entry.date)}.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      if (!deleteEntry(entry.id)) return;
      if (after) after();
      showToast('Deleted');
      renderToday();
    },
  });
}

async function pickFoodToLog(food) {
  const { food: full, warning } = await ensureDetail(food);
  openEntrySheet({ mode: 'new', food: full, date: viewDate, warning });
}

/* ======================================================================
   Quick add: one-off calories and macros, logged as estimated. Blank
   fields are unknown, not zero.
   ====================================================================== */
function nutrientInputsHtml(n, { perLabel } = {}) {
  return `<div class="grid3">${NUTS.map(k => `<div class="field"><label>${NUT_LABEL[k]}${k === 'kcal' ? '' : ' (g)'}</label>
    <input type="text" inputmode="decimal" data-nut="${k}" value="${n && n[k] != null ? escapeHtml(fmtQty(n[k])) : ''}" placeholder="${k === 'kcal' ? 'kcal' : '—'}"></div>`).join('')}</div>
    ${perLabel ? `<div class="hint">${escapeHtml(perLabel)} Leave a field blank if it is unknown; blank is not zero.</div>` : ''}`;
}

function readNutrientInputs(root) {
  const n = emptyN();
  root.querySelectorAll('[data-nut]').forEach(inp => {
    if (inp.tagName !== 'INPUT') return;
    n[inp.dataset.nut] = parseNum(inp.value);
  });
  return n;
}

function badNutrients(n) {
  return NUTS.filter(k => n[k] != null && n[k] < 0);
}

function openQuickAdd(restore) {
  const st = restore || { name: '', note: '', n: emptyN(), meal: defaultMeal(), date: viewDate };
  let dirty = !!restore;
  const ctl = openSheet({
    title: 'Quick add',
    sub: 'Logged as estimated',
    editor: true,
    draftKind: 'quick',
    getDraft: () => read(),
    isDirty: () => dirty,
    render(body, c) {
      body.innerHTML = `
        <div class="field"><label>What</label><input type="text" data-role="qa-name" placeholder="e.g. Restaurant burrito" value="${escapeHtml(st.name)}"></div>
        ${nutrientInputsHtml(st.n, { perLabel: 'Totals for what you ate.' })}
        <div class="field" style="margin-top:8px;"><label>Meal</label><select data-role="qa-meal">${MEALS.map(m => `<option value="${m}"${m === st.meal ? ' selected' : ''}>${MEAL_LABEL[m]}</option>`).join('')}</select></div>
        <div class="field"><label>Note</label><input type="text" data-role="qa-note" value="${escapeHtml(st.note)}"></div>
        <div class="hint">Logging to ${escapeHtml(fmtLongDate(st.date))}.</div>`;
      body.addEventListener('input', () => { dirty = true; });
      body.addEventListener('change', () => { dirty = true; });
      c.setActions([
        { label: 'Cancel', cls: 'btn-secondary', onClick: () => c.requestClose() },
        { label: 'Add', cls: 'btn-primary', role: 'qa-save', onClick: save },
      ]);
    },
  });
  function read() {
    return {
      name: ctl.body.querySelector('[data-role="qa-name"]').value.trim(),
      note: ctl.body.querySelector('[data-role="qa-note"]').value.trim(),
      n: readNutrientInputs(ctl.body),
      meal: ctl.body.querySelector('[data-role="qa-meal"]').value,
      date: st.date,
    };
  }
  function save() {
    const d = read();
    if (d.n.kcal == null) { showToast('Calories are required for quick add', { error: true }); return; }
    if (badNutrients(d.n).length) { showToast('Values cannot be negative', { error: true }); return; }
    const food = { id: 'quick', source: 'quick', name: d.name || 'Quick add', brand: '' };
    const e = buildEntry({ food, serving: { label: 'entry', grams: null, per: d.n }, qty: 1, meal: d.meal, date: d.date, note: d.note });
    e.foodId = null;
    if (!addEntries([e])) return;
    ctl.close();
    showToast(`Added to ${MEAL_LABEL[d.meal].toLowerCase()}: ${fmtKcal(d.n.kcal)} kcal`);
    renderToday();
  }
  return ctl;
}
draftRestorers.quick = (d) => openQuickAdd(d);

/* ======================================================================
   Custom foods: name, optional brand and UPC, serving label, optional
   serving grams, nutrients per serving.
   ====================================================================== */
function openCustomFood(existing, restore) {
  const st = restore || (existing
    ? { id: existing.id, name: existing.name, brand: existing.brand || '', upc: existing.upc || '', servingLabel: existing.servingLabel || '', servingGrams: existing.servingGrams, n: cleanN(existing.per) }
    : { id: null, name: '', brand: '', upc: '', servingLabel: '1 serving', servingGrams: null, n: emptyN() });
  let dirty = !!restore;
  const ctl = openSheet({
    title: st.id ? 'Edit custom food' : 'New custom food',
    editor: true,
    draftKind: 'custom',
    getDraft: () => Object.assign(read(), { id: st.id }),
    isDirty: () => dirty,
    render(body, c) {
      body.innerHTML = `
        <div class="field"><label>Name</label><input type="text" data-role="cf-name" value="${escapeHtml(st.name)}"></div>
        <div class="grid2">
          <div class="field"><label>Brand (optional)</label><input type="text" data-role="cf-brand" value="${escapeHtml(st.brand)}"></div>
          <div class="field"><label>UPC (optional)</label><input type="text" inputmode="numeric" data-role="cf-upc" value="${escapeHtml(st.upc)}"></div>
          <div class="field"><label>Serving label</label><input type="text" data-role="cf-serving" value="${escapeHtml(st.servingLabel)}" placeholder="e.g. 2 tbsp"></div>
          <div class="field"><label>Serving grams (optional)</label><input type="text" inputmode="decimal" data-role="cf-grams" value="${st.servingGrams == null ? '' : escapeHtml(fmtQty(st.servingGrams))}"></div>
        </div>
        ${nutrientInputsHtml(st.n, { perLabel: 'Per serving, as printed.' })}`;
      body.addEventListener('input', () => { dirty = true; });
      const actions = [{ label: 'Cancel', cls: 'btn-secondary', onClick: () => c.requestClose() }];
      if (st.id) actions.push({ label: 'Delete', cls: 'btn-danger', onClick: () => askDeleteCustom(st.id, () => c.close()) });
      actions.push({ label: 'Save', cls: 'btn-primary', role: 'cf-save', onClick: save });
      c.setActions(actions);
    },
  });
  function read() {
    const q = (r) => ctl.body.querySelector(`[data-role="${r}"]`).value.trim();
    return { name: q('cf-name'), brand: q('cf-brand'), upc: q('cf-upc').replace(/\D/g, ''), servingLabel: q('cf-serving') || 'serving', servingGrams: parseNum(q('cf-grams')), n: readNutrientInputs(ctl.body) };
  }
  function save() {
    const d = read();
    if (!d.name) { showToast('Give it a name', { error: true }); return; }
    if (d.n.kcal == null) { showToast('Calories per serving are required', { error: true }); return; }
    if (badNutrients(d.n).length || (d.servingGrams != null && d.servingGrams <= 0)) { showToast('Values cannot be negative', { error: true }); return; }
    const t = nowIso();
    const rec = { id: st.id || uid(), name: d.name, brand: d.brand, upc: d.upc, servingLabel: d.servingLabel, servingGrams: d.servingGrams, per: d.n, updatedAt: t };
    const prev = customFoods.find(x => x.id === rec.id);
    rec.createdAt = prev ? prev.createdAt : t;
    const next = prev ? customFoods.map(x => (x.id === rec.id ? rec : x)) : customFoods.concat(rec);
    if (!commitCustomFoods(next)) return;
    ctl.close();
    showToast('Custom food saved');
    if (currentView === 'foods') renderFoods();
  }
  return ctl;
}
draftRestorers.custom = (d) => openCustomFood(null, d);

function askDeleteCustom(id, after) {
  const c = customFoods.find(x => x.id === id);
  if (!c) return;
  confirmSheet({
    title: 'Delete this custom food?',
    body: `${c.name}. Entries already logged keep their numbers.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      if (!commitCustomFoods(customFoods.filter(x => x.id !== id))) return;
      if (after) after();
      showToast('Deleted');
      renderFoods();
    },
  });
}

/* ======================================================================
   Recipes (M1: the manual builder). The model never supplies a number
   here: every line is a food Rob picked, and code does all arithmetic.
   ====================================================================== */
function recipeTotals(lines, servings) {
  const totals = sumStrict(lines);
  const perServing = servings > 0 ? scaleN(totals, 1 / servings) : emptyN();
  return { totals, perServing, incomplete: nullsIn(totals) };
}

function openRecipeBuilder(existing, restore) {
  const st = restore || (existing
    ? { id: existing.id, name: existing.name, servings: existing.servings, lines: existing.lines.map(l => Object.assign({}, l)), createdAt: existing.createdAt }
    : { id: null, name: '', servings: 4, lines: [], createdAt: null });
  const initial = JSON.stringify([st.name, st.servings, st.lines]);
  let restored = !!restore;
  let root = null;   // the sheet body; set in render, before the first paint

  const ctl = openSheet({
    title: st.id ? 'Edit recipe' : 'New recipe',
    tall: true,
    editor: true,
    draftKind: 'recipe',
    getDraft: () => ({ id: st.id, name: st.name, servings: st.servings, lines: st.lines, createdAt: st.createdAt }),
    isDirty: () => restored || JSON.stringify([st.name, st.servings, st.lines]) !== initial,
    render(body, c) {
      root = body;
      body.innerHTML = `
        <div class="field"><label>Name</label><input type="text" data-role="rb-name" value="${escapeHtml(st.name)}"></div>
        <div class="field"><label>Servings this recipe makes</label><input type="text" inputmode="decimal" class="big-input" data-role="rb-servings" value="${escapeHtml(fmtQty(st.servings))}"></div>
        <div class="group-title">Ingredients</div>
        <div data-role="rb-lines"></div>
        <button class="btn btn-secondary btn-block" data-role="rb-add" style="margin-top:8px;">+ Add ingredient</button>
        <div class="group-title">Per serving</div>
        <div data-role="rb-per"></div>
        <div class="hint" data-role="rb-totals"></div>`;
      body.querySelector('[data-role="rb-name"]').addEventListener('input', (e) => { st.name = e.target.value; });
      body.querySelector('[data-role="rb-servings"]').addEventListener('input', (e) => { st.servings = parseNum(e.target.value); paint(); });
      body.querySelector('[data-role="rb-add"]').addEventListener('click', () => pickIngredient(null));
      body.querySelector('[data-role="rb-lines"]').addEventListener('click', (e) => {
        const del = e.target.closest('[data-action="rb-remove"]');
        if (del) { st.lines.splice(Number(del.dataset.i), 1); paint(); return; }
        const row = e.target.closest('[data-action="rb-edit"]');
        if (row) pickIngredient(Number(row.dataset.i));
      });
      c.setActions([
        { label: 'Cancel', cls: 'btn-secondary', onClick: () => c.requestClose() },
        { label: 'Save recipe', cls: 'btn-primary', role: 'rb-save', onClick: save },
      ]);
      paint();
    },
  });

  function paint() {
    const linesEl = root.querySelector('[data-role="rb-lines"]');
    linesEl.innerHTML = st.lines.length
      ? `<div class="list">${st.lines.map((l, i) => {
          const miss = nullsIn(l.nutrients);
          return `<div class="item"><button class="item-main" style="background:none;border:none;color:inherit;text-align:left;font-family:inherit;padding:0;" data-action="rb-edit" data-i="${i}">
            <div class="item-name">${escapeHtml(l.name)}${miss.length ? '<span class="tag warn">incomplete</span>' : ''}</div>
            <div class="item-sub">${escapeHtml(fmtServing(l.qty, l.servingLabel))}${l.grams != null && l.servingLabel !== 'g'  ? ` · ${escapeHtml(fmtQty(l.grams))} g` : ''} · ${fmtKcal(l.nutrients.kcal)} kcal</div></button>
            <button class="icon-btn del" data-action="rb-remove" data-i="${i}" aria-label="Remove">×</button></div>`;
        }).join('')}</div>`
      : `<div class="list"><div class="list-empty">No ingredients yet.</div></div>`;
    const sv = st.servings;
    const t = recipeTotals(st.lines, sv > 0 ? sv : 0);
    root.querySelector('[data-role="rb-per"]').innerHTML = sv > 0 ? previewHtml(t.perServing) : '<div class="warn-text">Servings must be above zero.</div>';
    root.querySelector('[data-role="rb-totals"]').textContent =
      `Whole recipe: ${fmtKcal(t.totals.kcal)} kcal.` +
      (t.incomplete.length ? ` Unknown for at least one ingredient: ${t.incomplete.map(k => NUT_LABEL[k].toLowerCase()).join(', ')}, so those stay unknown for the recipe.` : '');
  }

  function pickIngredient(i) {
    const existingLine = i == null ? null : st.lines[i];
    const onIngredient = (line) => {
      if (i == null) st.lines.push(line); else st.lines[i] = line;
      paint();
    };
    if (existingLine) {
      openEntrySheet({ mode: 'ingredient', food: resolveFood(existingLine.foodId), line: existingLine, onIngredient });
      return;
    }
    openSheet({
      title: 'Add ingredient',
      tall: true,
      render(body, c) {
        const s = mountSearch(body, {
          includeRecipes: false,
          placeholder: 'Search foods for this recipe',
          onPick: async (food) => {
            const { food: full, warning } = await ensureDetail(food);
            c.close();
            if (full.source === 'fdc') cacheFood(full);
            openEntrySheet({ mode: 'ingredient', food: full, warning, onIngredient });
          },
        });
        setTimeout(() => s.input.focus(), 50);
        c.setActions([{ label: 'Cancel', cls: 'btn-secondary', onClick: () => c.close() }]);
      },
    });
  }

  function save() {
    const name = (st.name || '').trim();
    if (!name) { showToast('Give the recipe a name', { error: true }); return; }
    if (!(st.servings > 0)) { showToast('Servings must be above zero', { error: true }); return; }
    if (!st.lines.length) { showToast('Add at least one ingredient', { error: true }); return; }
    const t = nowIso();
    const { totals, perServing } = recipeTotals(st.lines, st.servings);
    const rec = {
      id: st.id || uid(),
      name,
      servings: st.servings,
      cookedWeightG: null,
      sourceRef: 'manual',
      lines: st.lines.map(l => ({ raw: l.raw || l.name, foodId: l.foodId, source: l.source, name: l.name, qty: l.qty, servingLabel: l.servingLabel, grams: l.grams, basis: l.basis, nutrients: l.nutrients, zeroed: l.zeroed || [], confidence: l.confidence || 'exact' })),
      totals,
      perServing,
      per100gCooked: null,
      createdAt: st.createdAt || t,
      updatedAt: t,
    };
    const prev = recipes.find(r => r.id === rec.id);
    const next = prev ? recipes.map(r => (r.id === rec.id ? rec : r)) : recipes.concat(rec);
    if (!commitRecipes(next)) return;
    ctl.close();
    showToast('Recipe saved');
    if (currentView === 'foods') renderFoods();
  }
  return ctl;
}
draftRestorers.recipe = (d) => openRecipeBuilder(null, d);

function duplicateRecipe(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  const t = nowIso();
  const copy = Object.assign(JSON.parse(JSON.stringify(r)), { id: uid(), name: r.name + ' (copy)', createdAt: t, updatedAt: t });
  if (commitRecipes(recipes.concat(copy))) { showToast('Duplicated'); renderFoods(); }
}

function askDeleteRecipe(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  confirmSheet({
    title: 'Delete this recipe?',
    body: `${r.name}, ${r.lines.length} ingredients. Entries already logged keep their numbers.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => { if (commitRecipes(recipes.filter(x => x.id !== id))) { showToast('Deleted'); renderFoods(); } },
  });
}

/* ======================================================================
   Copying meals
   ====================================================================== */
function copyEntries(list, date, meal) {
  const t = nowIso();
  const copies = list.filter(e => !e.deletedAt).map(e => Object.assign({}, JSON.parse(JSON.stringify(e)), {
    id: uid(), date, meal, time: nowHHMM(), createdAt: t, updatedAt: t, deletedAt: null, syncedAt: null,
  }));
  return addEntries(copies) ? copies.length : 0;
}

function openCopyMeal(fromDate, fromMeal) {
  const list = entriesFor(fromDate).filter(e => e.meal === fromMeal);
  if (!list.length) return;
  const kcal = sumDayStyle(list).totals.kcal;
  openSheet({
    title: `Copy ${MEAL_LABEL[fromMeal].toLowerCase()}`,
    sub: `${list.length} item${list.length === 1 ? '' : 's'}, ${fmtKcal(kcal)} kcal, from ${fmtShortDate(fromDate)}`,
    render(body, c) {
      body.innerHTML = `<div class="grid2">
        <div class="field"><label>To date</label><input type="date" data-role="cp-date" value="${todayStr()}"></div>
        <div class="field"><label>Meal</label><select data-role="cp-meal">${MEALS.map(m => `<option value="${m}"${m === fromMeal ? ' selected' : ''}>${MEAL_LABEL[m]}</option>`).join('')}</select></div></div>`;
      c.setActions([
        { label: 'Cancel', cls: 'btn-secondary', onClick: () => c.close() },
        { label: 'Copy', cls: 'btn-primary', role: 'cp-ok', onClick: () => {
          const d = body.querySelector('[data-role="cp-date"]').value;
          const m = body.querySelector('[data-role="cp-meal"]').value;
          if (!isValidDateKey(d)) { showToast('Pick a date', { error: true }); return; }
          const n = copyEntries(list, d, m);
          if (!n) return;
          c.close();
          showToast(`Copied ${n} item${n === 1 ? '' : 's'} to ${MEAL_LABEL[m].toLowerCase()}, ${fmtShortDate(d)}`);
          renderToday();
        } },
      ]);
    },
  });
}

function askCopyYesterday(meal) {
  const from = addDaysKey(viewDate, -1);
  const list = entriesFor(from).filter(e => e.meal === meal);
  const kcal = sumDayStyle(list).totals.kcal;
  confirmSheet({
    title: `Copy yesterday's ${MEAL_LABEL[meal].toLowerCase()}?`,
    body: `${list.length} item${list.length === 1 ? '' : 's'}, ${fmtKcal(kcal)} kcal, into ${MEAL_LABEL[meal].toLowerCase()} on ${fmtShortDate(viewDate)}.`,
    confirmLabel: 'Copy',
    onConfirm: () => {
      const n = copyEntries(list, viewDate, meal);
      if (n) { showToast(`Copied ${n} item${n === 1 ? '' : 's'}`); renderAddLists(); renderToday(); }
    },
  });
}

/* ======================================================================
   Today
   ====================================================================== */
const todayRoot = document.getElementById('todayRoot');

function targetsFor(date) {
  const mode = modeFor(date);
  const t = settings.targets[mode] || {};
  return { mode, kcal: calorieFor(date), protein: t.protein, fat: t.fat, fiber: t.fiber, satFat: t.satFat };
}

/* Calorie status by mode (spec section 9):
   Lose: a ceiling, flagged the moment it is exceeded; under is normal.
   Maintain: a band, flagged outside it once the day is complete.
   Gain: a floor to eat up to, flagged under it once the day is complete. */
function calorieStatus(total, target, mode, complete) {
  if (target == null) {
    return { flag: false, note: mode === 'gain' ? 'Set a calorie target (Settings).' : 'No calorie target set.', remaining: null };
  }
  if (mode === 'lose') {
    const left = target - total;
    return left < 0
      ? { flag: true, note: `Over the ceiling by ${fmtKcal(-left)} kcal.`, remaining: `Over the ceiling by ${fmtKcal(-left)} kcal.` }
      : { flag: false, note: `${fmtKcal(left)} kcal under the ceiling.`, remaining: `${fmtKcal(left)} kcal left` };
  }
  if (mode === 'maintain') {
    const p = (settings.maintainBandPct == null ? 10 : settings.maintainBandPct) / 100;
    const lo = target * (1 - p), hi = target * (1 + p);
    const outside = total < lo || total > hi;
    const band = `Band ${fmtKcal(lo)}–${fmtKcal(hi)} kcal.`;
    if (complete && outside) return { flag: true, note: (total < lo ? `Under the band by ${fmtKcal(lo - total)} kcal. ` : `Over the band by ${fmtKcal(total - hi)} kcal. `) + band, remaining: band };
    return { flag: false, note: band, remaining: total < lo ? `${fmtKcal(lo - total)} kcal to the band` : total > hi ? `Over the band by ${fmtKcal(total - hi)} kcal.` : 'In the band' };
  }
  const left = target - total;
  if (left > 0) return { flag: complete, note: complete ? `${fmtKcal(left)} kcal under target.` : `${fmtKcal(left)} kcal left to eat.`, remaining: `${fmtKcal(left)} kcal left to eat` };
  return { flag: false, note: 'Target reached.', remaining: 'Calorie target reached' };
}

function barHtml({ name, total, target, unit, flag, met, note, role }) {
  const pct = target ? Math.min(100, Math.max(0, (total / target) * 100)) : 0;
  const val = target != null
    ? `<strong>${unit === 'kcal' ? fmtKcal(total) : fmtG(total)}</strong> / ${unit === 'kcal' ? fmtKcal(target) : fmtG(target)} ${unit}`
    : `<strong>${unit === 'kcal' ? fmtKcal(total) : fmtG(total)}</strong> ${unit}`;
  return `<div class="bar-row${flag ? ' flag' : met ? ' met' : ''}" data-role="${role}">
    <div class="bar-head"><span class="bar-name">${name}</span><span class="bar-val num">${val}</span></div>
    ${target != null ? `<div class="bar"><div style="width:${pct}%"></div></div>` : ''}
    ${note ? `<div class="bar-note">${escapeHtml(note)}</div>` : ''}
  </div>`;
}

function unmarkedDays() {
  const today = todayStr();
  const firstUse = settings.installedOn || today;
  const out = [];
  for (let i = 7; i >= 1; i--) {
    const d = addDaysKey(today, -i);
    if (d < firstUse) continue;
    if (!isComplete(d)) out.push(d);
  }
  return out;
}

function renderToday() {
  if (!todayRoot) return;
  const date = viewDate;
  const list = entriesFor(date);
  const { totals, incomplete } = sumDayStyle(list);
  const complete = isComplete(date);
  const t = targetsFor(date);
  const cal = calorieStatus(totals.kcal, t.kcal, t.mode, complete);

  const minNote = (total, target) => {
    if (target == null) return { note: '', flag: false, met: false };
    const left = target - total;
    if (left <= 0) return { note: 'Minimum met.', flag: false, met: true };
    return { note: complete ? `${fmtG(left)} g short.` : `${fmtG(left)} g left.`, flag: complete, met: false };
  };
  const p = minNote(totals.protein, t.protein);
  const fb = minNote(totals.fiber, t.fiber);
  const fatOver = t.fat != null && totals.fat > t.fat * 1.1;
  const satOver = t.satFat != null && totals.satFat > t.satFat;

  let html = '';
  const unmarked = unmarkedDays();
  if (unmarked.length) {
    html += `<div class="notice" data-role="unmarked-banner"><strong>Not marked complete:</strong>${unmarked.map(d => `
      <div class="notice-row"><span>${escapeHtml(fmtShortDate(d))} · ${fmtKcal(sumDayStyle(entriesFor(d)).totals.kcal)} kcal</span>
      <button class="btn btn-secondary btn-sm" data-action="mark-day" data-date="${d}">Mark complete</button></div>`).join('')}</div>`;
  }

  html += `<div class="date-row">
    <input type="date" data-role="view-date" value="${date}">
    ${date !== todayStr() ? '<button class="btn btn-secondary btn-sm" data-action="go-today">Today</button>' : ''}
  </div>`;

  const remainParts = [];
  if (cal.remaining) remainParts.push(cal.remaining);
  if (t.protein != null && totals.protein < t.protein) remainParts.push(`protein ${fmtG(t.protein - totals.protein)} g`);
  if (t.fiber != null && totals.fiber < t.fiber) remainParts.push(`fiber ${fmtG(t.fiber - totals.fiber)} g`);
  html += `<div class="remaining${cal.flag && t.mode === 'lose' ? ' flag' : ''}" data-role="remaining">${escapeHtml(remainParts.join(' · ') || 'Nothing left to hit.')}</div>`;

  html += `<div class="card" data-role="targets">
    ${barHtml({ name: 'Calories', total: totals.kcal, target: t.kcal, unit: 'kcal', flag: cal.flag, met: false, note: cal.note, role: 'bar-kcal' })}
    ${barHtml({ name: 'Protein', total: totals.protein, target: t.protein, unit: 'g', flag: p.flag, met: p.met, note: p.note, role: 'bar-protein' })}
    ${barHtml({ name: 'Fiber', total: totals.fiber, target: t.fiber, unit: 'g', flag: fb.flag, met: fb.met, note: fb.note, role: 'bar-fiber' })}
    ${barHtml({ name: 'Fat', total: totals.fat, target: t.fat, unit: 'g', flag: fatOver, met: false, note: fatOver ? `More than 10% over (${fmtG(totals.fat - t.fat)} g over).` : '', role: 'bar-fat' })}
    ${barHtml({ name: 'Sat fat', total: totals.satFat, target: t.satFat, unit: 'g', flag: satOver, met: false, note: satOver ? `Over the maximum by ${fmtG(totals.satFat - t.satFat)} g.` : t.satFat == null ? 'No maximum set.' : '', role: 'bar-satfat' })}
    <div class="info-line" data-role="carbs-line">${escapeHtml(carbsLine(totals.carbs, t))}</div>
    ${incomplete ? `<div class="info-line" data-role="day-incomplete"><span class="tag warn">incomplete</span> ${incomplete} entr${incomplete === 1 ? 'y is' : 'ies are'} missing at least one value. Totals leave the unknowns out.</div>` : ''}
  </div>`;

  MEALS.forEach(m => {
    const ml = list.filter(e => e.meal === m);
    const mk = sumDayStyle(ml).totals.kcal;
    html += `<div class="meal" data-meal="${m}">
      <div class="meal-head"><span class="meal-name">${MEAL_LABEL[m]}</span><span class="meal-kcal num">${ml.length ? fmtKcal(mk) + ' kcal' : ''}</span>
      ${ml.length ? `<button class="btn btn-ghost btn-sm" data-action="copy-meal" data-meal="${m}">Copy to…</button>` : ''}</div>
      <div class="list">${ml.length ? ml.map(entryRowHtml).join('') : `<button class="item" data-action="add-to-meal" data-meal="${m}"><div class="item-main"><div class="item-sub">Nothing logged. Tap to add.</div></div></button>`}</div>
    </div>`;
  });

  html += `<button class="btn btn-block complete-btn ${complete ? 'done' : 'btn-secondary'}" data-action="toggle-complete" data-role="complete-btn">${complete ? 'Day marked complete. Tap to undo.' : 'Mark day complete'}</button>`;
  html += `<div class="footnote">Not medical advice.</div>`;
  todayRoot.innerHTML = html;
  renderHeader();
}

function carbsLine(carbs, t) {
  if (t.kcal != null && t.protein != null && t.fat != null) {
    const implied = (t.kcal - t.protein * 4 - t.fat * 9) / 4;
    if (implied > 0) return `Carbs ${fmtG(carbs)} g. No target; at these targets the remainder is about ${Math.round(implied)} g.`;
  }
  return `Carbs ${fmtG(carbs)} g. No target.`;
}

function entryRowHtml(e) {
  const miss = nullsIn(e.nutrients);
  const tags = (miss.length ? '<span class="tag warn">incomplete</span>' : '') + (e.confidence === 'estimated' ? '<span class="tag est">estimated</span>' : '');
  const qty = e.source === 'quick' ? (e.note || 'quick add') : fmtServing(e.qty, e.servingLabel);
  return `<div class="item" data-role="entry" data-id="${escapeHtml(e.id)}">
    <button class="item-main" style="background:none;border:none;color:inherit;text-align:left;font-family:inherit;padding:0;min-height:44px;" data-action="edit-entry" data-id="${escapeHtml(e.id)}">
      <div class="item-name">${escapeHtml(e.name)}</div>
      <div class="item-sub">${tags}${escapeHtml(qty)}${e.brand ? ' · ' + escapeHtml(e.brand) : ''}</div>
    </button>
    <div class="item-right num">${fmtKcal(e.nutrients.kcal)}<div class="item-sub">${fmtG(e.nutrients.protein)} g P</div></div>
    <button class="icon-btn del" data-action="delete-entry" data-id="${escapeHtml(e.id)}" aria-label="Delete">×</button>
  </div>`;
}

if (todayRoot) {
  todayRoot.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'edit-entry') {
      const e = entries.find(x => x.id === a.dataset.id);
      if (e && e.source === 'quick') { openEditQuick(e); return; }
      if (e) openEntrySheet({ mode: 'edit', entry: e, food: resolveFood(e.foodId) });
    } else if (act === 'delete-entry') {
      const e = entries.find(x => x.id === a.dataset.id);
      if (e) askDeleteEntry(e);
    } else if (act === 'copy-meal') {
      openCopyMeal(viewDate, a.dataset.meal);
    } else if (act === 'add-to-meal') {
      setView('add');
      preferredMeal = a.dataset.meal;
    } else if (act === 'toggle-complete') {
      setComplete(viewDate, !isComplete(viewDate));
    } else if (act === 'mark-day') {
      if (setComplete(a.dataset.date, true)) showToast(`${fmtShortDate(a.dataset.date)} marked complete`);
    } else if (act === 'go-today') {
      viewDate = todayStr(); followToday = true; renderToday();
    }
  });
  todayRoot.addEventListener('change', (ev) => {
    if (ev.target.dataset.role === 'view-date' && isValidDateKey(ev.target.value)) {
      viewDate = ev.target.value;
      followToday = viewDate === todayStr();
      renderToday();
    }
  });
}

/* A quick-add entry has no food behind it, so it edits as numbers. */
function openEditQuick(entry) {
  let dirty = false;
  openSheet({
    title: entry.name,
    sub: 'Quick add (estimated)',
    editor: true,
    isDirty: () => dirty,
    render(body, c) {
      body.innerHTML = `${nutrientInputsHtml(entry.nutrients, { perLabel: 'Totals for what you ate.' })}
        <div class="field" style="margin-top:8px;"><label>Meal</label><select data-role="qe-meal">${MEALS.map(m => `<option value="${m}"${m === entry.meal ? ' selected' : ''}>${MEAL_LABEL[m]}</option>`).join('')}</select></div>
        <div class="field"><label>Note</label><input type="text" data-role="qe-note" value="${escapeHtml(entry.note || '')}"></div>`;
      body.addEventListener('input', () => { dirty = true; });
      body.addEventListener('change', () => { dirty = true; });
      c.setActions([
        { label: 'Cancel', cls: 'btn-secondary', onClick: () => c.requestClose() },
        { label: 'Delete', cls: 'btn-danger', onClick: () => askDeleteEntry(entry, () => c.close()) },
        { label: 'Save', cls: 'btn-primary', role: 'qe-save', onClick: () => {
          const n = readNutrientInputs(body);
          if (n.kcal == null) { showToast('Calories are required', { error: true }); return; }
          if (badNutrients(n).length) { showToast('Values cannot be negative', { error: true }); return; }
          const changes = { nutrients: n, basis: { label: 'entry', grams: null, per: n }, meal: body.querySelector('[data-role="qe-meal"]').value, note: body.querySelector('[data-role="qe-note"]').value.trim() };
          if (!updateEntry(entry.id, changes)) return;
          c.close();
          showToast('Saved');
          renderToday();
        } },
      ]);
    },
  });
}

/* Mode chip: switching asks first, applies from today forward, and never
   reinterprets a past day. */
function askSwitchMode() {
  openSheet({
    title: 'Mode',
    sub: `Now: ${MODE_LABEL[settings.mode]}`,
    render(body, c) {
      body.innerHTML = `<div class="seg" data-role="mode-seg">${MODES.map(m => `<button data-mode="${m}" class="${m === settings.mode ? 'on' : ''}">${MODE_LABEL[m]}</button>`).join('')}</div>
        <div class="hint">Lose: calories are a ceiling. Maintain: a band of ±${escapeHtml(String(settings.maintainBandPct))}%. Gain: a target to eat up to. Applies from today; past days keep their mode.</div>`;
      body.querySelector('[data-role="mode-seg"]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b || b.dataset.mode === settings.mode) return;
        c.close();
        confirmSwitchMode(b.dataset.mode);
      });
      c.setActions([{ label: 'Close', cls: 'btn-secondary', onClick: () => c.close() }]);
    },
  });
}

function confirmSwitchMode(mode) {
  const t = settings.targets[mode];
  confirmSheet({
    title: `Switch to ${MODE_LABEL[mode]}?`,
    body: `From today, calories are ${mode === 'lose' ? 'a ceiling' : mode === 'maintain' ? 'a target band' : 'a target to eat up to'}${t.kcal == null ? ' (no calorie target set for this mode yet)' : ` of ${fmtKcal(t.kcal)} kcal`}. Past days keep the mode they were logged under.`,
    confirmLabel: 'Switch',
    onConfirm: () => switchMode(mode),
  });
}

function switchMode(mode) {
  const next = Object.assign({}, settings, { mode, updatedAt: nowIso() });
  if (!commitSettings(next)) return false;
  const today = todayStr();
  const prev = dayState[today] || { complete: false };
  commitDayState(Object.assign({}, dayState, {
    [today]: Object.assign({}, prev, { mode, calorieSetting: settings.targets[mode].kcal, updatedAt: nowIso(), syncedAt: prev.syncedAt || null }),
  }));
  const empty = TARGET_KEYS.every(k => settings.targets[mode][k] == null);
  showToast(`Mode: ${MODE_LABEL[mode]}`);
  renderToday();
  renderHeader();
  if (currentView === 'settings') renderSettings();
  if (empty) setTimeout(() => { setView('settings'); showToast(`Set your ${MODE_LABEL[mode]} targets`); }, 50);
  return true;
}

modeChip.addEventListener('click', askSwitchMode);

/* ======================================================================
   Add tab
   ====================================================================== */
const addRoot = document.getElementById('addRoot');
let addSearch = null;

function renderAdd() {
  if (!addRoot) return;
  if (!addSearch) {
    addRoot.innerHTML = `
      <div class="notice" data-role="add-date" hidden></div>
      <div data-role="add-search"></div>
      <div data-role="add-lists"></div>`;
    addSearch = mountSearch(addRoot.querySelector('[data-role="add-search"]'), { includeRecipes: true, onPick: pickFoodToLog });
    addSearch.onEmpty = (empty) => { addRoot.querySelector('[data-role="add-lists"]').hidden = !empty; };
    addRoot.querySelector('[data-role="add-lists"]').addEventListener('click', onAddListClick);
  }
  const dateNote = addRoot.querySelector('[data-role="add-date"]');
  dateNote.hidden = viewDate === todayStr();
  dateNote.textContent = `Adding to ${fmtLongDate(viewDate)}, not today.`;
  renderAddLists();
}

function renderAddLists() {
  if (!addRoot) return;
  const el = addRoot.querySelector('[data-role="add-lists"]');
  if (!el) return;
  let html = `<div class="action-row">
    <button class="btn btn-secondary" data-action="quick-add">Quick add</button>
    <button class="btn btn-secondary" data-action="new-recipe">New recipe</button>
    <button class="btn btn-secondary" data-action="new-custom">Custom food</button>
  </div>`;

  const y = addDaysKey(viewDate, -1);
  const yList = entriesFor(y);
  const tList = entriesFor(viewDate);
  const copyable = MEALS.filter(m => yList.some(e => e.meal === m) && !tList.some(e => e.meal === m));
  if (copyable.length) {
    html += `<div class="chip-row">${copyable.map(m => {
      const ml = yList.filter(e => e.meal === m);
      return `<button class="btn btn-secondary btn-block" data-action="copy-yesterday" data-meal="${m}">Copy yesterday's ${MEAL_LABEL[m].toLowerCase()} (${ml.length} item${ml.length === 1 ? '' : 's'}, ${fmtKcal(sumDayStyle(ml).totals.kcal)} kcal)</button>`;
    }).join('')}</div>`;
  }

  const ranked = rankedRecents().map(r => ({ r, food: resolveFood(r.foodId) })).filter(x => x.food).slice(0, 25);
  html += `<div class="group-title">Recent and frequent</div>`;
  html += ranked.length
    ? `<div class="list">${ranked.map(({ r, food }) => `<div class="item">
        <button class="item-main" style="background:none;border:none;color:inherit;text-align:left;font-family:inherit;padding:0;min-height:44px;" data-action="open-recent" data-food="${escapeHtml(food.id)}">
          <div class="item-name">${escapeHtml(food.name)}</div>
          <div class="item-sub">${escapeHtml(fmtServing(r.qty, r.servingLabel))} · ${MEAL_LABEL[r.meal] || ''}${food.brand ? ' · ' + escapeHtml(food.brand) : ''}</div>
        </button>
        <button class="icon-btn add" data-action="relog" data-food="${escapeHtml(food.id)}" aria-label="Log again">+</button></div>`).join('')}</div>`
    : `<div class="list"><div class="list-empty">Foods you log show up here for one-tap re-logging.</div></div>`;
  el.innerHTML = html;
}

function onAddListClick(ev) {
  const a = ev.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'quick-add') openQuickAdd();
  else if (act === 'new-recipe') openRecipeBuilder();
  else if (act === 'new-custom') openCustomFood();
  else if (act === 'copy-yesterday') askCopyYesterday(a.dataset.meal);
  else if (act === 'open-recent') {
    const food = resolveFood(a.dataset.food);
    if (food) openEntrySheet({ mode: 'new', food, date: viewDate });
  } else if (act === 'relog') relog(a.dataset.food);
}

/* One tap: the last-used serving, quantity and meal. */
function relog(foodId) {
  const r = recents.find(x => x.foodId === foodId);
  const food = resolveFood(foodId);
  if (!r || !food) return false;
  const s = servingOptions(food).find(o => o.label === r.servingLabel);
  if (!s) { openEntrySheet({ mode: 'new', food, date: viewDate }); return false; }
  const e = buildEntry({ food, serving: s, qty: r.qty, meal: r.meal, date: viewDate });
  if (!addEntries([e])) return false;
  touchRecent(food, s.label, r.qty, r.meal);
  if (food.source === 'fdc') cacheFood(food);
  showToast(`Logged ${food.name}: ${fmtKcal(e.nutrients.kcal)} kcal, ${MEAL_LABEL[r.meal].toLowerCase()}`);
  renderAddLists();
  renderToday();
  return true;
}

/* ======================================================================
   Foods tab
   ====================================================================== */
const foodsRoot = document.getElementById('foodsRoot');

function renderFoods() {
  if (!foodsRoot) return;
  const cf = customFoods.slice().sort((a, b) => a.name.localeCompare(b.name));
  const rc = recipes.slice().sort((a, b) => a.name.localeCompare(b.name));
  let html = `<div class="group-title" style="margin-top:0;">Recipes</div>`;
  html += rc.length ? `<div class="list">${rc.map(r => `<div class="item">
      <button class="item-main" style="background:none;border:none;color:inherit;text-align:left;font-family:inherit;padding:0;min-height:44px;" data-action="edit-recipe" data-id="${escapeHtml(r.id)}">
        <div class="item-name">${escapeHtml(r.name)}${nullsIn(r.perServing).length ? '<span class="tag warn">incomplete</span>' : ''}</div>
        <div class="item-sub">${r.lines.length} ingredients · ${fmtQty(r.servings)} servings · ${fmtKcal(r.perServing.kcal)} kcal / serving</div>
      </button>
      <button class="btn btn-ghost btn-sm" data-action="dup-recipe" data-id="${escapeHtml(r.id)}">Duplicate</button>
      <button class="icon-btn del" data-action="del-recipe" data-id="${escapeHtml(r.id)}" aria-label="Delete">×</button></div>`).join('')}</div>`
    : `<div class="list"><div class="list-empty">No recipes yet.</div></div>`;
  html += `<button class="btn btn-secondary btn-block" data-action="new-recipe" style="margin-top:8px;">+ New recipe</button>`;

  html += `<div class="group-title">Custom foods</div>`;
  html += cf.length ? `<div class="list">${cf.map(c => `<div class="item">
      <button class="item-main" style="background:none;border:none;color:inherit;text-align:left;font-family:inherit;padding:0;min-height:44px;" data-action="edit-custom" data-id="${escapeHtml(c.id)}">
        <div class="item-name">${escapeHtml(c.name)}</div>
        <div class="item-sub">${c.brand ? escapeHtml(c.brand) + ' · ' : ''}${fmtKcal(c.per.kcal)} kcal / ${escapeHtml(c.servingLabel)}</div>
      </button>
      <button class="icon-btn del" data-action="del-custom" data-id="${escapeHtml(c.id)}" aria-label="Delete">×</button></div>`).join('')}</div>`
    : `<div class="list"><div class="list-empty">No custom foods yet.</div></div>`;
  html += `<button class="btn btn-secondary btn-block" data-action="new-custom" style="margin-top:8px;">+ New custom food</button>`;

  const rr = rankedRecents().slice(0, 30);
  html += `<div class="group-title">Recent</div>`;
  html += rr.length ? `<div class="list">${rr.map(r => `<div class="item"><div class="item-main"><div class="item-name">${escapeHtml(r.name)}</div><div class="item-sub">${escapeHtml(fmtServing(r.qty, r.servingLabel))}${r.brand ? ' · ' + escapeHtml(r.brand) : ''}</div></div></div>`).join('')}</div>`
    : `<div class="list"><div class="list-empty">Nothing logged yet.</div></div>`;
  foodsRoot.innerHTML = html;
}

if (foodsRoot) {
  foodsRoot.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-action]');
    if (!a) return;
    const id = a.dataset.id;
    const act = a.dataset.action;
    if (act === 'new-recipe') openRecipeBuilder();
    else if (act === 'edit-recipe') { const r = recipes.find(x => x.id === id); if (r) openRecipeBuilder(r); }
    else if (act === 'dup-recipe') duplicateRecipe(id);
    else if (act === 'del-recipe') askDeleteRecipe(id);
    else if (act === 'new-custom') openCustomFood();
    else if (act === 'edit-custom') { const c = customFoods.find(x => x.id === id); if (c) openCustomFood(c); }
    else if (act === 'del-custom') askDeleteCustom(id);
  });
}

/* ======================================================================
   Settings: mode, targets
   ====================================================================== */
const settingsTop = document.getElementById('settingsTop');

function renderSettings() {
  if (!settingsTop) return;
  const m = settings.mode;
  const t = settings.targets[m];
  const field = (k, label) => `<div class="field"><label>${label}</label><input type="text" inputmode="decimal" data-target="${k}" value="${t[k] == null ? '' : escapeHtml(fmtQty(t[k]))}" placeholder="blank = none"></div>`;
  settingsTop.innerHTML = `
    <div class="card">
      <div class="card-title">Mode</div>
      <div class="seg" data-role="settings-mode">${MODES.map(x => `<button data-mode="${x}" class="${x === m ? 'on' : ''}">${MODE_LABEL[x]}</button>`).join('')}</div>
      <div class="hint">Switching applies from today. Past days keep the mode they were logged under.</div>
    </div>
    <div class="card" data-role="targets-card">
      <div class="card-title">${MODE_LABEL[m]} targets</div>
      <div class="grid2">
        ${field('kcal', m === 'lose' ? 'Calorie ceiling' : m === 'maintain' ? 'Calorie target' : 'Calories to eat up to')}
        ${field('protein', 'Protein minimum (g)')}
        ${field('fiber', 'Fiber minimum (g)')}
        ${field('fat', 'Total fat target (g)')}
        ${field('satFat', 'Sat fat maximum (g)')}
        ${m === 'maintain' ? `<div class="field"><label>Band (± %)</label><input type="text" inputmode="decimal" data-role="band" value="${escapeHtml(String(settings.maintainBandPct))}"></div>` : ''}
      </div>
      <div class="hint">These are the numbers you set. The app does not set clinical targets. Blank means no target for that line.</div>
      <button class="btn btn-primary btn-block" data-role="targets-save" style="margin-top:10px;">Save targets</button>
    </div>`;
}

if (settingsTop) {
  settingsTop.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (b && b.dataset.mode !== settings.mode) { confirmSwitchMode(b.dataset.mode); return; }
    if (ev.target.closest('[data-role="targets-save"]')) saveTargets();
  });
}

function saveTargets() {
  const m = settings.mode;
  const t = {};
  let bad = false;
  settingsTop.querySelectorAll('[data-target]').forEach(inp => {
    const v = parseNum(inp.value);
    if (v != null && v <= 0) bad = true;
    t[inp.dataset.target] = v;
  });
  const bandEl = settingsTop.querySelector('[data-role="band"]');
  const band = bandEl ? parseNum(bandEl.value) : settings.maintainBandPct;
  if (bad || (bandEl && (band == null || band <= 0 || band >= 50))) { showToast('Targets must be above zero (band under 50%)', { error: true }); return; }
  const next = Object.assign({}, settings, {
    targets: Object.assign({}, settings.targets, { [m]: Object.assign({}, settings.targets[m], t) }),
    maintainBandPct: band,
    updatedAt: nowIso(),
  });
  if (!commitSettings(next)) return;
  // From today forward: today's stamped calorie setting follows the new value.
  const today = todayStr();
  if (dayState[today] && dayState[today].mode === m) {
    commitDayState(Object.assign({}, dayState, { [today]: Object.assign({}, dayState[today], { calorieSetting: t.kcal, updatedAt: nowIso() }) }));
  }
  showToast('Targets saved');
  renderToday();
}

/* ======================================================================
   Backup and export
   JSON backup with a merge-by-ID restore that never deletes: on an ID in
   both, the newer updatedAt wins; tombstones are permanent, so an older
   backup can never bring back a deleted entry.
   ====================================================================== */
const backupRoot = document.getElementById('backupRoot');

function renderBackupCard() {
  if (!backupRoot) return;
  backupRoot.innerHTML = `<div class="card">
    <div class="card-title">Backup and export</div>
    <div class="row">
      <button class="btn btn-secondary btn-sm" data-action="export-json">Backup (JSON)</button>
      <button class="btn btn-secondary btn-sm" data-action="import-json">Restore</button>
    </div>
    <div class="row" style="margin-top:8px;">
      <button class="btn btn-secondary btn-sm" data-action="export-entries">Entries CSV</button>
      <button class="btn btn-secondary btn-sm" data-action="export-days">Daily CSV</button>
    </div>
    <div class="hint">The sheet is a second copy of your entries, not a backup of recipes or custom foods. Back up here.</div>
  </div>`;
}

function buildBackup() {
  return {
    app: 'nutrition-app',
    version: 1,
    exportedAt: nowIso(),
    entries,
    customFoods,
    recipes,
    recents,
    dayState,
    settings,
    zeroed,
  };
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvNum(v) {
  return v == null ? '' : String(round(v, 2));
}

function entriesCsv() {
  const head = ['Date', 'Time', 'Meal', 'Food', 'Brand', 'Qty', 'Serving', 'Grams', 'Calories', 'Protein', 'Carbs', 'Fat', 'Sat Fat', 'Fiber', 'Source', 'Confidence', 'Note'];
  const rows = liveEntries().slice().sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
    .map(e => [e.date, e.time, MEAL_LABEL[e.meal], e.name, e.brand, csvNum(e.qty), e.servingLabel, csvNum(e.grams),
      csvNum(e.nutrients.kcal), csvNum(e.nutrients.protein), csvNum(e.nutrients.carbs), csvNum(e.nutrients.fat), csvNum(e.nutrients.satFat), csvNum(e.nutrients.fiber),
      e.source, e.confidence, e.note]);
  return [head].concat(rows).map(r => r.map(csvEscape).join(',')).join('\r\n');
}

function daysCsv() {
  const head = ['Date', 'Calories', 'Protein', 'Carbs', 'Fat', 'Sat Fat', 'Fiber', 'Entries', 'Incomplete', 'Complete', 'Mode', 'Calorie Setting'];
  const dates = new Set(liveEntries().map(e => e.date));
  Object.keys(dayState).forEach(d => dates.add(d));
  const rows = [...dates].sort().map(d => {
    const list = entriesFor(d);
    const { totals, incomplete } = sumDayStyle(list);
    const ds = dayState[d] || {};
    return [d, csvNum(totals.kcal), csvNum(totals.protein), csvNum(totals.carbs), csvNum(totals.fat), csvNum(totals.satFat), csvNum(totals.fiber),
      list.length, incomplete, ds.complete ? 'TRUE' : 'FALSE', MODE_LABEL[ds.mode || settings.mode], ds.calorieSetting == null ? '' : ds.calorieSetting];
  });
  return [head].concat(rows).map(r => r.map(csvEscape).join(',')).join('\r\n');
}

/* Merges records keyed by `idOf`: adds unknown ones, replaces a local one
   only with a strictly newer updatedAt, never removes anything. */
function mergeById(local, incoming, idOf, counts) {
  const map = new Map(local.map(x => [idOf(x), x]));
  (incoming || []).forEach(x => {
    if (!x || typeof x !== 'object' || !idOf(x)) { counts.skipped++; return; }
    const cur = map.get(idOf(x));
    if (!cur) { map.set(idOf(x), x); counts.added++; return; }
    const newer = (x.updatedAt || '') > (cur.updatedAt || '');
    if (newer) { map.set(idOf(x), x); counts.replaced++; }
    else if (cur.deletedAt && !x.deletedAt) counts.keptDeleted++;
    else counts.keptLocal++;
  });
  return [...map.values()];
}

function planRestore(data) {
  if (!data || data.app !== 'nutrition-app' || !Array.isArray(data.entries)) throw new Error('not a Nutrition App backup');
  const counts = { added: 0, replaced: 0, keptLocal: 0, keptDeleted: 0, skipped: 0 };
  const validEntry = (e) => e && e.id && isValidDateKey(e.date) && e.nutrients && MEALS.includes(e.meal);
  const inEntries = data.entries.filter(e => { if (validEntry(e)) return true; counts.skipped++; return false; });
  const next = {
    entries: mergeById(entries, inEntries, x => x.id, counts),
    customFoods: mergeById(customFoods, data.customFoods, x => x.id, { added: 0, replaced: 0, keptLocal: 0, keptDeleted: 0, skipped: 0 }),
    recipes: mergeById(recipes, data.recipes, x => x.id, { added: 0, replaced: 0, keptLocal: 0, keptDeleted: 0, skipped: 0 }),
  };
  const ds = Object.assign({}, dayState);
  Object.entries(data.dayState || {}).forEach(([d, v]) => {
    if (!isValidDateKey(d) || !v) return;
    if (!ds[d] || (v.updatedAt || '') > (ds[d].updatedAt || '')) ds[d] = v;
  });
  next.dayState = ds;
  // Choices merge per food and nutrient: a local choice always stands, and
  // the backup only fills in choices this phone has never made.
  const z = JSON.parse(JSON.stringify(zeroed));
  Object.entries((data.zeroed && typeof data.zeroed === 'object') ? data.zeroed : {}).forEach(([id, m]) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    Object.entries(m).forEach(([k, v]) => {
      if (!NUTS.includes(k) || typeof v !== 'boolean') return;
      z[id] = z[id] || {};
      if (!(k in z[id])) z[id][k] = v;
    });
  });
  next.zeroed = z;
  next.recents = recents.length ? recents : (Array.isArray(data.recents) ? data.recents : []);
  next.settings = data.settings && (data.settings.updatedAt || '') > (settings.updatedAt || '')
    ? Object.assign(loadSettingsFrom(data.settings), { installedOn: settings.installedOn }) : settings;
  next.foods = { custom: next.customFoods.length - customFoods.length, recipes: next.recipes.length - recipes.length };
  return { counts, next };
}

function loadSettingsFrom(s) {
  const def = defaultSettings();
  const out = Object.assign({}, def, s);
  out.targets = {};
  MODES.forEach(m => { out.targets[m] = Object.assign({}, def.targets[m], (s.targets && s.targets[m]) || {}); });
  if (!MODES.includes(out.mode)) out.mode = 'lose';
  return out;
}

function applyRestore(next) {
  if (!commitEntries(next.entries)) return false;
  commitCustomFoods(next.customFoods);
  commitRecipes(next.recipes);
  commitDayState(next.dayState);
  commitZeroed(next.zeroed);
  commitRecents(next.recents);
  commitSettings(next.settings);
  // A restore can bring back entries older than the sync window (M3).
  config.needsFullSync = true;
  saveJson(KEYS.config, config);
  return true;
}

function askRestore(data) {
  let plan;
  try { plan = planRestore(data); }
  catch (e) { showToast(`Can't restore: ${e.message}`, { error: true }); return; }
  const c = plan.counts;
  const lines = [
    `Entries: ${c.added} added, ${c.replaced} replaced by a newer copy, ${c.keptLocal} kept as they are here, ${c.keptDeleted} kept deleted.`,
    `Custom foods: ${plan.next.foods.custom} added. Recipes: ${plan.next.foods.recipes} added.`,
  ];
  if (c.skipped) lines.push(`${c.skipped} damaged record${c.skipped === 1 ? '' : 's'} skipped.`);
  lines.push('Nothing on this phone is deleted.');
  confirmSheet({
    title: 'Restore this backup?',
    body: lines.join(' '),
    confirmLabel: 'Restore',
    onConfirm: () => {
      if (!applyRestore(plan.next)) return;
      showToast('Restored');
      renderToday();
      renderFoods();
      renderSettings();
    },
  });
}

if (backupRoot) {
  renderBackupCard();
  backupRoot.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-action]');
    if (!a) return;
    const stamp = todayStr();
    if (a.dataset.action === 'export-json') {
      triggerDownload(`nutrition-backup-${stamp}.json`, JSON.stringify(buildBackup(), null, 1), 'application/json');
      showToast('Backup downloaded');
    } else if (a.dataset.action === 'import-json') {
      document.getElementById('importFileInput').click();
    } else if (a.dataset.action === 'export-entries') {
      triggerDownload(`nutrition-entries-${stamp}.csv`, entriesCsv(), 'text/csv');
    } else if (a.dataset.action === 'export-days') {
      triggerDownload(`nutrition-days-${stamp}.csv`, daysCsv(), 'text/csv');
    }
  });
}

document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { askRestore(JSON.parse(reader.result)); }
    catch (err) { showToast("Couldn't read that file. Is it a Nutrition App backup?", { error: true }); }
    finally { e.target.value = ''; }
  };
  reader.readAsText(file);
});

/* ======================================================================
   Cloud sync settings and the connection test
   ====================================================================== */
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
      at: nowIso(),
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
    saveJson(KEYS.config, config);
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

const fdcKeyInput = document.getElementById('fdcKeyInput');
document.getElementById('fdcKeySaveBtn').addEventListener('click', () => {
  config.fdcKey = fdcKeyInput.value.trim();
  if (!saveJson(KEYS.config, config)) return;
  fdcSessionCache.clear();
  renderFdcKeyStatus();
  showToast(config.fdcKey ? 'USDA key saved' : 'USDA key removed');
});

function renderFdcKeyStatus() {
  const el = document.getElementById('fdcKeyStatus');
  if (el) el.textContent = config.fdcKey
    ? 'Set. Searches go straight to USDA, with the proxy as backup.'
    : 'Not set. Searches go through the proxy.';
}

/* ======================================================================
   Lifecycle
   iOS resumes a frozen home-screen app instead of re-running app.js, so a
   day that rolled over while it slept would still show yesterday.
   ====================================================================== */
window.addEventListener('pageshow', () => {
  if (followToday && viewDate !== todayStr()) {
    viewDate = todayStr();
    renderToday();
    if (currentView === 'add') renderAdd();
  }
  renderHeader();
});

// Backgrounding is when iOS is most likely to kill the page; pagehide covers
// navigation and teardown. Both are deduped, so they only write real changes.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { persistAll(); saveDraft(); }
});
window.addEventListener('pagehide', () => { persistAll(); saveDraft(); });

/* ======================================================================
   Updates
   A new service worker reloads the page straight away, except while an
   editor is open: then it waits behind a banner so edits survive.
   ====================================================================== */
let swUpdatePending = false;
let swReloading = false;
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
  // On a genuine first install there's no controller and controllerchange
  // fires immediately; reloading then would be pointless.
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

/* ======================================================================
   Boot
   ====================================================================== */
syncUrlInput.value = config.url;
syncTokenInput.value = config.token;
fdcKeyInput.value = config.fdcKey;
renderFdcKeyStatus();
renderHeader();
renderToday();
renderSyncStatus();
renderStorage();
restoreDraft();
