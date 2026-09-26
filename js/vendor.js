// Scarab Vendor UI, EV tools, regex, estimator, sparklines, and EV history chart.
// Shared shell orchestration is supplied by app.js to preserve existing behavior.

import { state } from './state.js';
import { CHAR_LIMIT, WORKER_URL } from './config.js';
import { calcEV, calcAutoEV, computeWeightBasedRate, getNinjaEntries } from './scarabEngine.js';
import { buildRegex, parseRegexToScarabs } from './regexEngine.js';
import { buildNinjaLookup, getNinjaPrice, getNinjaImage } from './market.js';
import { setLoggerRegexMode } from './logger.js';
import { colorWithAlpha } from './atlas.js';

const SCARAB_LIST = state.scarabList;
let getFinalSparklineSeries;
let getSeriesTrendPercent;
let getPriceTrend;
let getCurrentLeagueSharePctFromState;
let getRecommendedEVModeForShare;
let updateEVModeRecommendationWarning;
let computeLoopVendorRate;
let applyScarabModifierTooltips;
let getSelectedLeagueKey;
let setEVHistoryForLeague;
let clearEVChartForSelectedLeague;
let getDailySnapshotLocalTimeLabel;
let toLocalDateKey;
let showToast;
let EV_CHART_RANGE_TO_DAYS;
let EV_CHART_RANGE_STORAGE_KEY;

export function configureVendor(deps) {
  ({
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
  } = deps);
}
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

function syncLoggerRegex() {
  if (state._loggerRegexUserEdited) return;
  const body = document.getElementById('n-regexBody');
  const field = document.getElementById('loggerRegex');
  if (!body || !field) return;
  const regex = body.querySelector('.regex-empty-msg') ? '' : body.textContent.trim();
  field.value = regex;
  setLoggerRegexMode(false);
  if (regex) {
    const { matched, unmatched, identifiedCount } = parseRegexToScarabs(regex);
    const count = Number.isFinite(identifiedCount) ? identifiedCount : matched.length;
    let hint = `${count} scarab types identified`;
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
  const groups = {};
  for (const s of items) {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  }
  const gnames = Object.keys(groups).sort((a,b) => {
    return String(a || '').localeCompare(String(b || ''));
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

  const imgSrc = getNinjaImage(s.name) || '';
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
  const recommendedMode = getRecommendedEVModeForShare(getCurrentLeagueSharePctFromState());
  const usingRecommendedMode = state._evMode === recommendedMode;
  if (!manual) {
    btn.style.borderColor = usingRecommendedMode ? 'var(--green)' : 'var(--amber)';
    btn.style.color = usingRecommendedMode ? 'var(--green)' : 'var(--amber)';
    btn.style.background = usingRecommendedMode ? 'rgba(36, 232, 158, 0.08)' : 'rgba(245, 185, 73, 0.14)';
  } else {
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.style.background = '';
  }
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

  // Only switch to weighted if data is ready
  if (mode === 'weighted' && state._calibratedMean === null) {
    const reason = state._weightUnavailableReason || 'waiting for weight data...';
    document.getElementById('thresholdModeLabel').textContent = reason;
    return setEVMode('harmonic');
  }
  updateEVModeRecommendationWarning(mode);
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
  const recommendedMode = getRecommendedEVModeForShare(getCurrentLeagueSharePctFromState());
  const usingRecommendedMode = state._evMode === recommendedMode;
  const primaryGoodColor = usingRecommendedMode ? 'var(--green)' : 'var(--amber)';
  const warningZoneColor = usingRecommendedMode ? 'var(--amber)' : '#d4a72c';
  const dangerColor = 'var(--red)';

  // Compute real average price of vendor targets from live ninja prices.
  const lower = buildNinjaLookup();
  const vendorPrices = SCARAB_LIST
    .map(s => getNinjaPrice(s.name, lower))
    .filter(p => p > 0 && p <= threshold);
  const avgInput = vendorPrices.length
    ? vendorPrices.reduce((s, p) => s + p, 0) / vendorPrices.length
    : 0;
  // ROI source is 2-state by recommendation maturity:
  // - recommended harmonic: harmonic mode uses harmonic ROI, weighted mode uses weighted ROI.
  // - recommended weighted: both modes evaluate ROI from weighted source.
  const useWeightedRoiSource = state._calibratedRate !== null
    && (weightedMode || recommendedMode === 'weighted');
  const returnPerInput = useWeightedRoiSource ? state._calibratedRate : autoEV;
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

async function fetchAndRenderEVChart() {
  const requestId = (Number(state._evChartFetchSeq) || 0) + 1;
  state._evChartFetchSeq = requestId;
  const league = getSelectedLeagueKey();
  if (!WORKER_URL) {
    clearEVChartForSelectedLeague(`EV history endpoint is not configured for ${league}.`);
    return;
  }
  try {
    const res = await fetch(`${WORKER_URL}?type=EVHistory&league=${encodeURIComponent(league)}`, { cache: 'no-store' });
    if (requestId !== state._evChartFetchSeq) return;
    if (!res.ok) {
      clearEVChartForSelectedLeague(`Could not load ${league} threshold history.`);
      return;
    }
    const data = await res.json();
    if (requestId !== state._evChartFetchSeq) return;
    const history = Array.isArray(data?.history) ? data.history : [];
    setEVHistoryForLeague(league, history);
    if (!history.length) {
      clearEVChartForSelectedLeague(`No threshold history snapshots yet for ${league}.`);
      return;
    }
    renderEVChart(history);
  } catch(e) {
    if (requestId !== state._evChartFetchSeq) return;
    clearEVChartForSelectedLeague(`Could not load ${league} threshold history.`);
  }
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
  const leagueKey = getSelectedLeagueKey();
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
  if (!state._evWeightedSeriesCacheByLeague || typeof state._evWeightedSeriesCacheByLeague !== 'object') {
    state._evWeightedSeriesCacheByLeague = {};
  }
  if (weightedSeries.length >= 2) {
    state._evWeightedSeriesCacheByLeague[leagueKey] = weightedSeries.map((h) => ({ date: String(h.date), ev: Number(h.ev) }));
  } else if (Array.isArray(state._evWeightedSeriesCacheByLeague[leagueKey]) && state._evWeightedSeriesCacheByLeague[leagueKey].length >= 2) {
      weightedSeries = state._evWeightedSeriesCacheByLeague[leagueKey]
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
  const pointHitRadius = dates.length <= 24 ? 14 : (dates.length <= 72 ? 10 : (dates.length <= 160 ? 7 : 5));

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
        pointHitRadius,
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
        pointHitRadius,
        pointBackgroundColor: weightedColor,
        borderWidth: 1.5,
      }]
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
              return ` ${label} threshold: ${ctx.parsed.y.toFixed(3)}c`;
            }
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



export {
  buildSparkline,
  showSparkTooltip,
  hideSparkTooltip,
  syncLoggerRegex,
  updateRegexUI,
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
  toggleEVMode,
  setEVMode,
  updateSliderROI,
  syncSliderToEV,
  toggleEstimator,
  getDivineRate,
  fmtWithRate,
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
