// Bulk Buy Analyzer UI, parsing, matching, Gemini handling, and diagnostics.
// Shared shell callbacks are supplied by app.js to preserve orchestration timing.

import { state } from './state.js';
import { WORKER_URL } from './config.js';
import { buildNinjaLookup, getNinjaPrice, getNinjaImage } from './market.js';
import { calcEV } from './scarabEngine.js';

const SCARAB_LIST = state.scarabList;
let mobileScarabName;
let getDivineRate;
let toLocalDateKey;
let showToast;
let getRecommendedEVModeForShare;
let getCurrentLeagueSharePctFromState;
let computeLoopVendorRate;

export function configureBulk(deps) {
  ({ mobileScarabName, getDivineRate, toLocalDateKey, showToast, getRecommendedEVModeForShare, getCurrentLeagueSharePctFromState, computeLoopVendorRate } = deps);
}
// 'image' or 'csv'
const GEMINI_KEY_STORAGE = 'poepool-gemini-api-key';
const GEMINI_RATE_LIMITED_KEYS_STORAGE = 'poepool-gemini-rate-limited-keys';
const GEMINI_MODEL_FLASH = 'gemini-2.5-flash';
const GEMINI_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
// Optional: set a default key for personal/local use ONLY.
// Do not share a copy of this file if you populate this value.
const DEFAULT_GEMINI_API_KEY = '';

const BULK_MISMATCH_LOG_KEY = 'poepool-bulk-mismatch-log';
const BULK_MISMATCH_QUEUE_KEY = 'poepool-bulk-mismatch-queue';
const BULK_NAME_MAP_STORAGE_KEY = 'poepool-bulk-name-map';

function normalizeBulkNameMap(obj) {
  const normalized = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return normalized;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    normalized[key] = v;
  }
  return normalized;
}

function recomputeBulkNameMap() {
  state.BULK_NAME_MAP = { ...(state.BULK_DEFAULT_NAME_MAP || {}), ...(state.BULK_USER_NAME_MAP || {}) };
}

async function loadBulkDefaultNameMap() {
  let merged = {};
  if (WORKER_URL) {
    try {
      const remoteRes = await fetch(`${WORKER_URL}?type=BulkNameMap`, { cache: 'no-store' });
      if (remoteRes.ok) {
        const remoteData = await remoteRes.json();
        const remoteMap = normalizeBulkNameMap(remoteData && remoteData.map ? remoteData.map : {});
        merged = remoteMap;
      }
    } catch (e) {
      // Remote map is optional; fall back to user overrides only.
    }
  }
  state.BULK_DEFAULT_NAME_MAP = merged;
  recomputeBulkNameMap();
}

function readBulkMismatchQueue() {
  try {
    const raw = localStorage.getItem(BULK_MISMATCH_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeBulkMismatchQueue(rows) {
  try {
    localStorage.setItem(BULK_MISMATCH_QUEUE_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch (e) {
    // Ignore queue persistence errors.
  }
}

async function flushBulkMismatchQueue() {
  if (!WORKER_URL) return false;
  const rows = readBulkMismatchQueue();
  if (!rows.length) return true;
  try {
    const res = await fetch(`${WORKER_URL}?type=BulkMismatchLog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows })
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) return false;
    writeBulkMismatchQueue([]);
    return true;
  } catch (e) {
    return false;
  }
}

function flushBulkMismatchQueueOnExit() {
  if (!WORKER_URL) return;
  const rows = readBulkMismatchQueue();
  if (!rows.length) return;
  try {
    void fetch(`${WORKER_URL}?type=BulkMismatchLog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
      keepalive: true
    });
  } catch (e) {
    // Ignore exit-flush errors; queue remains for next visit retry.
  }
}

function logBulkMismatch(rawName, qty, source) {
  const name = String(rawName || '');
  if (!name) return;
  try {
    const existing = localStorage.getItem(BULK_MISMATCH_LOG_KEY);
    const arr = Array.isArray(JSON.parse(existing)) ? JSON.parse(existing) : [];
    if (!arr.some(e => String(e.rawName || '') === name)) {
      arr.push({
        rawName: name,
        qty: Number.isFinite(qty) ? qty : null,
        source: source || 'unknown',
        timestamp: new Date().toISOString()
      });
      localStorage.setItem(BULK_MISMATCH_LOG_KEY, JSON.stringify(arr));
    }
  } catch (e) {
    // Swallow logging errors; analyzer should never fail because of logging.
  }
  try {
    const queue = readBulkMismatchQueue();
    if (queue.some(e => String(e.rawName || '') === name)) return;
    queue.push({
      rawName: name,
      qty: Number.isFinite(qty) ? qty : null,
      source: source || 'unknown',
      timestamp: new Date().toISOString()
    });
    writeBulkMismatchQueue(queue);
  } catch (e) {
    // Swallow queue errors; analyzer should never fail because of logging.
  }
}

function loadBulkNameMap() {
  try {
    const raw = localStorage.getItem(BULK_NAME_MAP_STORAGE_KEY);
    if (!raw) {
      state.BULK_USER_NAME_MAP = {};
      recomputeBulkNameMap();
      loadBulkDefaultNameMap();
      return;
    }
    const parsed = JSON.parse(raw);
    state.BULK_USER_NAME_MAP = normalizeBulkNameMap(parsed);
    recomputeBulkNameMap();
    loadBulkDefaultNameMap();
  } catch (e) {
    state.BULK_USER_NAME_MAP = {};
    recomputeBulkNameMap();
    loadBulkDefaultNameMap();
  }
}

function saveBulkNameMapFromInput() {
  const input = document.getElementById('bulkNameMapInput');
  if (!input) return;
  let obj = {};
  try {
    const txt = (input.value || '').trim();
    obj = txt ? JSON.parse(txt) : {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Expected an object');
    const normalized = normalizeBulkNameMap(obj);
    localStorage.setItem(BULK_NAME_MAP_STORAGE_KEY, JSON.stringify(normalized));
    state.BULK_USER_NAME_MAP = normalized;
    recomputeBulkNameMap();
    showToast('Bulk name map saved.', 2000);
  } catch (e) {
    showToast('Invalid bulk name map JSON.', 2000);
  }
}

function exportBulkNameMapToInput() {
  const input = document.getElementById('bulkNameMapInput');
  if (!input) return;
  try {
    const map = state.BULK_NAME_MAP || {};
    const isEmpty = !map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length;
    // When empty, leave textarea blank so the greyed-out placeholder example shows.
    input.value = isEmpty ? '' : JSON.stringify(map, null, 2);
  } catch (e) {
    input.value = '';
  }
}

function clearBulkMismatchLog() {
  try {
    localStorage.removeItem(BULK_MISMATCH_LOG_KEY);
  } catch (e) {}
  const logEl = document.getElementById('bulkDebugLog');
  if (logEl) {
    logEl.innerHTML = '<div class="bulk-debug-empty">No mismatches logged yet.</div>';
  }
}

function refreshBulkDebug() {
  // Refresh mismatch log
  const logEl = document.getElementById('bulkDebugLog');
  if (logEl) {
    try {
      const raw = localStorage.getItem(BULK_MISMATCH_LOG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!arr || !arr.length) {
        logEl.innerHTML = '<div class="bulk-debug-empty">No mismatches logged yet.</div>';
      } else {
        const latest = arr.slice(-50).reverse();
        logEl.innerHTML = latest.map(e => {
          const ts = e.timestamp || '';
          const src = e.source || 'unknown';
          const qty = Number.isFinite(e.qty) ? e.qty : (e.qty || '');
          const name = e.rawName || '';
          return `<div>[${ts}] [${src}] ${qty ? qty + 'x ' : ''}${name}</div>`;
        }).join('');
      }
    } catch (e) {
      logEl.innerHTML = '<div class="bulk-debug-empty">Failed to read mismatch log.</div>';
    }
  }

  // Refresh map text area from current in-memory map
  exportBulkNameMapToInput();
}

function isBulkDevMode() {
  return false;
}

function toggleBulkDebug() {
  if (!isBulkDevMode()) return;
  const panel = document.getElementById('bulkDebugPanel');
  const toggle = panel ? panel.previousElementSibling : null;
  if (!panel || !toggle) return;
  const isOpen = panel.style.display === 'block';
  if (isOpen) {
    panel.style.display = 'none';
    toggle.classList.remove('open');
  } else {
    panel.style.display = 'block';
    toggle.classList.add('open');
    refreshBulkDebug();
  }
}

function toggleBulkDev() {
  if (!isBulkDevMode()) return;
  const panel = document.getElementById('bulkDevPanel');
  const toggle = panel ? panel.previousElementSibling : null;
  if (!panel || !toggle) return;
  const isOpen = panel.style.display === 'block';
  if (isOpen) {
    panel.style.display = 'none';
    toggle.classList.remove('open');
  } else {
    panel.style.display = 'block';
    toggle.classList.add('open');
  }
}

function renderBulkScarabList() {
  const el = document.getElementById('bulkScarabList');
  if (!el) return;
  if (!Array.isArray(SCARAB_LIST) || !SCARAB_LIST.length) {
    el.innerHTML = '<div class="bulk-debug-empty">No scarab data loaded.</div>';
    return;
  }
  const rows = SCARAB_LIST.map(s => {
    const group = s.group || '';
    const name = s.name || '';
    return `<div>${group ? '[' + group + '] ' : ''}${name}</div>`;
  }).join('');
  el.innerHTML = rows;
}

function toggleBulkScarabList() {
  if (!isBulkDevMode()) return;
  const panel = document.getElementById('bulkScarabPanel');
  const toggle = panel ? panel.previousElementSibling : null;
  if (!panel || !toggle) return;
  const isOpen = panel.style.display === 'block';
  if (isOpen) {
    panel.style.display = 'none';
    toggle.classList.remove('open');
  } else {
    panel.style.display = 'block';
    toggle.classList.add('open');
    renderBulkScarabList();
  }
}

function getBulkGeminiKey() {
  if (DEFAULT_GEMINI_API_KEY && DEFAULT_GEMINI_API_KEY.trim()) return DEFAULT_GEMINI_API_KEY.trim();
  try { return (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim(); } catch(e) { return ''; }
}

function onBulkGeminiKeyChange(el) {
  const v = (el.value || '').trim();
  try {
    if (v) localStorage.setItem(GEMINI_KEY_STORAGE, v);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch(e) {}
}

function initBulkGeminiKey() {
  const el = document.getElementById('bulkGeminiKey');
  if (!el) return;
  try {
    const v = getBulkGeminiKey();
    if (v) el.value = v;
  } catch(e) {}
}

// Bulk analyzer uses Flash only. If a key is rate-limited, cool it down to prevent hammering.
function getTodayDateKey() {
  return toLocalDateKey(); // YYYY-MM-DD (local)
}
function readGeminiRateLimitedKeyMap() {
  try {
    const raw = localStorage.getItem(GEMINI_RATE_LIMITED_KEYS_STORAGE);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) { return {}; }
}
function writeGeminiRateLimitedKeyMap(map) {
  try {
    localStorage.setItem(GEMINI_RATE_LIMITED_KEYS_STORAGE, JSON.stringify(map && typeof map === 'object' ? map : {}));
  } catch (e) {}
}
function getGeminiKeyFingerprint(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return '';
  return key.slice(0, 12);
}
function getGeminiKeyCooldownRemainingMs(apiKey) {
  const fingerprint = getGeminiKeyFingerprint(apiKey);
  if (!fingerprint) return 0;
  const map = readGeminiRateLimitedKeyMap();
  const until = Number(map[fingerprint] || 0);
  if (!Number.isFinite(until) || until <= 0) return 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}
function formatCooldownRemaining(remainingMs) {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
function setGeminiKeyRateLimitedCooldown(apiKey, cooldownMs = GEMINI_RATE_LIMIT_COOLDOWN_MS) {
  const fingerprint = getGeminiKeyFingerprint(apiKey);
  if (!fingerprint) return;
  const map = readGeminiRateLimitedKeyMap();
  const duration = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : GEMINI_RATE_LIMIT_COOLDOWN_MS;
  map[fingerprint] = Date.now() + duration;
  try {
    writeGeminiRateLimitedKeyMap(map);
  } catch (e) {}
}
function isRateLimitError(res, status, text) {
  if (status === 429) return true;
  if (status === 503) return true;
  const body = (text || '').toLowerCase();
  return body.includes('resource_exhausted') || body.includes('quota') || body.includes('rate limit');
}

function clearBulkImage() {
  state._bulkImageFile = null;
  const zone = document.getElementById('bulkDropZone');
  const textEl = document.getElementById('bulkDropText');
  const hintEl = document.getElementById('bulkDropHint');
  const clearBtn = document.getElementById('bulkClearImageBtn');
  const fileInput = document.getElementById('bulkImageInput');
  if (zone) zone.classList.remove('loaded', 'parse-failed');
  if (textEl) textEl.textContent = 'Drop a TFT listing screenshot here, paste with Ctrl+V, or click to browse.';
  if (hintEl) hintEl.textContent = 'Tab must be on Bulk Buy Analyzer for paste to work.';
  if (clearBtn) clearBtn.style.display = 'none';
  if (fileInput) fileInput.value = '';
}

function handleBulkImage(event) {
  const file = event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0];
  if (!file) return;
  state._bulkImageFile = file;
  if (event.target && event.target.type === 'file') {
    event.target.value = '';
  }
  const zone = document.getElementById('bulkDropZone');
  const textEl = document.getElementById('bulkDropText');
  const hintEl = document.getElementById('bulkDropHint');
  const clearBtn = document.getElementById('bulkClearImageBtn');
  if (zone) {
    zone.classList.remove('parse-failed');
    zone.classList.add('loaded');
  }
  if (textEl) textEl.textContent = `Loaded: ${file.name}`;
  if (hintEl) hintEl.textContent = 'Tab must be on Bulk Buy Analyzer for paste to work.';
  if (clearBtn) clearBtn.style.display = '';
  // Clear CSV when a new image is set so "Analyze image" repopulates with fresh data
  const csvEl = document.getElementById('bulkCsv');
  if (csvEl) csvEl.value = '';
}

// Enable drag-and-drop and paste for images when Bulk tab is active
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('bulkDropZone');
  const fileInput = document.getElementById('bulkImageInput');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter','dragover'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('loaded');
      });
    });

    ['dragleave','drop'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          handleBulkImage(e);
        }
      });
    });
  }

  // Global paste handler, only active when Bulk tab is visible
  window.addEventListener('paste', e => {
    const bulkTab = document.getElementById('tab-bulk');
    if (!bulkTab || bulkTab.style.display === 'none') return;
    if (!e.clipboardData) return;
    const items = e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type && it.type.indexOf('image') === 0) {
        const file = it.getAsFile();
        if (file) {
          const fakeEvent = { dataTransfer: { files: [file] } };
          handleBulkImage(fakeEvent);
          e.preventDefault();
          break;
        }
      }
    }
  });
});

function buildBulkScarabIndex() {
  return SCARAB_LIST.map(s => {
    const nameLower = s.name.toLowerCase();
    const groupLower = (s.group || '').toLowerCase();
    // Remove the word "Scarab" anywhere and collapse spaces
    const short = nameLower.replace(/\bscarab\b/gi, '').replace(/\s+/g, ' ').trim();
    let suffix = '';
    const m1 = nameLower.match(/scarab of (.+)$/);
    if (m1) suffix = ('of ' + m1[1]).trim();
    const m2 = nameLower.match(/^scarab of (.+)$/);
    if (m2) suffix = ('of ' + m2[1]).trim();
    return { ...s, nameLower, groupLower, short, suffix };
  });
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i + 1;
    for (let j = 0; j < b.length; j++) {
      const curr = Math.min(prev + 1, dp[j + 1] + 1, dp[j] + (a[i] !== b[j] ? 1 : 0));
      dp[j] = prev;
      prev = curr;
    }
    dp[b.length] = prev;
  }
  return dp[b.length];
}

// Tokens stripped of structural filler words common to all scarab names
const _BULK_STOP = new Set(['scarab','of','the','a','an']);
function tokenizeBulkName(str) {
  return str.toLowerCase().split(/\s+/).filter(t => t && !_BULK_STOP.has(t));
}

function matchBulkName(rawName, index) {
  const q = rawName.trim().toLowerCase();
  if (!q) return null;

  const mapped = state.BULK_NAME_MAP && state.BULK_NAME_MAP[q];
  if (mapped && typeof mapped === 'string' && mapped.trim()) {
    const target = mapped.trim().toLowerCase();
    const direct = index.find(e => e.nameLower === target);
    if (direct) return direct;
  }

  // 1) Exact canonical
  let hits = index.filter(e => e.nameLower === q);
  if (hits.length === 1) return hits[0];

  // 2) Exact short (without "Scarab")
  hits = index.filter(e => e.short && e.short === q);
  if (hits.length === 1) return hits[0];

  // 3) Exact suffix ("of X")
  hits = index.filter(e => e.suffix && e.suffix === q);
  if (hits.length === 1) return hits[0];

  hits = index.filter(e => e.groupLower && e.groupLower === q && /scarab$/.test(e.name));
  if (hits.length === 1) return hits[0];

  // 5) First + last token exact match
  // Strip stop words, compare first meaningful token (group signal) and
  // last meaningful token (variant signal). Proven conflict-free across the full list.
  const qToks  = tokenizeBulkName(q);
  const qFirst = qToks[0] || '';
  const qLast  = qToks[qToks.length - 1] || '';

  if (qFirst && qLast && qFirst !== qLast) {
    // after stripping they may have no first token, so allow last-only match for those
    hits = index.filter(e => {
      const et = tokenizeBulkName(e.nameLower);
      const ef = et[0] || '';
      const el = et[et.length - 1] || '';
      return ef === qFirst && el === qLast;
    });
    if (hits.length === 1) return hits[0];
  }

  // This allows 1 typo on short words, up to ~3 on longer ones
  if (qFirst && qLast) {
    const scored = index.map(e => {
      const et    = tokenizeBulkName(e.nameLower);
      const ef    = et[0] || '';
      const el    = et[et.length - 1] || '';
      const fedMax = Math.max(1, Math.floor(Math.max(qFirst.length, ef.length) * 0.35));
      const ledMax = Math.max(1, Math.floor(Math.max(qLast.length, el.length) * 0.35));
      const fed   = levenshteinDistance(qFirst, ef);
      const led   = levenshteinDistance(qLast, el);
      if (fed <= fedMax && led <= ledMax) {
        // Score: lower = better. Weight last token more (it's the variant signal)
        return { e, score: fed * 0.4 + led * 0.6 };
      }
      return null;
    }).filter(Boolean).sort((a, b) => a.score - b.score);

    if (scored.length === 1) return scored[0].e;
    if (scored.length > 1 && scored[0].score < scored[1].score) return scored[0].e;
  }

  hits = index.filter(e =>
    e.nameLower.includes(q) ||
    (e.short && e.short.includes(q)) ||
    (e.suffix && e.suffix.includes(q))
  );
  if (hits.length === 1) return hits[0];

  return null;
}

function isBulkScarabLikeName(rawName) {
  const q = String(rawName || '').trim().toLowerCase();
  if (!q) return false;
  const qToks = tokenizeBulkName(q);
  if (!qToks.length) return false;
  if (q.includes(' scarab ') || q.endsWith(' scarab') || q.startsWith('scarab ')) return true;
  return qToks.some((tok) => {
    if (!tok) return false;
    if (tok === 'scarab') return true;
    if (tok.length >= 4 && tok.includes('scarab')) return true;
    return levenshteinDistance(tok, 'scarab') <= 2;
  });
}

function parseBulkCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const qty = parseInt(parts[1].trim(), 10);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    rows.push({ rawName: name, qty });
  }
  return rows;
}

function formatBulkChaosValue(chaos, divRate) {
  if (!divRate) return Math.round(chaos) + 'c';
  const d = chaos / divRate;
  return d >= 1 ? d.toFixed(1) + 'd' : Math.round(chaos) + 'c';
}

function parseBulkAskingChaos() {
  const divRate = getDivineRate();
  const askDivEl = document.getElementById('bulkAskingDivine');
  const askChaosEl = document.getElementById('bulkAskingChaos');
  const askDivStr = askDivEl?.value || '';
  const askChaosStr = askChaosEl?.value || '';
  const divinePart = askDivStr.trim() === '' ? 0 : Number(askDivStr);
  const chaosPart = askChaosStr.trim() === '' ? 0 : Number(askChaosStr);
  if (!Number.isFinite(divinePart) || divinePart < 0 || !Number.isFinite(chaosPart) || chaosPart < 0) {
    return { ok: false, error: 'Please enter a valid asking price. Use non-negative divine/chaos values.' };
  }
  if (divinePart > 0 && !(divRate > 0)) {
    return { ok: false, error: 'Divine rate is unavailable. Load market prices first on Scarab Vendor tab.' };
  }
  const askingChaos = (divinePart * (divRate || 0)) + chaosPart;
  if (!(askingChaos > 0)) {
    return { ok: false, error: 'Please enter the total asking price before analyzing.' };
  }
  return { ok: true, askingChaos };
}

function detectBulkPartialParse(rawText) {
  const cleaned = String(rawText || '')
    .replace(/```(?:csv|text)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { partial: true, malformedCount: 0 };

  const csvLine = /^.+,\s*\d+\s*$/;
  const malformed = lines.filter(l => !csvLine.test(l));
  return { partial: malformed.length > 0, malformedCount: malformed.length };
}

async function analyzeBulkFromImage() {
  const errEl = document.getElementById('bulkError');
  errEl.style.display = 'none';

  if (!state._bulkImageFile) {
    errEl.textContent = 'Upload a TFT listing screenshot first.';
    errEl.style.display = 'block';
    return;
  }

  const apiKey = getBulkGeminiKey();
  if (!apiKey) {
    errEl.textContent = 'Enter your Gemini API key.';
    errEl.style.display = 'block';
    return;
  }
  const cooldownRemainingMs = getGeminiKeyCooldownRemainingMs(apiKey);
  if (cooldownRemainingMs > 0) {
    errEl.textContent = `Daily Gemini request limit reached for this API key. If you upgraded your limit, cooldown remaining is ${formatCooldownRemaining(cooldownRemainingMs)} until you can try again.`;
    errEl.style.display = 'block';
    return;
  }

  const askingParse = parseBulkAskingChaos();
  if (!askingParse.ok) {
    errEl.textContent = askingParse.error;
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('bulkAnalyzeImageBtn');
  const spinnerEl = document.getElementById('bulkDropZoneSpinner');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Analyzing image...';
  }
  if (spinnerEl) spinnerEl.style.display = 'flex';

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = e => reject(e);
      reader.readAsDataURL(state._bulkImageFile);
    });
    const base64 = String(dataUrl).split(',')[1];

	const body = {
			system_instruction: {
				parts: [{
					text:
					"You are a STRICT OCR extraction engine for Path of Exile TFT listing images.\n\n" +

					"ABSOLUTE RULE: THIS IS NOT INTERPRETATION. THIS IS TEXT EXTRACTION ONLY.\n\n" +

					"CRITICAL CONSTRAINTS:\n" +
					"- You must extract ONLY text that is visibly present in the image.\n" +
					"- You are NOT allowed to infer, correct, normalize, or complete item names.\n" +
					"- You are NOT allowed to use external knowledge of Path of Exile items.\n" +
					"- You are NOT allowed to 'fix' partial or unclear names.\n\n" +

					"ROW STRUCTURE RULE:\n" +
					"- Each horizontal background band is exactly one row.\n" +
					"- Each row must be processed independently.\n" +
					"- Do not combine text across rows under any circumstance.\n\n" +

					"VISUAL ALIGNMENT RULE:\n" +
					"- An Item Name belongs to the Quantity it is horizontally level with.\n" +
					"- Do not pull words from the row below into the current row's name.\n\n" +
					
					"CROSS-ROW FORBIDDEN MEMORY RULE (CRITICAL):\n" +
					"- Each row must be processed as an independent isolated unit.\n" +
					"- You MUST NOT reuse or reference any numeric values (Quantity) from any other row, even if visually similar.\n" +
					"- Every Quantity must be derived ONLY from text inside the current row band.\n" +
					"- If a Quantity is not clearly visible in the current row band, output nothing for that row (do not substitute).\n\n" +

					"ABSOLUTE RULE:\n" +
					"- Under no circumstances may a value from a different row be used, copied, or inferred for the current row.\n\n" +

					"FIELD RULES:\n" +
					"- Quantity = the first whole integer visible in the row.\n" +
					"- Item Name = ONLY the exact text visible in that same row.\n" +
					"- Do NOT modify spelling.\n" +
					"- Do NOT expand abbreviations.\n" +
					"- Do NOT complete partial words.\n" +
					"- Do NOT merge split words unless they are visually continuous in the same row.\n\n" +

					"QUANTITY PARSING RULE (CRITICAL):\n" +
					"- Quantities may be visually formatted with spaces as thousand separators.\n" +
					"- Example: '1 288' must be read as 1288.\n" +
					"- Example: '12 345' must be read as 12345.\n" +
					"- If multiple numeric tokens appear consecutively in the quantity position, they MUST be merged into a single number.\n" +
					"- Only apply this merging rule to numbers in the quantity position of the row.\n" +
					"- Do NOT split or reinterpret quantities once identified.\n\n" +

					"STRICT ANTI-HALLUCINATION RULE:\n" +
					"- If a name is partially visible, output it exactly as seen, even if incomplete.\n" +
					"- Never replace or correct item names to a 'known' version.\n\n" +

					"OUTPUT RULES:\n" +
					"- Return ONLY CSV lines: Name,Qty\n" +
					"- No commentary, no notes, no headers, no extra text.\n" +
					"- Each line must correspond to exactly one row."
				}]
			},

		  contents: [
			{
			  parts: [
				{ text: "Extract Name,Qty exactly as visible." },
				{
				  inline_data: {
					mime_type: state._bulkImageFile.type || 'image/png',
					data: base64
				  }
				}
			  ]
			}
		  ],

		  generationConfig: {
			temperature: 0,
			topP: 1,
			topK: 1,
			maxOutputTokens: 8192,
			responseMimeType: "text/plain"
		  }
		};

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_FLASH}:generateContent?key=` + encodeURIComponent(apiKey);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const txt = await res.text();

    if (res.ok) {
      const json = JSON.parse(txt);
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const text = parts.map(p => p.text || '').join('\n').trim();
      if (!text) throw new Error('No text returned from Gemini.');
      const quality = detectBulkPartialParse(text);
      if (quality.partial) {
        document.getElementById('bulkCsv').value = text;
        const zone = document.getElementById('bulkDropZone');
        const textEl = document.getElementById('bulkDropText');
        const hintEl = document.getElementById('bulkDropHint');
        if (zone) zone.classList.add('parse-failed', 'loaded');
        if (textEl) textEl.textContent = 'Parse failed: partial CSV detected.';
        if (hintEl) hintEl.textContent = 'Data was not applied. Re-crop image and retry, or fix CSV then use Analyze CSV only.';
        const warningEl = document.getElementById('bulkResultWarning');
        if (warningEl) {
          warningEl.style.display = 'none';
          warningEl.textContent = '';
        }
        return;
      }
      document.getElementById('bulkCsv').value = text;
      state._bulkSource = 'image';
      await analyzeBulkFromCsv('image');
      const zone = document.getElementById('bulkDropZone');
      const textEl = document.getElementById('bulkDropText');
      const hintEl = document.getElementById('bulkDropHint');
      if (zone) {
        zone.classList.remove('parse-failed');
        zone.classList.add('loaded');
      }
      if (textEl) textEl.textContent = `Parsed successfully: ${state._bulkImageFile?.name || 'image'}`;
      if (hintEl) hintEl.textContent = 'Image data applied to CSV. You can edit the CSV and re-run Analyze CSV only.';
      return;
    }

    if (isRateLimitError(res, res.status, txt)) {
      setGeminiKeyRateLimitedCooldown(apiKey);
      throw new Error('Daily Gemini request limit reached for this API key. Please wait until your daily quota resets, then try again.');
    }
    throw new Error(`Gemini error ${res.status}: ${txt.slice(0, 200)}`);
  } catch (e) {
    errEl.textContent = 'Gemini parse failed: ' + (e.message || e);
    errEl.style.display = 'block';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Analyze Image';
    }
    if (spinnerEl) spinnerEl.style.display = 'none';
  }
}

function resetBulkOutputUI() {
  const errEl = document.getElementById('bulkError');
  const warningEl = document.getElementById('bulkResultWarning');
  const summaryEl = document.getElementById('bulkSummary');
  const tableWrap = document.getElementById('bulkTableWrap');
  const unmatchedEl = document.getElementById('bulkUnmatched');
  const unmatchedListEl = document.getElementById('bulkUnmatchedList');
  const tbody = document.getElementById('bulkTableBody');
  const hadVisibleResults =
    !!(summaryEl && summaryEl.style.display !== 'none') ||
    !!(tableWrap && tableWrap.style.display !== 'none') ||
    !!(unmatchedEl && unmatchedEl.style.display !== 'none');

  if (errEl) errEl.style.display = 'none';
  if (warningEl) {
    warningEl.style.display = 'none';
    warningEl.textContent = '';
  }
  if (summaryEl) summaryEl.style.display = 'none';
  if (tableWrap) tableWrap.style.display = 'none';
  if (unmatchedEl) unmatchedEl.style.display = 'none';
  if (unmatchedListEl) unmatchedListEl.textContent = '';
  if (tbody) tbody.innerHTML = '';
  return hadVisibleResults;
}

async function analyzeBulkFromCsv(sourceOverride = 'csv') {
  const source = sourceOverride || 'csv';
  state._bulkSource = source;

  const csvText = document.getElementById('bulkCsv').value || '';
  const errEl = document.getElementById('bulkError');
  const summaryEl = document.getElementById('bulkSummary');
  const tableWrap = document.getElementById('bulkTableWrap');
  const unmatchedEl = document.getElementById('bulkUnmatched');
  const unmatchedListEl = document.getElementById('bulkUnmatchedList');

  const hadVisibleResults = resetBulkOutputUI();
  // On reruns, keep results cleared briefly so users can see a fresh process happened.
  if (hadVisibleResults) {
    await new Promise(resolve => setTimeout(resolve, 900));
  }

  const rows = parseBulkCsv(csvText);
  if (!rows.length) {
    errEl.textContent = 'No valid rows found. Ensure the CSV is in the format "Name,Qty" on each line.';
    errEl.style.display = 'block';
    return;
  }

  const askingParse = parseBulkAskingChaos();
  if (!askingParse.ok) {
    errEl.textContent = askingParse.error;
    errEl.style.display = 'block';
    return;
  }
  const askingChaos = askingParse.askingChaos;

  if (!Object.keys(state.ninjaPrices || {}).length) {
    errEl.textContent = 'Load market prices first (open the Scarab Vendor tab).';
    errEl.style.display = 'block';
    return;
  }

  const lower = buildNinjaLookup();
  const entries = SCARAB_LIST.map(s => ({ chaosEa: getNinjaPrice(s.name, lower) }));
  const priced = entries.filter(e => e.chaosEa > 0);
  const harmonicEV = calcEV(priced);
  const recommendedMode = getRecommendedEVModeForShare(getCurrentLeagueSharePctFromState());
  const weightedEV = state._calibratedMean;
  const recommendedThreshold = (recommendedMode === 'weighted' && Number.isFinite(weightedEV) && weightedEV > 0)
    ? weightedEV
    : harmonicEV;
  const threshold = state.ninjaEvOverride !== null ? state.ninjaEvOverride : recommendedThreshold;
  if (threshold == null) {
    errEl.textContent = `Could not determine ${recommendedMode} EV \u2014 ensure market prices are loaded.`;
    errEl.style.display = 'block';
    return;
  }

  // Build vendor set & price map using same logic as estimator
  const vendorSet = new Set();
  const priceMap = {};
  for (const s of SCARAB_LIST) {
    const chaosPerUnit = getNinjaPrice(s.name, lower);
    if (chaosPerUnit > 0) {
      priceMap[s.name] = chaosPerUnit;
      if (chaosPerUnit <= threshold) vendorSet.add(s.name);
    }
  }

  const index = buildBulkScarabIndex();
  const divRate = getDivineRate();

  const matchedRows = [];
  const unmatched = [];

  for (const r of rows) {
    const match = matchBulkName(r.rawName, index);
    if (!match) {
      unmatched.push(r);
      if (isBulkScarabLikeName(r.rawName)) {
        logBulkMismatch(r.rawName, r.qty, source);
      }
      continue;
    }
    const priceEa = priceMap[match.name] || 0;
    matchedRows.push({
      canonical: match,
      qty: r.qty,
      priceEa,
      isVendor: vendorSet.has(match.name)
    });
  }

  if (!matchedRows.length) {
    errEl.textContent = 'No rows could be matched to known scarabs. Double-check the names Gemini returned.';
    errEl.style.display = 'block';
    if (unmatched.length) {
      unmatchedEl.style.display = 'block';
      unmatchedListEl.textContent = unmatched.map(u => `${u.rawName} (${u.qty})`).join(' \u00B7 ');
    }
    return;
  }

  let expectedReturn = 0;
  let totalQty = 0;
  let vendorQty = 0;
  let keeperQty = 0;
  const loopRate = computeLoopVendorRate(threshold);
  const vendorRateUsed = (loopRate?.loopRate ?? state._calibratedRate) || threshold;

  const enriched = matchedRows.map(r => {
    const valueChaos = r.isVendor
      ? r.qty * vendorRateUsed
      : r.qty * (r.priceEa || 0);
    expectedReturn += valueChaos;
    totalQty += r.qty;
    if (r.isVendor) vendorQty += r.qty; else keeperQty += r.qty;
    return { ...r, valueChaos };
  });

  const net = expectedReturn - askingChaos;
  const marginPct = askingChaos > 0 ? (net / askingChaos) * 100 : 0;

  // Summary
  const costLabel = formatBulkChaosValue(askingChaos, divRate);
  const retLabel = formatBulkChaosValue(expectedReturn, divRate);
  const netLabel = formatBulkChaosValue(Math.abs(net), divRate);

  document.getElementById('bulkCost').textContent = costLabel;
  document.getElementById('bulkCostSub').textContent =
    `Vendor: ${vendorQty.toLocaleString()} \u00B7 Keep: ${keeperQty.toLocaleString()}`;

  const typesEl = document.getElementById('bulkTypes');
  const typesSub = document.getElementById('bulkTypesSub');
  if (typesEl) typesEl.textContent = matchedRows.length.toLocaleString();
  if (typesSub) typesSub.textContent = unmatched.length > 0 ? `${unmatched.length} unmatched` : 'Matched';

  document.getElementById('bulkReturn').textContent = retLabel;
  document.getElementById('bulkReturnSub').textContent =
    `After 3->1 vendor targets`;

  const netEl = document.getElementById('bulkNet');
  netEl.textContent = (net >= 0 ? '+' : '-') + netLabel;
  netEl.classList.toggle('bulk-summary-profit-pos', net >= 0);
  netEl.classList.toggle('bulk-summary-profit-neg', net < 0);
  document.getElementById('bulkNetSub').textContent =
    `${vendorRateUsed.toFixed(2)}c/vendor est. return`;

  const marginEl = document.getElementById('bulkMargin');
  marginEl.textContent = (net >= 0 ? '+' : '') + marginPct.toFixed(1) + '%';
  marginEl.classList.toggle('bulk-summary-profit-pos', net >= 0);
  marginEl.classList.toggle('bulk-summary-profit-neg', net < 0);
  document.getElementById('bulkMarginSub').textContent =
    net >= 0 ? 'Positive expected edge' : 'Negative expected edge';

  summaryEl.style.display = '';

  // Table
  enriched.sort((a, b) => b.valueChaos - a.valueChaos);
  const tbody = document.getElementById('bulkTableBody');
  tbody.innerHTML = enriched.map(r => {
    const icon = getNinjaImage(r.canonical.name) || '';
    const diff = (r.priceEa || 0) - threshold;
    const diffCls = diff >= 0 ? 'bulk-diff-pos' : 'bulk-diff-neg';
    const badgeCls = r.isVendor ? 'bulk-pill bulk-pill-vendor' : 'bulk-pill bulk-pill-keep';
    const badgeLabel = r.isVendor ? 'Vendor' : 'Keep';
    const valueLabel = formatBulkChaosValue(r.valueChaos, divRate);
    const ceaLabel = r.priceEa > 0 ? r.priceEa.toFixed(2) + 'c' : '\u2014';
    const diffLabel = r.priceEa > 0 ? (diff >= 0 ? '+' : '') + diff.toFixed(2) + 'c' : '\u2014';
    return `
      <div class="bulk-body-row${r.isVendor ? ' vendor-target' : ''}">
        <div>
          <div class="bulk-icon-wrap">
            <img src="${icon}" alt="">
          </div>
        </div>
        <div class="bulk-name-cell">
          <span class="scarab-name">${r.canonical.name}</span>
          <span class="scarab-name-mobile">${mobileScarabName(r.canonical.name)}</span>
          <div class="bulk-group-sub">${r.canonical.group || ''}</div>
        </div>
        <div class="bulk-td-right">${r.qty.toLocaleString()}</div>
        <div class="bulk-td-right">
          <div>${ceaLabel}</div>
          <div class="${diffCls}" style="font-size:10px">${diffLabel}</div>
        </div>
        <div class="bulk-td-right bulk-col-value">
          ${valueLabel}
        </div>
        <div class="bulk-td-right bulk-col-action">
          <span class="${badgeCls}">${badgeLabel}</span>
        </div>
      </div>
    `;
  }).join('');
  normalizeBulkTableColumnOrder();
  normalizeBulkNameCells();

  tableWrap.style.display = '';

  if (unmatched.length) {
    unmatchedEl.style.display = 'block';
    unmatchedListEl.textContent = unmatched.map(u => `${u.rawName} (${u.qty})`).join(' \u00B7 ');
  }
}

function normalizeBulkTableColumnOrder() {
  const rows = document.querySelectorAll('#bulkTableBody .bulk-body-row');
  rows.forEach((row) => {
    const cells = row.children;
    if (!cells || cells.length < 6) return;
    const col5 = cells[4];
    const col6 = cells[5];
    const col5HasAction = !!col5.querySelector('.bulk-pill');
    const col6HasAction = !!col6.querySelector('.bulk-pill');
    if (col5HasAction && !col6HasAction) {
      row.insertBefore(col6, col5);
    }
  });
}

function normalizeBulkNameCells() {
  const rows = document.querySelectorAll('#bulkTableBody .bulk-body-row');
  rows.forEach((row) => {
    const nameCell = row.children[1];
    if (!nameCell) return;

    const hasNewStructure = !!nameCell.querySelector('.scarab-name') && !!nameCell.querySelector('.scarab-name-mobile');
    if (!hasNewStructure) {
      const fullName = (nameCell.children[0]?.textContent || nameCell.textContent || '').trim();
      const group = (nameCell.children[1]?.textContent || '').trim();
      if (!fullName) return;

      nameCell.classList.add('bulk-name-cell');
      nameCell.textContent = '';

      const fullSpan = document.createElement('span');
      fullSpan.className = 'scarab-name';
      fullSpan.textContent = fullName;

      const mobileSpan = document.createElement('span');
      mobileSpan.className = 'scarab-name-mobile';
      mobileSpan.textContent = mobileScarabName(fullName);

      nameCell.appendChild(fullSpan);
      nameCell.appendChild(mobileSpan);

      if (group) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'bulk-group-sub';
        groupDiv.textContent = group;
        nameCell.appendChild(groupDiv);
      }
      return;
    }

    const fullSpan = nameCell.querySelector('.scarab-name');
    const mobileSpan = nameCell.querySelector('.scarab-name-mobile');
    if (fullSpan && mobileSpan) {
      mobileSpan.textContent = mobileScarabName(fullSpan.textContent.trim());
    }
  });
}


export function initializeBulk() {
  normalizeBulkTableColumnOrder();
  normalizeBulkNameCells();
  initBulkGeminiKey();
  loadBulkNameMap();
  void flushBulkMismatchQueue();
  window.addEventListener('pagehide', flushBulkMismatchQueueOnExit);
  (() => {
    const devPanel = document.getElementById('bulkDevPanel');
    const devToggle = devPanel ? devPanel.previousElementSibling : null;
    if (devToggle && devToggle.style) devToggle.style.display = 'none';
    if (devPanel && devPanel.style) devPanel.style.display = 'none';
  })();
}

export {
  normalizeBulkNameMap,
  recomputeBulkNameMap,
  loadBulkDefaultNameMap,
  logBulkMismatch,
  loadBulkNameMap,
  saveBulkNameMapFromInput,
  exportBulkNameMapToInput,
  clearBulkMismatchLog,
  refreshBulkDebug,
  isBulkDevMode,
  toggleBulkDebug,
  toggleBulkDev,
  renderBulkScarabList,
  toggleBulkScarabList,
  getBulkGeminiKey,
  onBulkGeminiKeyChange,
  initBulkGeminiKey,
  getTodayDateKey,
  isRateLimitError,
  clearBulkImage,
  handleBulkImage,
  buildBulkScarabIndex,
  levenshteinDistance,
  tokenizeBulkName,
  matchBulkName,
  parseBulkCsv,
  formatBulkChaosValue,
  analyzeBulkFromImage,
  analyzeBulkFromCsv
};