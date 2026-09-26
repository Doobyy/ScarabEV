// Atlas Optimizer UI, persistence, EV calculations, and trend preview.
// Shared shell callbacks are supplied by app.js to retain startup orchestration.

import { state } from './state.js';
import { WORKER_URL, ATLAS_BLOCKABLE, ATLAS_BOOSTABLE, ATLAS_SAVE_KEY } from './config.js';
import { buildNinjaLookup, getNinjaPrice } from './market.js';

const SCARAB_LIST = state.scarabList;
let getPriceTrend;
let mobileScarabName;
let applyScarabModifierTooltips;
let switchTab;
let toLocalDateKey;
let EV_CHART_RANGE_TO_DAYS;
let ATLAS_TREND_RANGE_STORAGE_KEY;
let ATLAS_MAX_OPTIMIZE_STEPS;

export function configureAtlas(deps) {
  ({
    getPriceTrend,
    mobileScarabName,
    applyScarabModifierTooltips,
    switchTab,
    toLocalDateKey,
    EV_CHART_RANGE_TO_DAYS,
    ATLAS_TREND_RANGE_STORAGE_KEY,
    ATLAS_MAX_OPTIMIZE_STEPS
  } = deps);
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
  const pointHitRadius = series.length <= 24 ? 14 : (series.length <= 72 ? 10 : (series.length <= 160 ? 7 : 5));

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
          pointHitRadius,
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
          pointHitRadius,
          pointBackgroundColor: optColor,
          borderWidth: 1.5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'index',
        axis: 'x',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          bodyFont: {
            family: 'Consolas, Menlo, Monaco, "Courier New", monospace'
          },
          callbacks: {
            title: items => items[0].label,
            label: ctx => {
              const datasets = Array.isArray(ctx.chart?.data?.datasets) ? ctx.chart.data.datasets : [];
              const maxLabelLen = datasets.reduce((max, ds) => {
                const len = String(ds?.label || '').trim().length;
                return len > max ? len : max;
              }, 0);
              const label = String(ctx.dataset?.label || '').trim().padEnd(maxLabelLen, ' ');
              return ` ${label}  ${ctx.parsed.y.toFixed(4)}c`;
            }
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


export {
  colorWithAlpha,
  toggleAtlasTrendPreview,
  setAtlasTrendRange,
  fetchAndRenderAtlasTrendPreview,
  renderAtlasTrendPreview,
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
