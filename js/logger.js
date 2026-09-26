// Session Logger UI, preview, submission, and local session history.
// Receives shared shell helpers from app.js to preserve startup ownership.

import { state } from './state.js';
import { POOL_API_URL } from './config.js';
import { calcAutoEV } from './scarabEngine.js';
import { buildReverseTokenMap, parseRegexToScarabs } from './regexEngine.js';
import { buildNinjaLookup, getNinjaPrice, parseSnapCSV } from './market.js';

const SCARAB_LIST = state.scarabList;
let syncLoggerRegex;
let getDivineRate;
let mobileScarabName;
let fmtWithRate;

export function configureLogger(deps) {
  ({ syncLoggerRegex, getDivineRate, mobileScarabName, fmtWithRate } = deps);
}

export function initializeLogger() {
  bindLoggerEvents();
  renderSessionHistory();
}

export { parseSnapCSV, buildReverseTokenMap, parseRegexToScarabs };
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

function bindLoggerEvents() {
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
  const { matched, unmatched, identifiedCount } = parseRegexToScarabs(val);
  const count = Number.isFinite(identifiedCount) ? identifiedCount : matched.length;
  let hint = `${count} scarab types identified`;
  if (unmatched.length) hint += ` \u00B7 ${unmatched.length} unrecognised tokens: ${unmatched.join(', ')}`;
  document.getElementById('loggerRegexHint').textContent = hint;
  tryPreview();
});

	}

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

  const totalTrades = Math.floor(totalConsumed / 3);
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

  const loggedThreshold = state.ninjaEvOverride !== null
    ? Number(state.ninjaEvOverride)
    : Number(calcAutoEV());
  const loggedThresholdMode = state.ninjaEvOverride !== null
    ? 'manual'
    : (state._evMode === 'weighted' ? 'weighted' : 'harmonic');

  // Store parsed session for submit
  window._parsedSession = {
    threshold: Number.isFinite(loggedThreshold) && loggedThreshold > 0 ? loggedThreshold : 0,
    threshold_mode: loggedThresholdMode,
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

  if (!Array.isArray(session.allRows) || session.allRows.length === 0) {
    status.textContent = 'Session rows are missing - session not saved';
    status.style.color = 'var(--red)';
    btn.disabled = false;
    return;
  }

  try {
    const payload = {
      total_consumed: session.totalConsumed,
      total_trades: session.totalTrades,
      input_value: session.totalInputValue,
      output_value: session.totalOutputValue,
      divine_rate: session.divine_rate,
      league: session.league || undefined,
      regex: session.regex || undefined,
      scarabs: (session.allRows || []).map(r => ({
        name: r.name,
        received: r.received || 0,
        consumed: r.consumed || 0,
        was_vendor: r.was_vendor || false,
        ninja_price: r.ninja_price || 0
      }))
    };

    let intake = {
      counted: false,
      classification: 'local_only_unavailable',
      healthPct: null,
      reasons: ['Community intake endpoint is unavailable.'],
      expectedTrades: null,
      actualOutputs: null,
      drift: null
    };

    if (POOL_API_URL) {
      try {
        const resp = await fetch(POOL_API_URL + '/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        let body = null;
        try { body = await resp.json(); } catch (e) { body = null; }
        if (body && typeof body === 'object') {
          intake = {
            counted: body.counted === true,
            classification: body.classification || (body.counted === true ? 'accepted' : 'rejected'),
            healthPct: Number.isFinite(Number(body.healthPct)) ? Number(body.healthPct) : null,
            reasons: Array.isArray(body.reasons) ? body.reasons : (body.error ? [String(body.error)] : []),
            expectedTrades: Number.isFinite(Number(body.expectedTrades)) ? Number(body.expectedTrades) : null,
            actualOutputs: Number.isFinite(Number(body.actualOutputs)) ? Number(body.actualOutputs) : null,
            drift: Number.isFinite(Number(body.drift)) ? Number(body.drift) : null
          };
        } else if (!resp.ok) {
          intake = {
            counted: false,
            classification: 'local_only_backend_error',
            healthPct: null,
            reasons: ['Community intake returned an invalid response.'],
            expectedTrades: null,
            actualOutputs: null,
            drift: null
          };
        }
      } catch (e) {
        intake = {
          counted: false,
          classification: 'local_only_network_error',
          healthPct: null,
          reasons: ['Could not reach community intake endpoint.'],
          expectedTrades: null,
          actualOutputs: null,
          drift: null
        };
      }
    }

    const existing = JSON.parse(localStorage.getItem('poepool-sessions') || '[]');
    const record = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      league: session.league,
      threshold: session.threshold,
      threshold_mode: session.threshold_mode,
      divine_rate: session.divine_rate,
      regex: session.regex,
      total_consumed: session.totalConsumed,
      total_trades: session.totalTrades,
      input_value: session.totalInputValue,
      output_value: session.totalOutputValue,
      roi_pct: session.roi,
      flagged: !intake.counted,
      flags: intake.reasons || [],
      counted_community: !!intake.counted,
      intake_classification: intake.classification || null,
      intake_health_pct: intake.healthPct,
      intake_expected_trades: intake.expectedTrades,
      intake_actual_outputs: intake.actualOutputs,
      intake_drift: intake.drift,
      scarabs: session.allRows
    };
    existing.push(record);
    localStorage.setItem('poepool-sessions', JSON.stringify(existing));
    const intakeClass = String(intake.classification || '').trim().toLowerCase();
    const heldForReview = intakeClass === 'review_pending';
    if (intake.counted) {
      status.textContent = `Counted in community data${intake.healthPct != null ? ` \u00B7 Health ${Math.round(intake.healthPct)}%` : ''}`;
      status.style.color = 'var(--green)';
    } else if (heldForReview) {
      status.textContent = 'Saved locally only - held for admin review before it is added to community aggregate.';
      status.style.color = 'var(--amber)';
    } else {
      const reasonLine = (intake.reasons && intake.reasons.length)
        ? intake.reasons.slice(0, 2).join(' | ')
        : 'Backend rejected this session.';
      status.textContent = `Saved locally only${intake.healthPct != null ? ` \u00B7 Health ${Math.round(intake.healthPct)}%` : ''} - ${reasonLine}`;
      status.style.color = 'var(--amber)';
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
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
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
  const cols = isMobile
    ? '98px 58px 64px 62px 62px 62px 54px 52px minmax(54px, 1fr)'
    : '132px 1fr 84px 98px 72px 72px 72px 64px 56px minmax(80px, 1fr)';
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
  const fmtSessionDateMobile = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${min}`;
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
      <span class="cell-left">Date</span>${isMobile ? '' : '<span class="cell-left">League</span>'}<span class="cell-right">${isMobile ? 'S-IN' : 'Scarabs In'}</span><span class="cell-right">${isMobile ? 'S-OUT' : 'Scarabs Out'}</span><span class="cell-right">Input</span><span class="cell-right">Output</span><span class="cell-right">Profit</span><span class="cell-right">Cutoff</span><span class="cell-right">ROI</span><span class="cell-left"></span>
    </div>
    ${pageRows.map((s, i) => {
      const globalPos = start + i;
      const idx = sessions.length - 1 - globalPos;
      const profit = (s.output_value || 0) - (s.input_value || 0);
      const thresholdValue = Number(s.threshold);
      const thresholdText = Number.isFinite(thresholdValue) ? (thresholdValue.toFixed(2) + 'c') : '-';
      const thresholdMode = String(s.threshold_mode || '').trim().toLowerCase();
      const thresholdModeTitle = thresholdMode === 'weighted'
        ? 'Weighted EV cutoff used for this session'
        : (thresholdMode === 'manual' ? 'Manual cutoff used for this session' : 'Harmonic EV cutoff used for this session');
      const fmtSession = (c) => fmtWithRate(c, s.divine_rate);
      const profitFmt = (c) => (c >= 0 ? '+' : '') + fmtSession(c);
      const scarabsOut = Array.isArray(s.scarabs)
        ? Math.round(s.scarabs.reduce((sum, row) => sum + (Number(row?.received) || 0), 0)).toLocaleString()
        : '0';
      return `<div>
        <div onclick="toggleSessionDetail(${idx})" class="logger-history-grid" style="grid-template-columns:${cols};gap:${gap};font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='var(--row-hover)'" onmouseout="this.style.background=''">
          <span class="cell-left" style="white-space:nowrap">${isMobile ? fmtSessionDateMobile(s.created_at) : fmtSessionDate(s.created_at)}</span>
          ${isMobile ? '' : `<span class="cell-left">${s.league}</span>`}
          <span class="cell-right">${s.total_consumed?.toLocaleString()}</span>
          <span class="cell-right">${scarabsOut}</span>
          <span class="cell-right">${fmtSession(s.input_value)}</span>
          <span class="cell-right">${fmtSession(s.output_value)}</span>
          <span class="cell-right" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${profitFmt(profit)}</span>
          <span class="cell-right" style="color:var(--chaos)" title="${thresholdModeTitle}">${thresholdText}</span>
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

export {
  handleSnap,
  setLoggerRegexMode,
  tryPreview,
  submitSession,
  renderSessionHistory,
  setLoggerHistoryPage,
  setLoggerHistoryPageSize,
  deleteSession,
  toggleSessionDetail,
  renderSessionDetail
};

