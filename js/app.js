// Frontend UI shell for ScarabEV.
// Owns page startup, DOM rendering, event wiring, and user interactions.
// Coordinates shared state and extracted engines across all tabs.
// Keeps orchestration logic in one place for browser runtime flow.
// Does not define backend API or Cloudflare worker behavior.

import { state } from './state.js';
import { configureScarabEngine, calcEV, calcAutoEV, computeWeightBasedRate, getNinjaEntries } from './scarabEngine.js';
import { configureRegexEngine, buildRegex, parseRegexToScarabs } from './regexEngine.js';
import { parseWorkerResponse, buildNinjaLookup, getNinjaPrice, getNinjaImage } from './market.js';
import { initializeBackendTokenSource } from './tokenSource.js';
import { initHashRouting } from './hashRouting.js';
import { exposeGlobals } from './globalExpose.js';
import { maybeShowLeagueSessionCta } from './currentLeagueCta.js';
import { configureLogger, initializeLogger, parseSnapCSV, handleSnap, buildReverseTokenMap, parseRegexToScarabs as parseLoggerRegexToScarabs, setLoggerRegexMode, tryPreview, submitSession, renderSessionHistory, setLoggerHistoryPage, setLoggerHistoryPageSize, deleteSession, toggleSessionDetail, renderSessionDetail } from './logger.js';
import { configureAtlas, toggleAtlasTrendPreview, setAtlasTrendRange, fetchAndRenderAtlasTrendPreview, renderAtlasTrendPreview, atlasSave, atlasLoad, atlasCheckRevisitWarning, showAtlasWarningToast, dismissAtlasToast, atlasGetWeights, atlasComputeEV, atlasGroupStats, atlasUpdateHero, atlasGroupCardHTML, renderAtlas, atlasToggleBlock, atlasToggleBoost, atlasToggleExpand, atlasResetBlocks, atlasResetBoosts, atlasToggleLeftovers } from './atlas.js';
import { configureBulk, initializeBulk, normalizeBulkNameMap, recomputeBulkNameMap, loadBulkDefaultNameMap, logBulkMismatch, loadBulkNameMap, saveBulkNameMapFromInput, exportBulkNameMapToInput, clearBulkMismatchLog, refreshBulkDebug, isBulkDevMode, toggleBulkDebug, toggleBulkDev, renderBulkScarabList, toggleBulkScarabList, getBulkGeminiKey, onBulkGeminiKeyChange, initBulkGeminiKey, getTodayDateKey, isRateLimitError, clearBulkImage, handleBulkImage, buildBulkScarabIndex, levenshteinDistance, tokenizeBulkName, matchBulkName, parseBulkCsv, formatBulkChaosValue, analyzeBulkFromImage, analyzeBulkFromCsv } from './bulk.js';
import { configureAnalysis, renderAnalysis, renderAnalysisFromLocalSessions, renderAnalysisFromAggregate, getAnalysisSortLabel, updateAnalysisChartAxisLabel, showAnalysisBarTooltip, hideAnalysisBarTooltip, setAnalysisWeightFilter, sortAnalysisWeight, renderAnalysisWeightTable } from './analysis.js';
import { configureVendor, buildSparkline, showSparkTooltip, hideSparkTooltip, syncLoggerRegex, updateRegexUI, resetNinjaSort, setNinjaSort, updateSortArrows, recalculateVendorTargets, renderVendorTable, buildVendorTableRow, setNinjaView, initSlider, positionMarker, onSliderChange, resetSlider, toggleEVMode, setEVMode, updateSliderROI, syncSliderToEV, toggleEstimator, getDivineRate, fmtWithRate, fmtEst, importWealthyCSV, parseWealthyCSV, toggleCSVBreakdown, renderCSVBreakdown, clearCSV, calcEstimator, renderEstimator, toggleEVChart, setEVChartRange, fetchAndRenderEVChart, renderEVChart, copyRegex } from './vendor.js';
import {
  POOL_API_URL,
  FAQ_SECTIONS,
  CHAR_LIMIT,
  WORKER_URL,
  ATLAS_BLOCKABLE,
  ATLAS_BOOSTABLE,
  ATLAS_SAVE_KEY,
  BACKEND_TOKEN_SET_URL,
  BACKEND_SCARAB_METADATA_URL,
  BACKEND_ADMIN_UI_URL,
  FRONTEND_ENVIRONMENT
} from './config.js';
const SCARAB_LIST = state.scarabList;

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
const SPARKLINE_TREND_WINDOW_DAYS = 7;
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
let _AMBIGUOUS_LAST = new Set();

function refreshAmbiguousLast() {
  const counts = {};
  for (const s of SCARAB_LIST) {
    const last = s.name.split(' ').pop().toLowerCase();
    counts[last] = (counts[last] || 0) + 1;
  }
  _AMBIGUOUS_LAST = new Set(Object.keys(counts).filter(k => counts[k] > 1));
}

function inferScarabGroup(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Misc';
  if (/^scarab of\b/i.test(raw)) return 'Misc';
  const match = raw.match(/^(.+?)\s+Scarab\b/i);
  if (!match || !match[1]) return 'Misc';
  return match[1].trim();
}

function getBackendScarabGroup(name) {
  const key = normalizeScarabNameKey(name);
  const meta = state._scarabMetaByName && state._scarabMetaByName[key];
  const groupName = String(meta?.groupName || '').trim();
  return groupName || null;
}

function rebuildRuntimeScarabList(tokenNames) {
  const tokenList = Array.isArray(tokenNames) ? tokenNames : [];
  if (!tokenList.length) {
    throw new Error('backend_token_source_empty');
  }
  const names = tokenList;
  const next = names
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const backendGroup = getBackendScarabGroup(name);
      return {
        name,
        group: backendGroup || inferScarabGroup(name)
      };
    });
  SCARAB_LIST.splice(0, SCARAB_LIST.length, ...next);
  refreshAmbiguousLast();
  configureScarabEngine({
    SCARAB_LIST,
    buildNinjaLookup,
    getNinjaPrice
  });
}
refreshAmbiguousLast();

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
    state._scarabMetaItems = items;
    const map = {};
    for (const item of items) {
      const name = String(item?.name || '').trim();
      if (!name) continue;
      map[normalizeScarabNameKey(name)] = {
        groupName: item?.groupName || null,
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
  const targetKind = String(src.targetKind || '').toLowerCase();
  const supportsWeighted = !!src.supportsWeighted;
  if (targetKind === 'standard' && supportsWeighted) return 100;
  if (mode === 'challenge-current-only') return 100;
  if (mode === 'challenge-prior-fallback') return 0;

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

function maybeShowCurrentLeagueCtaFromShare(currentLeagueSharePct, progress = {}) {
  const league = String(document.getElementById('leagueSelect')?.value || '').trim();
  if (!league) return;
  maybeShowLeagueSessionCta(currentLeagueSharePct, {
    league,
    dayKey: getTodayDateKey(),
    tradesObserved: progress.tradesObserved,
    scarabsVendored: progress.scarabsVendored,
    switchTab,
    ensureLoggerHowToExpanded
  });
}

function getCurrentLeagueSharePctFromState() {
  return readCurrentLeagueSharePct(state._weightMeta);
}

function getRecommendedEVModeForShare(currentLeagueSharePct) {
  return Number.isFinite(currentLeagueSharePct) && currentLeagueSharePct >= 100 ? 'weighted' : 'harmonic';
}

function updateEVModeRecommendationWarning(mode, currentLeagueSharePct = getCurrentLeagueSharePctFromState()) {
  const hint = document.getElementById('weightedEvWarning');
  if (!hint) return;
  const recommendedMode = getRecommendedEVModeForShare(currentLeagueSharePct);
  if (mode === recommendedMode) {
    hint.style.display = 'none';
    return;
  }
  if (recommendedMode === 'harmonic') {
    hint.innerHTML = 'Warning: Current-league weighting data is still maturing and may not yet be fully representative. While coverage is still building, Harmonic EV is the recommended model.';
  } else {
    hint.innerHTML = 'Warning: Current-league weighting data is now fully established and reliable. At this stage, Weighted EV is the recommended model.';
  }
  hint.style.display = '';
}

function applyRecommendedEVMode(currentLeagueSharePct = getCurrentLeagueSharePctFromState()) {
  const recommendedMode = getRecommendedEVModeForShare(currentLeagueSharePct);
  if (state._evMode !== recommendedMode) {
    setEVMode(recommendedMode);
    return;
  }
  updateEVModeRecommendationWarning(state._evMode, currentLeagueSharePct);
}

async function fetchObservedWeights() {
  if (!POOL_API_URL) return;
  const league = document.getElementById('leagueSelect')?.value || '';
  try {
    const url = POOL_API_URL + '/api/aggregate?league=' + encodeURIComponent(league);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const weights = data.weights && typeof data.weights === 'object' ? data.weights : null;
    const hasWeights = !!(weights && Object.keys(weights).length > 0);
    const previousWeights = state._observedWeights && Object.keys(state._observedWeights).length > 0
      ? state._observedWeights
      : null;
    state._observedWeights = hasWeights ? weights : previousWeights;
    state._weightSessionCount = data.weightSessionCount || data.sessionCount || 0;
    state._weightTradeCount = data.weightTradeCount || data.totalTrades || data?.weightMeta?.totalTrades || 0;
    state._weightMeta = data.weightMeta || null;
    state._weightUnavailableReason = hasWeights ? null : (data?.weightMeta?.reason || 'Not enough community data for weighted mode yet.');
    let currentLeagueSharePct = readCurrentLeagueSharePct(data.weightMeta);
    if (currentLeagueSharePct == null) currentLeagueSharePct = readCurrentLeagueSharePct(data);
    if (currentLeagueSharePct == null) currentLeagueSharePct = readCurrentLeagueSharePct(state._weightMeta);
    maybeShowCurrentLeagueCtaFromShare(currentLeagueSharePct, {
      tradesObserved: state._weightTradeCount,
      scarabsVendored: data.totalConsumed
    });

    if (!hasWeights) {
      if (previousWeights) {
        // Keep last known good weights to avoid transient weighted-mode/chart flicker.
        state._weightUnavailableReason = data?.weightMeta?.reason || state._weightUnavailableReason || 'Using last known weight snapshot.';
        applyRecommendedEVMode(currentLeagueSharePct);
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
      } else {
        updateEVModeRecommendationWarning(state._evMode, currentLeagueSharePct);
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
    applyRecommendedEVMode(currentLeagueSharePct);
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
    const league = getSelectedLeagueKey();
    const res = await fetch(`${WORKER_URL}?league=${encodeURIComponent(league)}&type=PriceHistory`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.prices && Object.keys(data.prices).length > 0) {
      const incoming = data.prices;
      const current = getPriceHistoryForLeague(league);
      const merged = mergePriceHistoryByDepth(current, incoming);
      setPriceHistoryForLeague(league, merged);
      if (state.ninjaLoaded) renderVendorTable();
      if (Array.isArray(state._evHistoryRaw)) renderEVChart(state._evHistoryRaw);
      if (Array.isArray(state._atlasTrendHistoryRaw)) renderAtlasTrendPreview(state._atlasTrendHistoryRaw);
    }
  } catch(e) { /* silent */ }
}

function getSelectedLeagueKey() {
  const selected = String(document.getElementById('leagueSelect')?.value || '').trim();
  return selected || 'Mirage';
}

function ensurePriceHistoryByLeagueCache() {
  if (!state._priceHistoryByLeague || typeof state._priceHistoryByLeague !== 'object') {
    // Keep sparkline history in per-league buckets to prevent stale cross-league bleed-through.
    state._priceHistoryByLeague = {};
  }
  return state._priceHistoryByLeague;
}

function sanitizePriceHistoryMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [name, seriesRaw] of Object.entries(raw)) {
    out[name] = Array.isArray(seriesRaw) ? seriesRaw : [];
  }
  return out;
}

function getPriceHistoryForLeague(leagueKey) {
  const cache = ensurePriceHistoryByLeagueCache();
  const key = String(leagueKey || '').trim() || 'Mirage';
  const bucket = sanitizePriceHistoryMap(cache[key]);
  cache[key] = bucket;
  return bucket;
}

function setPriceHistoryForLeague(leagueKey, historyMap) {
  const cache = ensurePriceHistoryByLeagueCache();
  const key = String(leagueKey || '').trim() || 'Mirage';
  const next = sanitizePriceHistoryMap(historyMap);
  cache[key] = next;
  if (getSelectedLeagueKey() === key) state._priceHistory = next;
  return next;
}

function mergePriceHistoryByDepth(currentMap, incomingMap) {
  const current = sanitizePriceHistoryMap(currentMap);
  const incoming = sanitizePriceHistoryMap(incomingMap);
  const merged = { ...current };
  for (const [name, nextSeriesRaw] of Object.entries(incoming)) {
    const nextSeries = Array.isArray(nextSeriesRaw) ? nextSeriesRaw : [];
    const prevSeries = Array.isArray(current[name]) ? current[name] : [];
    // Same-league guard: keep whichever source has deeper history.
    merged[name] = nextSeries.length >= prevSeries.length ? nextSeries : prevSeries;
  }
  return merged;
}

function ensureEVHistoryByLeagueCache() {
  if (!state._evHistoryByLeague || typeof state._evHistoryByLeague !== 'object') {
    state._evHistoryByLeague = {};
  }
  return state._evHistoryByLeague;
}

function getEVHistoryForLeague(leagueKey) {
  const cache = ensureEVHistoryByLeagueCache();
  const key = String(leagueKey || '').trim() || 'Mirage';
  return Array.isArray(cache[key]) ? cache[key] : null;
}

function setEVHistoryForLeague(leagueKey, history) {
  const cache = ensureEVHistoryByLeagueCache();
  const key = String(leagueKey || '').trim() || 'Mirage';
  const next = Array.isArray(history) ? history : [];
  cache[key] = next;
  if (getSelectedLeagueKey() === key) state._evHistoryRaw = next;
  return next;
}

function setEVChartStatusMessage(message) {
  const meta = document.getElementById('evChartMeta');
  if (meta) meta.innerHTML = `<span style="color:var(--text-3)">${String(message || '').trim()}</span>`;
}

function clearEVChartForSelectedLeague(message) {
  if (state._evChartInstance) {
    state._evChartInstance.destroy();
    state._evChartInstance = null;
  }
  const canvas = document.getElementById('evHistoryChart');
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  setEVChartStatusMessage(message);
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
  const leagueHistory = getPriceHistoryForLeague(getSelectedLeagueKey());
  const hist = leagueHistory[scarabName];
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

  return [...workingHist]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-SPARKLINE_TREND_WINDOW_DAYS);
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

function ensureLoggerHowToExpanded() {
  const body = document.getElementById('loggerHowToBody');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  if (!isOpen) toggleLoggerHowTo();
}


function initFaq() {
  const list = document.getElementById('faq-list');
  if (!list) return;
  list.innerHTML = ''; // always rebuild fresh

  let activeGroupBody = null;
  let groupIndex = 0;
  let defaultExpandedQuestions = 0;

  FAQ_SECTIONS.forEach((section, i) => {
    if (section.groupTitle) {
      const groupId = `faq-group-${i}`;
      const groupBodyId = `faq-group-body-${i}`;
      const groupChevronId = `faq-group-chevron-${i}`;
      const openByDefault = groupIndex < 2;
      groupIndex += 1;
      const group = document.createElement('div');
      group.innerHTML = `
        <div onclick="toggleFaqGroup('${groupBodyId}','${groupChevronId}','${groupId}')" class="faq-question faq-group-header${openByDefault ? ' open' : ''}" style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:10px 14px;border:1px solid var(--border);border-radius:7px;transition:background 0.15s" id="${groupId}">
          <span class="faq-chevron" style="font-size:24px;font-weight:700;transition:transform 0.15s;line-height:1;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;overflow:visible;transform-origin:center center;${openByDefault ? 'transform:rotate(90deg);' : ''}" id="${groupChevronId}">&#9656;</span>
          <span class="faq-question-title">${section.groupTitle}</span>
        </div>
        <div id="${groupBodyId}" class="faq-group-body" style="display:${openByDefault ? '' : 'none'}"></div>
      `;
      list.appendChild(group);
      activeGroupBody = document.getElementById(groupBodyId);
      return;
    }

    const id = `faq-item-${i}`;
    const bodyId = `faq-body-${i}`;
    const chevronId = `faq-chevron-${i}`;
    const openQuestionByDefault = groupIndex === 1 && defaultExpandedQuestions < 2;
    if (openQuestionByDefault) defaultExpandedQuestions += 1;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div onclick="toggleFaqItem('${bodyId}','${chevronId}','${id}')" class="faq-question faq-subquestion${openQuestionByDefault ? ' open' : ''}" style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:9px 14px;border:1px solid var(--border);border-radius:7px;transition:background 0.15s" id="${id}">
      <span class="faq-chevron" style="font-size:24px;font-weight:700;transition:transform 0.15s;line-height:1;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;overflow:visible;transform-origin:center center;${openQuestionByDefault ? 'transform:rotate(90deg);' : ''}" id="${chevronId}">&#9656;</span>
        <span class="faq-question-title">${section.title}</span>
      </div>
      <div id="${bodyId}" class="faq-body" style="display:${openQuestionByDefault ? '' : 'none'};margin-top:2px;background:var(--bg-card);border:1px solid var(--border);border-top:none;border-radius:0 0 7px 7px;padding:14px 18px;font-size:12px;line-height:1.8">
        ${section.body}
      </div>
    `;
    if (activeGroupBody) {
      activeGroupBody.appendChild(wrapper);
    } else {
      list.appendChild(wrapper);
    }
  });
}

function toggleFaqGroup(bodyId, chevronId, groupId) {
  const body = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  const group = groupId ? document.getElementById(groupId) : null;
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
  if (group) group.classList.toggle('open', !open);
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
  state._priceHistory = getPriceHistoryForLeague(league);
  const cachedEvHistory = getEVHistoryForLeague(league);
  if (Array.isArray(cachedEvHistory) && cachedEvHistory.length > 0) {
    state._evHistoryRaw = cachedEvHistory;
    renderEVChart(cachedEvHistory);
  } else {
    state._evHistoryRaw = null;
    clearEVChartForSelectedLeague(`Loading ${league} threshold history...`);
  }
  fetchAndRenderEVChart();
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
      // Re-apply recommended EV mode after prices arrive so initial-load races
      // do not leave the UI stuck on harmonic when weighted is now ready.
      applyRecommendedEVMode();

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
              const currentPriceHistory = getPriceHistoryForLeague(league);
              const mergedPriceHistory = mergePriceHistoryByDepth(currentPriceHistory, parsed.priceHistory);
              setPriceHistoryForLeague(league, mergedPriceHistory);
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
        const currentPriceHistory = getPriceHistoryForLeague(league);
        const mergedPriceHistory = mergePriceHistoryByDepth(currentPriceHistory, storedSnapshot.priceHistory);
        setPriceHistoryForLeague(league, mergedPriceHistory);
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

configureVendor({
  getFinalSparklineSeries,
  getSeriesTrendPercent,
  getPriceTrend,
  getCurrentLeagueSharePctFromState,
  getRecommendedEVModeForShare,
  updateEVModeRecommendationWarning,
  computeLoopVendorRate,
  applyScarabModifierTooltips,
  getSelectedLeagueKey,
  setEVHistoryForLeague,
  clearEVChartForSelectedLeague,
  getDailySnapshotLocalTimeLabel,
  toLocalDateKey,
  showToast,
  EV_CHART_RANGE_TO_DAYS,
  EV_CHART_RANGE_STORAGE_KEY
});
configureLogger({
  syncLoggerRegex,
  getDivineRate,
  mobileScarabName,
  fmtWithRate
});
initializeLogger();
// BULK BUY ANALYZER (CSV from Gemini)


 // ATLAS OPTIMIZER





configureBulk({ mobileScarabName, getDivineRate, toLocalDateKey, showToast, getRecommendedEVModeForShare, getCurrentLeagueSharePctFromState, computeLoopVendorRate });
initializeBulk();

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

function applyEnvironmentBadge() {
  if (String(FRONTEND_ENVIRONMENT || '').toLowerCase() !== 'staging') return;
  const badge = document.createElement('div');
  badge.id = 'env-staging-badge';
  badge.textContent = 'STAGING';
  badge.style.position = 'fixed';
  badge.style.right = '12px';
  badge.style.bottom = '12px';
  badge.style.zIndex = '99999';
  badge.style.padding = '6px 10px';
  badge.style.borderRadius = '999px';
  badge.style.border = '1px solid rgba(255, 204, 0, 0.65)';
  badge.style.background = 'rgba(20, 26, 38, 0.88)';
  badge.style.color = '#ffcc00';
  badge.style.font = '700 12px/1.1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  badge.style.letterSpacing = '0.08em';
  document.body.appendChild(badge);
}

configureAnalysis({ mobileScarabName, applyScarabModifierTooltips, bindStatInfoTooltipEvents, readCurrentLeagueSharePct, maybeShowCurrentLeagueCtaFromShare });
configureAtlas({
  getPriceTrend,
  mobileScarabName,
  applyScarabModifierTooltips,
  switchTab,
  toLocalDateKey,
  EV_CHART_RANGE_TO_DAYS,
  ATLAS_TREND_RANGE_STORAGE_KEY,
  ATLAS_MAX_OPTIMIZE_STEPS
});
atlasLoad();    // restore saved atlas config before any rendering
applyEnvironmentBadge();
updateDailySnapshotCopy();
(async () => {
  try {
    const [tokenInit] = await Promise.all([
      initializeBackendTokenSource({ BACKEND_TOKEN_SET_URL, configureRegexEngine, state }),
      fetchScarabMetadata(),
      fetchCurrentLeague()
    ]);
    const tokensByName = tokenInit?.tokensByName;
    const tokenNames = tokensByName && typeof tokensByName === 'object' ? Object.keys(tokensByName) : [];
    rebuildRuntimeScarabList(tokenNames);
    fetchMarketScarabPrices();
    fetchPriceHistory();
    fetchAndRenderEVChart();
    fetchAndRenderAtlasTrendPreview();
  } catch (e) {
    const msg = (e && e.message) ? String(e.message) : String(e);
    const st = document.getElementById('ninjaStatus');
    if (st) st.textContent = `Startup error: ${msg}`;
    throw e;
  }
})();
updateSortArrows();
initSlider();
checkVersionToast();

initHashRouting(switchTab);

// Expose selected helpers on window for debug tooling and static markup hooks.
const UI_GLOBALS = {
  mobileScarabName,
  toggleTheme,
  switchTab,
  toggleHamburger,
  toggleLoggerHowTo,
  ensureLoggerHowToExpanded,
  initFaq,
  toggleFaqGroup,
  toggleFaqItem,
  showToast,
  checkVersionToast,
  showVersionToast,
  dismissVersionToast,
  versionToastClick,
  toggleChangelog,
  loadChangelog,
  parseChangelog
};

const CORE_CALC_GLOBALS = {
  computeWeightBasedRate,
  fetchObservedWeights,
  fetchPriceHistory,
  getPriceTrend,
  buildSparkline,
  showSparkTooltip,
  hideSparkTooltip,
  calcEV,
  buildRegex,
  syncLoggerRegex,
  updateRegexUI
};

const MARKET_VENDOR_GLOBALS = {
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
  setNinjaView
};

const EV_ESTIMATOR_GLOBALS = {
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
  fetchAndRenderEVChart,
  renderEVChart,
  copyRegex
};

const LOGGER_ANALYSIS_GLOBALS = {
  parseSnapCSV,
  handleSnap,
  buildReverseTokenMap,
  parseRegexToScarabs: parseLoggerRegexToScarabs,
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
  renderAnalysisWeightTable
};

const BULK_GLOBALS = {
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

const ATLAS_GLOBALS = {
  toggleAtlasTrendPreview,
  setAtlasTrendRange,
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
  atlasToggleLeftovers
};

exposeGlobals({
  ...UI_GLOBALS,
  ...CORE_CALC_GLOBALS,
  ...MARKET_VENDOR_GLOBALS,
  ...EV_ESTIMATOR_GLOBALS,
  ...LOGGER_ANALYSIS_GLOBALS,
  ...BULK_GLOBALS,
  ...ATLAS_GLOBALS
});

Object.defineProperty(window, '_bulkImageFile', {
  configurable: true,
  get() { return state._bulkImageFile; },
  set(v) { state._bulkImageFile = v; }
});
