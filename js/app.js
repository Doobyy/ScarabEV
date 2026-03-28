// Frontend UI shell for ScarabEV.
// Owns page startup, DOM rendering, event wiring, and user interactions.
// Coordinates shared state and extracted engines across all tabs.
// Keeps orchestration logic in one place for browser runtime flow.
// Does not define backend API or Cloudflare worker behavior.

import { state } from './state.js';
import { configureScarabEngine, calcEV, calcAutoEV, computeWeightBasedRate, getNinjaEntries } from './scarabEngine.js';
import { configureRegexEngine, buildRegex, buildReverseTokenMap, parseRegexToScarabs } from './regexEngine.js';
import { parseWorkerResponse, parseOldNinjaResponse, buildNinjaLookup, getNinjaPrice, getNinjaImage, parseSnapCSV } from './market.js';
import { CDN, SCARAB_LIST, ALPHA_ORDER, INGAME_ORDER, POOL_API_URL, FAQ_SECTIONS, CHAR_LIMIT, POE_RE_TOKENS, WORKER_URL, ATLAS_BLOCKABLE, ATLAS_BOOSTABLE, ATLAS_SAVE_KEY } from './config.js';




// On mobile: show last meaningful word. If that word is ambiguous (shared by
// multiple scarabs), fall back to last two meaningful words.
const _SCARAB_STOP = new Set(['scarab','of','the','a','an']);
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
    state._observedWeights = hasWeights ? weights : null;
    state._weightSessionCount = data.weightSessionCount || data.sessionCount || 0;
    state._weightMeta = data.weightMeta || null;
    state._weightUnavailableReason = hasWeights ? null : (data?.weightMeta?.reason || 'Not enough community data for weighted mode yet.');

    if (!hasWeights) {
      state._calibratedMean = null;
      state._calibratedP20 = null;
      state._calibratedRate = null;
      if (state._evMode === 'weighted') {
        setEVMode('harmonic');
        const threshModeEl = document.getElementById('thresholdModeLabel');
        if (threshModeEl) threshModeEl.textContent = 'harmonic EV';
      }
      calcEstimator();
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
      // If user already switched to weighted mode before data arrived, apply it now
      if (state._evMode === 'weighted') {
        state.ninjaEvOverride = null;
        try { localStorage.removeItem('poepool28v2-ninja-evoverride'); } catch(e) {}
        recalculateVendorTargets();
        renderVendorTable();
      }
      // If atlas tab is open, render it now that weights are available
      if (state.currentTab === 'atlas') renderAtlas();
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
    }
  } catch(e) { /* silent */ }
}

function getFinalSparklineSeries(scarabName) {
  const hist = state._priceHistory[scarabName];
  let workingHist = hist ? [...hist] : [];

  // Inject current live ninja price as the final point used for rendering/trend.
  if (state.ninjaLoaded) {
    const lower = buildNinjaLookup();
    const livePrice = getNinjaPrice(scarabName, lower);
    if (livePrice > 0) {
      const today = new Date().toISOString().slice(0, 10);
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

// Theme
const savedTheme = localStorage.getItem('poepool-theme') || 'dark';
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme','dark');
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('poepool-theme', isDark ? 'light' : 'dark');
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

// Canonical token map sourced directly from poe.re scarab data (Scarabs.ts)
// Each token is the exact pre-validated regex string poe.re uses for that scarab

configureRegexEngine({ POE_RE_TOKENS });


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
  const league = document.getElementById('leagueSelect').value;
  fetchObservedWeights();
  const status = document.getElementById('ninjaStatus');
  const btn    = document.getElementById('refreshBtn');
  status.textContent = 'Loading prices from poe.ninja...'; status.className = 'ninja-status loading';
  btn.disabled = true;
  state.ninjaDivineRate = null; // reset stale rate \u2014 will be refreshed from worker below

  const ourNames = new Set(SCARAB_LIST.map(s => s.name.toLowerCase()));
  const log = [];
  const cb = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ninjaUrl = `https://poe.ninja/poe1/api/data/itemoverview?league=${encodeURIComponent(league)}&type=Scarab&_cb=${cb}`;

  function applyPrices(rawPrices, rawImages, label) {
    const matchCount = Object.keys(rawPrices).filter(n => ourNames.has(n.toLowerCase())).length;
    if (matchCount < 10) { log.push(`[${label}] only ${matchCount} matched`); return false; }
    const top3 = Object.entries(rawPrices).filter(([n]) => ourNames.has(n.toLowerCase())).sort((a,b)=>b[1]-a[1]).slice(0,3);
    log.push(`[${label}] OK \u2014 ${matchCount} matched. Top: ${top3.map(([n,p])=>`${n.split(' ').pop()}=${p.toFixed(1)}c`).join(', ')}`);
    state.ninjaPrices = rawPrices;
    state.ninjaImages = rawImages;
    state.ninjaLoaded = true;
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

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    status.textContent = `Prices loaded from poe.ninja \u00B7 ${timeStr}`;
    if (state.currentTab === 'atlas') renderAtlas();
    if (state.currentTab === 'analysis') renderAnalysis();
    status.className = 'ninja-status loaded';
    clearInterval(window._ninjaAgeTicker);
    window._ninjaPriceTime = now;
    window._ninjaAgeTicker = setInterval(() => {
      const mins = Math.floor((Date.now() - window._ninjaPriceTime) / 60000);
      const statusEl = document.getElementById('ninjaStatus');
      if (!statusEl) return;
      if (mins < 1) statusEl.textContent = `Prices loaded from poe.ninja \u00B7 just now`;
      else if (mins === 1) statusEl.textContent = `Prices loaded from poe.ninja \u00B7 1 min ago`;
      else statusEl.textContent = `Prices loaded from poe.ninja \u00B7 ${mins} mins ago`;
    }, 30000);
    renderVendorTable();
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
    return true;
  }

  // 1. Cloudflare Worker (new format)
  if (WORKER_URL) {
    try {
      status.textContent = 'Trying Cloudflare Worker...';
      const res = await fetch(`${WORKER_URL}?league=${encodeURIComponent(league)}&type=Scarab`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        try {
          const parsed = Array.isArray(data.items) && data.items.length > 0
            ? parseWorkerResponse(data)
            : parseOldNinjaResponse(JSON.stringify(data), false);
          const { rawPrices, rawImages } = parsed;
          if (parsed.priceHistory && Object.keys(parsed.priceHistory).length > 0) {
            state._priceHistory = parsed.priceHistory;
          }
          if (parsed.priceTotalChange && Object.keys(parsed.priceTotalChange).length > 0) {
            state._priceTotalChange = parsed.priceTotalChange;
          }
          if (applyPrices(rawPrices, rawImages, 'Worker')) { btn.disabled = false; return; }
        } catch(e) { log.push(`[Worker] parse error: ${e.message}`); }
      } else { log.push(`[Worker] HTTP ${res.status}`); }
    } catch(e) { log.push(`[Worker] ${e.message}`); }
  }

  // 2. Public proxy fallbacks
  const fallbacks = [
    { label: 'allorigins/raw', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(ninjaUrl)}` },
    { label: 'codetabs',       url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(ninjaUrl)}` },
  ];
  for (const attempt of fallbacks) {
    try {
      status.textContent = `Trying ${attempt.label}...`;
      const res = await fetch(attempt.url, { cache: 'no-store' });
      if (!res.ok) { log.push(`[${attempt.label}] HTTP ${res.status}`); continue; }
      const text = await res.text();
      try {
        const { rawPrices, rawImages } = parseOldNinjaResponse(text, attempt.unwrap);
        if (applyPrices(rawPrices, rawImages, attempt.label)) { btn.disabled = false; return; }
      } catch(e) { log.push(`[${attempt.label}] ${e.message}`); }
    } catch(e) { log.push(`[${attempt.label}] ${e.message}`); }
  }

  status.textContent = 'Failed to load prices from poe.ninja'; status.className = 'ninja-status error';
  const logHtml = log.map(l => `<div style="margin:3px 0;font-size:10px;color:var(--text-3);font-family:monospace;word-break:break-all">${l}</div>`).join('');
  document.getElementById('n-tableBody').innerHTML = `<div style="padding:20px 24px;line-height:1.9;font-size:12px"><strong style="color:var(--red)">&#9888; Could not load data.</strong><br><br><details open><summary style="cursor:pointer;font-weight:600;color:var(--text-2)">Attempt log</summary><div style="margin-top:6px">${logHtml}</div></details></div>`;
  btn.disabled = false;
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
  const countEl = document.getElementById('weightedSessionCount');
  if (hint) hint.style.display = mode === 'weighted' ? '' : 'none';
  if (countEl) countEl.textContent = state._weightSessionCount > 0 ? state._weightSessionCount.toLocaleString() : '\u2014';

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

function fmtEst(chaos, divRate) {
  if (!divRate) return Math.round(chaos) + 'c';
  const d = chaos / divRate;
  return d >= 1 ? d.toFixed(1) + 'd' : Math.round(chaos) + 'c';
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

async function fetchAndRenderEVChart() {
  const league = document.getElementById('leagueSelect')?.value || 'Mirage';
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}?type=EVHistory&league=${encodeURIComponent(league)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const history = data.history || [];
    if (!history.length) {
      const demo = [];
      const evValues = [0.44,0.43,0.42,0.44,0.45,0.43,0.41,0.40,0.42,0.41,0.39,0.38,0.40,0.41,0.42,0.43,0.41,0.40,0.39,0.41,0.42,0.40,0.39,0.38,0.40,0.41,0.39,0.38,0.37,0.39];
      const now = new Date();
      for (let i = evValues.length - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        demo.push({ date: d.toISOString().slice(0, 10), ev: evValues[evValues.length - 1 - i], demo: true });
      }
      renderEVChart(demo);
      return;
    }
    renderEVChart(history);
  } catch(e) { /* silent */ }
}

function renderEVChart(history) {
  // Sort by date
  history.sort((a, b) => a.date.localeCompare(b.date));

  // Inject live current EV as the final data point (always up to date)
  if (state.ninjaLoaded) {
    const lower = buildNinjaLookup();
    const entries = SCARAB_LIST.map(s => ({ chaosEa: getNinjaPrice(s.name, lower) })).filter(e => e.chaosEa > 0);
    const liveEV = calcEV(entries);
    if (liveEV) {
      const today = new Date().toISOString().slice(0, 10);
      // Remove any existing entry for today then push live value
      const filtered = history.filter(h => h.date !== today);
      filtered.push({ date: today, ev: parseFloat(liveEV.toFixed(4)), live: true });
      history = filtered;
      history.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const labels = history.map(h => {
    const d = new Date(h.date);
    return `${d.getMonth()+1}/${d.getDate()}`;
  });
  const values = history.map(h => h.ev);
  const latest = values[values.length - 1];
  const earliest = values[0];
  const trend = latest > earliest ? '&uarr;' : latest < earliest ? '&darr;' : '&rarr;';
  const trendColor = latest > earliest ? '#E24B4A' : latest < earliest ? '#1D9E75' : '#888';

  const isDemo = history.some(h => h.demo);
  document.getElementById('evChartMeta').innerHTML = isDemo
    ? `<span style="color:var(--amber)">demo data \u2014 real data starts tonight at 7PM UTC</span>`
    : `${history.length} days \u00B7 latest <strong style="color:var(--chaos)">${latest.toFixed(3)}c</strong> <span style="color:${trendColor}">${trend}</span>`;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#525c7a' : '#9aa4c4';

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
        data: values,
        borderColor: '#a03ec8',
        backgroundColor: 'rgba(160,62,200,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: history.length <= 14 ? 3 : 0,
        pointBackgroundColor: '#a03ec8',
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label,
            label: ctx => ` EV: ${ctx.parsed.y.toFixed(3)}c`
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: textColor, maxTicksLimit: 10, maxRotation: 0 },
          grid: { color: gridColor }
        },
        y: {
          ticks: { font: { size: 10 }, color: textColor, callback: v => v.toFixed(2) + 'c' },
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
    document.getElementById('snap1Text').textContent = 'Choose CSV file';
    document.getElementById('snap2Text').textContent = 'Choose CSV file';
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
  if (!sessions.length) {
    el.innerHTML = '<div class="logger-history-empty">No sessions logged yet.</div>';
    return;
  }
  const divRate = getDivineRate();
  const fmt = (c) => divRate && c / divRate >= 1 ? (c / divRate).toFixed(1) + 'd' : Math.round(c) + 'c';
  const cols = '1fr 72px 72px 72px 72px 72px 64px 56px minmax(80px, 1fr)';
  const gap = '12px';
  const gridStyle = `display:grid;grid-template-columns:${cols};gap:${gap};align-items:center;padding:6px 10px`;
  const profitFmt = (c) => (c >= 0 ? '+' : '') + fmt(c);

  el.innerHTML = `
    <div class="logger-history-grid" style="grid-template-columns:${cols};gap:${gap};font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center">
      <span class="cell-left">League</span><span class="cell-right">Scarabs</span><span class="cell-right">Trades</span><span class="cell-right">Input</span><span class="cell-right">Output</span><span class="cell-right">Profit</span><span class="cell-right">Cutoff</span><span class="cell-right">ROI</span><span class="cell-left"></span>
    </div>
    ${sessions.slice().reverse().map((s, i) => {
      const idx = sessions.length - 1 - i;
      const profit = (s.output_value || 0) - (s.input_value || 0);
      return `<div>
        <div onclick="toggleSessionDetail(${idx})" class="logger-history-grid" style="grid-template-columns:${cols};gap:${gap};font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='var(--row-hover)'" onmouseout="this.style.background=''">
          <span class="cell-left">${s.league}</span>
          <span class="cell-right">${s.total_consumed?.toLocaleString()}</span>
          <span class="cell-right">${s.total_trades?.toLocaleString()}</span>
          <span class="cell-right">${fmt(s.input_value)}</span>
          <span class="cell-right">${fmt(s.output_value)}</span>
          <span class="cell-right" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${profitFmt(profit)}</span>
          <span class="cell-right" style="color:var(--chaos)">${s.threshold?.toFixed(2)}c</span>
          <span class="cell-right" style="color:${s.roi_pct >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${s.roi_pct >= 0 ? '+' : ''}${s.roi_pct?.toFixed(1)}%</span>
          <span class="cell-left" style="display:flex;align-items:center;gap:6px;min-width:0" onclick="event.stopPropagation()">
            <button onclick="deleteSession('${s.id}')" title="Delete session" style="font-family:inherit;font-size:14px;padding:2px 4px;border:none;background:transparent;color:var(--text-3);cursor:pointer;opacity:0.4;transition:all 0.15s;line-height:1;flex-shrink:0" onmouseover="this.style.opacity='1';this.style.color='var(--red)'" onmouseout="this.style.opacity='0.4';this.style.color='var(--text-3)'">&#128465;</button>
          </span>
        </div>
        <div id="hist-detail-${idx}" style="display:none;padding:10px 14px 14px;border-bottom:1px solid var(--border);background:var(--bg)">
          ${renderSessionDetail(s, fmt)}
        </div>
      </div>`;
    }).join('')}
  `;
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

function renderSessionDetail(s, fmt) {
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
  const divRate = getDivineRate();
  const fmt = (c) => divRate && c !== null && c !== undefined && c / divRate >= 1 ? (c / divRate).toFixed(1) + 'd' : Math.round(c || 0) + 'c';

  if (POOL_API_URL) {
    emptyEl.style.display = 'block';
    contentEl.style.display = 'none';
    emptyEl.innerHTML = '<p>Loading community data...</p>';
    const league = document.getElementById('leagueSelect')?.value || '';
    fetch(POOL_API_URL + '/api/aggregate?league=' + encodeURIComponent(league))
      .then(res => res.ok ? res.json() : null)
      .then(agg => {
        if (agg && (agg.sessionCount > 0 || Object.keys(agg.receivedByScarab || {}).length > 0)) {
          renderAnalysisFromAggregate({
            totalConsumed: agg.totalConsumed || 0,
            totalTrades: agg.totalTrades || 0,
            totalInput: agg.totalInput || 0,
            totalOutput: agg.totalOutput || 0,
            receivedByScarab: agg.receivedByScarab || {},
            sessionCount: agg.sessionCount || 0,
            dataSourceLabel: 'Community data (' + (agg.sessionCount || 0).toLocaleString() + ' sessions)'
          }, fmt, emptyEl, contentEl);
          return;
        }
        renderAnalysisFromLocalSessions(fmt, emptyEl, contentEl);
      })
      .catch(() => renderAnalysisFromLocalSessions(fmt, emptyEl, contentEl));
  } else {
    renderAnalysisFromLocalSessions(fmt, emptyEl, contentEl);
  }
}

function renderAnalysisFromLocalSessions(fmt, emptyEl, contentEl) {
  const sessions = JSON.parse(localStorage.getItem('poepool-sessions') || '[]');
  let totalConsumed = 0, totalTrades = 0, totalInput = 0, totalOutput = 0;
  const receivedByScarab = {};
  for (const s of sessions) {
    totalConsumed += s.total_consumed || 0;
    totalTrades += s.total_trades || 0;
    totalInput += s.input_value || 0;
    totalOutput += s.output_value || 0;
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
    sessionCount: sessions.length,
    validCount: sessions.filter(s => !s.flagged).length,
    dataSourceLabel: 'Your data only (' + sessions.length + ' sessions)'
  }, fmt, emptyEl, contentEl);
}

function renderAnalysisFromAggregate(data, fmt, emptyEl, contentEl) {
  const { totalConsumed, totalTrades, totalInput, totalOutput, receivedByScarab, dataSourceLabel } = data;
  const sessionCount = data.sessionCount != null ? data.sessionCount : 0;
  const validSub = data.validCount != null ? data.validCount + ' unflagged' : '';

  emptyEl.style.display = 'block';
  contentEl.style.display = 'none';
  const totalReceived = Object.values(receivedByScarab).reduce((a, b) => a + b, 0);
  if (totalReceived === 0 && totalTrades === 0) {
    emptyEl.innerHTML = '<p>No session data yet. Log sessions on the <strong>Session Logger</strong> tab to see analytics here. Set <code>POOL_API_URL</code> to your community API to use shared data.</p>';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = '';
  const totalProfit = totalOutput - totalInput;
  const overallRoi = totalInput > 0 ? ((totalOutput - totalInput) / totalInput * 100) : 0;
  const realAvgPerTrade = totalTrades > 0 ? totalOutput / totalTrades : 0;

  const sourceEl = document.getElementById('analysisDataSource');
  if (sourceEl) sourceEl.textContent = dataSourceLabel;

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

  const topEvContrib = [...weightData].sort((a, b) => b.evContrib - a.evContrib);
  const top3EvContrib = topEvContrib.slice(0, 3).reduce((s, d) => s + d.evContrib, 0);
  const jackpotReliancePct = observedEv > 0 ? (top3EvContrib / observedEv) * 100 : 0;

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
  const jackpotRelianceClass = jackpotReliancePct <= 35 ? 'green' : (jackpotReliancePct <= 55 ? 'amber' : 'red');

  // Summary stats bar
  document.getElementById('analysisStatsBar').innerHTML = `
    <div class="analysis-stat-card"><div class="analysis-stat-label">Sessions</div><div class="analysis-stat-value">${sessionCount.toLocaleString()}</div><div style="font-size:10px;color:var(--text-3)">${validSub || '\u2014'}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Scarabs vendored</div><div class="analysis-stat-value">${totalConsumed.toLocaleString()}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Total trades (3:1)</div><div class="analysis-stat-value">${totalTrades.toLocaleString()}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Total profit</div><div class="analysis-stat-value ${totalProfit >= 0 ? 'green' : ''}">${(totalProfit >= 0 ? '+' : '') + fmt(totalProfit)}</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Overall ROI</div><div class="analysis-stat-value ${overallRoi >= 0 ? 'green' : ''}">${(overallRoi >= 0 ? '+' : '') + overallRoi.toFixed(1)}%</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Real avg/trade</div><div class="analysis-stat-value chaos">${realAvgPerTrade.toFixed(2)}c</div><div style="font-size:10px;color:var(--text-3)">from sessions</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Weight stability</div><div class="analysis-stat-value ${weightStabilityClass}">${weightStabilityPct.toFixed(0)}%</div><div style="font-size:10px;color:var(--text-3)">Higher = lower output variance.</div></div>
    <div class="analysis-stat-card"><div class="analysis-stat-label">Jackpot reliance</div><div class="analysis-stat-value ${jackpotRelianceClass}">${jackpotReliancePct.toFixed(1)}%</div><div style="font-size:10px;color:var(--text-3)">Top-3 EV share</div></div>
  `;

  const maxReceived = Math.max(...weightData.map(d => d.count), 1);
  window._analysisWeightData = weightData;
  window._analysisWeightSort = { key: 'ninja', dir: -1 };
  weightData.sort((a, b) => (a.ninjaPrice - b.ninjaPrice) * window._analysisWeightSort.dir);

  const head = document.getElementById('analysisWeightHead');
  if (head) {
    head.style.gridTemplateColumns = '1fr 82px 76px 82px 84px';
    head.style.gap = '6px';
    head.innerHTML = `
      <div class="th" data-sort="name" onclick="sortAnalysisWeight('name')">Scarab</div>
      <div class="th right" data-sort="received" onclick="sortAnalysisWeight('received')"><span class="recv-desktop">Received</span><span class="recv-mobile">Recv</span></div>
      <div class="th right" data-sort="pct" onclick="sortAnalysisWeight('pct')">Weight</div>
      <div class="th right" data-sort="ninja" onclick="sortAnalysisWeight('ninja')">COST/EA</div>
      <div class="th right" data-sort="contrib" onclick="sortAnalysisWeight('contrib')"><span class="contrib-desktop">CONTRIB</span><span class="contrib-mobile">CONTRIB</span></div>
    `;
  }

  // Axis label and chart (instant tooltip via data attr + one global tooltip)
  updateAnalysisChartAxisLabel();
  let chartHtml = '';
  for (const d of weightData) {
    const heightPct = maxReceived > 0 ? (d.count / maxReceived * 100) : 0;
    const safeName = (d.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    chartHtml += `<div class="analysis-bar-vertical" data-scarab-name="${safeName}" onmouseenter="showAnalysisBarTooltip(this, event)" onmouseleave="hideAnalysisBarTooltip()"><div class="bar-inner" style="height:${heightPct}%"></div></div>`;
  }
  document.getElementById('analysisWeightChart').innerHTML = chartHtml || '<div style="font-size:12px;color:var(--text-3)">No output scarab data.</div>';
  renderAnalysisWeightTable();

  // Ninja EV: harmonic mean of all scarab prices (same as app logic)
  const ninjaEntries = Object.keys(state.ninjaPrices || {}).filter(n => state.ninjaPrices[n] > 0).map(n => ({ chaosEa: state.ninjaPrices[n] }));
  const ninjaEv = ninjaEntries.length >= 2 ? calcEV(ninjaEntries) : null;

  document.getElementById('analysisEvCompare').innerHTML = `
    <div class="analysis-ev-card">
      <div class="label">Realized avg per trade (sessions)</div>
      <div class="value chaos">${realAvgPerTrade.toFixed(2)}c</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Total output ÷ total trades</div>
    </div>
    <div class="analysis-ev-card">
      <div class="label">Observed EV (weight \u00D7 market)</div>
      <div class="value">${(state.ninjaPrices && Object.keys(state.ninjaPrices).length) ? (observedEv.toFixed(2) + 'c') : '\u2014'}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Observed weights \u00D7 current market prices</div>
    </div>
    <div class="analysis-ev-card">
      <div class="label">Market EV (harmonic)</div>
      <div class="value">${ninjaEv != null ? ninjaEv.toFixed(2) + 'c' : '\u2014'}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Harmonic EV from market prices.</div>
    </div>
    <div class="analysis-ev-card">
      <div class="label">Real vs market EV</div>
      <div class="value ${ninjaEv != null && realAvgPerTrade >= ninjaEv ? 'green' : ninjaEv != null ? 'amber' : ''}">${ninjaEv != null ? ((realAvgPerTrade - ninjaEv) >= 0 ? '+' : '') + (realAvgPerTrade - ninjaEv).toFixed(2) + 'c' : '\u2014'}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">Realized minus theoretical</div>
    </div>
  `;

  // Weight table sort indicators on header (default ninja desc)
  if (head) {
    head.querySelectorAll('.th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === (window._analysisWeightSort?.key || 'ninja')) {
        th.classList.add(window._analysisWeightSort.dir === 1 ? 'sort-asc' : 'sort-desc');
      }
    });
  }
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

function sortAnalysisWeight(key) {
  const data = window._analysisWeightData;
  if (!data || !data.length) return;
  const prev = window._analysisWeightSort || { key: 'ninja', dir: -1 };
  const dir = prev.key === key ? -prev.dir : (key === 'name' ? 1 : -1);
  window._analysisWeightSort = { key, dir };
  data.sort((a, b) => {
    if (key === 'name') return (a.name.localeCompare(b.name)) * dir;
    if (key === 'received') return (a.count - b.count) * dir;
    if (key === 'pct') return (a.pct - b.pct) * dir;
    if (key === 'ninja') return (a.ninjaPrice - b.ninjaPrice) * dir;
    if (key === 'contrib') return (a.evContrib - b.evContrib) * dir;
    return 0;
  });
  updateAnalysisChartAxisLabel();
  const maxReceived = Math.max(...data.map(d => d.count), 1);
  let chartHtml = '';
  for (const d of data) {
    const heightPct = maxReceived > 0 ? (d.count / maxReceived * 100) : 0;
    const safeName = (d.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    chartHtml += `<div class="analysis-bar-vertical" data-scarab-name="${safeName}" onmouseenter="showAnalysisBarTooltip(this, event)" onmouseleave="hideAnalysisBarTooltip()"><div class="bar-inner" style="height:${heightPct}%"></div></div>`;
  }
  const chartEl = document.getElementById('analysisWeightChart');
  if (chartEl) chartEl.innerHTML = chartHtml;
  renderAnalysisWeightTable();
  const head = document.getElementById('analysisWeightHead');
  if (head) {
    head.querySelectorAll('.th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === key) th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
    });
  }
}

function renderAnalysisWeightTable() {
  const data = window._analysisWeightData || [];
  const el = document.getElementById('analysisWeightTable');
  if (!el) return;
  if (!data.length) {
    el.innerHTML = '<div style="padding:12px;color:var(--text-3)">No output scarab data.</div>';
    return;
  }
  const rows = data.map(d => `
    <div class="analysis-weight-row" style="display:grid;grid-template-columns:1fr 82px 76px 82px 84px;font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;gap:6px;">
      <div style="overflow:hidden;min-width:0"><span class="scarab-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}</span><span class="scarab-name-mobile" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mobileScarabName(d.name)}</span></div>
      <span style="text-align:right;font-variant-numeric:tabular-nums">${d.count.toLocaleString()}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${d.pct.toFixed(1)}%</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text-3)">${d.ninjaPrice ? d.ninjaPrice.toFixed(2) + 'c' : '\u2014'}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--chaos)">${d.evContrib.toFixed(2)}c</span>
    </div>`).join('');
  el.innerHTML = rows;
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
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
  // previously-positive toggle has flipped negative on revisit
  const saved = { blocked: [], boosted: [], deltas: {} };
  for (const g of state._atlasBlocked) {
    saved.blocked.push(g);
    saved.deltas[`block:${g}`] = atlasGroupStats(g, true).toggleDelta;
  }
  for (const g of state._atlasBoosted) {
    saved.boosted.push(g);
    saved.deltas[`boost:${g}`] = atlasGroupStats(g, false).toggleDelta;
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

    // Only warn if it was negative (good) when saved but is now positive (bad).
    let hasFlipped = false;
    for (const [key, savedDelta] of Object.entries(saved.deltas)) {
      if (savedDelta >= 0) continue; // was already an EV loss when saved \u2014 skip
      const [type, group] = key.split(':');
      const currentDelta = atlasGroupStats(group, type === 'block').toggleDelta;
      if (currentDelta > 0) { hasFlipped = true; break; }
    }
    if (!hasFlipped) return;

    // Only warn once per session
    if (window._atlasWarnedThisSession) return;
    window._atlasWarnedThisSession = true;

    setTimeout(() => {
      showAtlasWarningToast();
    }, 2000);
  } catch(e) {}
}

function showAtlasWarningToast() {
  const el = document.getElementById('toastAtlas');
  if (!el || el.classList.contains('show')) return;
  el.style.setProperty('--vt-accent', 'var(--chaos)');
  el.innerHTML = `
    <div class="version-toast-header">
      <span class="version-toast-title" style="text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap">Atlas config needs review</span>
      <button class="version-toast-dismiss" onclick="event.stopPropagation(); dismissAtlasToast()" title="Dismiss">&times;</button>
    </div>
    <div class="version-toast-alert">Prices may have shifted since your last save.</div>
    <div class="version-toast-body">
      <ul><li>One or more of your saved toggles is now hurting your map EV.</li>
      <li>Check the Atlas Optimizer &mdash; EV loss pills show which ones.</li></ul>
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
    const evContrib  = localShare * price;
    // Live pool contribution (accounts for boosts on other groups too)
    const mult       = state._atlasBoosted.has(s.group) ? 2 : 1;
    const liveShare  = liveTotalW > 0 ? (w * mult) / liveTotalW : 0;
    const liveContrib = liveShare * price;
    return { name: s.name, localShare, price, evContrib, liveContrib };
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

  // Badge logic:
  // - blocked/boosted state badges always show
  // - ev-loss shows if current toggle is net negative (regardless of save state)
  // - suggested shows on best untoggled positive >= 1%
  // - ev-loss takes priority over suggested
  let badgeHtml = '';
  const isActive = isBlockable ? isBlocked : isBoosted;
  const isEvLoss = isActive && stats.toggleDelta > 0;
  if (isEvLoss) badgeHtml += '<span class="atlas-badge ev-loss">EV loss</span>';
  if (!isActive && isRecommended) badgeHtml += '<span class="atlas-badge recommended">suggested</span>';

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
    const baselineEV = atlasComputeEV(new Set(), new Set());
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
        <span>Scarab</span><span>Group share</span><span>Price</span><span>Contrib</span>
      </div>
      ${stats.scarabs.map(sc => `
        <div class="atlas-scarab-row">
          <span class="atlas-scarab-name scarab-name">${sc.name}</span><span class="atlas-scarab-name scarab-name-mobile">${mobileScarabName(sc.name)}</span>
          <span class="atlas-scarab-stat muted">${(sc.localShare * 100).toFixed(1)}%</span>
          <span class="atlas-scarab-stat chaos">${sc.price > 0 ? sc.price.toFixed(2) + 'c' : '\u2014'}</span>
          <span class="atlas-scarab-stat accent">${sc.evContrib.toFixed(4)}c</span>
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
          <span class="atlas-chevron${isExpanded ? ' open' : ''}">&#9656;</span>
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
    const hasMarginal = rows.some(r => {
      const d = atlasGroupStats(r.g, isBlockable).toggleDelta;
      const pct = _atlasBaselineEV > 0 ? d / _atlasBaselineEV : 0;
      return pct > 0.000005 && pct < 0.01;
    });
    const warning = hasMarginal
      ? `<span style="font-size:10px;color:#c8b400;font-weight:500;margin-left:auto">marginal gains only</span>`
      : '';
    const hasActive = isBlockable
      ? rows.some(r => state._atlasBlocked.has(r.g))
      : rows.some(r => state._atlasBoosted.has(r.g));
    const resetBtn = hasActive
      ? `<button onclick="${isBlockable ? 'atlasResetBlocks()' : 'atlasResetBoosts()'}"
          style="font-family:inherit;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-3);cursor:pointer;margin-left:${warning ? '8px' : 'auto'};transition:all 0.15s"
          onmouseover="this.style.color='var(--red)';this.style.borderColor='var(--red)'"
          onmouseout="this.style.color='var(--text-3)';this.style.borderColor='var(--border)'">&#8634; Reset</button>`
      : '';
    return `
    <div class="atlas-col-header">
      <span class="atlas-col-header-title">${title}</span>
      <span class="atlas-col-title-tag ${tagClass}">${tagLabel}</span>
      ${warning}
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
          <span class="atlas-chevron${isOpen ? ' open' : ''}">&#9656;</span>
          <span class="atlas-leftovers-title">Fixed pool &mdash; ${leftovers.length} remaining groups</span>
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
                  <span>Scarab</span><span>Group share</span><span>Price</span><span>Contrib</span>
                </div>
                ${scarabs.map(sc => {
                  const w = weights2[sc.name] || 0;
                  const localShare = groupW2 > 0 ? w / groupW2 : 0;
                  const price = getNinjaPrice(sc.name, lower2);
                  const evC = localShare * price;
                  return `<div class="atlas-scarab-row">
                    <span class="atlas-scarab-name scarab-name">${sc.name}</span><span class="atlas-scarab-name scarab-name-mobile">${mobileScarabName(sc.name)}</span>
                    <span class="atlas-scarab-stat muted">${(localShare * 100).toFixed(1)}%</span>
                    <span class="atlas-scarab-stat chaos">${price > 0 ? price.toFixed(2) + 'c' : '\u2014'}</span>
                    <span class="atlas-scarab-stat accent">${evC.toFixed(4)}c</span>
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
                  <span class="atlas-chevron${isEx ? ' open' : ''}">&#9656;</span>
                </div>
                ${scarabBreak}
              </div>`;
          }).join('')}
        </div>` : ''}
      </div>`;
  }
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
fetchCurrentLeague().then(() => {
  fetchMarketScarabPrices();
  fetchPriceHistory();
  fetchAndRenderEVChart();
});
fetchObservedWeights(); // pull weight distribution from community aggregate
updateSortArrows();
initSlider();
checkVersionToast();

(function initHashRouting() {
  const VALID_TABS = ['scarabEV','atlas','bulk','logger','analysis','faq'];
  function loadFromHash() {
    const raw = window.location.hash.replace('#', '');
    const hash = raw === 'scarabEV' ? 'ninja' : raw;
    if (VALID_TABS.includes(raw)) switchTab(hash, true);
  }
  loadFromHash();
  window.addEventListener('hashchange', () => loadFromHash());
})();

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


// Preserve legacy global access for inline HTML handlers after module migration.
Object.assign(window, {
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
  parseOldNinjaResponse,
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




