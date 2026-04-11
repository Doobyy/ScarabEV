// Frontend UI shell for ScarabEV.
// Owns page startup, DOM rendering, event wiring, and user interactions.
// Coordinates shared state and extracted engines across all tabs.
// Keeps orchestration logic in one place for browser runtime flow.
// Does not define backend API or Cloudflare worker behavior.

import { state } from './state.js';
import { configureScarabEngine, calcEV, calcAutoEV, computeWeightBasedRate, getNinjaEntries } from './scarabEngine.js';
import { configureRegexEngine, buildRegex, buildReverseTokenMap, parseRegexToScarabs } from './regexEngine.js';
import { parseWorkerResponse, buildNinjaLookup, getNinjaPrice, getNinjaImage, parseSnapCSV } from './market.js';
import { initializeBackendTokenSource } from './tokenSource.js';
import { initHashRouting } from './hashRouting.js';
import { exposeGlobals } from './globalExpose.js';
import {
  CDN,
  SCARAB_LIST,
  ALPHA_ORDER,
  INGAME_ORDER,
  POOL_API_URL,
  FAQ_SECTIONS,
  CHAR_LIMIT,
  WORKER_URL,
  ATLAS_BLOCKABLE,
  ATLAS_BOOSTABLE,
  ATLAS_SAVE_KEY,
  BACKEND_TOKEN_SET_URL,
  BACKEND_SCARAB_METADATA_URL,
  BACKEND_ADMIN_UI_URL
} from './config.js';

{
  const p = String(window.location.pathname || '').toLowerCase();
  if (p === '/admin' || p === '/admin/' || p.startsWith('/admin/')) {
    window.location.replace(BACKEND_ADMIN_UI_URL + window.location.search + window.location.hash);
  }
}




// On mobile: show last meaningful word. If that word is ambiguous (shared by
// multiple scarabs), fall back to last two meaningful words.
const _SCARAB_STOP = new Set(['scarab','of','the','a','an']);
const DAILY_SNAPSHOT_UTC_HOUR = 18;
const EV_CHART_RANGE_STORAGE_KEY = 'poepool28v2-ev-chart-range';
const ATLAS_TREND_RANGE_STORAGE_KEY = 'poepool28v2-atlas-trend-range';
const EV_CHART_RANGE_TO_DAYS = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90
});
const ATLAS_MAX_OPTIMIZE_STEPS = 24;
let _scarabMetaTooltipBound = false;
let _scarabMetaTooltipEl = null;
let _statInfoTooltipBound = false;
let _statInfoTooltipEl = null;
const _AMBIGUOUS_LAST = (() => {
  const counts = {};
  for (const s of SCARAB_LIST) {
    const last = s.name.split(' ').pop().toLowerCase();
    counts[last] = (counts[last] || 0) + 1;
  }
  return new Set(Object.keys(counts).filter(k => counts[k] > 1));
})();

function mobileScarabName(fullName) {
  const words = fullName.split(' ');
  const last = words[words.length - 1].toLowerCase();
  if (!_AMBIGUOUS_LAST.has(last)) return words[words.length - 1];
  // Ambiguous - use last two meaningful words.
  const meaningful = words.filter(w => !_SCARAB_STOP.has(w.toLowerCase()));
  if (meaningful.length >= 2) return meaningful.slice(-2).join(' ');
  return meaningful[meaningful.length - 1] || words[words.length - 1];
}

function normalizeScarabNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

function getScarabTooltipText(name) {
  const key = normalizeScarabNameKey(name);
  const meta = state._scarabMetaByName && state._scarabMetaByName[key] ? state._scarabMetaByName[key] : null;
  if (!meta) return '';
  const mods = Array.isArray(meta.modifiers) ? meta.modifiers.filter(Boolean) : [];
  if (!mods.length) return '';
  return mods.map((m) => String(m || '').trim()).filter(Boolean).join('\n');
}

function ensureScarabMetaTooltipEl() {
  if (_scarabMetaTooltipEl && _scarabMetaTooltipEl.parentNode) return _scarabMetaTooltipEl;
  const el = document.createElement('div');
  el.id = 'scarabMetaTooltip';
  el.className = 'analysis-tooltip scarab-meta-tooltip';
  document.body.appendChild(el);
  _scarabMetaTooltipEl = el;
  return el;
}

function showScarabMetaTooltip(target, ev) {
  const text = String(target?.getAttribute('data-scarab-tooltip') || '').trim();
  if (!text) return;
  const tip = ensureScarabMetaTooltipEl();
  tip.textContent = text;
  tip.classList.add('show');
  moveScarabMetaTooltip(ev);
}

function moveScarabMetaTooltip(ev) {
  const tip = _scarabMetaTooltipEl;
  if (!tip || !tip.classList.contains('show')) return;
  const pad = 12;
  const x = (ev && Number.isFinite(ev.clientX)) ? ev.clientX : 0;
  const y = (ev && Number.isFinite(ev.clientY)) ? ev.clientY : 0;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  let left = x + pad;
  let top = y + pad;
  const rect = tip.getBoundingClientRect();
  if (left + rect.width + 8 > vw) left = Math.max(8, x - rect.width - pad);
  if (top + rect.height + 8 > vh) top = Math.max(8, y - rect.height - pad);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideScarabMetaTooltip() {
  const tip = _scarabMetaTooltipEl;
  if (!tip) return;
  tip.classList.remove('show');
  tip.textContent = '';
}

function ensureStatInfoTooltipEl() {
  if (_statInfoTooltipEl && _statInfoTooltipEl.parentNode) return _statInfoTooltipEl;
  const el = document.createElement('div');
  el.id = 'analysisStatTooltip';
  el.className = 'analysis-stat-tooltip';
  document.body.appendChild(el);
  _statInfoTooltipEl = el;
  return el;
}

function moveStatInfoTooltipFromRect(rect) {
  const tip = _statInfoTooltipEl;
  if (!tip || !tip.classList.contains('show')) return;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const pad = 8;
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
  left = Math.max(pad, Math.min(left, vw - tipRect.width - pad));
  let top = rect.top - tipRect.height - 8;
  if (top < pad) top = Math.min(vh - tipRect.height - pad, rect.bottom + 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showStatInfoTooltip(target) {
  const text = String(target?.getAttribute('data-tip') || '').trim();
  if (!text) return;
  const tip = ensureStatInfoTooltipEl();
  tip.textContent = text;
  tip.classList.add('show');
  const rect = target.getBoundingClientRect();
  moveStatInfoTooltipFromRect(rect);
}

function hideStatInfoTooltip() {
  const tip = _statInfoTooltipEl;
  if (!tip) return;
  tip.classList.remove('show');
  tip.textContent = '';
}

function bindStatInfoTooltipEvents() {
  if (_statInfoTooltipBound) return;
  _statInfoTooltipBound = true;
  document.addEventListener('mouseover', (ev) => {
    const target = ev.target && ev.target.closest ? ev.target.closest('.analysis-info-tip.stat-tip[data-tip]') : null;
    if (!target) return;
    showStatInfoTooltip(target);
  });
  document.addEventListener('mouseout', (ev) => {
    const from = ev.target && ev.target.closest ? ev.target.closest('.analysis-info-tip.stat-tip[data-tip]') : null;
    if (!from) return;
    const to = ev.relatedTarget && ev.relatedTarget.closest ? ev.relatedTarget.closest('.analysis-info-tip.stat-tip[data-tip]') : null;
    if (to === from) return;
    hideStatInfoTooltip();
  });
  document.addEventListener('focusin', (ev) => {
    const target = ev.target && ev.target.closest ? ev.target.closest('.analysis-info-tip.stat-tip[data-tip]') : null;
    if (!target) return;
    showStatInfoTooltip(target);
  });
  document.addEventListener('focusout', (ev) => {
    const from = ev.target && ev.target.closest ? ev.target.closest('.analysis-info-tip.stat-tip[data-tip]') : null;
    if (!from) return;
    hideStatInfoTooltip();
  });
  window.addEventListener('resize', () => {
    const active = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.analysis-info-tip.stat-tip[data-tip]') : null;
    if (!active || !_statInfoTooltipEl || !_statInfoTooltipEl.classList.contains('show')) return;
    moveStatInfoTooltipFromRect(active.getBoundingClientRect());
  });
  document.addEventListener('scroll', hideStatInfoTooltip, true);
  window.addEventListener('blur', hideStatInfoTooltip);
}

function bindScarabMetaTooltipEvents() {
  if (_scarabMetaTooltipBound) return;
  _scarabMetaTooltipBound = true;
  document.addEventListener('mouseover', (ev) => {
    const target = ev.target && ev.target.closest ? ev.target.closest('[data-scarab-tooltip]') : null;
    if (!target) return;
    showScarabMetaTooltip(target, ev);
  });
  document.addEventListener('mousemove', (ev) => {
    const active = ev.target && ev.target.closest ? ev.target.closest('[data-scarab-tooltip]') : null;
    if (!active) return;
    moveScarabMetaTooltip(ev);
  });
  document.addEventListener('mouseout', (ev) => {
    const from = ev.target && ev.target.closest ? ev.target.closest('[data-scarab-tooltip]') : null;
    if (!from) return;
    const to = ev.relatedTarget && ev.relatedTarget.closest ? ev.relatedTarget.closest('[data-scarab-tooltip]') : null;
    if (to === from) return;
    hideScarabMetaTooltip();
  });
  document.addEventListener('scroll', hideScarabMetaTooltip, true);
  window.addEventListener('blur', hideScarabMetaTooltip);
}

function applyScarabModifierTooltips(scopeEl) {
  if (!state._scarabMetaByName) return;
  bindScarabMetaTooltipEvents();
  const root = scopeEl && scopeEl.querySelectorAll ? scopeEl : document;
  const nodes = root.querySelectorAll('.scarab-name, .scarab-name-mobile');
  nodes.forEach((el) => {
    const baseName = el.classList.contains('scarab-name-mobile')
      ? (el.parentElement && el.parentElement.querySelector('.scarab-name')
          ? el.parentElement.querySelector('.scarab-name').textContent
          : el.textContent)
      : el.textContent;
    const tooltip = getScarabTooltipText(baseName || '');
    if (!tooltip) return;
    el.removeAttribute('title');
    el.setAttribute('aria-label', tooltip);
    el.setAttribute('data-scarab-tooltip', tooltip);
  });
}

function applyScarabModifierTooltipsForTabs() {
  ['tab-ninja', 'tab-atlas', 'tab-analysis'].forEach((id) => {
    const tab = document.getElementById(id);
    if (tab) applyScarabModifierTooltips(tab);
  });
}

async function fetchScarabMetadata() {
  if (!BACKEND_SCARAB_METADATA_URL) return;
  try {
    const res = await fetch(BACKEND_SCARAB_METADATA_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    const map = {};
    for (const item of items) {
      const name = String(item?.name || '').trim();
      if (!name) continue;
      map[normalizeScarabNameKey(name)] = {
        description: item?.description || null,
        modifiers: Array.isArray(item?.modifiers) ? item.modifiers : [],
        flavorText: item?.flavorText || null
      };
    }
    state._scarabMetaByName = map;
    state._scarabMetaLoaded = true;
    applyScarabModifierTooltipsForTabs();
  } catch (_e) {
    // No fallback: if metadata endpoint fails, we simply do not show modifier tooltips.
  }
}


// Instead of tracking historical ROI (which goes stale as prices shift), we use
// the observed scarab output distribution from logged sessions combined with
// current market prices to compute an expected value per input scarab.
//
//   Rate = sum(weight[scarab] x ninjaPrice[scarab]) / 3
//
// weight[scarab] = how often that scarab appears as a vendor output, normalized.
// Dividing by 3 because 3 scarabs in -> 1 scarab out.
// This is always current - only the weights are from data, prices are live.
// Computed from observed output weights and current market prices.
// No hardcoded fallback: if data isn't loaded yet, the estimator shows nothing.


async function fetchObservedWeights() {
  if (!POOL_API_URL) return;
  const league = document.getElementById('leagueSelect')?.value || '';
  try {
    const url = POOL_API_URL + '/api/aggregate?league=' + encodeURIComponent(league);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const providedWeights = data.weights && typeof data.weights === 'object' ? data.weights : null;
    const received = data.receivedByScarab || {};
    const totalReceived = Object.values(received).reduce((s, n) => s + (Number(n) || 0), 0);

    let weights = providedWeights;
    if (!weights && totalReceived > 0) {
      // Backward compatibility with older API payloads that return only raw received counts.
      weights = {};
      for (const [name, count] of Object.entries(received)) {
        const c = Number(count) || 0;
        if (c > 0) weights[name] = c / totalReceived;
      }
    }
    const hasWeights = !!(weights && Object.keys(weights).length > 0);
    const previousWeights = state._observedWeights && Object.keys(state._observedWeights).length > 0
      ? state._observedWeights
      : null;
    state._observedWeights = hasWeights ? weights : previousWeights;
    state._weightSessionCount = data.weightSessionCount || data.sessionCount || 0;
    state._weightTradeCount = data.weightTradeCount || data.totalTrades || data?.weightMeta?.totalTrades || 0;
    state._weightMeta = data.weightMeta || null;
    state._weightUnavailableReason = hasWeights ? null : (data?.weightMeta?.reason || 'Not enough community data for weighted mode yet.');

    if (!hasWeights) {
      if (previousWeights) {
        // Keep last known good weights to avoid transient weighted-mode/chart flicker.
        state._weightUnavailableReason = data?.weightMeta?.reason || state._weightUnavailableReason || 'Using last known weight snapshot.';
        calcEstimator();
        if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
        return;
      }
      state._calibratedMean = null;
      state._calibratedP20 = null;
      state._calibratedRate = null;
      if (state._evMode === 'weighted') {
        setEVMode('harmonic');
        const threshModeEl = document.getElementById('thresholdModeLabel');
        if (threshModeEl) threshModeEl.textContent = 'harmonic EV';
      }
      calcEstimator();
      if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
      if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
      return;
    }

    if (state.ninjaLoaded && state._observedWeights) {
      const result = computeWeightBasedRate();
      if (result) {
        state._calibratedMean = result.mean;
        state._calibratedP20  = result.conservative;
        state._calibratedRate = result.conservative;
      }
      calcEstimator();
      if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
      // If user already switched to weighted mode before data arrived, apply it now
      if (state._evMode === 'weighted') {
        state.ninjaEvOverride = null;
        try { localStorage.removeItem('poepool28v2-ninja-evoverride'); } catch(e) {}
        recalculateVendorTargets();
        renderVendorTable();
      }
      // If atlas tab is open, render it now that weights are available
      if (state.currentTab === 'atlas') renderAtlas();
      if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
    }
  } catch(e) { /* silent \u2014 estimator shows nothing until data is available */ }
}

function computeLoopVendorRate(threshold) {
  if (!state._observedWeights || !state.ninjaLoaded) return null;
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  const lower = buildNinjaLookup();

  const pairs = [];
  for (const s of SCARAB_LIST) {
    const price = getNinjaPrice(s.name, lower);
    if (price <= 0) continue;
    const weight = state._observedWeights[s.name] || 0;
    pairs.push({ price, weight });
  }
  if (!pairs.length) return null;

  const totalWeight = pairs.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return null;

  let pVendor = 0;
  let sKeep = 0;
  for (const p of pairs) {
    const w = p.weight / totalWeight;
    if (p.price <= threshold) pVendor += w;
    else sKeep += w * p.price;
  }

  const denom = 3 - pVendor;
  if (denom <= 0) return null;
  const loopRate = sKeep / denom;
  if (!Number.isFinite(loopRate) || loopRate <= 0) return null;

  return { loopRate, pVendor };
}





async function fetchPriceHistory() {
  if (!WORKER_URL) return;
  try {
    const league = document.getElementById('leagueSelect')?.value || 'Mirage';
    const res = await fetch(`${WORKER_URL}?league=${encodeURIComponent(league)}&type=PriceHistory`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.prices && Object.keys(data.prices).length > 0) {
      state._priceHistory = data.prices;
      if (state.ninjaLoaded) renderVendorTable();
      if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
      if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
    }
  } catch(e) { /* silent */ }
}

function toLocalDateKey(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getFinalSparklineSeries(scarabName) {
  const hist = state._priceHistory[scarabName];
  let workingHist = hist ? [...hist] : [];

  // Inject current live ninja price as the final point used for rendering/trend.
  if (state.ninjaLoaded) {
    const lower = buildNinjaLookup();
    const livePrice = getNinjaPrice(scarabName, lower);
    if (livePrice > 0) {
      const today = toLocalDateKey();
      workingHist = workingHist.filter(h => h.date !== today);
      workingHist.push({ date: today, price: livePrice, live: true });
    }
  }

  return [...workingHist].sort((a, b) => a.date.localeCompare(b.date));
}

function getSeriesTrendPercent(series) {
  if (!series || series.length < 2) return null;
  const first = series[0]?.price;
  const last = series[series.length - 1]?.price;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return (last - first) / first * 100;
}


// Returns % change from oldest to newest in the 7-day history for a scarab.
// null if fewer than 2 data points.
function getPriceTrend(scarabName) {
  return getSeriesTrendPercent(getFinalSparklineSeries(scarabName));
}

// % change shown only on hover via the global analysis tooltip.
function buildSparkline(scarabName) {
  const sorted = getFinalSparklineSeries(scarabName);

  if (sorted.length < 2) {
    if (sorted.length === 1) {
      return '<div class="sparkline-wrap"><svg width="100%" height="26" viewBox="0 0 56 28" preserveAspectRatio="none"><circle cx="28" cy="14" r="2.5" fill="var(--text-3)"/></svg></div>';
    }
    return '<div class="sparkline-wrap"><svg width="100%" height="26" viewBox="0 0 56 28" preserveAspectRatio="none"><line x1="4" y1="14" x2="52" y2="14" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,2"/></svg></div>';
  }
  const prices = sorted.map(h => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const W = 56, H = 28, padX = 3, padY = 4;
  const range = max - min || max * 0.1 || 1;

  const xs = prices.map((_, i) => padX + (i / (prices.length - 1)) * (W - padX * 2));
  const ys = prices.map(p => H - padY - ((p - min) / range) * (H - padY * 2));

  function catmullToBezier(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 4;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 4;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 4;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 4;
      d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  }

  const pts = xs.map((x, i) => [x, ys[i]]);
  const linePath = catmullToBezier(pts);

  // Fill path: line path + down to bottom-right + across to bottom-left + close
  const lastX = xs[xs.length - 1];
  const firstX = xs[0];
  const fillPath = `${linePath} L ${lastX.toFixed(2)},${(H - padY + 2).toFixed(2)} L ${firstX.toFixed(2)},${(H - padY + 2).toFixed(2)} Z`;

  const pct = getSeriesTrendPercent(sorted);
  const isUp   = pct !== null && pct > 1;
  const isDown = pct !== null && pct < -1;
  const strokeColor = isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--text-3)';
  const fillId = `sf-${scarabName.replace(/[^a-z0-9]/gi, '')}`;
  const fillColor = isUp ? '#1e9c52' : isDown ? '#d63a2c' : '#727890';
  const pctLabel = pct === null ? 'no data' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';

  // End dot position
  const endX = xs[xs.length - 1];
  const endY = ys[ys.length - 1];

  const safeName = (scarabName || '').replace(/'/g, '&apos;').replace(/"/g, '&quot;');

  return `<div class="sparkline-wrap">
    <svg class="sparkline-svg" width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
      onmouseenter="showSparkTooltip(event,'${safeName}','${pctLabel}')"
      onmouseleave="hideSparkTooltip()">
      <defs>
        <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${fillColor}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${fillColor}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${fillPath}" fill="url(#${fillId})" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle class="spark-dot" cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="2.5" fill="${strokeColor}"/>
    </svg>
  </div>`;
}

function showSparkTooltip(e, name, pct) {
  const tip = document.getElementById('analysisBarTooltip');
  if (!tip) return;
  tip.textContent = `${name} \u00B7 ${pct}`;
  tip.classList.add('show');
  tip.style.left = (e.clientX + 12) + 'px';
  tip.style.top  = (e.clientY - 4) + 'px';
}
function hideSparkTooltip() {
  const tip = document.getElementById('analysisBarTooltip');
  if (tip) tip.classList.remove('show');
}

function getDailySnapshotLocalTimeLabel() {
  try {
    const now = new Date();
    const utcSlot = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      DAILY_SNAPSHOT_UTC_HOUR,
      0,
      0
    ));
    const formatted = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(utcSlot);
    return formatted;
  } catch (_e) {
    return `${DAILY_SNAPSHOT_UTC_HOUR}:00 UTC`;
  }
}

function updateDailySnapshotCopy() {
  const el = document.getElementById('evSnapshotTimeLabel');
  if (!el) return;
  el.textContent = `Daily EV snapshot at ${getDailySnapshotLocalTimeLabel()}`;
}

// Theme
const savedTheme = localStorage.getItem('poepool-theme') || 'dark';
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme','dark');
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('poepool-theme', isDark ? 'light' : 'dark');
  if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
  else fetchAndRenderEVChart();
  if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
  else fetchAndRenderAtlasTrendPreview();
}

// TABS
function switchTab(tab, skipHash) {
  state.currentTab = tab;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-drawer-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  const drawerItem = document.querySelector(`.nav-drawer-item[onclick*="${tab}"]`);
  if (drawerItem) drawerItem.classList.add('active');
  const tabNames = { ninja:'Scarab Vendor', atlas:'Atlas Optimizer', bulk:'Bulk Buy Analyzer', logger:'Session Logger', analysis:'Data Analysis', faq:'FAQ' };
  const currentTabEl = document.getElementById('navCurrentTab');
  if (currentTabEl) currentTabEl.textContent = tabNames[tab] || tab;
  if (!skipHash) {
    const newHash = '#' + (tab === 'ninja' ? 'scarabEV' : tab);
    if (window.location.hash !== newHash) history.replaceState(null, '', newHash);
  }
  if (tab === 'ninja') { if (!state.ninjaLoaded) fetchMarketScarabPrices(); else renderVendorTable(); }
  if (tab === 'analysis') { if (!state.ninjaLoaded) fetchMarketScarabPrices(); else if (!state.ninjaDivineRate) fetchMarketScarabPrices(); renderAnalysis(); }
  if (tab === 'atlas') { if (!state._observedWeights) fetchObservedWeights(); renderAtlas(); }
  if (tab === 'faq') initFaq();
  if (tab === 'logger') renderSessionHistory();
}

function toggleHamburger() {
  const btn     = document.getElementById('hamBtn');
  const drawer  = document.getElementById('navDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const open    = drawer.classList.contains('open');
  btn.classList.toggle('open', !open);
  drawer.classList.toggle('open', !open);
  overlay.classList.toggle('open', !open);
  document.body.style.overflow = !open ? 'hidden' : '';
}

// Load tab from URL hash on page load, and listen for back/forward navigation

function toggleLoggerHowTo() {
  const body    = document.getElementById('loggerHowToBody');
  const chevron = document.getElementById('loggerHowToChevron');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
}


function initFaq() {
  const list = document.getElementById('faq-list');
  if (!list) return;
  list.innerHTML = ''; // always rebuild fresh

  FAQ_SECTIONS.forEach((section, i) => {
    const id = `faq-item-${i}`;
    const bodyId = `faq-body-${i}`;
    const chevronId = `faq-chevron-${i}`;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div onclick="toggleFaqItem('${bodyId}','${chevronId}','${id}')" class="faq-question" style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:9px 14px;background:var(--bg-table-head);border:1px solid var(--border);border-radius:7px;transition:background 0.15s" onmouseover="this.style.background='var(--bg-row-alt)'" onmouseout="this.style.background='var(--bg-table-head)'" id="${id}">
      <span style="font-size:24px;font-weight:700;color:var(--accent);transition:transform 0.15s;line-height:1;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;overflow:visible;transform-origin:center center" id="${chevronId}">&#9656;</span>
        <span class="faq-question-title" style="font-size:12px;font-weight:600;color:var(--text-2)">${section.title}</span>
      </div>
      <div id="${bodyId}" class="faq-body" style="display:none;margin-top:2px;background:var(--bg-card);border:1px solid var(--border);border-top:none;border-radius:0 0 7px 7px;padding:14px 18px;font-size:12px;line-height:1.8">
        ${section.body}
      </div>
    `;
    list.appendChild(wrapper);
  });
}

function toggleFaqItem(bodyId, chevronId, questionId) {
  const body    = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  const question = questionId ? document.getElementById(questionId) : null;
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
  if (question) question.classList.toggle('open', !open);
}

// EV CALCULATION (harmonic mean, floored)



// Each token is a short, pre-validated unique substring that matches exactly
// one scarab and nothing else in the PoE item tooltip. Mirrors the approach
// used by poe.re/#/scarab. The regex is simply token1|token2|... for all
// vendor-targeted scarabs, joined and wrapped in quotes.

// vendorNames = names to match; keepNames kept for API compat but unused (poe.re tokens are pre-validated)
function syncLoggerRegex() {
  if (state._loggerRegexUserEdited) return;
  const body = document.getElementById('n-regexBody');
  const field = document.getElementById('loggerRegex');
  if (!body || !field) return;
  const regex = body.querySelector('.regex-empty-msg') ? '' : body.textContent.trim();
  field.value = regex;
  setLoggerRegexMode(false);
  if (regex) {
    const { matched, unmatched } = parseRegexToScarabs(regex);
    let hint = `${matched.length} scarab types identified`;
    if (unmatched.length) hint += ` \u00B7 ${unmatched.length} unrecognised tokens: ${unmatched.join(', ')}`;
    document.getElementById('loggerRegexHint').textContent = hint;
  } else {
    document.getElementById('loggerRegexHint').textContent = '';
  }
}

function updateRegexUI(prefix, vendorNames, keepNames) {
  const result = vendorNames.length ? buildRegex(vendorNames) : { regex: null };
  const body = document.getElementById(`${prefix}-regexBody`);
  const pill = document.getElementById(`${prefix}-charPill`);
  const warn = document.getElementById(`${prefix}-regexWarn`);

if (result.regex) {
  const innerLen = result.tokens.join('|').length;
  const over = result.overLimit;

  // NEW LOGIC: If over limit, show inverse regex with ! prefix
  if (over && keepNames.length) {
    const chaosResult = buildRegex(keepNames);
    if (chaosResult.regex) {
      // Show the inverse regex with ! prefix when main regex is over limit
      const invertedRegex = chaosResult.regex.replace(/^"(.*)"$/, '"!$1"');
      body.innerHTML = invertedRegex;
      body.style.color = 'var(--chaos)';
      
      // Update pill to show inverse regex length
      const chaosInnerLen = chaosResult.tokens.join('|').length;
      pill.textContent = `${chaosInnerLen} / ${CHAR_LIMIT}`;
      pill.className = 'char-pill ' + (chaosInnerLen <= Math.floor(CHAR_LIMIT * 0.89) ? 'ok' : chaosInnerLen <= CHAR_LIMIT ? 'warn' : 'over');
      
      // No warning needed - seamless experience
      warn.className = 'regex-warn';
    }
  } else {
    // Normal behavior when under limit or no inverse available
    body.textContent = result.regex;
    body.style.color = over ? 'var(--red)' : '';
    pill.textContent = `${innerLen} / ${CHAR_LIMIT}`;
    pill.className = 'char-pill ' + (innerLen <= Math.floor(CHAR_LIMIT * 0.89) ? 'ok' : innerLen <= CHAR_LIMIT ? 'warn' : 'over');
    
    // Keep existing warnings for collateral/uncovered but remove the over limit warning
    const msgs = [];
    
    if (result.collateral && result.collateral.length > 0) {
      const names = result.collateral.map(n => n.split(' ').slice(-2).join(' '));
      msgs.push(`- <strong>Collateral:</strong> regex also matches ${[...new Set(names)].join(', ')} \u2014 skip those when vendoring.`);
    }
    
    if (result.uncovered && result.uncovered.length > 0) {
      msgs.push(`- <strong>Uncovered:</strong> ${result.uncovered.map(n => n.split(' ').pop()).join(', ')} could not be included without matching 2+ keepers.`);
    }
    
    if (msgs.length) {
      warn.innerHTML = msgs.join('<br>');
      warn.className = 'regex-warn show';
    } else {
      warn.className = 'regex-warn';
    }
  }
} else {
  // No regex case
  body.innerHTML = `<span class="regex-empty-msg">${prefix === 'm' ? 'Enter prices to generate regex' : 'Load live price data to generate regex'}</span>`;
  body.style.color = '';
  pill.textContent = `0 / ${CHAR_LIMIT}`;
  pill.className = 'char-pill ok';
  warn.className = 'regex-warn';
}


  
  if (prefix === 'n') syncLoggerRegex();
}


// NINJA TAB



try { const o = localStorage.getItem('poepool28v2-ninja-evoverride'); if (o) state.ninjaEvOverride = parseFloat(o); } catch(e) {}
try {
  const savedEvChartRange = String(localStorage.getItem(EV_CHART_RANGE_STORAGE_KEY) || '').toLowerCase();
  if (EV_CHART_RANGE_TO_DAYS[savedEvChartRange]) state._evChartRange = savedEvChartRange;
} catch (e) {}
try {
  const savedAtlasTrendRange = String(localStorage.getItem(ATLAS_TREND_RANGE_STORAGE_KEY) || '').toLowerCase();
  if (EV_CHART_RANGE_TO_DAYS[savedAtlasTrendRange]) state._atlasTrendRange = savedAtlasTrendRange;
} catch (e) {}

// items[i].id  ? name + image URL
configureScarabEngine({
  SCARAB_LIST,
  buildNinjaLookup,
  getNinjaPrice
});

async function fetchCurrentLeague() {
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}?type=CurrentLeague`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.league) return;
    const select = document.getElementById('leagueSelect');
    if (!select) return;
    // Update or add the current league option
    let currentOpt = select.querySelector('option[data-current]');
    if (!currentOpt) {
      currentOpt = document.createElement('option');
      currentOpt.setAttribute('data-current', '1');
      select.insertBefore(currentOpt, select.firstChild);
    }
    currentOpt.value = data.league;
    currentOpt.textContent = `${data.league} (current)`;
    // Remove any old hardcoded option with same name
    [...select.options].forEach(o => {
      if (!o.dataset.current && o.value === data.league) o.remove();
    });
    select.value = data.league;
  } catch(e) { /* breaks cleanly \u2014 no fallback */ }
}

async function fetchMarketScarabPrices() {
  if (state._marketFetchBusy) {
    state._marketFetchPending = true;
    return;
  }
  state._marketFetchBusy = true;
  const league = document.getElementById('leagueSelect').value;
  fetchAndRenderAtlasTrendPreview();
  fetchObservedWeights();
  const status = document.getElementById('ninjaStatus');
  const btn    = document.getElementById('refreshBtn');
  const hadPriorData = !!(state.ninjaLoaded && state.ninjaPrices && Object.keys(state.ninjaPrices).length > 0);
  const LOCAL_FALLBACK_MAX_AGE_MS = 15 * 60 * 1000;
  const WORKER_FETCH_TIMEOUT_MS = 7000;
  const WORKER_SNAPSHOT_KEY = 'scarabev-worker-snapshot-v1';
  status.textContent = 'Loading prices from poe.ninja...'; status.className = 'ninja-status loading';
  btn.disabled = true;
  state.ninjaDivineRate = null; // reset stale rate \u2014 will be refreshed from worker below

  const fetchWithTimeout = async (url, options, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || 5000));
    try {
      return await fetch(url, { ...(options || {}), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const loadStoredWorkerSnapshot = () => {
    try {
      const raw = localStorage.getItem(WORKER_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (String(parsed.league || '') !== String(league || '')) return null;
      const snapshotTimeMs = Number(parsed.snapshotTimeMs);
      if (!Number.isFinite(snapshotTimeMs) || snapshotTimeMs <= 0) return null;
      const ageMs = Date.now() - snapshotTimeMs;
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > LOCAL_FALLBACK_MAX_AGE_MS) return null;
      if (!parsed.rawPrices || typeof parsed.rawPrices !== 'object') return null;
      if (!parsed.rawImages || typeof parsed.rawImages !== 'object') return null;
      return { ...parsed, snapshotTimeMs, ageMs };
    } catch (_e) {
      return null;
    }
  };

  const persistWorkerSnapshot = (payload) => {
    try {
      const safe = payload && typeof payload === 'object' ? payload : null;
      if (!safe) return;
      localStorage.setItem(WORKER_SNAPSHOT_KEY, JSON.stringify(safe));
    } catch (_e) { /* silent */ }
  };

  try {
    const ourNames = new Set(SCARAB_LIST.map(s => s.name.toLowerCase()));
    const log = [];
    let staleExpiredSeen = false;

    const fmtAgeLabel = (ageSeconds) => {
      const s = Math.max(0, Number(ageSeconds) || 0);
      if (s < 60) return 'just now';
      const mins = Math.floor(s / 60);
      if (mins < 60) return mins === 1 ? '1 min ago' : `${mins} mins ago`;
      const hours = Math.floor(mins / 60);
      return hours === 1 ? '1 hr ago' : `${hours} hrs ago`;
    };

    function applyPrices(rawPrices, rawImages, label, meta) {
      rawPrices = (rawPrices && typeof rawPrices === 'object') ? rawPrices : {};
      rawImages = (rawImages && typeof rawImages === 'object') ? rawImages : {};
      const matchCount = Object.keys(rawPrices).filter(n => ourNames.has(n.toLowerCase())).length;
      if (matchCount < 10) { log.push(`[${label}] only ${matchCount} matched`); return false; }
      const top3 = Object.entries(rawPrices).filter(([n]) => ourNames.has(n.toLowerCase())).sort((a,b)=>b[1]-a[1]).slice(0,3);
      log.push(`[${label}] OK \u2014 ${matchCount} matched. Top: ${top3.map(([n,p])=>`${n.split(' ').pop()}=${p.toFixed(1)}c`).join(', ')}`);
      state.ninjaPrices = rawPrices;
      state.ninjaImages = rawImages;
      state.ninjaLoaded = true;
      try {
    // If observed weights were already fetched, recompute the calibrated rate now
    // that we have live ninja prices to pair them with
      if (state._observedWeights) {
        const result = computeWeightBasedRate();
        if (result) {
          state._calibratedMean = result.mean;
          state._calibratedP20 = result.conservative;
          state._calibratedRate = result.conservative;
        } else {
          state._calibratedMean = null;
          state._calibratedP20 = null;
          state._calibratedRate = null;
        }
      }

      // Check atlas revisit warning now that prices are live
      atlasCheckRevisitWarning();
      // Fetch real price history for sparklines

      const hasMeta = !!(meta && typeof meta === 'object');
      const lastSuccessAtRaw = hasMeta ? String(meta.lastSuccessAt || '') : '';
      const lastSuccessMs = lastSuccessAtRaw ? Date.parse(lastSuccessAtRaw) : NaN;
      const snapshotTimeMs = Number.isFinite(lastSuccessMs) ? lastSuccessMs : Date.now();
      const snapshotDate = new Date(snapshotTimeMs);
      if (hasMeta && meta.dataState === 'stale') {
        const ageLabel = fmtAgeLabel(meta.ageSeconds);
        status.textContent = `Prices loaded from cache \u00B7 ${ageLabel}`;
      } else {
        const timeStr = snapshotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        status.textContent = `Prices loaded from poe.ninja \u00B7 ${timeStr}`;
      }
      if (state.currentTab === 'atlas') renderAtlas();
      if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
      if (state.currentTab === 'analysis') renderAnalysis();
      status.className = 'ninja-status loaded';
      clearInterval(window._ninjaAgeTicker);
      window._ninjaPriceTime = snapshotDate;
      window._ninjaAgeTicker = setInterval(() => {
        const mins = Math.floor((Date.now() - window._ninjaPriceTime) / 60000);
        const statusEl = document.getElementById('ninjaStatus');
        if (!statusEl) return;
        const sourceLabel = hasMeta && meta.dataState === 'stale' ? 'Prices loaded from cache' : 'Prices loaded from poe.ninja';
        if (mins < 1) statusEl.textContent = `${sourceLabel} \u00B7 just now`;
        else if (mins === 1) statusEl.textContent = `${sourceLabel} \u00B7 1 min ago`;
        else statusEl.textContent = `${sourceLabel} \u00B7 ${mins} mins ago`;
      }, 30000);
      renderVendorTable();
      if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
      btn.disabled = false;
      if (WORKER_URL) {
        fetch(`${WORKER_URL}?league=${encodeURIComponent(league)}&type=Currency`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) return;
            try {
              const { rawPrices } = parseWorkerResponse(data);
              const d = rawPrices['Divine Orb'];
              if (d && d > 50) {
                state.ninjaDivineRate = d;
                calcEstimator();
                if (state.currentTab === 'analysis') renderAnalysis();
              }
            } catch(e) { /* silent */ }
          })
          .catch(() => { /* silent */ });
      }
      } catch (e) {
        log.push(`[Client] render error after price apply: ${e?.message || String(e)}`);
      }
      return true;
    }

    let workerAttempted = false;
    let workerOkParsed = false;

    // 1. Cloudflare Worker (new format)
    if (WORKER_URL) {
      const workerScarabUrl = `${WORKER_URL}?league=${encodeURIComponent(league)}&type=Scarab`;
      const workerAttemptStartedAt = Date.now();
      try {
        workerAttempted = true;
        status.textContent = 'Trying Cloudflare Worker...';
        log.push(`[Worker] GET ${workerScarabUrl}`);
        if (typeof navigator !== 'undefined') {
          log.push(`[Client] online=${String(navigator.onLine)}`);
        }
        const res = await fetchWithTimeout(
          workerScarabUrl,
          { cache: 'no-store' },
          WORKER_FETCH_TIMEOUT_MS
        );
        if (res.ok) {
          const data = await res.json();
          try {
            const meta = (data && typeof data === 'object' && data._meta && typeof data._meta === 'object') ? data._meta : null;
            if (meta && meta.dataState === 'stale') {
              const metaAgeMs = (Number(meta.ageSeconds) || 0) * 1000;
              if (metaAgeMs > LOCAL_FALLBACK_MAX_AGE_MS) {
                staleExpiredSeen = true;
                log.push('[Worker] stale snapshot exceeded local max age window');
                workerOkParsed = false;
                throw new Error('stale_snapshot_too_old');
              }
            }
            const parsed = parseWorkerResponse(data);
            const { rawPrices, rawImages } = parsed;
            if (parsed.priceHistory && Object.keys(parsed.priceHistory).length > 0) {
              state._priceHistory = parsed.priceHistory;
            }
            if (parsed.priceTotalChange && Object.keys(parsed.priceTotalChange).length > 0) {
              state._priceTotalChange = parsed.priceTotalChange;
            }
            workerOkParsed = true;
            if (applyPrices(rawPrices, rawImages, 'Worker', meta)) {
              const lastSuccessAtRaw = meta ? String(meta.lastSuccessAt || '') : '';
              const lastSuccessMs = lastSuccessAtRaw ? Date.parse(lastSuccessAtRaw) : NaN;
              persistWorkerSnapshot({
                league,
                snapshotTimeMs: Number.isFinite(lastSuccessMs) ? lastSuccessMs : Date.now(),
                rawPrices,
                rawImages,
                priceHistory: parsed.priceHistory && typeof parsed.priceHistory === 'object' ? parsed.priceHistory : {},
                priceTotalChange: parsed.priceTotalChange && typeof parsed.priceTotalChange === 'object' ? parsed.priceTotalChange : {}
              });
              btn.disabled = false;
              return;
            }
          } catch(e) { log.push(`[Worker] parse error: ${e.message}`); }
        } else {
          let errPayload = null;
          try { errPayload = await res.json(); } catch (_) { errPayload = null; }
          if (errPayload?.error === 'stale_expired') staleExpiredSeen = true;
          const errMeta = (errPayload && typeof errPayload === 'object' && errPayload._meta && typeof errPayload._meta === 'object')
            ? errPayload._meta
            : null;
          const errTag = errPayload?.error ? ` (${errPayload.error})` : '';
          const metaBits = [];
          if (errMeta?.dataState) metaBits.push(`dataState=${errMeta.dataState}`);
          if (Number.isFinite(Number(errMeta?.ageSeconds))) metaBits.push(`age=${Math.floor(Number(errMeta.ageSeconds))}s`);
          if (errMeta?.lastSuccessAt) metaBits.push(`lastSuccessAt=${errMeta.lastSuccessAt}`);
          log.push(`[Worker] HTTP ${res.status}${errTag}${metaBits.length ? ` | ${metaBits.join(' | ')}` : ''}`);
        }
      } catch(e) {
        const elapsedMs = Math.max(0, Date.now() - workerAttemptStartedAt);
        const errName = e?.name || 'Error';
        const errMsg = e?.message || String(e);
        log.push(`[Worker] request failed after ${elapsedMs}ms: ${errName}: ${errMsg}`);
        if (errName === 'AbortError') {
          log.push(`[Client] timeout exceeded (${WORKER_FETCH_TIMEOUT_MS}ms)`);
        }
        if (typeof navigator !== 'undefined') {
          log.push(`[Client] online=${String(navigator.onLine)}`);
        }
      }
    }

    const storedSnapshot = loadStoredWorkerSnapshot();
    if (storedSnapshot) {
      log.push(`[Client] storedWorkerSnapshotAge=${Math.max(0, Math.floor(storedSnapshot.ageMs / 1000))}s`);
    } else {
      log.push('[Client] no valid stored worker snapshot');
    }
    if (storedSnapshot && workerAttempted && !workerOkParsed) {
      if (storedSnapshot.priceHistory && typeof storedSnapshot.priceHistory === 'object' && Object.keys(storedSnapshot.priceHistory).length > 0) {
        state._priceHistory = storedSnapshot.priceHistory;
      }
      if (storedSnapshot.priceTotalChange && typeof storedSnapshot.priceTotalChange === 'object' && Object.keys(storedSnapshot.priceTotalChange).length > 0) {
        state._priceTotalChange = storedSnapshot.priceTotalChange;
      }
      const staleMeta = {
        dataState: 'stale',
        ageSeconds: Math.max(0, Math.floor(storedSnapshot.ageMs / 1000)),
        lastSuccessAt: new Date(storedSnapshot.snapshotTimeMs).toISOString()
      };
      if (applyPrices(storedSnapshot.rawPrices, storedSnapshot.rawImages, 'StoredWorkerSnapshot', staleMeta)) {
        status.textContent = staleExpiredSeen
          ? 'Refresh failed; showing last good worker snapshot (upstream cache expired)'
          : 'Refresh failed; showing last good worker snapshot';
        status.className = 'ninja-status loaded';
        btn.disabled = false;
        return;
      }
      log.push('[Client] stored worker snapshot was invalid for current table');
    }

    const priorAgeMs = window._ninjaPriceTime ? (Date.now() - new Date(window._ninjaPriceTime).getTime()) : Number.POSITIVE_INFINITY;
    const canUseLocalFallback = hadPriorData && Number.isFinite(priorAgeMs) && priorAgeMs <= LOCAL_FALLBACK_MAX_AGE_MS;
    if (hadPriorData) {
      const priorAgeSec = Math.max(0, Math.floor(priorAgeMs / 1000));
      log.push(`[Client] priorSnapshotAge=${priorAgeSec}s`);
    } else {
      log.push('[Client] no prior snapshot available');
    }
    if (canUseLocalFallback && workerAttempted && !workerOkParsed) {
      status.textContent = staleExpiredSeen
        ? 'Refresh failed; showing last good market snapshot (worker cache expired upstream)'
        : 'Refresh failed; showing last good market snapshot';
      status.className = 'ninja-status loaded';
      btn.disabled = false;
      return;
    }

    if (staleExpiredSeen) status.textContent = 'Market data unavailable (worker cache expired while upstream fetch failed)';
    else status.textContent = 'Failed to load prices from market worker';
    status.className = 'ninja-status error';
    if (canUseLocalFallback) {
      status.textContent = staleExpiredSeen
        ? 'Refresh failed; showing last good market snapshot (worker cache expired upstream)'
        : 'Refresh failed; showing last good market snapshot';
      status.className = 'ninja-status loaded';
      btn.disabled = false;
      return;
    }
    const logHtml = log.map(l => `<div style="margin:3px 0;font-size:10px;color:var(--text-3);font-family:monospace;word-break:break-all">${l}</div>`).join('');
    document.getElementById('n-tableBody').innerHTML = `<div style="padding:20px 24px;line-height:1.9;font-size:12px"><strong style="color:var(--red)">&#9888; Could not load data.</strong><br><br><details open><summary style="cursor:pointer;font-weight:600;color:var(--text-2)">Attempt log</summary><div style="margin-top:6px">${logHtml}</div></details></div>`;
    btn.disabled = false;
  } finally {
    state._marketFetchBusy = false;
    if (state._marketFetchPending) {
      state._marketFetchPending = false;
      fetchMarketScarabPrices();
    }
  }
}

function resetNinjaSort() {
  state.vendorSortMode = null;
  document.getElementById('n-resetSort').style.display = 'none';
  updateSortArrows();
  renderVendorTable();
}

function setNinjaSort(col) {
  if (state.vendorSortMode === null || !state.vendorSortMode.startsWith(col)) {
    state.vendorSortMode = col + '-asc';
  } else if (state.vendorSortMode === col + '-asc') {
    state.vendorSortMode = col + '-desc';
  } else {
    state.vendorSortMode = null;
  }
  const resetBtn = document.getElementById('n-resetSort');
  if (resetBtn) resetBtn.style.display = state.vendorSortMode ? '' : 'none';
  updateSortArrows();
  renderVendorTable();
}

function updateSortArrows() {
  // Instead of arrows, highlight the active column header
  ['name','group','trend','delta','chaosPerUnit','diff','action'].forEach(col => {
    const el = document.getElementById(`n-th-${col}`);
    if (!el) return;
    if (state.vendorSortMode && state.vendorSortMode.startsWith(col)) {
      el.style.color = 'var(--accent)';
    } else {
      el.style.color = '';
    }
  });
}

function recalculateVendorTargets() {
  const entries = getNinjaEntries();
  const priced = entries.filter(e => e.chaosEa > 0);
  const calcedEV = calcAutoEV(); // respects _evMode \u2014 harmonic or weighted
  const ev = state.ninjaEvOverride !== null ? state.ninjaEvOverride : calcedEV;
  const threshold = ev !== null ? ev : null;
  const belowEv = ev !== null ? priced.filter(e => e.chaosEa <= ev) : [];

  const modeTag = state._evMode === 'weighted' ? 'weighted EV' : 'harmonic EV';
  const evLabel = state.ninjaEvOverride !== null
    ? ev.toFixed(2) + 'c (manual)'
    : (calcedEV !== null ? calcedEV.toFixed(2) + 'c' : '\u2014');
  const threshModeEl = document.getElementById('thresholdModeLabel');
  if (threshModeEl && state.ninjaEvOverride === null) threshModeEl.textContent = modeTag;
  const statEV = document.getElementById('n-statEV'); if (statEV) statEV.textContent = evLabel;
  const statTgt = document.getElementById('n-statTargets'); if (statTgt) statTgt.textContent = ev !== null ? belowEv.length : '\u2014';
  const threshEl = document.getElementById('n-statThresh'); if (threshEl) threshEl.textContent = threshold !== null ? threshold.toFixed(2)+'c' : '\u2014';
  const visitsEl = document.getElementById('n-statVisits'); if (visitsEl) { const estQty = parseInt(document.getElementById('estimatorInput')?.value)||7500; visitsEl.textContent = '~'+Math.ceil(estQty/180).toLocaleString(); }
  const avgInEl = document.getElementById('n-statAvgInput');
  if (avgInEl) { const vp = belowEv.map(e=>e.chaosEa).filter(p=>p>0); avgInEl.textContent = vp.length ? (vp.reduce((s,p)=>s+p,0)/vp.length).toFixed(3)+'c' : '\u2014'; }
  const statProfEl = document.getElementById('n-statEstProfit'); if (statProfEl) statProfEl.textContent = '\u2014';
  // Muted EV + vendor targets in table header


  const aboveEv = priced.filter(e => e.chaosEa > ev);
  updateRegexUI('n', belowEv.map(e => e.name), aboveEv.map(e => e.name));
  syncSliderToEV(ev);
  return { ev, belowEv, priced };
}

function renderVendorTable() {
  const { ev, belowEv } = recalculateVendorTargets();
  const filter = document.getElementById('n-filter').value.toLowerCase();

  if (!state.ninjaLoaded) {
    document.getElementById('n-tableBody').innerHTML = '<div class="empty-row">Click Refresh to load poe.ninja prices.</div>';
    return;
  }

  const lower = buildNinjaLookup();
  const tbody = document.getElementById('n-tableBody');
  tbody.innerHTML = '';

  // Build flat item list
  let items = [];
  for (const s of SCARAB_LIST) {
    const ninjaPrice = getNinjaPrice(s.name, lower) || null;
    const chaosPerUnit = ninjaPrice;
    const isV = chaosPerUnit !== null && ev !== null && chaosPerUnit <= ev;
    if (state.vendorViewMode === 'vendor' && !isV) continue;
    if (state.vendorViewMode === 'keep' && isV) continue;
    if (filter && !s.name.toLowerCase().includes(filter)) continue;
    items.push({ ...s, chaosPerUnit, isV, ninjaPrice });
  }

  if (!items.length) { tbody.innerHTML='<div class="empty-row">No scarabs match the filter.</div>'; return; }

  // SORTED flat view
  if (state.vendorSortMode !== null) {
    const [col, dir] = state.vendorSortMode.split('-');
    const asc = dir === 'asc';
    const trendCache = {};
    const getTrendForSort = (name) => {
      if (!(name in trendCache)) trendCache[name] = getPriceTrend(name);
      return trendCache[name];
    };
    items.sort((a, b) => {
      let va, vb;
      if (col === 'name') {
        va = a.name; vb = b.name;
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (col === 'chaosPerUnit') {
        va = a.chaosPerUnit ?? Infinity; vb = b.chaosPerUnit ?? Infinity;
      } else if (col === 'diff') {
        va = (a.chaosPerUnit !== null && ev !== null) ? a.chaosPerUnit - ev : Infinity;
        vb = (b.chaosPerUnit !== null && ev !== null) ? b.chaosPerUnit - ev : Infinity;
      } else if (col === 'trend') {
        va = getTrendForSort(a.name) ?? (asc ? Infinity : -Infinity);
        vb = getTrendForSort(b.name) ?? (asc ? Infinity : -Infinity);
      } else if (col === 'delta') {
        va = getTrendForSort(a.name) ?? (asc ? Infinity : -Infinity);
        vb = getTrendForSort(b.name) ?? (asc ? Infinity : -Infinity);
      } else if (col === 'group') {
        va = a.group; vb = b.group;
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (col === 'action') {
        // asc = vendor targets first, desc = keepers first
        va = a.isV ? 0 : 1; vb = b.isV ? 0 : 1;
      }
      return asc ? va - vb : vb - va;
    });

    for (const s of items) {
      tbody.appendChild(buildVendorTableRow(s, ev));
    }
    applyScarabModifierTooltips(document.getElementById('tab-ninja'));
    return;
  }

  // GROUPED view (default)
  const activeOrder = state.groupOrderMode === 'alpha' ? ALPHA_ORDER : INGAME_ORDER;
  const groups = {};
  for (const s of items) {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  }
  const gnames = Object.keys(groups).sort((a,b) => {
    const ia = activeOrder.indexOf(a); const ib = activeOrder.indexOf(b);
    return (ia===-1?999:ia) - (ib===-1?999:ib);
  });

  for (const gname of gnames) {
    const gitems = groups[gname];
    const collapsed = state.collapsedVendorGroups.has(gname);
    const gh = document.createElement('div');
    gh.className = 'group-header'+(collapsed?' collapsed':'');
    const vendorCount = gitems.filter(i=>i.isV).length;
    gh.innerHTML = `<span class="group-name">${gname}</span><span class="group-count">${gitems.length}</span>${vendorCount>0?`<span class="group-ev-badge">${vendorCount} vendor</span>`:''}<span class="group-chevron">&#9656;</span>`;
    gh.onclick = () => { state.collapsedVendorGroups.has(gname)?state.collapsedVendorGroups.delete(gname):state.collapsedVendorGroups.add(gname); renderVendorTable(); };
    tbody.appendChild(gh);
    if (collapsed) continue;
    for (const s of gitems) {
      tbody.appendChild(buildVendorTableRow(s, ev));
    }
  }
  applyScarabModifierTooltips(document.getElementById('tab-ninja'));
}

function buildVendorTableRow(s, ev) {
  const row = document.createElement('div');
  row.className = 'scarab-row ninja-row'+(s.isV?' vendor-target':'');

  let diffHtml = '<span style="color:var(--text-3)">\u2014</span>';
  if (s.chaosPerUnit !== null && ev !== null) {
    const d = s.chaosPerUnit - ev;
    diffHtml = d<=0 ? `<span class="ev-diff below">&darr; ${Math.abs(d).toFixed(2)}c</span>` : `<span class="ev-diff above">&uarr; ${d.toFixed(2)}c</span>`;
  }

  const imgSrc = getNinjaImage(s.name) || `${CDN}${s.icon}`;
  const priceDisplay = s.chaosPerUnit !== null ? s.chaosPerUnit.toFixed(2)+'c' : '\u2014';

  const priceCell = document.createElement('div');
  priceCell.className = 'td right td-price';
  priceCell.innerHTML = `
      <div class="price-cell">
        <span class="price-val">${priceDisplay}</span>
      </div>`;

  row.innerHTML = `
    <div class="td icon-cell">
      <div class="icon-wrap"><img class="scarab-icon" src="${imgSrc}" alt="" loading="lazy" onerror="this.style.opacity='0.15'"></div>
    </div>
    <div class="td"><div class="scarab-name-cell">
      <span class="vendor-dot"></span>
      <span class="scarab-name">${s.name}</span><span class="scarab-name-mobile">${mobileScarabName(s.name)}</span>
      ${s.isNew?'<span class="new-badge">NEW</span>':''}
    </div></div>
    <div class="td td-group" style="color:var(--text-3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.group}</div>
  `;
  const trendCell = document.createElement('div');
  trendCell.className = 'td center td-trend';
  trendCell.innerHTML = buildSparkline(s.name);
  row.appendChild(trendCell);

  const deltaCell = document.createElement('div');
  deltaCell.className = 'td right td-delta';
  const tc = getPriceTrend(s.name);
  if (tc != null) {
    const isUp = tc > 1; const isDn = tc < -1;
    const col = isUp ? 'var(--green)' : isDn ? 'var(--red)' : 'var(--text-3)';
    const sign = tc > 0 ? '+' : '';
    deltaCell.innerHTML = `<span style="font-size:11px;font-variant-numeric:tabular-nums;color:${col}">${sign}${tc.toFixed(1)}%</span>`;
  } else {
    deltaCell.innerHTML = '<span style="color:var(--text-3);font-size:11px">\u2014</span>';
  }
  row.appendChild(deltaCell);
  row.appendChild(priceCell);
  row.insertAdjacentHTML('beforeend', `
    <div class="td center td-diff">${diffHtml}</div>
    <div class="td center td-action"><span class="vendor-badge">VENDOR</span></div>
  `);
  return row;
}

function setNinjaView(v) {
  state.vendorViewMode = v;
  ['all','vendor','keep'].forEach(m => {
    document.getElementById(`n-view${m.charAt(0).toUpperCase()+m.slice(1)}`).classList.toggle('active', m===v);
  });
  renderVendorTable();
}


// THRESHOLD SLIDER

function initSlider() {
  const marker = document.getElementById('sliderMarker');
  const slider = document.getElementById('thresholdSlider');
  if (!marker || !slider) return;
  marker.style.display = 'none';
  refreshSliderScale(calcAutoEV() || 0.38);

  // Safety reset: if a prior interaction left slider RAF state stale,
  // clear it as soon as the user starts a new pointer interaction.
  slider.addEventListener('pointerdown', (e) => {
    _sliderDragActive = true;
    setMarkerResetInteractivity(false);
    try { slider.setPointerCapture?.(e.pointerId); } catch(err) {}
    if (_sliderInputRaf !== null) {
      cancelAnimationFrame(_sliderInputRaf);
      _sliderInputRaf = null;
    }
    _pendingSliderInput = null;
  });
  const endDrag = (e) => {
    try { if (e && e.pointerId !== undefined) slider.releasePointerCapture?.(e.pointerId); } catch(err) {}
    _sliderDragActive = false;
    setMarkerResetInteractivity(true);
  };
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // Show a default ROI reading while ninja loads
  updateSliderROI(state.ninjaEvOverride !== null ? state.ninjaEvOverride : 0.38);
}

const SLIDER_MAX_MULTIPLIER = 1.45;
const SLIDER_MAX_STEP = 0.25;
let _sliderMaxChaos = 1.0;

function roundUpToStep(value, step) {
  if (!Number.isFinite(value) || value <= 0) return step;
  return Math.ceil(value / step) * step;
}

function computeSliderMax(autoEV) {
  const base = Number.isFinite(autoEV) && autoEV > 0 ? autoEV : 0.38;
  return roundUpToStep(base * SLIDER_MAX_MULTIPLIER, SLIDER_MAX_STEP);
}

function refreshSliderScale(autoEV) {
  _sliderMaxChaos = computeSliderMax(autoEV);
  const maxLabel = document.getElementById('sliderMaxLabel');
  if (maxLabel) maxLabel.textContent = _sliderMaxChaos.toFixed(2) + 'c';
  return _sliderMaxChaos;
}

function sliderValueToThreshold(val) {
  const pct = Math.min(100, Math.max(0, parseFloat(val) || 0)) / 100;
  return Math.min(_sliderMaxChaos, Math.max(0, pct * _sliderMaxChaos));
}

function thresholdToSliderValue(threshold) {
  if (!_sliderMaxChaos || _sliderMaxChaos <= 0) return 0;
  return Math.min(100, Math.max(0, (threshold / _sliderMaxChaos) * 100));
}

function positionMarker(ev) {
  const marker = document.getElementById('sliderMarker');
  const slider = document.getElementById('thresholdSlider');
  if (!marker || !slider) return;
  const pct = _sliderMaxChaos > 0 ? Math.min(1, Math.max(0, ev / _sliderMaxChaos)) : 0;
  const thumbW = 14; // matches CSS width in px
  // Browser positions thumb left edge at: pct * (trackW - thumbW)
  // So thumb center is at: pct * (trackW - thumbW) + thumbW/2
  // As a percentage of trackW: pct * (1 - thumbW/trackW) + (thumbW/2)/trackW
  // Simplified with CSS calc: calc(pct*100% * (100% - thumbW) / 100% + thumbW/2)
  marker.style.display = '';
  marker.style.left = `calc(${pct * 100}% - ${thumbW * pct}px + ${thumbW / 2}px)`;
  marker.setAttribute('data-label', '');

  let btn = document.getElementById('sliderMarkerBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'sliderMarkerBtn';
    marker.parentElement?.appendChild(btn);
  }
  btn.style.left = marker.style.left;
  const manual = state.ninjaEvOverride !== null;
  btn.className = 'slider-marker-btn ' + (manual ? 'is-reset' : 'is-auto');
  const resetPrefix = String.fromCodePoint(0x21BA) + ' ';
  btn.textContent = manual ? (resetPrefix + 'Reset to auto EV') : ('auto EV ' + ev.toFixed(2) + 'c');
  btn.type = 'button';
  if (manual) {
    btn.style.pointerEvents = _sliderDragActive ? 'none' : 'auto';
    btn.onclick = (e) => {
      if (_sliderDragActive) return;
      e.preventDefault();
      e.stopPropagation();
      resetSlider();
    };
  } else {
    btn.style.pointerEvents = '';
    btn.onclick = null;
  }
}

let _pendingSliderInput = null;
let _sliderInputRaf = null;
let _sliderDragActive = false;

function setMarkerResetInteractivity(enabled) {
  const btn = document.getElementById('sliderMarkerBtn');
  if (!btn || !btn.classList.contains('is-reset')) return;
  btn.style.pointerEvents = enabled ? 'auto' : 'none';
}

function applySliderChange(val) {
  const t = sliderValueToThreshold(val);
  document.getElementById('sliderValueDisplay').textContent = t.toFixed(2) + 'c';
  updateSliderROI(t);

  const autoEV = calcAutoEV();
  const autoRounded = autoEV ? thresholdToSliderValue(autoEV) : null;
  if (autoRounded !== null && parseInt(val, 10) === autoRounded) {
    state.ninjaEvOverride = null;
    try { localStorage.removeItem('poepool28v2-ninja-evoverride'); } catch(e) {}
    document.getElementById('thresholdModeLabel').textContent = 'auto EV';
    const resetBtn = document.getElementById('sliderResetBtn');
    if (resetBtn) resetBtn.style.display = 'none';
    recalculateVendorTargets();
    renderVendorTable();
    // Recalculate CSV-based vendor totals and profit using the current (auto) EV
    calcEstimator();
    return;
  }

  state.ninjaEvOverride = t;
  try { localStorage.setItem('poepool28v2-ninja-evoverride', t); } catch(e) {}
  document.getElementById('thresholdModeLabel').textContent = 'manual';
  const resetBtn = document.getElementById('sliderResetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  recalculateVendorTargets();
  renderVendorTable();
  // Recalculate CSV-based vendor totals and profit using the manual threshold
  calcEstimator();
}

function onSliderChange(val) {
  _pendingSliderInput = parseFloat(val);
  if (_sliderInputRaf !== null) return;
  _sliderInputRaf = requestAnimationFrame(() => {
    _sliderInputRaf = null;
    if (_pendingSliderInput === null) return;
    const next = _pendingSliderInput;
    _pendingSliderInput = null;
    applySliderChange(next);
  });
}

function resetSlider() {
  state.ninjaEvOverride = null;
  try { localStorage.removeItem('poepool28v2-ninja-evoverride'); } catch(e) {}
  document.getElementById('thresholdModeLabel').textContent = 'auto EV';
  const resetBtn = document.getElementById('sliderResetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  // Snap slider to auto EV value
  const autoEV = calcAutoEV();
  refreshSliderScale(autoEV || 0.38);
  if (autoEV) {
    const sliderVal = thresholdToSliderValue(autoEV);
    document.getElementById('thresholdSlider').value = Math.min(100, Math.max(0, sliderVal));
    document.getElementById('sliderValueDisplay').textContent = autoEV.toFixed(2) + 'c';
    updateSliderROI(autoEV);
  }
  recalculateVendorTargets();
  renderVendorTable();
  calcEstimator();
  if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
  else fetchAndRenderEVChart();
}

function toggleEVMode() {
  const current = state._evMode || 'harmonic';
  setEVMode(current === 'harmonic' ? 'weighted' : 'harmonic');
}

function setEVMode(mode) {
  state._evMode = mode;
  const pill = document.getElementById('evModePill');
  const thumb = document.getElementById('evModePillThumb');
  const label = document.getElementById('evModeLabel');
  if (pill) {
    const isWeighted = mode === 'weighted';
    pill.style.background = isWeighted ? 'var(--amber)' : 'var(--chaos)';
    if (thumb) thumb.style.transform = isWeighted ? 'translateX(16px)' : 'translateX(0)';
    if (label) { label.textContent = isWeighted ? 'Weighted' : 'Harmonic'; label.style.color = isWeighted ? 'var(--amber)' : 'var(--chaos)'; }
  }
  const btnH = document.getElementById('evModeHarmonic');
  const btnW = document.getElementById('evModeWeighted');
  if (btnH) btnH.classList.toggle('active', mode === 'harmonic');
  if (btnW) btnW.classList.toggle('active', mode === 'weighted');

  // Show/hide weighted warning
  const hint = document.getElementById('weightedEvWarning');
  const countEl = document.getElementById('weightedTradeCount');
  if (hint) hint.style.display = mode === 'weighted' ? '' : 'none';
  if (countEl) countEl.textContent = state._weightTradeCount > 0 ? state._weightTradeCount.toLocaleString() : '\u2014';

  // Only switch to weighted if data is ready
  if (mode === 'weighted' && state._calibratedMean === null) {
    const reason = state._weightUnavailableReason || 'waiting for weight data...';
    document.getElementById('thresholdModeLabel').textContent = reason;
    return setEVMode('harmonic');
  }
  // Reset to auto EV (no manual override) so the new mode takes effect immediately
  state.ninjaEvOverride = null;
  try { localStorage.removeItem('poepool28v2-ninja-evoverride'); } catch(e) {}
  const resetBtn = document.getElementById('sliderResetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  recalculateVendorTargets();
  renderVendorTable();
  calcEstimator();
  if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
  else fetchAndRenderEVChart();
}

function updateSliderROI(threshold) {
  const autoEV  = calcAutoEV() || 0.38;
  const sliderMax = refreshSliderScale(autoEV);
  const tier2End = autoEV + (sliderMax - autoEV) * 0.55;
  const roiEl   = document.getElementById('sliderROI');
  const hintEl  = document.getElementById('sliderHint');
  const weightedMode = state._evMode === 'weighted';
  const primaryGoodColor = weightedMode ? 'var(--amber)' : 'var(--green)';
  const warningZoneColor = weightedMode ? '#d4a72c' : 'var(--amber)';
  const dangerColor = 'var(--red)';

  // Compute real average price of vendor targets from live ninja prices.
  const lower = buildNinjaLookup();
  const vendorPrices = SCARAB_LIST
    .map(s => getNinjaPrice(s.name, lower))
    .filter(p => p > 0 && p <= threshold);
  const avgInput = vendorPrices.length
    ? vendorPrices.reduce((s, p) => s + p, 0) / vendorPrices.length
    : 0;
  const returnPerInput = state._calibratedRate || autoEV;
  const estROI = avgInput > 0 ? Math.round((returnPerInput - avgInput) / avgInput * 100) : 0;

  if (roiEl) {
    roiEl.textContent = `~${estROI}% ROI`;
    roiEl.className = 'threshold-roi ' + (estROI >= 0 ? 'roi-good' : 'roi-bad');
    roiEl.style.color = estROI >= 0 ? primaryGoodColor : dangerColor;
  }

  if (hintEl) {
    if (state.ninjaEvOverride === null) {
      hintEl.style.display = 'none';
      hintEl.textContent = '';
    } else if (threshold <= autoEV) {
      hintEl.style.display = '';
      hintEl.textContent = 'Safe vendor range';
      hintEl.style.color = primaryGoodColor;
    } else if (threshold <= tier2End) {
      hintEl.style.display = '';
      hintEl.textContent = 'Profit edge is thinning';
      hintEl.style.color = warningZoneColor;
    } else {
      hintEl.style.display = '';
      hintEl.textContent = 'Pray to RNG gods';
      hintEl.style.color = dangerColor;
    }
  }

  const cur = sliderMax > 0 ? Math.min(1, Math.max(0, threshold / sliderMax)) : 0;
  const safePct = sliderMax > 0 ? Math.min(1, Math.max(0, autoEV / sliderMax)) : 0;
  const cautionPct = sliderMax > 0 ? Math.min(1, Math.max(0, tier2End / sliderMax)) : safePct;
  const greenW = Math.min(cur, safePct) * 100;
  const amberW = cur > safePct ? Math.min(cautionPct - safePct, cur - safePct) * 100 : 0;
  const redW = cur > cautionPct ? (cur - cautionPct) * 100 : 0;

  const roiGreenSeg = document.getElementById('roiSegGreen');
  roiGreenSeg.style.width = greenW + '%';
  roiGreenSeg.style.background = primaryGoodColor;
  const roiAmberSeg = document.getElementById('roiSegAmber');
  roiAmberSeg.style.width = amberW + '%';
  roiAmberSeg.style.background = warningZoneColor;
  document.getElementById('roiSegRed').style.width   = redW   + '%';

  const marker = document.getElementById('sliderMarker');
  if (marker) {
    marker.style.background = primaryGoodColor;
    marker.style.color = 'var(--green)';
  }

  const beLabel = document.querySelector('.breakeven-label');
  if (beLabel) beLabel.style.color = primaryGoodColor;

  const valEl = document.getElementById('sliderValueDisplay');
  if (valEl) valEl.style.color = '';
}

function syncSliderToEV(ev) {
  const autoEV = calcAutoEV() || ev || 0.38;
  refreshSliderScale(autoEV);
  if (state.ninjaEvOverride !== null) {
    const slider = document.getElementById('thresholdSlider');
    if (slider) slider.value = thresholdToSliderValue(state.ninjaEvOverride);
    const display = document.getElementById('sliderValueDisplay');
    if (display) display.textContent = state.ninjaEvOverride.toFixed(2) + 'c';
    updateSliderROI(state.ninjaEvOverride);
    requestAnimationFrame(() => positionMarker(autoEV));
    calcEstimator();
    return;
  }
  const slider = document.getElementById('thresholdSlider');
  if (!slider || !autoEV) return;
  const val = thresholdToSliderValue(autoEV);
  slider.value = val;
  document.getElementById('sliderValueDisplay').textContent = autoEV.toFixed(2) + 'c';
  updateSliderROI(autoEV);
  requestAnimationFrame(() => positionMarker(autoEV));
  calcEstimator();
}

// PROFIT ESTIMATOR
// Estimator rates are computed dynamically from observed weight distribution
// See computeWeightBasedRate() and fetchObservedWeights().



function toggleEstimator() {
  document.getElementById('estimatorPanel').classList.toggle('collapsed');
}

function getDivineRate() {
  return state.ninjaDivineRate || null;
}

function fmtChaos(chaos) {
  return Math.round(Number(chaos) || 0) + 'c';
}

function fmtWithRate(chaos, divRate) {
  const c = Number(chaos) || 0;
  const r = Number(divRate) || 0;
  if (r > 0 && c / r >= 1) return (c / r).toFixed(1) + 'd';
  return fmtChaos(c);
}

function fmtEst(chaos, divRate) {
  return fmtWithRate(chaos, divRate);
}

function importWealthyCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = (e) => parseWealthyCSV(e.target.result);
  reader.readAsText(file);
}

function parseWealthyCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n').slice(1);
  const items = [];
  let totalQty = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 3) continue;
    const name = cols[0].replace(/"/g, '').trim();
    const qty  = parseInt(cols[2].replace(/"/g, '')) || 0;
    if (qty > 0) {
      items.push({ name, qty });
      totalQty += qty;
    }
  }

  if (items.length === 0) {
    const st = document.getElementById('n-infoText');
    if (st) st.innerHTML = 'No scarabs found in CSV \u2014 check the export format.';
    return;
  }

  // Store full CSV contents for this session; slider & EV decide which are vendor targets
  state._csvImportedItems = items;
  state.csvVendorQuantity = totalQty;
  window._csvFoundItems = null;

  const st = document.getElementById('csvStatus');
  if (st) st.textContent = `${items.length} scarab types \u00B7 ${totalQty.toLocaleString()} total scarabs`;
  document.getElementById('csvClearBtn').style.display = '';
  // Show breakdown collapsed by default
  document.getElementById('csvBreakdown').style.display = '';
  document.getElementById('csvBreakdownTable').style.display = 'none';
  renderCSVBreakdown();
  calcEstimator();
}

function toggleCSVBreakdown() {
  const table = document.getElementById('csvBreakdownTable');
  const chevron = document.getElementById('csvBreakdownChevron');
  if (!table) return;
  const open = table.style.display !== 'none';
  table.style.display = open ? 'none' : '';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
}

function renderCSVBreakdown(foundItems) {
  // We never recompute the threshold here to avoid divergence.
  const raw = state._csvImportedItems;
  if (!raw) return;

  const found = foundItems || window._csvFoundItems || [];
  const lower = buildNinjaLookup();
  const totalQty = found.reduce((s, f) => s + f.qty, 0);

  if (!found.length) {
    const st = document.getElementById('csvStatus');
    if (st) st.textContent = 'No vendor targets at current threshold';
    document.getElementById('csvBreakdownTable').innerHTML = '';
    return;
  }

  const st = document.getElementById('csvStatus');
  if (st) {
    const chevron = document.getElementById('csvBreakdownChevron');
    st.innerHTML = `<span id="csvBreakdownChevron" style="font-size:9px;color:var(--text-3);transition:transform 0.15s${document.getElementById('csvBreakdownTable')?.style.display !== 'none' ? ';transform:rotate(90deg)' : ''}">${chevron?.innerHTML || '&#9656;'}</span> ${found.length} scarab types \u00B7 ${totalQty.toLocaleString()} vendor targets`;
  }
  document.getElementById('csvBreakdownTable').innerHTML = found.map(f => {
    const livePrice = getNinjaPrice(f.name, lower);
    const priceStr = livePrice > 0 ? livePrice.toFixed(2) + 'c' : '\u2014';
    return `<div style="display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border);padding:2px 0">
      <span>${f.name}</span>
      <span style="color:var(--text-2);white-space:nowrap;font-weight:500">${f.qty.toLocaleString()} \u00D7 ${priceStr}</span>
    </div>`;
  }).join('');
}

function clearCSV() {
  state.csvVendorQuantity = null;
  state._csvImportedItems = null;
  window._csvFoundItems = null;
  const st = document.getElementById('csvStatus');
  if (st) st.textContent = '';
  document.getElementById('csvClearBtn').style.display = 'none';
  document.getElementById('csvBreakdown').style.display = 'none';
  calcEstimator();
}

function calcEstimator() {
  const lower = buildNinjaLookup();
  const threshold = state.ninjaEvOverride !== null ? state.ninjaEvOverride : calcAutoEV();

  let vendorQty = 0;
  let inputValue = 0; // current market value of scarabs being vendored (qty \u00D7 ninja price)

  if (state._csvImportedItems) {
    const found = [];
    for (const item of state._csvImportedItems) {
      const ninjaPrice = getNinjaPrice(item.name, lower);
      if (ninjaPrice > 0 && threshold !== null && ninjaPrice <= threshold) {
        vendorQty += item.qty;
        inputValue += item.qty * ninjaPrice;
        found.push({ name: item.name, qty: item.qty });
      }
    }
    window._csvFoundItems = found;
    renderCSVBreakdown(found);
  } else {
    window._csvFoundItems = null;
    renderCSVBreakdown([]);
  }

  renderEstimator(vendorQty, inputValue, getDivineRate(), threshold);
}

function renderEstimator(vendorQty, inputValue, divRate, threshold) {
  if (state._observedWeights && state.ninjaLoaded) {
    const result = computeWeightBasedRate();
    if (result) {
      state._calibratedMean  = result.mean;
      state._calibratedP20 = result.conservative;
      state._calibratedRate  = result.conservative;
    } else {
      state._calibratedMean = null;
      state._calibratedP20 = null;
      state._calibratedRate = null;
    }
  }

  const retEl      = document.getElementById('est-return');
  const profEl     = document.getElementById('est-profit');
  const inputEl    = document.getElementById('est-input');
  const inputSub   = document.getElementById('est-input-sub');
  const statProfEl = document.getElementById('n-statEstProfit');
  const statProfSub = document.getElementById('n-statEstProfitSub');
  const divRateEl  = document.getElementById('est-divine-rate-wrap');
  const noCSV      = state.csvVendorQuantity === null;

  // Footer: always show rate info once calibration is ready
  if (divRateEl) {
    if (state._calibratedRate !== null) {
      divRateEl.textContent = divRate ? `1d = ${divRate.toFixed(0)}c` : '';
    } else {
      divRateEl.textContent = divRate ? `1d = ${divRate.toFixed(0)}c` : '';
    }
  }

  if (noCSV) {
    if (inputEl)  { inputEl.textContent = '\u2014'; }
    if (inputSub) { inputSub.textContent = 'import your Wealthy Exile CSV to estimate'; inputSub.style.color = 'var(--amber)'; }
    const inputValueEl = document.getElementById('est-input-value');
    if (inputValueEl) inputValueEl.textContent = '\u2014';
    if (retEl)    { retEl.textContent = '\u2014'; }
    if (profEl)   { profEl.textContent = '\u2014'; profEl.className = 'estimator-card-value val-return'; }
    if (statProfEl)  { statProfEl.textContent = '\u2014'; statProfEl.className = 'stat-value'; }
    if (statProfSub) { statProfSub.textContent = ''; }
    return;
  }

  // Calibration data not ready yet
  if (state._calibratedRate === null) {
    if (inputEl)  { inputEl.textContent = vendorQty.toLocaleString(); }
    if (inputSub) { inputSub.textContent = 'loading calibration data...'; inputSub.style.color = 'var(--text-3)'; }
    const inputValueEl = document.getElementById('est-input-value');
    if (inputValueEl) inputValueEl.textContent = '\u2014';
    if (retEl)    { retEl.textContent = '\u2014'; }
    if (profEl)   { profEl.textContent = '\u2014'; profEl.className = 'estimator-card-value val-return'; }
    return;
  }

  const loopRate = computeLoopVendorRate(threshold);
  const rateUsed = loopRate?.loopRate ?? state._calibratedRate;
  const retChaos  = vendorQty * rateUsed;  // expected keeper value from vendor outputs
  const profChaos = retChaos - inputValue;          // net vs just selling at market (usually negative \u2014 vendoring costs value)

  if (inputEl)       { inputEl.textContent = vendorQty.toLocaleString(); }
  if (inputSub)      { inputSub.textContent = 'from your Wealthy Exile CSV'; inputSub.style.color = 'var(--text-3)'; }

  const inputValueEl = document.getElementById('est-input-value');
  if (inputValueEl)  { inputValueEl.textContent = fmtEst(inputValue, divRate); }

  if (retEl) { retEl.textContent = fmtEst(retChaos, divRate); }

  if (profEl) {
    profEl.textContent = (profChaos >= 0 ? '+' : '') + fmtEst(Math.abs(profChaos), divRate);
    profEl.className   = 'estimator-card-value ' + (profChaos >= 0 ? 'val-profit' : 'val-roi');
  }
  if (statProfEl) {
    statProfEl.textContent = (profChaos >= 0 ? '+' : '') + fmtEst(Math.abs(profChaos), divRate);
    statProfEl.className   = 'stat-value ' + (profChaos >= 0 ? 'green' : 'red');
  }
  if (statProfSub) { statProfSub.textContent = `at ${vendorQty.toLocaleString()} scarabs`; }
}


// INIT
// Restore ninja EV override to slider position if saved
if (state.ninjaEvOverride !== null) {
  refreshSliderScale(calcAutoEV() || 0.38);
  const sliderVal = thresholdToSliderValue(state.ninjaEvOverride);
  const slider = document.getElementById('thresholdSlider');
  if (slider) {
    slider.value = sliderVal;
    const display = document.getElementById('sliderValueDisplay');
    if (display) display.textContent = state.ninjaEvOverride.toFixed(2) + 'c';
    const modeLabel = document.getElementById('thresholdModeLabel');
    if (modeLabel) modeLabel.textContent = 'manual';
    const resetBtn = document.getElementById('sliderResetBtn');
    if (resetBtn) resetBtn.style.display = 'none';
  }
}
// EV HISTORY CHART


function toggleEVChart() {
  document.getElementById('evChartPanel').classList.toggle('collapsed');
}

function getEVChartWindowDays() {
  const key = String(state._evChartRange || '30d').toLowerCase();
  return EV_CHART_RANGE_TO_DAYS[key] || EV_CHART_RANGE_TO_DAYS['30d'];
}

function syncEVChartRangeControls() {
  const current = String(state._evChartRange || '30d').toLowerCase();
  const controls = document.querySelectorAll('.ev-range-option[data-range]');
  controls.forEach((btn) => {
    const range = String(btn.getAttribute('data-range') || '').toLowerCase();
    const isActive = range === current;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.hidden = false;
    btn.tabIndex = 0;
  });
}

function setEVChartRange(range, ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (ev && ev.currentTarget && typeof ev.currentTarget.blur === 'function') ev.currentTarget.blur();
  const normalized = String(range || '').toLowerCase();
  if (!EV_CHART_RANGE_TO_DAYS[normalized]) return;
  state._evChartRange = normalized;
  try { localStorage.setItem(EV_CHART_RANGE_STORAGE_KEY, normalized); } catch (e) {}
  syncEVChartRangeControls();
  if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
  else fetchAndRenderEVChart();
}

function toggleAtlasTrendPreview() {
  const panel = document.getElementById('atlasTrendPreview');
  if (!panel) return;
  panel.classList.toggle('collapsed');
}

function colorWithAlpha(color, alpha) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const r = Number(data[0] || 0);
  const g = Number(data[1] || 0);
  const b = Number(data[2] || 0);
  return `rgba(${r},${g},${b},${alpha})`;
}

function setAtlasTrendPreviewEmpty(message) {
  const canvas = document.getElementById('atlasTrendPreviewChart');
  const empty = document.getElementById('atlasTrendPreviewEmpty');
  if (state._atlasTrendPreviewChart) {
    state._atlasTrendPreviewChart.destroy();
    state._atlasTrendPreviewChart = null;
  }
  if (canvas) canvas.style.display = 'none';
  if (empty) {
    empty.textContent = message || 'No Atlas EV history available yet.';
    empty.hidden = false;
  }
}

function showAtlasTrendPreviewChart() {
  const canvas = document.getElementById('atlasTrendPreviewChart');
  const empty = document.getElementById('atlasTrendPreviewEmpty');
  if (canvas) canvas.style.display = 'block';
  if (empty) empty.hidden = true;
}

function getAtlasTrendWindowDays() {
  const key = String(state._atlasTrendRange || '30d').toLowerCase();
  return EV_CHART_RANGE_TO_DAYS[key] || EV_CHART_RANGE_TO_DAYS['30d'];
}

function syncAtlasTrendRangeControls() {
  const current = String(state._atlasTrendRange || '30d').toLowerCase();
  const controls = document.querySelectorAll('.atlas-range-option[data-range]');
  controls.forEach((btn) => {
    const range = String(btn.getAttribute('data-range') || '').toLowerCase();
    const isActive = range === current;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setAtlasTrendRange(range, ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (ev && ev.currentTarget && typeof ev.currentTarget.blur === 'function') ev.currentTarget.blur();
  const normalized = String(range || '').toLowerCase();
  if (!EV_CHART_RANGE_TO_DAYS[normalized]) return;
  state._atlasTrendRange = normalized;
  try { localStorage.setItem(ATLAS_TREND_RANGE_STORAGE_KEY, normalized); } catch (e) {}
  syncAtlasTrendRangeControls();
  if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
  else fetchAndRenderAtlasTrendPreview();
}

async function fetchAndRenderAtlasTrendPreview() {
  const requestId = (Number(state._atlasTrendFetchSeq) || 0) + 1;
  state._atlasTrendFetchSeq = requestId;
  if (!WORKER_URL) {
    if (requestId !== state._atlasTrendFetchSeq) return;
    setAtlasTrendPreviewEmpty('Atlas EV history endpoint is not configured.');
    return;
  }
  const league = document.getElementById('leagueSelect')?.value || 'Mirage';
  try {
    const res = await fetch(`${WORKER_URL}?type=AtlasEVHistory&league=${encodeURIComponent(league)}`, { cache: 'no-store' });
    if (requestId !== state._atlasTrendFetchSeq) return;
    if (!res.ok) {
      setAtlasTrendPreviewEmpty('Could not load Atlas EV history.');
      return;
    }
    const data = await res.json();
    if (requestId !== state._atlasTrendFetchSeq) return;
    const history = Array.isArray(data?.history) ? data.history : [];
    state._atlasTrendHistoryRaw = history;
    renderAtlasTrendPreview(history);
  } catch (_e) {
    if (requestId !== state._atlasTrendFetchSeq) return;
    setAtlasTrendPreviewEmpty('Could not load Atlas EV history.');
  }
}

function renderAtlasTrendPreview(history) {
  const canvas = document.getElementById('atlasTrendPreviewChart');
  const windowDays = getAtlasTrendWindowDays();
  syncAtlasTrendRangeControls();
  if (!canvas || typeof Chart === 'undefined') return;

  if (state._atlasTrendPreviewChart) {
    state._atlasTrendPreviewChart.destroy();
    state._atlasTrendPreviewChart = null;
  }

  let series = Array.isArray(history)
    ? history
      .filter((h) => {
        const d = String(h?.date || '');
        const baseline = Number(h?.baselineEv);
        const optimized = Number(h?.optimizedEv);
        return !!d && Number.isFinite(baseline) && baseline > 0 && Number.isFinite(optimized) && optimized > 0;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-windowDays)
    : [];
  const livePoint = buildLiveAtlasTrendPoint();
  if (livePoint) {
    series = series.filter((h) => String(h.date) !== livePoint.date);
    series.push(livePoint);
    series = series.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-windowDays);
  }
  if (series.length < 2) {
    setAtlasTrendPreviewEmpty('No Atlas EV history snapshots yet.');
    return;
  }

  showAtlasTrendPreviewChart();

  const cs = getComputedStyle(document.documentElement);
  const baseColor = (cs.getPropertyValue('--text-2') || '#9aa4c4').trim();
  const optColor = (cs.getPropertyValue('--chaos') || '#d4a72c').trim();
  const borderColor = (cs.getPropertyValue('--border') || 'rgba(0,0,0,0.12)').trim();
  const tickColor = (cs.getPropertyValue('--text-3') || '#7a85a8').trim();

  const labels = series.map((h) => {
    const raw = String(h?.date || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${Number(iso[2])}/${Number(iso[3])}`;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const baseline = series.map((h) => Number(h.baselineEv));
  const optimized = series.map((h) => Number(h.optimizedEv));
  const allY = [...baseline, ...optimized].filter((v) => Number.isFinite(v));
  const niceNum = (range, round) => {
    const safeRange = Math.max(Math.abs(Number(range) || 0), 1e-9);
    const exponent = Math.floor(Math.log10(safeRange));
    const fraction = safeRange / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  };
  const buildNiceAxis = (values, targetTickCount = 6) => {
    const valid = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
    if (!valid.length) return { min: 0, max: 1 };
    let rawMin = Math.min(...valid);
    let rawMax = Math.max(...valid);
    if (!(rawMax > rawMin)) {
      const bump = Math.max(Math.abs(rawMax) * 0.06, 0.01);
      rawMin -= bump;
      rawMax += bump;
    }
    const spread = Math.max(rawMax - rawMin, 1e-6);
    const pad = spread * 0.14;
    const paddedMin = rawMin - pad;
    const paddedMax = rawMax + pad;
    const niceRange = niceNum(paddedMax - paddedMin, false);
    const niceStep = niceNum(niceRange / Math.max(2, targetTickCount - 1), true);
    let niceMin = Math.floor(paddedMin / niceStep) * niceStep;
    const niceMax = Math.ceil(paddedMax / niceStep) * niceStep;
    if (rawMin >= 0 && niceMin < 0) niceMin = 0;
    return {
      min: Number(niceMin.toFixed(6)),
      max: Number(niceMax.toFixed(6))
    };
  };
  const yAxis = buildNiceAxis(allY, 6);

  state._atlasTrendPreviewChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Baseline',
          data: baseline,
          borderColor: baseColor,
          backgroundColor: (ctx) => {
            const chart = ctx.chart;
            const area = chart?.chartArea;
            if (!area) return colorWithAlpha(baseColor, 0.11);
            const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            gradient.addColorStop(0, colorWithAlpha(baseColor, 0.16));
            gradient.addColorStop(1, colorWithAlpha(baseColor, 0.0));
            return gradient;
          },
          fill: true,
          tension: 0.3,
          pointRadius: series.length <= 14 ? 3 : 0,
          pointHoverRadius: 3,
          pointBackgroundColor: baseColor,
          borderWidth: 1.5,
        },
        {
          label: 'Optimized',
          data: optimized,
          borderColor: optColor,
          backgroundColor: (ctx) => {
            const chart = ctx.chart;
            const area = chart?.chartArea;
            if (!area) return colorWithAlpha(optColor, 0.11);
            const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            gradient.addColorStop(0, colorWithAlpha(optColor, 0.16));
            gradient.addColorStop(1, colorWithAlpha(optColor, 0.0));
            return gradient;
          },
          fill: true,
          tension: 0.3,
          pointRadius: series.length <= 14 ? 3 : 0,
          pointHoverRadius: 3,
          pointBackgroundColor: optColor,
          borderWidth: 1.5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label,
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}c`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: tickColor,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          },
          grid: { color: borderColor }
        },
        y: {
          min: yAxis.min,
          max: yAxis.max,
          ticks: { color: tickColor, font: { size: 10 }, callback: v => Number(v).toFixed(2) + 'c', maxTicksLimit: 6 },
          grid: { color: borderColor }
        }
      }
    }
  });
}

async function fetchAndRenderEVChart() {
  const league = document.getElementById('leagueSelect')?.value || 'Mirage';
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}?type=EVHistory&league=${encodeURIComponent(league)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const history = data.history || [];
    state._evHistoryRaw = Array.isArray(history) ? history : [];
    if (!history.length) {
      const demo = [];
      const evValues = [0.44,0.43,0.42,0.44,0.45,0.43,0.41,0.40,0.42,0.41,0.39,0.38,0.40,0.41,0.42,0.43,0.41,0.40,0.39,0.41,0.42,0.40,0.39,0.38,0.40,0.41,0.39,0.38,0.37,0.39];
      const now = new Date();
      for (let i = evValues.length - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        demo.push({ date: toLocalDateKey(d), ev: evValues[evValues.length - 1 - i], demo: true });
      }
      renderEVChart(demo);
      return;
    }
    renderEVChart(history);
  } catch(e) { /* silent */ }
}

function calcAtlasEVFromPriceMap(weights, priceByName, blockedGroups, boostedGroups) {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const scarab of SCARAB_LIST) {
    if (blockedGroups.has(scarab.group)) continue;
    const w = Number(weights[scarab.name] || 0);
    if (!Number.isFinite(w) || w <= 0) continue;
    const price = Number(priceByName.get(scarab.name));
    if (!Number.isFinite(price) || price <= 0) continue;
    const mult = boostedGroups.has(scarab.group) ? 2 : 1;
    const adjustedW = w * mult;
    weightedSum += adjustedW * price;
    totalWeight += adjustedW;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  const ev = weightedSum / totalWeight;
  if (!Number.isFinite(ev) || ev <= 0) return null;
  return { ev, totalWeight };
}

function optimizeAtlasBaselineAndOptimized(weights, priceByName) {
  const base = calcAtlasEVFromPriceMap(weights, priceByName, new Set(), new Set());
  if (!base) return null;

  const blocked = new Set();
  const boosted = new Set();
  let currentEV = base.ev;

  for (let step = 0; step < ATLAS_MAX_OPTIMIZE_STEPS; step++) {
    let bestDelta = 0;
    let bestType = null;
    let bestGroup = null;
    let bestEV = null;

    for (const group of ATLAS_BLOCKABLE) {
      if (blocked.has(group)) continue;
      const nextBlocked = new Set(blocked);
      nextBlocked.add(group);
      const next = calcAtlasEVFromPriceMap(weights, priceByName, nextBlocked, boosted);
      if (!next) continue;
      const delta = next.ev - currentEV;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestType = 'block';
        bestGroup = group;
        bestEV = next.ev;
      }
    }

    for (const group of ATLAS_BOOSTABLE) {
      if (boosted.has(group)) continue;
      const nextBoosted = new Set(boosted);
      nextBoosted.add(group);
      const next = calcAtlasEVFromPriceMap(weights, priceByName, blocked, nextBoosted);
      if (!next) continue;
      const delta = next.ev - currentEV;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestType = 'boost';
        bestGroup = group;
        bestEV = next.ev;
      }
    }

    if (!bestType || !Number.isFinite(bestEV) || bestDelta <= 0.0000005) break;
    if (bestType === 'block') blocked.add(bestGroup);
    else boosted.add(bestGroup);
    currentEV = bestEV;
  }

  return {
    baselineEv: Number(base.ev.toFixed(4)),
    optimizedEv: Number(currentEV.toFixed(4))
  };
}

function buildLiveAtlasTrendPoint() {
  if (!state.ninjaLoaded || !state._observedWeights) return null;
  const lower = buildNinjaLookup();
  const priceByName = new Map();
  for (const scarab of SCARAB_LIST) {
    const price = Number(getNinjaPrice(scarab.name, lower));
    if (Number.isFinite(price) && price > 0) priceByName.set(scarab.name, price);
  }
  const point = optimizeAtlasBaselineAndOptimized(state._observedWeights, priceByName);
  if (!point) return null;
  return {
    date: toLocalDateKey(),
    baselineEv: point.baselineEv,
    optimizedEv: point.optimizedEv,
    live: true
  };
}

function calcLiveHarmonicThresholdFromCurrentPrices() {
  if (!state.ninjaLoaded) return null;
  const lower = buildNinjaLookup();
  const prices = SCARAB_LIST
    .map((s) => Number(getNinjaPrice(s.name, lower)))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < 5) return null;
  const invSum = prices.reduce((sum, p) => sum + (1 / p), 0);
  if (!Number.isFinite(invSum) || invSum <= 0) return null;
  const harmonic = prices.length / invSum;
  const threshold = Math.floor(harmonic * 100) / 100;
  return Number.isFinite(threshold) && threshold > 0 ? Number(threshold.toFixed(4)) : null;
}

function calcLiveWeightedThresholdFromCurrentPrices() {
  if (!state.ninjaLoaded || !state._observedWeights) return null;
  const lower = buildNinjaLookup();
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of SCARAB_LIST) {
    const w = Number(state._observedWeights[s.name] || 0);
    if (!Number.isFinite(w) || w <= 0) continue;
    const price = Number(getNinjaPrice(s.name, lower));
    if (!Number.isFinite(price) || price <= 0) continue;
    weightedSum += w * price;
    totalWeight += w;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  const threshold = (weightedSum / totalWeight) / 3;
  return Number.isFinite(threshold) && threshold > 0 ? Number(threshold.toFixed(4)) : null;
}

function renderEVChart(history) {
  const windowDays = getEVChartWindowDays();
  const EV_HISTORY_V2_START = '2026-04-02';
  const cutoffMs = Date.parse(`${EV_HISTORY_V2_START}T00:00:00Z`);
  syncEVChartRangeControls();
  const getPositiveNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const toDateKey = (dateValue) => {
    const s = String(dateValue || '').trim();
    if (!s) return '';
    const isoDay = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDay) return `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`;
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString().slice(0, 10);
  };
  const isOnOrAfterCutoff = (dateValue) => {
    const s = toDateKey(dateValue);
    if (!s) return false;
    const ms = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(ms) && ms >= cutoffMs;
  };
  const titleEl = document.getElementById('evChartTitle');
  if (titleEl) titleEl.textContent = 'THRESHOLD TREND';
  const formatDateLabel = (dateValue) => {
    const s = toDateKey(dateValue);
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${Number(isoMatch[2])}/${Number(isoMatch[3])}`;
    return s || String(dateValue || '');
  };

  const raw = Array.isArray(history)
    ? history
      .map(h => ({ ...h }))
      .filter(h => isOnOrAfterCutoff(h?.date))
    : [];

  let harmonicSeries = raw
    .map(h => ({ date: toDateKey(h.date), ev: getPositiveNumber(h?.harmonicEv ?? h?.ev) }))
    .filter(h => Number.isFinite(h.ev) && h.ev > 0)
    .filter(h => !!h.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  let weightedSeries = raw
    .map(h => ({ date: toDateKey(h.date), ev: getPositiveNumber(h?.weightedEv) }))
    .filter(h => Number.isFinite(h.ev) && h.ev > 0)
    .filter(h => !!h.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weightedSeries.length >= 2) {
    state._evWeightedSeriesCache = weightedSeries.map((h) => ({ date: String(h.date), ev: Number(h.ev) }));
  } else if (Array.isArray(state._evWeightedSeriesCache) && state._evWeightedSeriesCache.length >= 2) {
      weightedSeries = state._evWeightedSeriesCache
        .map((h) => ({ date: toDateKey(h.date), ev: Number(h.ev), cached: true }))
        .filter((h) => isOnOrAfterCutoff(h.date))
        .filter((h) => !!h.date);
  }

  if (state.ninjaLoaded) {
    const today = toLocalDateKey();
    const liveHarmonic = calcLiveHarmonicThresholdFromCurrentPrices();
    if (liveHarmonic) {
      harmonicSeries = harmonicSeries.filter(h => h.date !== today);
      harmonicSeries.push({ date: today, ev: liveHarmonic, live: true });
      harmonicSeries = harmonicSeries.sort((a, b) => a.date.localeCompare(b.date));
    }
    const liveWeighted = calcLiveWeightedThresholdFromCurrentPrices();
    if (liveWeighted) {
      weightedSeries = weightedSeries.filter(h => h.date !== today);
      weightedSeries.push({ date: today, ev: liveWeighted, live: true });
      weightedSeries = weightedSeries.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const dateSet = new Set([
    ...harmonicSeries.map(h => h.date),
    ...weightedSeries.map(h => h.date)
  ]);
  let dates = [...dateSet].sort((a, b) => a.localeCompare(b));
  dates = dates.slice(-windowDays);

  const isDemo = dates.length < 2;
  if (isDemo) {
    const demo = [];
    const evValues = [0.44,0.43,0.42,0.44,0.45,0.43,0.41,0.40,0.42,0.41,0.39,0.38,0.40,0.41,0.42,0.43,0.41,0.40,0.39,0.41,0.42,0.40,0.39,0.38,0.40,0.41,0.39,0.38,0.37,0.39];
    const demoDays = Math.max(windowDays, 30);
    const now = new Date();
    for (let i = demoDays - 1; i >= 0; i--) {
      const idx = demoDays - 1 - i;
      const base = evValues[idx % evValues.length];
      const drift = Math.sin(idx / 7) * 0.005;
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      demo.push({ date: toLocalDateKey(d), ev: Number((base + drift).toFixed(4)), demo: true });
    }
    dates = demo.map(d => d.date);
    harmonicSeries = demo.map(d => ({ date: d.date, ev: d.ev }));
    weightedSeries = demo.map(d => ({ date: d.date, ev: Number((d.ev * 1.03).toFixed(4)) }));
  }

  const labels = dates.map(date => formatDateLabel(date));
  const harmonicByDate = new Map(harmonicSeries.map(h => [h.date, h.ev]));
  const weightedByDate = new Map(weightedSeries.map(h => [h.date, h.ev]));
  const harmonicValues = dates.map(date => harmonicByDate.has(date) ? Number(harmonicByDate.get(date)) : null);
  const weightedValues = dates.map(date => weightedByDate.has(date) ? Number(weightedByDate.get(date)) : null);

  const harmonicNonNull = harmonicValues.filter(v => v !== null && Number.isFinite(v)).map(v => Number(v));
  const weightedNonNull = weightedValues.filter(v => v !== null && Number.isFinite(v)).map(v => Number(v));
  const allY = [...harmonicNonNull, ...weightedNonNull];
  const niceNum = (range, round) => {
    const safeRange = Math.max(Math.abs(Number(range) || 0), 1e-9);
    const exponent = Math.floor(Math.log10(safeRange));
    const fraction = safeRange / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  };
  const buildNiceAxis = (values, targetTickCount = 6) => {
    const valid = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v));
    if (!valid.length) return { min: 0, max: 1 };
    let rawMin = Math.min(...valid);
    let rawMax = Math.max(...valid);
    if (!(rawMax > rawMin)) {
      const bump = Math.max(Math.abs(rawMax) * 0.06, 0.01);
      rawMin -= bump;
      rawMax += bump;
    }
    const spread = Math.max(rawMax - rawMin, 1e-6);
    const pad = spread * 0.14;
    const paddedMin = rawMin - pad;
    const paddedMax = rawMax + pad;
    const niceRange = niceNum(paddedMax - paddedMin, false);
    const niceStep = niceNum(niceRange / Math.max(2, targetTickCount - 1), true);
    let niceMin = Math.floor(paddedMin / niceStep) * niceStep;
    const niceMax = Math.ceil(paddedMax / niceStep) * niceStep;
    if (rawMin >= 0 && niceMin < 0) niceMin = 0;
    return {
      min: Number(niceMin.toFixed(6)),
      max: Number(niceMax.toFixed(6))
    };
  };
  const yAxis = buildNiceAxis(allY, 6);
  document.getElementById('evChartMeta').innerHTML = isDemo
    ? `<span style="color:var(--amber)">demo data \u2014 next real snapshot at ${getDailySnapshotLocalTimeLabel()}</span>`
    : '';

  const cs = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = (cs.getPropertyValue('--border') || 'rgba(0,0,0,0.12)').trim();
  const textColor = (cs.getPropertyValue('--text-3') || '#7a85a8').trim();
  const harmonicColor = (cs.getPropertyValue('--text-2') || '#9aa4c4').trim();
  const weightedColor = (cs.getPropertyValue('--chaos') || '#a03ec8').trim();
  const harmonicFillTopAlpha = isDark ? 0.16 : 0.15;
  const harmonicFillFallbackAlpha = isDark ? 0.11 : 0.09;
  const weightedFillTopAlpha = isDark ? 0.16 : 0.15;
  const weightedFillFallbackAlpha = isDark ? 0.11 : 0.09;

  if (state._evChartInstance) {
    state._evChartInstance.destroy();
    state._evChartInstance = null;
  }

  const ctx = document.getElementById('evHistoryChart');
  if (!ctx) return;

  state._evChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Harmonic',
        data: harmonicValues,
        borderColor: harmonicColor,
        backgroundColor: (ctx) => {
          const chart = ctx.chart;
          const area = chart?.chartArea;
          if (!area) return colorWithAlpha(harmonicColor, harmonicFillFallbackAlpha);
          const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          gradient.addColorStop(0, colorWithAlpha(harmonicColor, harmonicFillTopAlpha));
          gradient.addColorStop(1, colorWithAlpha(harmonicColor, 0.0));
          return gradient;
        },
        fill: true,
        tension: 0.3,
        spanGaps: true,
        pointRadius: dates.length <= 14 ? 3 : 0,
        pointHoverRadius: 3,
        pointBackgroundColor: harmonicColor,
        borderWidth: 1.5,
      }, {
        label: 'Weighted',
        data: weightedValues,
        borderColor: weightedColor,
        backgroundColor: (ctx) => {
          const chart = ctx.chart;
          const area = chart?.chartArea;
          if (!area) return colorWithAlpha(weightedColor, weightedFillFallbackAlpha);
          const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          gradient.addColorStop(0, colorWithAlpha(weightedColor, weightedFillTopAlpha));
          gradient.addColorStop(1, colorWithAlpha(weightedColor, 0.0));
          return gradient;
        },
        fill: true,
        tension: 0.3,
        spanGaps: true,
        pointRadius: dates.length <= 14 ? 3 : 0,
        pointHoverRadius: 3,
        pointBackgroundColor: weightedColor,
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label,
            label: ctx => ` ${ctx.dataset.label} threshold: ${ctx.parsed.y.toFixed(3)}c`
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: textColor, maxTicksLimit: 10, maxRotation: 0, autoSkip: true },
          grid: { color: gridColor }
        },
        y: {
          min: yAxis.min,
          max: yAxis.max,
          ticks: { font: { size: 10 }, color: textColor, callback: v => Number(v).toFixed(2) + 'c', maxTicksLimit: 6 },
          grid: { color: gridColor }
        }
      }
    }
  });
}


 // parsed CSV map: { scarabName -> qty }
function handleSnap(num, event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = parseSnapCSV(e.target.result);
    const count = Object.values(data).reduce((s, q) => s + q, 0);
    if (num === 1) {
      state._loggerSnapshotBefore = data;
    const checkMark = String.fromCodePoint(0x2713);
    document.getElementById('snap1Text').textContent = `${checkMark} ${file.name} \u2014 ${Object.keys(data).length} types`;
      document.getElementById('snap1Label').classList.add('loaded');
    } else {
      state._loggerSnapshotAfter = data;
    const checkMark = String.fromCodePoint(0x2713);
    document.getElementById('snap2Text').textContent = `${checkMark} ${file.name} \u2014 ${Object.keys(data).length} types`;
      document.getElementById('snap2Label').classList.add('loaded');
    }
    tryPreview();
  };
  reader.readAsText(file);
}


function setLoggerRegexMode(manual) {
  const badge = document.getElementById('loggerRegexBadge');
  const note  = document.getElementById('loggerRegexNote');
  const input = document.getElementById('loggerRegex');
  if (manual) {
    if (badge) { badge.textContent = 'manual'; badge.style.background = 'var(--chaos-bg)'; badge.style.color = 'var(--chaos)'; badge.style.borderColor = 'var(--chaos-border)'; }
    if (note)  note.style.display = 'none';
    if (input) input.style.color = 'var(--chaos)';
  } else {
    if (badge) { badge.textContent = 'auto'; badge.style.background = 'var(--ninja-bg)'; badge.style.color = 'var(--ninja-accent)'; badge.style.borderColor = 'var(--ninja-border)'; }
    if (note)  note.style.display = '';
    if (input) input.style.color = '';
  }
}

document.getElementById('loggerRegex').addEventListener('focus', function() {
  if (!state._loggerRegexUserEdited && this.value.trim()) {
    this.value = '';
    document.getElementById('loggerRegexHint').textContent = '';
    tryPreview();
  }
});

document.getElementById('loggerRegex').addEventListener('blur', function() {
  if (!state._loggerRegexUserEdited && !this.value.trim()) {
    syncLoggerRegex();
  }
});

document.getElementById('loggerRegex').addEventListener('input', function() {
  state._loggerRegexUserEdited = this.value.trim().length > 0;
  setLoggerRegexMode(state._loggerRegexUserEdited);
  const val = this.value.trim();
  if (!val) {
    document.getElementById('loggerRegexHint').textContent = '';
    tryPreview();
    return;
  }
  const { matched, unmatched } = parseRegexToScarabs(val);
  let hint = `${matched.length} scarab types identified`;
  if (unmatched.length) hint += ` \u00B7 ${unmatched.length} unrecognised tokens: ${unmatched.join(', ')}`;
  document.getElementById('loggerRegexHint').textContent = hint;
  tryPreview();
});

	function tryPreview() {
	  const regexVal = document.getElementById('loggerRegex').value.trim();
	  const btn = document.getElementById('loggerSubmitBtn');
	  if (!state._loggerSnapshotBefore || !state._loggerSnapshotAfter || !regexVal) {
		document.getElementById('loggerPreview').style.display = 'none';
		btn.disabled = true;
		return;
	  }
	  
	  const parseResult = parseRegexToScarabs(regexVal);
	  const vendorTargets = parseResult.matched;
	  const is_inverted = parseResult.is_inverted;
	  
	  const vendorSet = new Set(vendorTargets);
	  const lower = buildNinjaLookup();

	  // Get all scarab names across both snapshots
	  const scarabNameSet = new Set(SCARAB_LIST.map(s => s.name));
	  const allNames = new Set([...Object.keys(state._loggerSnapshotBefore), ...Object.keys(state._loggerSnapshotAfter)]);

	  const vendorRows = [];
	  const keeperRows = [];
	  let totalConsumed = 0, totalInputValue = 0, totalOutputValue = 0;

	  for (const name of allNames) {
		// Only process scarabs
		if (!scarabNameSet.has(name)) continue;

		const before = state._loggerSnapshotBefore[name] || 0;
		const after  = state._loggerSnapshotAfter[name] || 0;
		const price  = getNinjaPrice(name, lower) || 0;

		// Handle inverted regex logic
		let isVendorTarget = false;
		if (is_inverted) {
		  // For inverted regex, vendor everything that's NOT in the matched set
		  isVendorTarget = !vendorSet.has(name);
		} else {
		  // Normal regex, vendor everything that IS in the matched set
		  isVendorTarget = vendorSet.has(name);
		}

		if (isVendorTarget) {
		  const consumed = before;
		  const received = after;
		  const inputVal  = consumed * price;
		  const outputVal = received * price;
		  totalConsumed    += consumed;
		  totalInputValue  += inputVal;
		  totalOutputValue += outputVal; // include vendor target returns \u2014 they're real value
		  if (consumed > 0 || received > 0) {
			vendorRows.push({ name, consumed, received, net: after - before, price, inputVal, outputVal });
		  }
		} else {
		  const received = after - before;
		  if (received > 0) {
			const outputVal = received * price;
			totalOutputValue += outputVal;
			keeperRows.push({ name, received, price, outputVal });
		  }
		}
	  }

  const totalTrades = Math.round(totalConsumed / 3);
  const roi = totalInputValue > 0 ? ((totalOutputValue - totalInputValue) / totalInputValue * 100) : 0;
  const divRate = getDivineRate();
  const fmt = (c) => divRate && c / divRate >= 1 ? (c / divRate).toFixed(1) + 'd' : Math.round(c) + 'c';

  // Stats row
  document.getElementById('loggerStats').innerHTML = `
    <div class="logger-stat"><div class="logger-stat-label">Scarabs In</div><div class="logger-stat-value">${totalConsumed.toLocaleString()}</div></div>
    <div class="logger-stat"><div class="logger-stat-label">Est. Trades</div><div class="logger-stat-value">${totalTrades.toLocaleString()}</div></div>
    <div class="logger-stat"><div class="logger-stat-label">Input Value</div><div class="logger-stat-value">${fmt(totalInputValue)}</div></div>
    <div class="logger-stat"><div class="logger-stat-label">Output Value</div><div class="logger-stat-value">${fmt(totalOutputValue)}</div></div>
    <div class="logger-stat"><div class="logger-stat-label">ROI</div><div class="logger-stat-value ${roi >= 0 ? 'green' : 'red'}">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div></div>
  `;

  // Vendor table
  vendorRows.sort((a, b) => b.consumed - a.consumed);
  document.getElementById('loggerVendorTable').innerHTML = vendorRows.length
    ? vendorRows.map(r => `
      <div class="logger-vendor-row" style="border-bottom:1px solid var(--border);padding:5px 10px;font-size:12px">
        <span class="scarab-name">${r.name}</span><span class="scarab-name-mobile">${mobileScarabName(r.name)}</span>
        <span style="text-align:right;color:var(--red)">${r.consumed.toLocaleString()}</span>
        <span style="text-align:right;color:var(--green)">${r.received.toLocaleString()}</span>
        <span style="text-align:right;color:${r.net >= 0 ? 'var(--green)' : 'var(--red)'};">${r.net >= 0 ? '+' : ''}${r.net}</span>
        <span style="text-align:right;color:var(--chaos)">${r.price > 0 ? r.price.toFixed(2) + 'c' : '\u2014'}</span>
        <span style="text-align:right;color:var(--text-2)">${fmt(r.inputVal)}</span>
      </div>`).join('')
    : '<div class="empty-row">No vendor targets found</div>';

  // Keeper table
  keeperRows.sort((a, b) => b.outputVal - a.outputVal);
  document.getElementById('loggerKeeperTable').innerHTML = keeperRows.length
    ? keeperRows.map(r => `
      <div class="logger-keeper-row" style="border-bottom:1px solid var(--border);padding:5px 10px;font-size:12px">
        <span class="scarab-name">${r.name}</span><span class="scarab-name-mobile">${mobileScarabName(r.name)}</span>
        <span style="text-align:right;color:var(--green)">+${r.received.toLocaleString()}</span>
        <span style="text-align:right;color:var(--chaos)">${r.price > 0 ? r.price.toFixed(2) + 'c' : '\u2014'}</span>
        <span style="text-align:right;color:var(--text-2)">${fmt(r.outputVal)}</span>
      </div>`).join('')
    : '<div class="empty-row">No keeper outputs found</div>';

  document.getElementById('loggerPreview').style.display = '';
  btn.disabled = false;

  // Store parsed session for submit
  window._parsedSession = {
    threshold: state.ninjaEvOverride !== null ? state.ninjaEvOverride : (calcEV(getNinjaEntries().filter(e => e.chaosEa > 0)) || 0),
    divine_rate: divRate,
    league: document.getElementById('leagueSelect')?.value || 'Unknown',
    regex: document.getElementById('loggerRegex').value.trim(),
    totalConsumed, totalTrades, totalInputValue, totalOutputValue, roi,
    vendorRows, keeperRows,
    allRows: [...vendorRows.map(r => ({ name: r.name, consumed: r.consumed, received: r.received, was_vendor: true, ninja_price: r.price })),
              ...keeperRows.map(r => ({ name: r.name, consumed: 0, received: r.received, was_vendor: false, ninja_price: r.price }))]
  };
}

async function submitSession() {
  const session = window._parsedSession;
  if (!session) return;
  const btn = document.getElementById('loggerSubmitBtn');
  const status = document.getElementById('loggerSubmitStatus');
  btn.disabled = true;
  status.textContent = 'Saving...';

  const vendorReceived = (session.vendorRows || []).reduce((s, r) => s + r.received, 0);
  const keeperReceived = (session.keeperRows || []).reduce((s, r) => s + r.received, 0);
  const totalReceived  = vendorReceived + keeperReceived;

  if (session.totalConsumed === 0 && totalReceived === 0) {
    status.textContent = 'No scarab movement detected between snapshots \u2014 session not saved';
    status.style.color = 'var(--red)';
    btn.disabled = false;
    return;
  }

  if (session.totalInputValue > 0 && Math.abs(session.totalOutputValue - session.totalInputValue) < 1 && session.totalConsumed === 0) {
    status.textContent = 'No changes detected between snapshots \u2014 session not saved';
    status.style.color = 'var(--red)';
    btn.disabled = false;
    return;
  }

  const flags = [];
  if (session.totalConsumed < 500)
    flags.push('low sample');
  if (session.totalInputValue > 0 && Math.abs(session.totalOutputValue - session.totalInputValue) < 1)
    flags.push('no change detected');
  const keeperOutputs = session.keeperRows?.length || 0;
  if (session.totalConsumed >= 500 && keeperOutputs === 0)
    flags.push('zero keeper outputs');
  if (totalReceived > session.totalConsumed)
    flags.push('outputs > inputs');
  if (session.totalConsumed >= 500 && session.totalTrades > 0) {
    // Strict single-pass integrity check:
    // if Snapshot 1 vendor targets were actually vendored once, total outputs should
    // be close to consumed/3 (full trades), with only small operational noise.
    const fullTrades = session.totalTrades;
    const observedOut = totalReceived;
    const expectedOut = fullTrades;
    const outDelta = observedOut - expectedOut;
    const maxOutDelta = 40;
    if (Math.abs(outDelta) > maxOutDelta) {
      flags.push(`recycled session \u2014 output count outside single-pass tolerance (${observedOut}/${expectedOut})`);
    }
  }

  // outputs should themselves be vendor-target quality scarabs (the vendor hands back
  // cheap commons frequently). If almost nothing vendor-target came back, the person
  // recycled their outputs through multiple passes in one session, which contaminates
  // the weight distribution data. Flag and exclude from community aggregate.
  if (session.totalConsumed >= 500 && totalReceived >= 10) {
    const vendorReturnRatio = totalReceived > 0 ? vendorReceived / totalReceived : 0;
    if (vendorReturnRatio < 0.15) {
      flags.push('recycled session \u2014 vendor outputs contain <15% vendor-target scarabs');
    }

    // Partial recycle pattern: user keeps vendoring outputs, then stops once stacks are
    // messy/small. The session can still show some vendor-target returns (>15%) while
    // total returns are far below the estimated trade count.
    const fullTrades = session.totalTrades || 0;
    const outputCoverage = fullTrades > 0 ? totalReceived / fullTrades : 0;
    if (fullTrades >= 150 && outputCoverage < 0.55) {
      flags.push('recycled session \u2014 partial recycle detected (outputs/trades too low)');
    }
  }

  try {
    const existing = JSON.parse(localStorage.getItem('poepool-sessions') || '[]');
    const record = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      league: session.league,
      threshold: session.threshold,
      divine_rate: session.divine_rate,
      regex: session.regex,
      total_consumed: session.totalConsumed,
      total_trades: session.totalTrades,
      input_value: session.totalInputValue,
      output_value: session.totalOutputValue,
      roi_pct: session.roi,
      flagged: flags.length > 0,
      flags,
      scarabs: session.allRows
    };
    existing.push(record);
    localStorage.setItem('poepool-sessions', JSON.stringify(existing));
    if (flags.length) {
      // Positive-only UX: no warning note for local-only sessions.
      status.textContent = '';
    } else {
      status.textContent = 'Counted in community data';
      status.style.color = 'var(--green)';
      if (POOL_API_URL) {
        const payload = {
          total_consumed: record.total_consumed,
          total_trades: record.total_trades,
          input_value: record.input_value,
          output_value: record.output_value,
          league: record.league || undefined,
          regex: record.regex || undefined,
          scarabs: (record.scarabs || []).map(r => ({
            name: r.name,
            received: r.received || 0,
            consumed: r.consumed || 0,
            was_vendor: r.was_vendor || false,
            ninja_price: r.ninja_price || 0
          }))
        };
        fetch(POOL_API_URL + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(() => {})
          .catch(() => {});
      }
    }
    renderSessionHistory();
    // Reset form
    state._loggerSnapshotBefore = state._loggerSnapshotAfter = null;
    window._parsedSession = null;
    document.getElementById('snap1Text').textContent = 'Upload CSV file';
    document.getElementById('snap2Text').textContent = 'Upload CSV file';
    document.getElementById('snap1Label').classList.remove('loaded');
    document.getElementById('snap2Label').classList.remove('loaded');
    state._loggerRegexUserEdited = false;
    setLoggerRegexMode(false);
    syncLoggerRegex();
    document.getElementById('loggerRegexHint').textContent = '';
    document.getElementById('loggerPreview').style.display = 'none';
  } catch(e) {
    status.textContent = 'Error saving: ' + e.message;
    status.style.color = 'var(--red)';
    btn.disabled = false;
  }
}

function renderSessionHistory() {
  const sessions = JSON.parse(localStorage.getItem('poepool-sessions') || '[]');
  const el = document.getElementById('loggerHistoryTable');
  const validSizes = [10, 25, 50, 100];
  const savedSize = Number(localStorage.getItem('poepool-logger-history-page-size') || 25);
  const pageSize = validSizes.includes(savedSize) ? savedSize : 25;
  const currentPage = Math.max(1, Number(window._loggerHistoryPage || 1));
  if (!sessions.length) {
    window._loggerHistoryPage = 1;
    el.innerHTML = '<div class="logger-history-empty">No sessions logged yet.</div>';
    return;
  }
  const ordered = sessions.slice().reverse();
  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, totalPages);
  window._loggerHistoryPage = page;
  const start = (page - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const pageRows = ordered.slice(start, end);
  const cols = '132px 1fr 72px 72px 72px 72px 72px 64px 56px minmax(80px, 1fr)';
  const gap = '12px';
  const fmtSessionDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  };

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px 10px">
      <div style="font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums">Showing ${start + 1}-${end} of ${total}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <label style="font-size:11px;color:var(--text-3)">Rows</label>
        <select id="loggerHistoryPageSize" onchange="setLoggerHistoryPageSize(this.value)" style="height:24px;padding:2px 4px;border-radius:5px;font-size:11px">
          ${validSizes.map((n) => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="logger-history-grid" style="grid-template-columns:${cols};gap:${gap};font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center">
      <span class="cell-left">Date</span><span class="cell-left">League</span><span class="cell-right">Scarabs</span><span class="cell-right">Trades</span><span class="cell-right">Input</span><span class="cell-right">Output</span><span class="cell-right">Profit</span><span class="cell-right">Cutoff</span><span class="cell-right">ROI</span><span class="cell-left"></span>
    </div>
    ${pageRows.map((s, i) => {
      const globalPos = start + i;
      const idx = sessions.length - 1 - globalPos;
      const profit = (s.output_value || 0) - (s.input_value || 0);
      const fmtSession = (c) => fmtWithRate(c, s.divine_rate);
      const profitFmt = (c) => (c >= 0 ? '+' : '') + fmtSession(c);
      return `<div>
        <div onclick="toggleSessionDetail(${idx})" class="logger-history-grid" style="grid-template-columns:${cols};gap:${gap};font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='var(--row-hover)'" onmouseout="this.style.background=''">
          <span class="cell-left">${fmtSessionDate(s.created_at)}</span>
          <span class="cell-left">${s.league}</span>
          <span class="cell-right">${s.total_consumed?.toLocaleString()}</span>
          <span class="cell-right">${s.total_trades?.toLocaleString()}</span>
          <span class="cell-right">${fmtSession(s.input_value)}</span>
          <span class="cell-right">${fmtSession(s.output_value)}</span>
          <span class="cell-right" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${profitFmt(profit)}</span>
          <span class="cell-right" style="color:var(--chaos)">${s.threshold?.toFixed(2)}c</span>
          <span class="cell-right" style="color:${s.roi_pct >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${s.roi_pct >= 0 ? '+' : ''}${s.roi_pct?.toFixed(1)}%</span>
          <span class="cell-left" style="display:flex;align-items:center;gap:6px;min-width:0" onclick="event.stopPropagation()">
            <button onclick="deleteSession('${s.id}')" title="Delete session" style="font-family:inherit;font-size:14px;padding:2px 4px;border:none;background:transparent;color:var(--text-3);cursor:pointer;opacity:0.4;transition:all 0.15s;line-height:1;flex-shrink:0" onmouseover="this.style.opacity='1';this.style.color='var(--red)'" onmouseout="this.style.opacity='0.4';this.style.color='var(--text-3)'">&#128465;</button>
          </span>
        </div>
        <div id="hist-detail-${idx}" style="display:none;padding:10px 14px 14px;border-bottom:1px solid var(--border);background:var(--bg)">
          ${renderSessionDetail(s)}
        </div>
      </div>`;
    }).join('')}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 4px">
      <div style="font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums">Page ${page} of ${totalPages}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="setLoggerHistoryPage(${page - 1})" ${page <= 1 ? 'disabled' : ''} style="font-family:inherit;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-table-head);color:var(--text-2);cursor:${page <= 1 ? 'default' : 'pointer'};opacity:${page <= 1 ? '0.45' : '1'}">Prev</button>
        <button onclick="setLoggerHistoryPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} style="font-family:inherit;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-table-head);color:var(--text-2);cursor:${page >= totalPages ? 'default' : 'pointer'};opacity:${page >= totalPages ? '0.45' : '1'}">Next</button>
      </div>
    </div>
  `;
}

function setLoggerHistoryPage(page) {
  const n = Math.max(1, Number(page) || 1);
  window._loggerHistoryPage = n;
  renderSessionHistory();
}

function setLoggerHistoryPageSize(size) {
  const validSizes = [10, 25, 50, 100];
  const n = Number(size) || 25;
  const next = validSizes.includes(n) ? n : 25;
  try { localStorage.setItem('poepool-logger-history-page-size', String(next)); } catch (e) {}
  window._loggerHistoryPage = 1;
  renderSessionHistory();
}

function deleteSession(id) {
  const sessions = JSON.parse(localStorage.getItem('poepool-sessions') || '[]');
  localStorage.setItem('poepool-sessions', JSON.stringify(sessions.filter(s => s.id !== id)));
  renderSessionHistory();
}

function toggleSessionDetail(idx) {
  const detail  = document.getElementById(`hist-detail-${idx}`);
  const chevron = document.getElementById(`hist-chevron-${idx}`);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : '';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
}

function renderSessionDetail(s) {
  if (!s.scarabs || !s.scarabs.length) return '<div style="font-size:12px;color:var(--text-3)">No scarab data stored.</div>';
  const scarabNameSet = new Set(SCARAB_LIST.map(sc => sc.name));
  const vendors = s.scarabs.filter(r => r.was_vendor && scarabNameSet.has(r.name)).sort((a,b) => b.consumed - a.consumed);
  const keepers = s.scarabs.filter(r => !r.was_vendor && r.received > 0 && scarabNameSet.has(r.name)).sort((a,b) => (b.received*b.ninja_price) - (a.received*a.ninja_price));

  const vendorHTML = vendors.length ? vendors.map(r => `
    <div style="display:grid;grid-template-columns:1fr 60px 60px 60px 60px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">
      <span class="scarab-name">${r.name}</span><span class="scarab-name-mobile">${mobileScarabName(r.name)}</span>
      <span style="text-align:right;color:var(--red)">${r.consumed}</span>
      <span style="text-align:right;color:var(--green)">${r.received}</span>
      <span style="text-align:right;color:${(r.received-r.consumed)>=0?'var(--green)':'var(--red)'}">${r.received-r.consumed>=0?'+':''}${r.received-r.consumed}</span>
      <span style="text-align:right;color:var(--text-3)">${r.ninja_price>0?r.ninja_price.toFixed(2)+'c':'\u2014'}</span>
    </div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:4px 0">None</div>';

  const keeperHTML = keepers.length ? keepers.map(r => `
    <div style="display:grid;grid-template-columns:1fr 60px 60px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">
      <span class="scarab-name">${r.name}</span><span class="scarab-name-mobile">${mobileScarabName(r.name)}</span>
      <span style="text-align:right;color:var(--green)">+${r.received}</span>
      <span style="text-align:right;color:var(--text-3)">${r.ninja_price>0?r.ninja_price.toFixed(2)+'c':'\u2014'}</span>
    </div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:4px 0">None</div>';

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Vendor targets</div>
        <div style="display:grid;grid-template-columns:1fr 60px 60px 60px 60px;font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.04em;padding:2px 0;border-bottom:1px solid var(--border);margin-bottom:2px">
          <span>Scarab</span><span style="text-align:right">In</span><span style="text-align:right">Out</span><span style="text-align:right">Net</span><span style="text-align:right">c/ea</span>
        </div>
        ${vendorHTML}
      </div>
      <div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em">Keeper outputs</div>
          ${s.divine_rate ? `<div style="font-size:9px;color:var(--text-3);opacity:0.6">1d = ${Math.round(s.divine_rate)}c</div>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 60px 60px;font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.04em;padding:2px 0;border-bottom:1px solid var(--border);margin-bottom:2px">
          <span>Scarab</span><span style="text-align:right">Qty</span><span style="text-align:right">c/ea</span>
        </div>
        ${keeperHTML}
      </div>
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-top:10px">Regex: <span style="color:var(--text-3);font-family:monospace;opacity:0.7">${s.regex || '\u2014'}</span></div>
  `;
}

// Init history on load
renderSessionHistory();

// DATA ANALYSIS TAB
function renderAnalysis() {
  const emptyEl = document.getElementById('analysisEmpty');
  const contentEl = document.getElementById('analysisContent');

  if (POOL_API_URL) {
    emptyEl.style.display = 'block';
    contentEl.style.display = 'none';
    emptyEl.innerHTML = '<p>Loading community data...</p>';
    const league = document.getElementById('leagueSelect')?.value || '';
    Promise.all([
      fetch(POOL_API_URL + '/api/aggregate?league=' + encodeURIComponent(league)).then(res => res.ok ? res.json() : null).catch(() => null),
      fetch(POOL_API_URL + '/api/aggregate?league=all').then(res => res.ok ? res.json() : null).catch(() => null)
    ])
      .then(([aggCurrent, aggLifetime]) => {
        const hasCurrent = !!(aggCurrent && (aggCurrent.sessionCount > 0 || Object.keys(aggCurrent.receivedByScarab || {}).length > 0));
        if (!hasCurrent) {
          emptyEl.style.display = 'block';
          contentEl.style.display = 'none';
          emptyEl.innerHTML = '<p>No D1 session data found for this league yet.</p>';
          return;
        }
        renderAnalysisFromAggregate({
          totalConsumed: aggCurrent.totalConsumed || 0,
          totalTrades: aggCurrent.totalTrades || 0,
          totalInput: aggCurrent.totalInput || 0,
          totalOutput: aggCurrent.totalOutput || 0,
          totalInputDivine: aggCurrent.totalInputDivine ?? null,
          totalOutputDivine: aggCurrent.totalOutputDivine ?? null,
          receivedByScarab: aggCurrent.receivedByScarab || {},
          sessionCount: aggCurrent.sessionCount || 0,
          weightSessionCount: aggCurrent.weightSessionCount || 0,
          weightMeta: aggCurrent.weightMeta || null,
          lifetimeAggregate: aggLifetime || null,
          dataSourceLabel: 'Community data (' + (aggCurrent.totalTrades || 0).toLocaleString() + ' trades)'
        }, emptyEl, contentEl);
      })
      .catch(() => {
        emptyEl.style.display = 'block';
        contentEl.style.display = 'none';
        emptyEl.innerHTML = '<p>Could not load D1 aggregate data.</p>';
      });
  } else {
    renderAnalysisFromLocalSessions(emptyEl, contentEl);
  }
}

function renderAnalysisFromLocalSessions(emptyEl, contentEl) {
  const sessions = JSON.parse(localStorage.getItem('poepool-sessions') || '[]');
  const selectedLeague = String(document.getElementById('leagueSelect')?.value || '').trim().toLowerCase();
  let totalConsumed = 0, totalTrades = 0, totalInput = 0, totalOutput = 0;
  let totalInputDivine = 0, totalOutputDivine = 0, divineSessionCount = 0;
  const receivedByScarab = {};
  let filteredSessionCount = 0;
  let filteredValidCount = 0;
  for (const s of sessions) {
    const sessionLeague = String(s.league || '').trim().toLowerCase();
    const inSelectedLeague = selectedLeague ? (sessionLeague === selectedLeague) : true;
    if (!inSelectedLeague) continue;
    filteredSessionCount += 1;
    if (!s.flagged) filteredValidCount += 1;
    totalConsumed += s.total_consumed || 0;
    totalTrades += s.total_trades || 0;
    totalInput += s.input_value || 0;
    totalOutput += s.output_value || 0;
    const divineRate = Number(s.divine_rate) || 0;
    if (divineRate > 0) {
      totalInputDivine += (Number(s.input_value) || 0) / divineRate;
      totalOutputDivine += (Number(s.output_value) || 0) / divineRate;
      divineSessionCount += 1;
    }
    if (s.scarabs && s.scarabs.length) {
      for (const r of s.scarabs) {
        if (r.received > 0 && r.name) {
          receivedByScarab[r.name] = (receivedByScarab[r.name] || 0) + r.received;
        }
      }
    }
  }
  renderAnalysisFromAggregate({
    totalConsumed, totalTrades, totalInput, totalOutput, receivedByScarab,
    totalInputDivine: divineSessionCount > 0 ? totalInputDivine : null,
    totalOutputDivine: divineSessionCount > 0 ? totalOutputDivine : null,
    sessionCount: filteredSessionCount,
    validCount: filteredValidCount,
    dataSourceLabel: 'Your data only (' + totalTrades.toLocaleString() + ' trades)'
  }, emptyEl, contentEl);
}

function renderAnalysisFromAggregate(data, emptyEl, contentEl) {
  bindStatInfoTooltipEvents();
  const { totalConsumed, totalTrades, totalInput, totalOutput, totalInputDivine, totalOutputDivine, receivedByScarab, dataSourceLabel } = data;

  emptyEl.style.display = 'block';
  contentEl.style.display = 'none';
  const totalReceived = Object.values(receivedByScarab).reduce((a, b) => a + b, 0);
  if (totalReceived === 0 && totalTrades === 0) {
    emptyEl.innerHTML = '<p>No session data yet. Log sessions on the <strong>Session Logger</strong> tab to see analytics here. Set <code>POOL_API_URL</code> to your community API to use shared data.</p>';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = '';
  const sourceEl = document.getElementById('analysisDataSource');
  if (sourceEl) sourceEl.textContent = dataSourceLabel;

  const lifetimeAgg = data && data.lifetimeAggregate && typeof data.lifetimeAggregate === 'object'
    ? data.lifetimeAggregate
    : null;
  const lifetimeSessionCount = lifetimeAgg ? (Number(lifetimeAgg.sessionCount) || 0) : 0;
  const currentLeagueSessionCount = Number(data.sessionCount) || 0;
  const hasMultiLeagueData = lifetimeSessionCount > currentLeagueSessionCount;
  const lifetimeConsumed = lifetimeAgg ? (Number(lifetimeAgg.totalConsumed) || 0) : 0;
  const lifetimeReceived = lifetimeAgg
    ? Object.values(lifetimeAgg.receivedByScarab || {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
    : 0;
  const currentInDiv = Number(totalInputDivine);
  const currentOutDiv = Number(totalOutputDivine);
  const currentLeagueProfitDiv = (Number.isFinite(currentInDiv) && Number.isFinite(currentOutDiv))
    ? (currentOutDiv - currentInDiv)
    : null;
  const lifetimeInDiv = Number(lifetimeAgg?.totalInputDivine);
  const lifetimeOutDiv = Number(lifetimeAgg?.totalOutputDivine);
  let lifetimeProfitDiv = (Number.isFinite(lifetimeInDiv) && Number.isFinite(lifetimeOutDiv))
    ? (lifetimeOutDiv - lifetimeInDiv)
    : null;

  const atlasBaselineScarabEv = atlasComputeEV(new Set(), new Set());
  const scarabEvValue = Number.isFinite(atlasBaselineScarabEv) ? (atlasBaselineScarabEv.toFixed(2) + 'c') : '—';
  const currentLeagueProfitValue = Number.isFinite(currentLeagueProfitDiv)
    ? ((currentLeagueProfitDiv >= 0 ? '+' : '') + currentLeagueProfitDiv.toFixed(1) + 'd')
    : '—';
  const currentLeagueProfitClass = Number.isFinite(currentLeagueProfitDiv)
    ? (currentLeagueProfitDiv >= 0 ? 'green' : 'red')
    : '';

  // Weight distribution: build data array (sort by received desc initially)
  let observedEv = 0;
  const weightData = Object.keys(receivedByScarab).map(name => {
    const count = receivedByScarab[name];
    const pct = totalReceived > 0 ? (count / totalReceived * 100) : 0;
    const weight = pct / 100;
    const ninjaPrice = state.ninjaPrices[name] ?? 0;
    const evContrib = weight * ninjaPrice;
    observedEv += evContrib;
    return { name, count, pct, weight, ninjaPrice, evContrib };
  });

  function quantileOf(nums, q) {
    const arr = nums
      .map((v) => Number(v) || 0)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    const len = arr.length;
    if (!len) return 0;
    const clamped = Math.max(0, Math.min(1, Number(q) || 0));
    const pos = (len - 1) * clamped;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return arr[lo];
    const frac = pos - lo;
    return arr[lo] + ((arr[hi] - arr[lo]) * frac);
  }
  function computeDynamicJackpotReliance(items) {
    // Tail detection is value-first and uses only valid priced scarabs.
    const priced = items
      .map((d) => {
        const price = Number(d.ninjaPrice);
        const contrib = Number(d.evContrib);
        return {
          name: String(d.name || ''),
          price: Number.isFinite(price) ? price : 0,
          evContrib: Number.isFinite(contrib) ? contrib : 0
        };
      })
      .filter((d) => d.price > 0)
      .map((d) => ({ ...d, logPrice: Math.log1p(d.price) }));

    const total = priced.reduce((s, d) => s + Math.max(0, d.evContrib), 0);
    if (!priced.length || total <= 0) {
      return { pct: 0, count: 0 };
    }

    const sorted = [...priced].sort((a, b) => b.logPrice - a.logPrice);
    const logPrices = sorted.map((d) => d.logPrice);
    let premiumTail = [];

    // Candidate A: natural upper-tail gap on log-price with deterministic guardrails.
    if (sorted.length >= 5) {
      const xMed = quantileOf(logPrices, 0.5);
      const xQ75 = quantileOf(logPrices, 0.75);
      const candidateGaps = [];

      for (let j = 1; j <= (sorted.length - 3); j++) {
        const left = sorted[j].logPrice;
        const right = sorted[j + 1].logPrice;
        // Upper-regime window: avoid choosing breaks too low in the distribution.
        if (!(left >= xQ75 && right >= xMed)) continue;
        candidateGaps.push({ j, gap: left - right });
      }

      if (candidateGaps.length) {
        const gapValues = candidateGaps.map((g) => g.gap);
        const best = candidateGaps.reduce((acc, g) => (g.gap > acc.gap ? g : acc), candidateGaps[0]);
        const gMed = quantileOf(gapValues, 0.5);
        const gQ75 = quantileOf(gapValues, 0.75);
        const clearGapMin = Math.max(0.35, (2 * gMed), (1.5 * gQ75));
        const clearGap = best.gap >= clearGapMin;
        const impliedTailSize = best.j + 1;
        const tinyTailAllowed = impliedTailSize >= 3 || best.gap >= 0.70;

        if (clearGap && tinyTailAllowed) {
          premiumTail = sorted.slice(0, impliedTailSize);
        }
      }
    }

    // Candidate B fallback: strict value fence in log-price space.
    if (!premiumTail.length) {
      const q1 = quantileOf(logPrices, 0.25);
      const q3 = quantileOf(logPrices, 0.75);
      const iqr = q3 - q1;
      const fence = q3 + (2.5 * iqr);
      premiumTail = sorted.filter((d) => d.logPrice >= fence);
    }

    // If no premium tail is found, report 0% reliance instead of forcing one.
    if (!premiumTail.length) {
      return { pct: 0, count: 0 };
    }

    const premiumEv = premiumTail.reduce((s, d) => s + Math.max(0, d.evContrib), 0);
    return {
      pct: Math.max(0, Math.min(100, (premiumEv / total) * 100)),
      count: premiumTail.length
    };
  }
  const jackpotDynamic = computeDynamicJackpotReliance(weightData);
  const jackpotReliancePct = jackpotDynamic.pct;
  const jackpotDependenceHint = jackpotReliancePct < 30
    ? 'EV is broadly supported across outcomes.'
    : (jackpotReliancePct < 60
      ? 'EV is moderately driven by jackpot hits.'
      : 'EV is strongly driven by jackpot hits.');

  const n = weightData.length;
  const hhi = weightData.reduce((s, d) => s + d.weight * d.weight, 0);
  let weightStabilityPct = 0;
  if (n > 1) {
    const minHhi = 1 / n;
    const maxHhi = 1;
    const stability = 1 - ((hhi - minHhi) / (maxHhi - minHhi));
    weightStabilityPct = Math.max(0, Math.min(1, stability)) * 100;
  }
  const weightStabilityClass = weightStabilityPct >= 70 ? 'green' : (weightStabilityPct >= 45 ? 'amber' : 'red');
  const weightStabilityHint = weightStabilityPct < 70
    ? 'Early data is still unsettled.'
    : (weightStabilityPct < 90
      ? 'Results are settling into a stable pattern.'
      : 'Results are showing a stable pattern.');

  // Weight confidence: share of model weight where each scarab's observed rate
  // meets a 95% CI relative-error target (Wilson interval, ±20%).
  const zScore95 = 1.96;
  const targetRelativeError = 0.20;
  const z2 = zScore95 * zScore95;
  const totalObserved = Math.max(1, totalReceived);
  let statisticallySupportedWeight = 0;
  let statisticallySupportedScarabs = 0;
  let totalScarabWithObservations = 0;
  for (const d of weightData) {
    const k = Math.max(0, Number(d.count) || 0);
    if (k <= 0) continue;
    totalScarabWithObservations += 1;
    const pHat = k / totalObserved;
    const denom = 1 + (z2 / totalObserved);
    const halfWidth = (zScore95 / denom) * Math.sqrt((pHat * (1 - pHat) / totalObserved) + (z2 / (4 * totalObserved * totalObserved)));
    const relativeHalfWidth = pHat > 0 ? (halfWidth / pHat) : Infinity;
    const pass = Number.isFinite(relativeHalfWidth) && relativeHalfWidth <= targetRelativeError;
    if (pass) {
      statisticallySupportedWeight += d.weight;
      statisticallySupportedScarabs += 1;
    }
  }
  const weightConfidencePct = Math.max(0, Math.min(100, statisticallySupportedWeight * 100));
  const weightConfidenceClass = weightConfidencePct >= 80 ? 'green' : (weightConfidencePct >= 60 ? 'amber' : 'red');
  const weightConfidenceHint = totalScarabWithObservations > 0
    ? (statisticallySupportedScarabs.toLocaleString() + '/' + totalScarabWithObservations.toLocaleString() + ' scarabs meet the confidence threshold.')
    : 'Not enough observations.';

  function readCurrentLeagueSharePct(src) {
    if (!src || typeof src !== 'object') return null;
    const toFiniteNumber = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const directCandidates = [
      src.currentLeagueSharePct,
      src.currentLeagueShare,
      src.currentShare,
      src.leagueShare,
      src.inputMixCurrentPct,
      src.inputMixCurrent
    ];
    for (const v of directCandidates) {
      const n = toFiniteNumber(v);
      if (n != null) {
        if (n <= 1) return Math.max(0, Math.min(100, n * 100));
        return Math.max(0, Math.min(100, n));
      }
    }
    const nested = [
      src.inputMix,
      src.sourceMix,
      src.mix,
      src.transition
    ];
    for (const obj of nested) {
      if (!obj || typeof obj !== 'object') continue;
      const nestedCandidates = [
        obj.currentLeagueSharePct,
        obj.currentLeagueShare,
        obj.currentShare,
        obj.currentPct,
        obj.current
      ];
      for (const v of nestedCandidates) {
        const n = toFiniteNumber(v);
        if (n != null) {
          if (n <= 1) return Math.max(0, Math.min(100, n * 100));
          return Math.max(0, Math.min(100, n));
        }
      }
    }

    // Deterministic derivation from aggregate weight metadata.
    const mode = String(src.mode || '').toLowerCase();
    if (mode === 'challenge-current-only') return 100;
    if (mode === 'challenge-prior-fallback' || mode === 'standard-prior-challenge') return 0;

    const alpha = toFiniteNumber(src.alphaGlobal);
    if (alpha != null) {
      if (alpha <= 1) return Math.max(0, Math.min(100, alpha * 100));
      return Math.max(0, Math.min(100, alpha));
    }

    const consumedCurrent = toFiniteNumber(src.consumedCurrent);
    const handoverConsumed = toFiniteNumber(src.handoverConsumed);
    if (consumedCurrent != null && handoverConsumed != null && handoverConsumed > 0) {
      return Math.max(0, Math.min(100, (consumedCurrent / handoverConsumed) * 100));
    }

    return null;
  }
  let currentLeagueSharePct = readCurrentLeagueSharePct(data);
  if (currentLeagueSharePct == null) currentLeagueSharePct = readCurrentLeagueSharePct(data.weightMeta);
  if (currentLeagueSharePct == null) currentLeagueSharePct = readCurrentLeagueSharePct(state._weightMeta);
  const currentLeagueShareClass = currentLeagueSharePct == null
    ? ''
    : (currentLeagueSharePct >= 70 ? 'green' : (currentLeagueSharePct >= 45 ? 'amber' : 'red'));
  const currentLeagueShareValue = currentLeagueSharePct == null ? '&mdash;' : (currentLeagueSharePct.toFixed(1) + '%');
  const currentLeagueShareHint = currentLeagueSharePct == null
    ? 'Awaiting league transition telemetry.'
    : (currentLeagueSharePct < 50
      ? 'Weights still lean heavily on prior-league data.'
      : (currentLeagueSharePct < 85
        ? 'Weights are blending toward current-league data.'
        : (currentLeagueSharePct < 100
          ? 'Weights are mostly current-league native.'
          : 'Weights are fully current-league based.')));

  // Summary stats bar
  document.getElementById('analysisStatsBar').innerHTML = `
    <div class="analysis-stat-card"><div class="analysis-stat-label">Scarabs vendored</div><div class="analysis-stat-value">${totalConsumed.toLocaleString()}</div><div style="font-size:10px;color:var(--text-3)">Current league total</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Scarab received</div><div class="analysis-stat-value">${totalReceived.toLocaleString()}</div><div style="font-size:10px;color:var(--text-3)">Current league total</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Scarab EV</div><div class="analysis-stat-value chaos">${scarabEvValue}</div><div style="font-size:10px;color:var(--text-3)">Expected Value per scarab received</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Profit Realized</div><div class="analysis-stat-value ${currentLeagueProfitClass}">${currentLeagueProfitValue}</div><div style="font-size:10px;color:var(--text-3)">Realized profit totals from current league</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Current-League Data Share <span class="analysis-info-tip stat-tip" data-tip="Shows how much of the current data model comes from the active league.&#10;Early in a league, carryover data may still be used until enough new-league data replaces it." aria-label="Current-league data share details" tabindex="0">?</span></div><div class="analysis-stat-value ${currentLeagueShareClass}">${currentLeagueShareValue}</div><div style="font-size:10px;color:var(--text-3)">${currentLeagueShareHint}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Weight stability <span class="analysis-info-tip stat-tip" data-tip="Measures how evenly scarab weights are distributed.&#10;Higher values mean results are less concentrated in a few scarabs." aria-label="Weight stability details" tabindex="0">?</span></div><div class="analysis-stat-value ${weightStabilityClass}">${weightStabilityPct.toFixed(0)}%</div><div style="font-size:10px;color:var(--text-3)">${weightStabilityHint}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Weight confidence <span class="analysis-info-tip stat-tip" data-tip="Confidence threshold: 95% interval with ±20% relative error per scarab.&#10;This card shows the share of scarab weights that meet that threshold." aria-label="Confidence formula details" tabindex="0">?</span></div><div class="analysis-stat-value ${weightConfidenceClass}">${weightConfidencePct.toFixed(2)}%</div><div style="font-size:10px;color:var(--text-3)">${weightConfidenceHint}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Jackpot Dependence <span class="analysis-info-tip stat-tip" data-tip="Measures how much of your EV comes from premium scarabs.&#10;Higher values mean more expected profit is tied to big hits, so returns may feel swingier in smaller runs." aria-label="Jackpot dependence details" tabindex="0">?</span></div><div class="analysis-stat-value">${jackpotReliancePct.toFixed(1)}%</div><div style="font-size:10px;color:var(--text-3)">${jackpotDependenceHint}</div></div>
  `;

  window._analysisWeightAllData = weightData.map(d => ({ ...d }));
  window._analysisWeightData = [];
  window._analysisWeightSort = { key: 'ninja', dir: -1 };
  window._analysisWeightFilter = '';
  const filterInput = document.getElementById('analysis-filter');
  if (filterInput) filterInput.value = '';

  const head = document.getElementById('analysisWeightHead');
  if (head) {
    head.style.gridTemplateColumns = '1fr 82px 76px 82px 84px';
    head.style.gap = '6px';
    head.innerHTML = `
      <div class="th th-search"><input type="text" id="analysis-filter" class="analysis-head-search" placeholder="SCARAB" oninput="setAnalysisWeightFilter(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="analysis_filter" data-lpignore="true"></div>
      <div class="th right" data-sort="received" onclick="sortAnalysisWeight('received')"><span class="recv-desktop">Received</span><span class="recv-mobile">Recv</span></div>
      <div class="th right" data-sort="pct" onclick="sortAnalysisWeight('pct')">Weight</div>
      <div class="th right" data-sort="ninja" onclick="sortAnalysisWeight('ninja')">COST/EA</div>
      <div class="th right" data-sort="contrib" onclick="sortAnalysisWeight('contrib')"><span class="contrib-desktop">CONTRIB</span><span class="contrib-mobile">CONTRIB</span></div>
    `;
  }

  syncAnalysisWeightView();

  const forceLifetimeDev = (() => {
    try {
      return new URLSearchParams(window.location.search).get('dev') === '1';
    } catch (e) {
      return false;
    }
  })();
  const showLifetimeSection = hasMultiLeagueData || forceLifetimeDev;
  const lifetimeSection = document.getElementById('analysisEvCompare')?.closest('.analysis-section');
  if (lifetimeSection) {
    lifetimeSection.style.display = showLifetimeSection ? '' : 'none';
    lifetimeSection.classList.add('analysis-section-lifetime');
  }
  if (!showLifetimeSection) {
    document.getElementById('analysisEvCompare').innerHTML = '';
    return;
  }

  document.getElementById('analysisEvCompare').innerHTML = `
    <div class="analysis-ev-card">
      <div class="label">Sessions Submitted</div>
      <div class="value">${lifetimeSessionCount.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Accepted session logs.</div>
    </div>
    <div class="analysis-ev-card">
      <div class="label">Total Scarabs Vendored</div>
      <div class="value">${lifetimeConsumed.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Lifetime across all leagues</div>
    </div>
    <div class="analysis-ev-card">
      <div class="label">Total Scarabs Received</div>
      <div class="value">${lifetimeReceived.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Lifetime across all leagues</div>
    </div>
    <div class="analysis-ev-card">
      <div class="label">Total Profit Realized</div>
      <div class="value">${Number.isFinite(lifetimeProfitDiv) ? ((lifetimeProfitDiv >= 0 ? '+' : '') + lifetimeProfitDiv.toFixed(1) + 'd') : '—'}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Cumulative realized profit.</div>
    </div>
  `;

}

function getAnalysisSortLabel() {
  const s = window._analysisWeightSort || { key: 'ninja', dir: -1 };
  const key = s.key;
  const dir = s.dir;
  if (key === 'name') return 'Sorted by: Scarab name (' + (dir === 1 ? 'A-Z' : 'Z-A') + ')';
  if (key === 'received') return 'Sorted by: Count received (' + (dir === -1 ? 'high to low' : 'low to high') + ')';
  if (key === 'pct') return 'Sorted by: Weight % (' + (dir === -1 ? 'high to low' : 'low to high') + ')';
  if (key === 'ninja') return 'Sorted by COST/EA (' + (dir === -1 ? 'high-LOW' : 'low-HIGH') + ')';
  if (key === 'contrib') return 'Sorted by: EV contribution (' + (dir === -1 ? 'high to low' : 'low to high') + ')';
  return 'Bar height = count received';
}

function updateAnalysisChartAxisLabel() {
  const xEl = document.getElementById('analysisChartXLabel');
  if (xEl) xEl.textContent = getAnalysisSortLabel();
}

function showAnalysisBarTooltip(barEl, ev) {
  const name = barEl.getAttribute('data-scarab-name');
  if (!name) return;
  const tip = document.getElementById('analysisBarTooltip');
  if (!tip) return;
  tip.textContent = name.replace(/&quot;/g, '"').replace(/&lt;/g, '<');
  tip.classList.add('show');
  const x = (ev && ev.clientX != null) ? ev.clientX : (barEl.getBoundingClientRect().left + barEl.getBoundingClientRect().width / 2);
  const y = (ev && ev.clientY != null) ? ev.clientY : barEl.getBoundingClientRect().top;
  const offset = 12;
  tip.style.left = (x + offset) + 'px';
  tip.style.top = (y - 4) + 'px';
}

function hideAnalysisBarTooltip() {
  const tip = document.getElementById('analysisBarTooltip');
  if (tip) { tip.classList.remove('show'); tip.textContent = ''; }
}

function normalizeAnalysisSearchText(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isSubsequence(needle, haystack) {
  if (!needle) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

function matchesAnalysisWeightFilter(name, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;
  const nameLower = String(name || '').toLowerCase();
  if (nameLower.includes(q)) return true;

  const queryTokens = q.split(/\s+/).filter(Boolean);
  if (!queryTokens.length) return true;
  const normName = normalizeAnalysisSearchText(nameLower);

  // All typed words can appear in any order.
  if (queryTokens.every(tok => normName.includes(tok))) return true;

  // Compact typing support (e.g., "hornedblood" or shorthand-like typing).
  const compactQuery = queryTokens.join('');
  const compactName = normName.replace(/\s+/g, '');
  if (compactName.includes(compactQuery)) return true;
  return isSubsequence(compactQuery, compactName);
}

function getAnalysisWeightComparator(key, dir) {
  return (a, b) => {
    if (key === 'name') return (a.name.localeCompare(b.name)) * dir;
    if (key === 'received') return (a.count - b.count) * dir;
    if (key === 'pct') return (a.pct - b.pct) * dir;
    if (key === 'ninja') return (a.ninjaPrice - b.ninjaPrice) * dir;
    if (key === 'contrib') return (a.evContrib - b.evContrib) * dir;
    return 0;
  };
}

function syncAnalysisWeightView() {
  const source = window._analysisWeightAllData || [];
  const query = String(window._analysisWeightFilter || '').trim();
  const sortState = window._analysisWeightSort || { key: 'ninja', dir: -1 };
  const filtered = source.filter(d => matchesAnalysisWeightFilter(d.name, query));
  filtered.sort(getAnalysisWeightComparator(sortState.key, sortState.dir));
  window._analysisWeightData = filtered;

  updateAnalysisChartAxisLabel();
  const maxReceived = Math.max(...filtered.map(d => d.count), 1);
  let chartHtml = '';
  for (const d of filtered) {
    const heightPct = maxReceived > 0 ? (d.count / maxReceived * 100) : 0;
    const safeName = (d.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    chartHtml += `<div class="analysis-bar-vertical" data-scarab-name="${safeName}" onmouseenter="showAnalysisBarTooltip(this, event)" onmouseleave="hideAnalysisBarTooltip()"><div class="bar-inner" style="height:${heightPct}%"></div></div>`;
  }
  const chartEl = document.getElementById('analysisWeightChart');
  if (chartEl) {
    chartEl.innerHTML = chartHtml || `<div style="font-size:12px;color:var(--text-3)">${query ? 'No scarabs match the current filter.' : 'No output scarab data.'}</div>`;
  }
  renderAnalysisWeightTable();

  const head = document.getElementById('analysisWeightHead');
  if (head) {
    head.querySelectorAll('.th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === (sortState.key || 'ninja')) {
        th.classList.add(sortState.dir === 1 ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  const metaEl = document.getElementById('analysisFilterMeta');
  if (metaEl) {
    if (!query) {
      metaEl.textContent = `${filtered.length.toLocaleString()} scarabs shown`;
    } else {
      metaEl.textContent = `${filtered.length.toLocaleString()} of ${source.length.toLocaleString()} match`;
    }
  }
}

function setAnalysisWeightFilter(value) {
  window._analysisWeightFilter = String(value || '');
  syncAnalysisWeightView();
}

function sortAnalysisWeight(key) {
  const source = window._analysisWeightAllData;
  if (!source || !source.length) return;
  const prev = window._analysisWeightSort || { key: 'ninja', dir: -1 };
  const dir = prev.key === key ? -prev.dir : (key === 'name' ? 1 : -1);
  window._analysisWeightSort = { key, dir };
  syncAnalysisWeightView();
}

function renderAnalysisWeightTable() {
  const data = window._analysisWeightData || [];
  const el = document.getElementById('analysisWeightTable');
  if (!el) return;
  if (!data.length) {
    const q = String(window._analysisWeightFilter || '').trim();
    el.innerHTML = `<div style="padding:12px;color:var(--text-3)">${q ? 'No scarabs match the current filter.' : 'No output scarab data.'}</div>`;
    return;
  }
  const rows = data.map(d => {
    const pctText = d.pct.toFixed(3);
    return `
    <div class="analysis-weight-row" style="display:grid;grid-template-columns:1fr 82px 76px 82px 84px;font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;gap:6px;">
      <div style="overflow:hidden;min-width:0"><span class="scarab-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}</span><span class="scarab-name-mobile" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mobileScarabName(d.name)}</span></div>
      <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:550;color:var(--text-2)">${d.count.toLocaleString()}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:550;color:var(--text-2)">${pctText}%</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text-3)">${d.ninjaPrice ? d.ninjaPrice.toFixed(2) + 'c' : '\u2014'}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--chaos)">${d.evContrib.toFixed(2)}c</span>
    </div>`;
  }).join('');
  el.innerHTML = rows;
  applyScarabModifierTooltips(document.getElementById('tab-analysis'));
}

// BULK BUY ANALYZER (CSV from Gemini)


 // 'image' or 'csv'
const GEMINI_KEY_STORAGE = 'poepool-gemini-api-key';
const GEMINI_FLASH_SKIP_DATE_KEY = 'poepool-gemini-flash-skip-date';
const GEMINI_MODEL_FLASH = 'gemini-2.5-flash';
const GEMINI_MODEL_LITE = 'gemini-2.5-flash-lite';
// Optional: set a default key for personal/local use ONLY.
// Do not share a copy of this file if you populate this value.
const DEFAULT_GEMINI_API_KEY = '';

const BULK_MISMATCH_LOG_KEY = 'poepool-bulk-mismatch-log';
const BULK_NAME_MAP_STORAGE_KEY = 'poepool-bulk-name-map';

const BULK_DEFAULT_NAME_MAP_URL = './js/data/bulk-name-map.json';

 // shared defaults loaded from JSON file
    // user overrides stored in localStorage
         // effective map = defaults merged with user overrides

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
  try {
    const res = await fetch(BULK_DEFAULT_NAME_MAP_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    state.BULK_DEFAULT_NAME_MAP = normalizeBulkNameMap(data);
    recomputeBulkNameMap();

    // If dev panel is open (or user is in dev mode), refresh textarea to show defaults.
    if (typeof isBulkDevMode === 'function' && isBulkDevMode()) {
      try { exportBulkNameMapToInput(); } catch (e) {}
    }
  } catch (e) {
    // Optional file; ignore if missing or invalid.
  }
}

function logBulkMismatch(rawName, qty, source) {
  try {
    const existing = localStorage.getItem(BULK_MISMATCH_LOG_KEY);
    const arr = Array.isArray(JSON.parse(existing)) ? JSON.parse(existing) : [];
    const name = String(rawName || '').trim().toLowerCase();
    if (arr.some(e => String(e.rawName || '').trim().toLowerCase() === name)) return;
    arr.push({
      rawName: String(rawName || ''),
      qty: Number.isFinite(qty) ? qty : null,
      source: source || 'unknown',
      timestamp: new Date().toISOString()
    });
    localStorage.setItem(BULK_MISMATCH_LOG_KEY, JSON.stringify(arr));
  } catch (e) {
    // Swallow logging errors; analyzer should never fail because of logging.
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
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('dev') === '1';
  } catch (e) {
    return false;
  }
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

// Model fallback: prefer Flash; if rate-limited, skip Flash for rest of day (persists across reloads).
function getTodayDateKey() {
  return toLocalDateKey(); // YYYY-MM-DD (local)
}
function isFlashSkippedToday() {
  try {
    return localStorage.getItem(GEMINI_FLASH_SKIP_DATE_KEY) === getTodayDateKey();
  } catch (e) { return false; }
}
function setFlashSkippedToday() {
  try {
    localStorage.setItem(GEMINI_FLASH_SKIP_DATE_KEY, getTodayDateKey());
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

  const askStr = document.getElementById('bulkAskingChaos').value || '';
  const askingChaos = parseFloat(askStr);
  if (!Number.isFinite(askingChaos) || askingChaos <= 0) {
    errEl.textContent = 'Please enter the total asking price in chaos before analyzing.';
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
		  text: "You are a PoE OCR tool. The image contains 2 or 3 distinct vertical tables.\n\n" +
				"PROCESSING PROTOCOL (CRITICAL):\n" +
				"1. Focus on one vertical column at a time. Start with the leftmost column.\n" +
				"2. For every row, identify the WHOLE NUMBER at the start (Qty) and the TEXT immediately following it (Name).\n" +
				"3. STRICT RULE: A number containing a decimal (e.g., 44.45) is a price. You MUST ignore it. Never use a decimal number as a Quantity.\n" +
				"4. COHESION: If you find a Quantity like '79', ensure it stays linked to the item on its immediate right ('Kalguuran'). Do not jump to other columns.\n\n" +
				"OUTPUT FORMAT:\n" +
				"- Return ONLY 'Name,Qty' CSV lines.\n" +
				"- No markdown blocks, no headers, no conversational text.\n" +
				"- Example: 'Ambush,33'"
		}]
	  },
      contents: [
        {
          parts: [
            { text: "Extract Name,Qty from this TFT listing." },
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

    // Prefer Flash; if rate-limited, skip Flash for rest of day (persists across reloads) and use Lite.
    let modelId = isFlashSkippedToday() ? GEMINI_MODEL_LITE : GEMINI_MODEL_FLASH;
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=` + encodeURIComponent(apiKey);
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
        if (!text) {
          lastError = new Error('No text returned from Gemini.');
          break;
        }
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

      lastError = new Error(`Gemini error ${res.status}: ${txt.slice(0, 200)}`);
      if (isRateLimitError(res, res.status, txt) && modelId === GEMINI_MODEL_FLASH) {
        setFlashSkippedToday();
        modelId = GEMINI_MODEL_LITE;
        continue;
      }
      break;
    }

    throw lastError;
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
  const askingStr = document.getElementById('bulkAskingChaos').value || '';
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

  const askingChaos = parseFloat(askingStr);
  if (!Number.isFinite(askingChaos) || askingChaos <= 0) {
    errEl.textContent = 'Please enter the total asking price in chaos.';
    errEl.style.display = 'block';
    return;
  }

  if (!Object.keys(state.ninjaPrices || {}).length) {
    errEl.textContent = 'Load market prices first (open the Scarab Vendor tab).';
    errEl.style.display = 'block';
    return;
  }

  const lower = buildNinjaLookup();
  const entries = SCARAB_LIST.map(s => ({ chaosEa: getNinjaPrice(s.name, lower) }));
  const priced = entries.filter(e => e.chaosEa > 0);
  const autoEV = calcEV(priced);
  const threshold = state.ninjaEvOverride !== null ? state.ninjaEvOverride : autoEV;
  if (threshold == null) {
    errEl.textContent = 'Could not determine harmonic EV \u2014 ensure market prices are loaded.';
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
      logBulkMismatch(r.rawName, r.qty, source);
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
    const icon = getNinjaImage(r.canonical.name) || (CDN + r.canonical.icon);
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

normalizeBulkTableColumnOrder();
normalizeBulkNameCells();

// ATLAS OPTIMIZER





function atlasSave() {
  // Compute and store deltas at save time so we can detect when a
  // previously-positive toggle has flipped negative on revisit.
  // Also snapshot untoggled suggestion state so we only alert when a node
  // newly crosses into suggested territory later.
  const saved = { blocked: [], boosted: [], deltas: {}, suggestedState: {} };
  const baselineEV = atlasComputeEV(new Set(), new Set()) || 0;
  const suggestedThresholdPct = 0.01;
  for (const g of state._atlasBlocked) {
    saved.blocked.push(g);
    saved.deltas[`block:${g}`] = atlasGroupStats(g, true).toggleDelta;
  }
  for (const g of state._atlasBoosted) {
    saved.boosted.push(g);
    saved.deltas[`boost:${g}`] = atlasGroupStats(g, false).toggleDelta;
  }
  for (const g of ATLAS_BLOCKABLE) {
    if (state._atlasBlocked.has(g)) continue;
    const d = atlasGroupStats(g, true).toggleDelta;
    saved.suggestedState[`block:${g}`] = baselineEV > 0 ? (d / baselineEV) >= suggestedThresholdPct : false;
  }
  for (const g of ATLAS_BOOSTABLE) {
    if (state._atlasBoosted.has(g)) continue;
    const d = atlasGroupStats(g, false).toggleDelta;
    saved.suggestedState[`boost:${g}`] = baselineEV > 0 ? (d / baselineEV) >= suggestedThresholdPct : false;
  }
  try {
    localStorage.setItem(ATLAS_SAVE_KEY, JSON.stringify(saved));
  } catch(e) {}
  // Flash save button confirmation
  const btn = document.getElementById('atlasSaveBtn');
  if (btn) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = '&#10003; Saved';
    btn.style.color = isDark ? '#5a2570' : '#6dbf84';
    setTimeout(() => {
      btn.textContent = 'Save config';
      btn.style.color = '';
    }, 1800);
  }
}

function atlasLoad() {
  try {
    const raw = localStorage.getItem(ATLAS_SAVE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.blocked) state._atlasBlocked = new Set(saved.blocked);
    if (saved.boosted) state._atlasBoosted  = new Set(saved.boosted);
  } catch(e) {}
}

function atlasCheckRevisitWarning() {
  // Only warn if we have a saved config and ninja prices are loaded
  if (!state.ninjaLoaded) return;
  try {
    const raw = localStorage.getItem(ATLAS_SAVE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved.deltas || !Object.keys(saved.deltas).length) return;

    // Case 1: was negative (good) when saved, now positive (bad).
    let hasFlipped = false;
    for (const [key, savedDelta] of Object.entries(saved.deltas)) {
      if (savedDelta >= 0) continue; // was already an EV loss when saved \u2014 skip
      const [type, group] = key.split(':');
      const currentDelta = atlasGroupStats(group, type === 'block').toggleDelta;
      if (currentDelta > 0) { hasFlipped = true; break; }
    }

    // Case 2: node was not suggested when saved, now newly suggested.
    let newlySuggestedCount = 0;
    const baselineEV = atlasComputeEV(new Set(), new Set()) || 0;
    const suggestedThresholdPct = 0.01;
    const priorSuggested = saved.suggestedState || {};
    for (const [key, wasSuggested] of Object.entries(priorSuggested)) {
      if (wasSuggested) continue; // user already ignored this at save time
      const [type, group] = key.split(':');
      const isBlock = type === 'block';
      const isActive = isBlock ? state._atlasBlocked.has(group) : state._atlasBoosted.has(group);
      if (isActive) continue; // already toggled now, no reminder needed
      const currentDelta = atlasGroupStats(group, isBlock).toggleDelta;
      const isNowSuggested = baselineEV > 0 ? (currentDelta / baselineEV) >= suggestedThresholdPct : false;
      if (isNowSuggested) newlySuggestedCount++;
    }

    if (!hasFlipped && newlySuggestedCount === 0) return;

    // Only warn once per session
    if (window._atlasWarnedThisSession) return;
    window._atlasWarnedThisSession = true;

    setTimeout(() => {
      showAtlasWarningToast({ hasFlipped, newlySuggestedCount });
    }, 2000);
  } catch(e) {}
}

function showAtlasWarningToast(opts = {}) {
  const hasFlipped = !!opts.hasFlipped;
  const newlySuggestedCount = Number(opts.newlySuggestedCount || 0);
  const el = document.getElementById('toastAtlas');
  if (!el || el.classList.contains('show')) return;
  el.style.setProperty('--vt-accent', hasFlipped ? 'var(--chaos)' : 'var(--accent)');
  const title = hasFlipped ? 'Atlas config needs review' : 'New atlas suggestions available';
  const alert = hasFlipped
    ? 'Prices may have shifted since your last save.'
    : 'Market shifts unlocked new positive Atlas opportunities.';
  const lines = [];
  if (hasFlipped) lines.push('One or more of your saved toggles is now hurting your map EV.');
  if (newlySuggestedCount > 0) {
    const label = newlySuggestedCount === 1 ? 'One node' : `${newlySuggestedCount} nodes`;
    lines.push(`${label} crossed above your positive EV suggestion threshold.`);
  }
  lines.push('Check Atlas Optimizer pills/deltas and decide if you want to update your config.');
  el.innerHTML = `
    <div class="version-toast-header">
      <span class="version-toast-title" style="text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap">${title}</span>
      <button class="version-toast-dismiss" onclick="event.stopPropagation(); dismissAtlasToast()" title="Dismiss">&times;</button>
    </div>
    <div class="version-toast-alert">${alert}</div>
    <div class="version-toast-body">
      <ul>${lines.map(line => `<li>${line}</li>`).join('')}</ul>
    </div>
    <div class="version-toast-footer">Click to open Atlas Optimizer</div>
  `;
  el.classList.add('show');
  el.onclick = () => { dismissAtlasToast(); switchTab('atlas'); };
}

function dismissAtlasToast() {
  const el = document.getElementById('toastAtlas');
  if (el) { el.classList.remove('show'); el.style.removeProperty('--vt-accent'); }
}

// Returns base weights from community sessions, or equal fallback.
function atlasGetWeights() {
  if (state._observedWeights && Object.keys(state._observedWeights).length > 0) return state._observedWeights;
  return null; // no data yet \u2014 callers must handle null
}

// Compute map drop EV given current blocked + boosted state.
// blocked: Set of group names to exclude entirely (weight = 0)
function atlasComputeEV(blockedGroups, boostedGroups) {
  const weights = atlasGetWeights();
  if (!weights) return null; // weights not loaded yet
  const lower   = buildNinjaLookup();
  boostedGroups = boostedGroups || new Set();

  const active = SCARAB_LIST.filter(s => !blockedGroups.has(s.group));
  const totalW = active.reduce((sum, s) => {
    const mult = boostedGroups.has(s.group) ? 2 : 1;
    return sum + (weights[s.name] || 0) * mult;
  }, 0);
  if (!totalW) return null;

  return active.reduce((sum, s) => {
    const mult  = boostedGroups.has(s.group) ? 2 : 1;
    const w     = (weights[s.name] || 0) * mult;
    const price = getNinjaPrice(s.name, lower);
    return sum + (w / totalW) * price;
  }, 0);
}

// Per-group stats for one group card.
function atlasGroupStats(group, isBlockable) {
  const weights = atlasGetWeights();
  const lower   = buildNinjaLookup();
  const scarabs = SCARAB_LIST.filter(s => s.group === group);

  // Baseline pool weight (no blocks, no boosts)
  const allW   = SCARAB_LIST.reduce((sum, s) => sum + (weights[s.name] || 0), 0);
  const groupW = scarabs.reduce((sum, s) => sum + (weights[s.name] || 0), 0);

  const groupShare  = allW > 0 ? groupW / allW : 0;
  const groupEV     = groupW > 0
    ? scarabs.reduce((sum, s) => sum + ((weights[s.name] || 0) / groupW) * getNinjaPrice(s.name, lower), 0)
    : 0;
  const contribution = groupShare * groupEV;

  // Delta = what happens to current live EV if this group is toggled
  const currentEV = atlasComputeEV(state._atlasBlocked, state._atlasBoosted) || 0;

  let toggleDelta = 0;
  if (isBlockable) {
    if (state._atlasBlocked.has(group)) {
      const withoutBlock = new Set([...state._atlasBlocked].filter(g => g !== group));
      toggleDelta = atlasComputeEV(withoutBlock, state._atlasBoosted) - currentEV;
    } else {
      const withBlock = new Set([...state._atlasBlocked, group]);
      toggleDelta = atlasComputeEV(withBlock, state._atlasBoosted) - currentEV;
    }
  } else {
    if (state._atlasBoosted.has(group)) {
      const withoutBoost = new Set([...state._atlasBoosted].filter(g => g !== group));
      toggleDelta = atlasComputeEV(state._atlasBlocked, withoutBoost) - currentEV;
    } else {
      const withBoost = new Set([...state._atlasBoosted, group]);
      toggleDelta = atlasComputeEV(state._atlasBlocked, withBoost) - currentEV;
    }
  }

  // Per-scarab breakdown (sorted by EV contribution desc)
  const allWforDisplay = active => active.reduce((s, sc) => {
    const mult = state._atlasBoosted.has(sc.group) ? 2 : 1;
    return s + (weights[sc.name] || 0) * mult;
  }, 0);
  const livePool  = SCARAB_LIST.filter(s => !state._atlasBlocked.has(s.group));
  const liveTotalW = allWforDisplay(livePool);

  const scarabRows = scarabs.map(s => {
    const w          = weights[s.name] || 0;
    const localShare = groupW > 0 ? w / groupW : 0;
    const price      = getNinjaPrice(s.name, lower);
    const trendPct   = getPriceTrend(s.name);
    const evContrib  = localShare * price;
    // Live pool contribution (accounts for boosts on other groups too)
    const mult       = state._atlasBoosted.has(s.group) ? 2 : 1;
    const liveShare  = liveTotalW > 0 ? (w * mult) / liveTotalW : 0;
    const liveContrib = liveShare * price;
    return { name: s.name, localShare, price, trendPct, evContrib, liveContrib };
  }).sort((a, b) => b.evContrib - a.evContrib);

  return { scarabs: scarabRows, groupShare, groupEV, contribution, toggleDelta };
}

function atlasUpdateHero() {
  const currentEV  = atlasComputeEV(state._atlasBlocked, state._atlasBoosted);
  const baselineEV = atlasComputeEV(new Set(), new Set());
  const nb = state._atlasBlocked.size;
  const ns = state._atlasBoosted.size;

  const curEl   = document.getElementById('atlas-ev-current');
  const baseEl  = document.getElementById('atlas-ev-baseline');
  const deltaEl = document.getElementById('atlas-ev-delta');
  const subEl   = document.getElementById('atlas-ev-delta-sub');
  const pctEl   = document.getElementById('atlas-ev-pct');

  if (currentEV === null || baselineEV === null) {
    if (curEl)   curEl.textContent  = '\u2014';
    if (baseEl)  baseEl.textContent = '\u2014';
    if (deltaEl) { deltaEl.textContent = '\u2014'; deltaEl.className = 'atlas-hero-val muted'; }
    if (pctEl)   { pctEl.textContent = '\u2014';   pctEl.className   = 'atlas-hero-val muted'; }
    if (subEl)   subEl.textContent = 'Waiting for weight data...';
    return;
  }

  const delta = currentEV - baselineEV;
  if (curEl)   curEl.textContent  = currentEV.toFixed(3) + 'c';
  if (baseEl)  baseEl.textContent = baselineEV.toFixed(3) + 'c';
  if (deltaEl) {
    deltaEl.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(3) + 'c';
    deltaEl.className   = 'atlas-hero-val ' + (delta > 0.00005 ? 'green' : delta < -0.00005 ? 'red' : 'muted');
  }
  if (pctEl) {
    const pct = baselineEV > 0 ? (delta / baselineEV) * 100 : 0;
    pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    pctEl.className   = 'atlas-hero-val ' + (pct > 0.005 ? 'green' : pct < -0.005 ? 'red' : 'muted');
  }
  const parts = [];
  if (nb) parts.push(`${nb} blocked`);
  if (ns) parts.push(`${ns} boosted`);
  if (subEl) subEl.textContent = parts.length ? parts.join(' \u00B7 ') : 'no blocks or boosts active';
}

function atlasGroupCardHTML(group, isBlockable, isRecommended) {
  const stats     = atlasGroupStats(group, isBlockable);
  const isBlocked = state._atlasBlocked.has(group);
  const isBoosted = state._atlasBoosted.has(group);
  const isExpanded = state._atlasExpanded.has(group);
  const baselineEV = atlasComputeEV(new Set(), new Set()) || 0;

  // Badge logic:
  // - blocked/boosted state badges always show
  // - ev-loss shows if current toggle is net negative (regardless of save state)
  // - suggested shows on best untoggled positive >= 1%
  // - marginal-gains shows active nodes that are still positive but below 1%
  // - ev-loss takes priority over suggested/marginal-gains
  let badgeHtml = '';
  const isActive = isBlockable ? isBlocked : isBoosted;
  const isEvLoss = isActive && stats.toggleDelta > 0;
  const activeValueDelta = isActive ? -stats.toggleDelta : stats.toggleDelta;
  const activeValuePct = baselineEV > 0 ? (activeValueDelta / baselineEV) : 0;
  const isMarginalGain = isActive && !isEvLoss && activeValuePct > 0.000005 && activeValuePct < 0.01;
  if (isEvLoss) badgeHtml += '<span class="atlas-badge ev-loss">EV loss</span>';
  if (!isActive && isRecommended) badgeHtml += '<span class="atlas-badge recommended" title="SUGGESTED = >1% Change">suggested</span>';
  if (isMarginalGain) badgeHtml += '<span class="atlas-badge marginal" title="MARGINAL GAINS = <1% Change">marginal gains</span>';

  const togClass  = isBlockable ? 'block-toggle' : 'boost-toggle';
  // Both block and boost: toggle is OFF (grey) by default, ON when active.
  // Block ON = red (mechanic is blocked). Boost ON = amber (mechanic is boosted).
  const toggleOff = isBlockable ? !isBlocked : !isBoosted;


  const cardClass = isBlocked ? ' is-blocked' : (isBoosted ? ' is-boosted' : ' is-dimmed');

  // Delta column
  let deltaHtml;
  const d = stats.toggleDelta;
  if (Math.abs(d) < 0.000005) {
    deltaHtml = '<span class="atlas-group-stat neutral">˜0</span>';
  } else {
    const pct = baselineEV > 0 ? d / baselineEV : 0;
    const dp   = Math.abs(d) < 0.001 ? 5 : Math.abs(d) < 0.01 ? 4 : 3;
    const sign = d > 0 ? '+' : '';
    const cls  = d < 0 ? 'neg' : pct < 0.01 ? 'marginal' : 'pos';
    deltaHtml = `<span class="atlas-group-stat ${cls}">${sign}${d.toFixed(dp)}c</span>`;
  }

  const toggleFn = isBlockable ? `atlasToggleBlock('${group}')` : `atlasToggleBoost('${group}')`;

  const scarabBreakdown = isExpanded ? `
    <div class="atlas-scarab-rows">
      <div class="atlas-scarab-head">
        <span>Scarab</span><span>Group share</span><span>Price</span><span>Contrib</span><span>Trend</span>
      </div>
      ${stats.scarabs.map(sc => `
        <div class="atlas-scarab-row">
          <span class="atlas-scarab-name scarab-name">${sc.name}</span><span class="atlas-scarab-name scarab-name-mobile">${mobileScarabName(sc.name)}</span>
          <span class="atlas-scarab-stat muted">${(sc.localShare * 100).toFixed(1)}%</span>
          <span class="atlas-scarab-stat chaos">${sc.price > 0 ? sc.price.toFixed(2) + 'c' : '\u2014'}</span>
          <span class="atlas-scarab-stat accent">${sc.evContrib.toFixed(4)}c</span>
          <span class="atlas-scarab-stat ${sc.trendPct == null ? 'muted' : (sc.trendPct > 1 ? 'trend-pos' : (sc.trendPct < -1 ? 'trend-neg' : 'trend-flat'))}">
            ${sc.trendPct == null ? '\u2014' : `${sc.trendPct > 0 ? '+' : ''}${sc.trendPct.toFixed(1)}%`}
          </span>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="atlas-group-card${cardClass}">
      <div class="atlas-group-row" onclick="${toggleFn}">
        <button class="atlas-toggle ${togClass}${toggleOff ? ' off' : ''}"
          title="${isBlockable ? (isBlocked ? 'Unblock' : 'Block') : (isBoosted ? 'Remove boost' : 'Boost')} ${group}"
          onclick="event.stopPropagation(); ${toggleFn}"></button>
        <span class="atlas-group-name">${badgeHtml}<span class="atlas-group-name-text">${group}</span></span>
        <span class="atlas-group-stat chaos">${stats.groupEV.toFixed(3)}c</span>
        <span class="atlas-group-stat muted">${(stats.groupShare * 100).toFixed(1)}%</span>
        <span class="atlas-group-stat muted">${stats.contribution.toFixed(4)}c</span>
        ${deltaHtml}
        <div class="atlas-chevron-btn" onclick="event.stopPropagation(); atlasToggleExpand('${group}')" title="Show scarabs">
          <span class="atlas-chevron${!isExpanded ? ' open' : ''}">&#9656;</span>
        </div>
      </div>
      ${scarabBreakdown}
    </div>`;
}

function renderAtlas() {
  const mainEl      = document.getElementById('atlasMainCols');
  const leftoverEl  = document.getElementById('atlasLeftovers');
  if (!mainEl) return;

  if (!state.ninjaLoaded || !state._observedWeights) {
    const msg = !state.ninjaLoaded
      ? 'Loading market prices...'
      : 'Waiting for community weight data...';
    mainEl.innerHTML = `<div class="atlas-no-data">${msg}</div>`;
    if (leftoverEl) leftoverEl.innerHTML = '';
    return;
  }

  atlasUpdateHero();

  const _atlasBaselineEV = atlasComputeEV(new Set(), new Set());

  const colHeader = (title, tagClass, tagLabel, deltaLabel, rows, isBlockable) => {
    const hasActive = isBlockable
      ? rows.some(r => state._atlasBlocked.has(r.g))
      : rows.some(r => state._atlasBoosted.has(r.g));
    const resetBtn = hasActive
      ? `<button onclick="${isBlockable ? 'atlasResetBlocks()' : 'atlasResetBoosts()'}"
          style="font-family:inherit;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-3);cursor:pointer;margin-left:auto;transition:all 0.15s"
          onmouseover="this.style.color='var(--red)';this.style.borderColor='var(--red)'"
          onmouseout="this.style.color='var(--text-3)';this.style.borderColor='var(--border)'">&#8634; Reset</button>`
      : '';
    return `
    <div class="atlas-col-header">
      <span class="atlas-col-header-title">${title}</span>
      <span class="atlas-col-title-tag ${tagClass}">${tagLabel}</span>
      ${resetBtn}
    </div>
    <div class="atlas-col-subhead">
      <span></span>
      <span>Mechanic</span>
      <span>Group EV</span>
      <span>Share</span>
      <span>Contrib</span>
      <span>${deltaLabel}</span>
      <span></span>
    </div>`;
  };

  const blockRows = ATLAS_BLOCKABLE
    .map(g => ({ g, ev: atlasGroupStats(g, true).groupEV, delta: atlasGroupStats(g, true).toggleDelta }))
    .sort((a, b) => a.ev - b.ev);

  const boostRows = ATLAS_BOOSTABLE
    .map(g => ({ g, ev: atlasGroupStats(g, false).groupEV, delta: atlasGroupStats(g, false).toggleDelta }))
    .sort((a, b) => b.ev - a.ev);

  // Only consider groups not already in their active state
  const blockCandidates = blockRows
    .filter(r => !state._atlasBlocked.has(r.g) && r.delta / _atlasBaselineEV >= 0.01)
    .map(r => ({ g: r.g, delta: r.delta, isBlockable: true }));
  const boostCandidates = boostRows
    .filter(r => !state._atlasBoosted.has(r.g) && r.delta / _atlasBaselineEV >= 0.01)
    .map(r => ({ g: r.g, delta: r.delta, isBlockable: false }));
  const allCandidates = [...blockCandidates, ...boostCandidates].sort((a, b) => b.delta - a.delta);
  const recommendedGroup    = allCandidates[0]?.g || null;
  const recommendedBlockable = allCandidates[0]?.isBlockable ?? null;

  mainEl.innerHTML = `
    <div class="atlas-col">
      <div class="atlas-col-wrap">
        ${colHeader('Block nodes', 'block-tag', 'removes from pool', 'Delta', blockRows, true)}
        ${blockRows.map(r => atlasGroupCardHTML(r.g, true, recommendedGroup === r.g && recommendedBlockable === true)).join('')}
      </div>
    </div>
    <div class="atlas-col">
      <div class="atlas-col-wrap">
        ${colHeader('Boost nodes', 'boost-tag', '&times;2 drop weight', 'Delta', boostRows, false)}
        ${boostRows.map(r => atlasGroupCardHTML(r.g, false, recommendedGroup === r.g && recommendedBlockable === false)).join('')}
      </div>
    </div>
  `;

  if (leftoverEl) {
    const allGroups = [...new Set(SCARAB_LIST.map(s => s.group))];
    const controlled = new Set([...ATLAS_BLOCKABLE, ...ATLAS_BOOSTABLE]);
    const weights  = atlasGetWeights();
    const lower    = buildNinjaLookup();
    const livePool = SCARAB_LIST.filter(s => !state._atlasBlocked.has(s.group));
    const liveTotalW = livePool.reduce((sum, s) => {
      const mult = state._atlasBoosted.has(s.group) ? 2 : 1;
      return sum + (weights[s.name] || 0) * mult;
    }, 0);
    const allW = SCARAB_LIST.reduce((sum, s) => sum + (weights[s.name] || 0), 0);

    const leftovers = allGroups
      .filter(g => !controlled.has(g))
      .map(g => {
        const scarabs = SCARAB_LIST.filter(s => s.group === g);
        const groupW  = scarabs.reduce((sum, s) => sum + (weights[s.name] || 0), 0);
        const groupEV = groupW > 0
          ? scarabs.reduce((sum, s) => sum + ((weights[s.name] || 0) / groupW) * getNinjaPrice(s.name, lower), 0)
          : 0;
        const baseShare    = allW > 0 ? groupW / allW : 0;
        const liveShare    = liveTotalW > 0 ? groupW / liveTotalW : 0;
        const contribution = liveShare * groupEV;
        return { g, groupEV, baseShare, liveShare, contribution };
      })
      .sort((a, b) => b.groupEV - a.groupEV);

    const isOpen = state._atlasLeftoverOpen;
    leftoverEl.innerHTML = `
      <div class="atlas-leftovers-wrap">
        <div class="atlas-leftovers-header" onclick="atlasToggleLeftovers()">
          <span class="atlas-leftovers-title">Fixed Pool</span>
          <span class="atlas-chevron${!isOpen ? ' open' : ''}" style="margin-left:auto">&#9656;</span>
        </div>
        ${isOpen ? `
        <div class="atlas-leftovers-body">
          <div class="atlas-leftover-head">
            <span>Mechanic</span>
            <span>Group EV</span>
            <span>Share</span>
            <span>Contrib</span>
          </div>
          ${leftovers.map(r => {
            const isEx = state._atlasExpanded.has('lft-' + r.g);
            const scarabs = SCARAB_LIST.filter(s => s.group === r.g);
            const weights2 = atlasGetWeights();
            const lower2   = buildNinjaLookup();
            const groupW2  = scarabs.reduce((sum, s) => sum + (weights2[s.name] || 0), 0);
            const scarabBreak = isEx ? `
              <div class="atlas-scarab-rows">
                <div class="atlas-scarab-head">
                  <span>Scarab</span><span>Group share</span><span>Price</span><span>Contrib</span><span>Trend</span>
                </div>
                ${scarabs.map(sc => {
                  const w = weights2[sc.name] || 0;
                  const localShare = groupW2 > 0 ? w / groupW2 : 0;
                  const price = getNinjaPrice(sc.name, lower2);
                  const trendPct = getPriceTrend(sc.name);
                  const evC = localShare * price;
                  return `<div class="atlas-scarab-row">
                    <span class="atlas-scarab-name scarab-name">${sc.name}</span><span class="atlas-scarab-name scarab-name-mobile">${mobileScarabName(sc.name)}</span>
                    <span class="atlas-scarab-stat muted">${(localShare * 100).toFixed(1)}%</span>
                    <span class="atlas-scarab-stat chaos">${price > 0 ? price.toFixed(2) + 'c' : '\u2014'}</span>
                    <span class="atlas-scarab-stat accent">${evC.toFixed(4)}c</span>
                    <span class="atlas-scarab-stat ${trendPct == null ? 'muted' : (trendPct > 1 ? 'trend-pos' : (trendPct < -1 ? 'trend-neg' : 'trend-flat'))}">
                      ${trendPct == null ? '\u2014' : `${trendPct > 0 ? '+' : ''}${trendPct.toFixed(1)}%`}
                    </span>
                  </div>`;
                }).join('')}
              </div>` : '';
            return `
              <div class="atlas-group-card" style="border-radius:0;border-left:none;border-right:none;border-top:none;box-shadow:none">
                <div class="atlas-leftover-row" style="gap:6px;padding:6px 12px" onclick="atlasToggleExpand('lft-${r.g}');">
                  <span style="color:var(--text-2);font-size:12px;font-weight:600">${r.g}</span>
                  <span class="atlas-leftover-stat chaos">${r.groupEV.toFixed(3)}c</span>
                  <span class="atlas-leftover-stat muted">${(r.liveShare * 100).toFixed(1)}%</span>
                  <span class="atlas-leftover-stat muted">${r.contribution.toFixed(4)}c</span>
                  <span class="atlas-chevron${!isEx ? ' open' : ''}">&#9656;</span>
                </div>
                ${scarabBreak}
              </div>`;
          }).join('')}
        </div>` : ''}
      </div>`;
  }
  applyScarabModifierTooltips(document.getElementById('tab-atlas'));
}

function atlasToggleBlock(group) {
  if (state._atlasBlocked.has(group)) state._atlasBlocked.delete(group);
  else state._atlasBlocked.add(group);
  renderAtlas();
}

function atlasToggleBoost(group) {
  if (state._atlasBoosted.has(group)) state._atlasBoosted.delete(group);
  else state._atlasBoosted.add(group);
  renderAtlas();
}

function atlasToggleExpand(group) {
  if (state._atlasExpanded.has(group)) state._atlasExpanded.delete(group);
  else state._atlasExpanded.add(group);
  renderAtlas();
}

function atlasResetBlocks() {
  state._atlasBlocked.clear();
  renderAtlas();
}

function atlasResetBoosts() {
  state._atlasBoosted.clear();
  renderAtlas();
}

function atlasToggleLeftovers() {
  state._atlasLeftoverOpen = !state._atlasLeftoverOpen;
  renderAtlas();
}

// Kick off initial wiring
initBulkGeminiKey();
loadBulkNameMap();

// Hide bulk developer UI for normal users (enable with ?dev=1).
(() => {
  if (isBulkDevMode()) return;
  const devPanel = document.getElementById('bulkDevPanel');
  const devToggle = devPanel ? devPanel.previousElementSibling : null;
  if (devToggle && devToggle.style) devToggle.style.display = 'none';
  if (devPanel && devPanel.style) devPanel.style.display = 'none';
})();

let CURRENT_VERSION = (document.querySelector('.nav-tag')?.textContent || '').trim() || '0.0';
let _latestReleaseInfoCache = null;

function setVisibleVersion(version) {
  if (!version) return;
  document.querySelectorAll('.nav-tag').forEach(el => { el.textContent = version; });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatToastKey(key) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
  return String(key || '')
    .split(/(\s+|\/|-)/)
    .map((part, idx) => {
      if (!part || /^\s+$/.test(part) || part === '/' || part === '-') return part;
      const lower = part.toLowerCase();
      if (idx !== 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function parseHighlightBullet(raw, section) {
  const text = String(raw || '').trim();
  if (!text) return null;

  // Preferred authoring format for toast emphasis:
  // "Key phrase: supporting detail..."
  const colonIdx = text.indexOf(':');
  if (colonIdx > 0 && colonIdx < 64) {
    const key = text.slice(0, colonIdx).trim();
    const detail = text.slice(colonIdx + 1).trim();
    if (key && detail) return { section, key, detail, text };
  }

  // Also support dash-style bullets:
  // "Key phrase \u2014 detail..." or "Key phrase - detail..."
  for (const sep of [' \u2014 ', ' – ', ' - ']) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < 90) {
      const key = text.slice(0, idx).trim();
      const detail = text.slice(idx + sep.length).trim();
      if (key && detail) return { section, key, detail, text };
    }
  }

  // Backward-compatible fallback for existing changelog bullets:
  // if a sentence has a comma, treat the lead-in as key phrase.
  const commaIdx = text.indexOf(',');
  if (commaIdx > 10 && commaIdx < 90) {
    const key = text.slice(0, commaIdx).trim();
    const detail = text.slice(commaIdx + 1).trim();
    if (key && detail) return { section, key, detail, text };
  }

  return { section, key: '', detail: text, text };
}

function parseLatestReleaseInfo(changelogText) {
  const versionMatch = changelogText.match(/## \[([\d.]+)\]([\s\S]*?)(?=\n## \[|$)/);
  if (!versionMatch) return null;
  const version = versionMatch[1];
  const block = versionMatch[0];

  const highlights = [];
  for (const section of ['Added', 'Changed', 'Fixed', 'Focus']) {
    const sectionMatch = block.match(new RegExp(`### ${section}(?::\\s*([^\\n]+))?([\\s\\S]*?)(?=\\n###|$)`));
    if (!sectionMatch) continue;
    const sectionTitle = (sectionMatch[1] || '').trim();
    const sectionBody = sectionMatch[2] || '';

    if (section === 'Focus' && sectionTitle) {
      highlights.push({
        section: 'Focus',
        key: 'Focus',
        detail: sectionTitle,
        text: `Focus: ${sectionTitle}`
      });
    }

    const bullets = sectionBody
      .split('\n')
      .filter(l => l.trim().startsWith('- '))
      .map(l => l.replace(/^\s*-\s+/, '').trim())
      .filter(Boolean);
    for (const b of bullets) {
      const normalizedSection = section === 'Focus' ? 'Changed' : section;
      const parsed = parseHighlightBullet(b, normalizedSection);
      if (parsed) highlights.push(parsed);
    }
  }

  return { version, highlights: highlights.slice(0, 3) };
}

async function getLatestReleaseInfo() {
  if (_latestReleaseInfoCache) return _latestReleaseInfoCache;
  try {
    const res = await fetch('./CHANGELOG.md', { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const info = parseLatestReleaseInfo(text);
    if (info?.version) {
      CURRENT_VERSION = info.version;
      setVisibleVersion(CURRENT_VERSION);
    }
    _latestReleaseInfoCache = info;
    return info;
  } catch(e) {
    return null;
  }
}


function showToast(msg, duration, onClick) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.cursor = onClick ? 'pointer' : 'default';
  t.onclick = onClick || null;
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); t.onclick = null; }, duration || 2000);
}

async function checkVersionToast() {
  const info = await getLatestReleaseInfo();
  const liveVersion = info?.version || CURRENT_VERSION;
  if (liveVersion) {
    CURRENT_VERSION = liveVersion;
    setVisibleVersion(liveVersion);
  }

  const last = localStorage.getItem('scarabev-last-version');
  if (!last) {
    localStorage.setItem('scarabev-last-version', liveVersion);
    return;
  }
  if (last !== liveVersion) {
    localStorage.setItem('scarabev-last-version', liveVersion);
    setTimeout(() => showVersionToast(info), 1200);
  }
}

async function showVersionToast(preloadedInfo) {
  const el = document.getElementById('toastVersion');
  if (!el) return;

  const info = preloadedInfo || await getLatestReleaseInfo();
  const highlights = info?.highlights || [];
  const liveVersion = info?.version || CURRENT_VERSION;

  if (!highlights.length) return;

  // Chaos accent for version toast
  el.style.setProperty('--vt-accent', 'var(--chaos)');
  el.innerHTML = `
    <div class="version-toast-header">
      <span class="version-toast-title">ScarabEV ${liveVersion}</span>
      <span class="version-toast-sub">what's new</span>
      <button class="version-toast-dismiss" onclick="event.stopPropagation(); dismissVersionToast()" title="Dismiss">&times;</button>
    </div>
    <div class="version-toast-body">
      <ul>${highlights.map(h => {
        const sec = String(h.section || '').toLowerCase();
        if (h.key) {
          return `<li class="vt-item vt-${sec}"><span class="vt-key">${escapeHtml(formatToastKey(h.key))}</span><span class="vt-msg">: ${escapeHtml(h.detail)}</span></li>`;
        }
        return `<li class="vt-item vt-${sec}">${escapeHtml(h.detail || h.text || '')}</li>`;
      }).join('')}</ul>
      <div class="vt-muted">and more...</div>
    </div>
    <div class="version-toast-footer">Click to see full changelog</div>
  `;
  el.classList.add('show');
  window._versionToastRemaining = 7000;
  window._versionToastStartedAt = Date.now();
  clearTimeout(window._versionToastTimer);
  window._versionToastTimer = setTimeout(() => dismissVersionToast(), window._versionToastRemaining);
  el.onmouseenter = () => {
    if (!window._versionToastTimer) return;
    clearTimeout(window._versionToastTimer);
    window._versionToastTimer = null;
    const elapsed = Date.now() - (window._versionToastStartedAt || Date.now());
    window._versionToastRemaining = Math.max(0, (window._versionToastRemaining || 0) - elapsed);
  };
  el.onmouseleave = () => {
    if (!el.classList.contains('show')) return;
    if (!Number.isFinite(window._versionToastRemaining) || window._versionToastRemaining <= 0) {
      dismissVersionToast();
      return;
    }
    window._versionToastStartedAt = Date.now();
    clearTimeout(window._versionToastTimer);
    window._versionToastTimer = setTimeout(() => dismissVersionToast(), window._versionToastRemaining);
  };
}

function dismissVersionToast() {
  const el = document.getElementById('toastVersion');
  if (el) {
    el.classList.remove('show');
    el.style.removeProperty('--vt-accent');
    el.onmouseenter = null;
    el.onmouseleave = null;
  }
  clearTimeout(window._versionToastTimer);
  window._versionToastTimer = null;
  window._versionToastRemaining = 0;
  window._versionToastStartedAt = 0;
}

function versionToastClick() {
  dismissVersionToast();
  toggleChangelog();
}


function toggleChangelog() {
  const drawer  = document.getElementById('changelogDrawer');
  const overlay = document.getElementById('changelogOverlay');
  const open    = drawer.classList.contains('open');
  drawer.classList.toggle('open', !open);
  overlay.classList.toggle('open', !open);
  document.body.style.overflow = !open ? 'hidden' : '';
  if (!open && !state._changelogLoaded) loadChangelog();
}

async function loadChangelog() {
  const el = document.getElementById('changelogContent');
  try {
    const res  = await fetch('./CHANGELOG.md', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    el.innerHTML = parseChangelog(text);
    state._changelogLoaded = true;
  } catch(e) {
    el.innerHTML = '<div class="changelog-loading" style="color:var(--red)">Could not load CHANGELOG.md</div>';
  }
}

function parseChangelog(md) {
  const lines = md.split('\n');
  let html = '';
  let currentSection = '';
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('> Maintainer note:')) {
      continue;
    }
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      const m = heading.match(/^\[([^\]]+)\]\s*-\s*(.+)$/);
      if (m) {
        html += `<h2><span class="cl-ver">[${escapeHtml(m[1])}]</span><span class="cl-sep"> - </span><span class="cl-date">${escapeHtml(m[2])}</span></h2>`;
      } else {
        html += '<h2>' + escapeHtml(heading) + '</h2>';
      }
    } else if (line.startsWith('### ')) {
      const label = line.slice(4).trim();
      const cls = label.split(':')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      currentSection = cls;
      html += '<h3 class="cl-' + cls + '">' + escapeHtml(label) + '</h3>';
    } else if (line.startsWith('- ')) {
      const bullet = line.slice(2).trim();
      const parsed = parseHighlightBullet(bullet, currentSection || 'changed');
      const liClass = currentSection ? ` class="cl-${currentSection}"` : '';
      if (parsed?.key && parsed?.detail) {
        html += `<ul><li${liClass}><span class="cl-key">${escapeHtml(parsed.key)}</span><span class="cl-msg">: ${escapeHtml(parsed.detail)}</span></li></ul>`;
      } else {
        html += `<ul><li${liClass}>${escapeHtml(bullet)}</li></ul>`;
      }
    } else if (line.startsWith('---')) {
      html += '<hr>';
    } else if (line.startsWith('# ')) {
      // skip top-level title
    } else if (line.trim()) {
      html += '<p>' + escapeHtml(line) + '</p>';
    }
  }
  html = html.replace(/<\/ul><ul>/g, '');
  return html;
}

atlasLoad();    // restore saved atlas config before any rendering
updateDailySnapshotCopy();
(async () => {
  await Promise.allSettled([
    initializeBackendTokenSource({ BACKEND_TOKEN_SET_URL, configureRegexEngine, state }),
    fetchScarabMetadata(),
    fetchCurrentLeague()
  ]);
  fetchMarketScarabPrices();
  fetchPriceHistory();
  fetchAndRenderEVChart();
  fetchAndRenderAtlasTrendPreview();
})();
fetchObservedWeights(); // pull weight distribution from community aggregate
updateSortArrows();
initSlider();
checkVersionToast();

initHashRouting(switchTab);

function copyRegex(type) {
  let bodyId, btnId;
  if (type === 'chaos') {
    bodyId = 'c-regexBody';
    btnId = 'c-copyBtn';
  } else {
    bodyId = 'n-regexBody';
    btnId = 'n-copyBtn';
  }
  
  const body = document.getElementById(bodyId);
  if (body.querySelector('.regex-empty-msg')) return;
  
  navigator.clipboard.writeText(body.textContent).then(() => {
    const btn = document.getElementById(btnId);
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(()=>{ btn.textContent='Copy'; btn.classList.remove('copied'); }, 1500);
    showToast('Copied to clipboard', 2000);
  });
}


// Expose selected helpers on window for debug tooling and static markup hooks.
exposeGlobals({
  mobileScarabName,
  computeWeightBasedRate,
  fetchObservedWeights,
  fetchPriceHistory,
  getPriceTrend,
  buildSparkline,
  showSparkTooltip,
  hideSparkTooltip,
  toggleTheme,
  switchTab,
  toggleHamburger,
  toggleLoggerHowTo,
  initFaq,
  toggleFaqItem,
  calcEV,
  buildRegex,
  syncLoggerRegex,
  updateRegexUI,
  parseWorkerResponse,
  buildNinjaLookup,
  getNinjaPrice,
  getNinjaImage,
  fetchCurrentLeague,
  fetchMarketScarabPrices,
  getNinjaEntries,
  resetNinjaSort,
  setNinjaSort,
  updateSortArrows,
  recalculateVendorTargets,
  renderVendorTable,
  buildVendorTableRow,
  setNinjaView,
  initSlider,
  positionMarker,
  onSliderChange,
  resetSlider,
  calcAutoEV,
  toggleEVMode,
  setEVMode,
  updateSliderROI,
  syncSliderToEV,
  toggleEstimator,
  getDivineRate,
  fmtEst,
  importWealthyCSV,
  parseWealthyCSV,
  toggleCSVBreakdown,
  renderCSVBreakdown,
  clearCSV,
  calcEstimator,
  renderEstimator,
  toggleEVChart,
  setEVChartRange,
  toggleAtlasTrendPreview,
  setAtlasTrendRange,
  fetchAndRenderEVChart,
  renderEVChart,
  parseSnapCSV,
  handleSnap,
  buildReverseTokenMap,
  parseRegexToScarabs,
  setLoggerRegexMode,
  tryPreview,
  submitSession,
  renderSessionHistory,
  setLoggerHistoryPage,
  setLoggerHistoryPageSize,
  deleteSession,
  toggleSessionDetail,
  renderSessionDetail,
  renderAnalysis,
  renderAnalysisFromLocalSessions,
  renderAnalysisFromAggregate,
  getAnalysisSortLabel,
  updateAnalysisChartAxisLabel,
  showAnalysisBarTooltip,
  hideAnalysisBarTooltip,
  sortAnalysisWeight,
  setAnalysisWeightFilter,
  renderAnalysisWeightTable,
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
  isFlashSkippedToday,
  setFlashSkippedToday,
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
  analyzeBulkFromCsv,
  atlasSave,
  atlasLoad,
  atlasCheckRevisitWarning,
  showAtlasWarningToast,
  dismissAtlasToast,
  atlasGetWeights,
  atlasComputeEV,
  atlasGroupStats,
  atlasUpdateHero,
  atlasGroupCardHTML,
  renderAtlas,
  atlasToggleBlock,
  atlasToggleBoost,
  atlasToggleExpand,
  atlasResetBlocks,
  atlasResetBoosts,
  atlasToggleLeftovers,
  showToast,
  checkVersionToast,
  showVersionToast,
  dismissVersionToast,
  versionToastClick,
  toggleChangelog,
  loadChangelog,
  parseChangelog,
  copyRegex
});

Object.defineProperty(window, '_bulkImageFile', {
  configurable: true,
  get() { return state._bulkImageFile; },
  set(v) { state._bulkImageFile = v; }
});

