// Data Analysis UI, aggregate/local analysis, chart, sorting, and weight table.
// Shared shell callbacks are supplied by app.js to preserve orchestration behavior.

import { state } from './state.js';
import { POOL_API_URL } from './config.js';
import { atlasComputeEV } from './atlas.js';

const SCARAB_LIST = state.scarabList;
let mobileScarabName;
let applyScarabModifierTooltips;
let bindStatInfoTooltipEvents;
let readCurrentLeagueShare;
let maybeShowCurrentLeagueCtaFromShare;

export function configureAnalysis(deps) {
  ({ mobileScarabName, applyScarabModifierTooltips, bindStatInfoTooltipEvents, readCurrentLeagueShare, maybeShowCurrentLeagueCtaFromShare } = deps);
}
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
          weights: aggCurrent.weights || null,
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
  const { totalConsumed, totalTrades, totalInput, totalOutput, totalInputDivine, totalOutputDivine, receivedByScarab, weights, dataSourceLabel } = data;

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
  const scarabGroupByName = new Map();
  const scarabGroupByNameLower = new Map();
  for (const scarab of SCARAB_LIST) {
    const scarabName = String(scarab?.name || '');
    const scarabGroup = String(scarab?.group || '');
    if (!scarabName) continue;
    scarabGroupByName.set(scarabName, scarabGroup);
    scarabGroupByNameLower.set(scarabName.toLowerCase(), scarabGroup);
  }
  const weightData = Object.keys(receivedByScarab).map(name => {
    const count = receivedByScarab[name];
    const pct = totalReceived > 0 ? (count / totalReceived * 100) : 0;
    const backendWeight = weights && typeof weights === 'object' ? Number(weights[name]) : NaN;
    const weight = Number.isFinite(backendWeight) && backendWeight > 0 ? backendWeight : (pct / 100);
    const ninjaPrice = state.ninjaPrices[name] ?? 0;
    const evContrib = weight * ninjaPrice;
    const group = scarabGroupByName.get(name) || scarabGroupByNameLower.get(String(name || '').toLowerCase()) || '\u2014';
    observedEv += evContrib;
    return { name, group, count, pct, weight, ninjaPrice, evContrib };
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

  let currentLeagueSharePct = readCurrentLeagueSharePct(data.weightMeta);
  if (currentLeagueSharePct == null) currentLeagueSharePct = readCurrentLeagueSharePct(data);
  if (currentLeagueSharePct == null) currentLeagueSharePct = readCurrentLeagueSharePct(state._weightMeta);
  maybeShowCurrentLeagueCtaFromShare(currentLeagueSharePct, {
    tradesObserved: totalTrades,
    scarabsVendored: totalConsumed
  });
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
    head.style.gridTemplateColumns = '1fr 96px 82px 76px 82px 84px';
    head.style.gap = '6px';
    head.innerHTML = `
      <div class="th th-search"><input type="text" id="analysis-filter" class="analysis-head-search" placeholder="SCARAB" oninput="setAnalysisWeightFilter(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="analysis_filter" data-lpignore="true"></div>
      <div class="th right analysis-group-col" data-sort="group" onclick="sortAnalysisWeight('group')"><span class="analysis-group-desktop">Group</span></div>
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
  if (key === 'group') return 'Sorted by: Group (' + (dir === 1 ? 'A-Z' : 'Z-A') + ')';
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
    if (key === 'group') {
      const groupCmp = String(a.group || '').localeCompare(String(b.group || ''));
      if (groupCmp !== 0) return groupCmp * dir;
      return a.name.localeCompare(b.name) * dir;
    }
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
  const dir = prev.key === key ? -prev.dir : ((key === 'name' || key === 'group') ? 1 : -1);
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
    <div class="analysis-weight-row" style="display:grid;grid-template-columns:1fr 96px 82px 76px 82px 84px;font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;gap:6px;">
      <div style="overflow:hidden;min-width:0"><span class="scarab-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}</span><span class="scarab-name-mobile" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mobileScarabName(d.name)}</span></div>
      <span class="analysis-group-col" style="text-align:right;font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.group || '\u2014'}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:550;color:var(--text-2)">${d.count.toLocaleString()}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:550;color:var(--text-2)">${pctText}%</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text-3)">${d.ninjaPrice ? d.ninjaPrice.toFixed(2) + 'c' : '\u2014'}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--chaos)">${d.evContrib.toFixed(4)}c</span>
    </div>`;
  }).join('');
  el.innerHTML = rows;
  applyScarabModifierTooltips(document.getElementById('tab-analysis'));
}


export {
  renderAnalysis,
  renderAnalysisFromLocalSessions,
  renderAnalysisFromAggregate,
  getAnalysisSortLabel,
  updateAnalysisChartAxisLabel,
  showAnalysisBarTooltip,
  hideAnalysisBarTooltip,
  setAnalysisWeightFilter,
  sortAnalysisWeight,
  renderAnalysisWeightTable
};