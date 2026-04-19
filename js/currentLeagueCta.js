// Current-league session data CTA modal for ScarabEV.
// Feature-scoped utility: eligibility, per-day-per-league persistence, and modal UI.

function buildLeagueCtaStorageKey(league, dayKey) {
  const safeLeague = String(league || '').trim() || 'Unknown';
  const safeDay = String(dayKey || '').trim() || '';
  return `scarabev-league-cta:${safeLeague}:${safeDay}`;
}

function wasLeagueCtaHandledToday(league, dayKey) {
  const key = buildLeagueCtaStorageKey(league, dayKey);
  try {
    return localStorage.getItem(key) === '1';
  } catch (_e) {
    return false;
  }
}

function markLeagueCtaHandledToday(league, dayKey) {
  const key = buildLeagueCtaStorageKey(league, dayKey);
  try {
    localStorage.setItem(key, '1');
  } catch (_e) {}
}

function ensureActionModalStyles() {
  if (document.getElementById('scarabevActionModalStyles')) return;
  const style = document.createElement('style');
  style.id = 'scarabevActionModalStyles';
  style.textContent = `
    .scarabev-action-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(8, 14, 22, 0.66);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      z-index: 420;
      backdrop-filter: blur(2px);
    }
    .scarabev-action-modal {
      width: min(560px, 96vw);
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow-md);
      color: var(--text);
      padding: 16px 16px 14px;
    }
    .scarabev-action-modal-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--chaos);
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }
    .scarabev-action-modal-body {
      font-size: 12px;
      line-height: 1.65;
      color: var(--text-2);
    }
    .scarabev-action-modal-status {
      margin-top: 10px;
      border: 1px solid var(--border);
      background: var(--bg-group);
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 12px;
      color: var(--text-2);
      text-align: center;
    }
    .scarabev-action-modal-status strong {
      color: var(--accent);
      font-weight: 700;
    }
    .scarabev-action-modal-status-label {
      font-size: 10px;
      color: var(--text-3);
      letter-spacing: 0.02em;
      text-transform: none;
    }
    .scarabev-action-modal-progress-title {
      font-size: 11px;
      color: var(--text-3);
      margin-bottom: 6px;
      font-weight: 600;
    }
    .scarabev-action-modal-progress-grid {
      display: grid;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .scarabev-action-modal-progress-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      font-size: 11px;
      padding: 5px 8px;
      background: var(--bg-card);
      border-top: 1px solid var(--border);
    }
    .scarabev-action-modal-progress-row:first-child {
      border-top: none;
    }
    .scarabev-action-modal-progress-row:hover {
      background: var(--row-hover);
    }
    .scarabev-action-modal-progress-row-label {
      color: var(--text-3);
      text-align: left;
      flex: 1;
    }
    .scarabev-action-modal-progress-row-value {
      color: var(--text);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .scarabev-action-modal-progress-divider {
      height: 1px;
      background: var(--border);
      margin: 8px 0 7px;
    }
    .scarabev-action-modal-validation {
      font-size: 11px;
      line-height: 1.6;
      color: var(--text-2);
      text-align: left;
    }
    .scarabev-action-modal-status-value {
      margin-top: 2px;
      font-size: 22px;
      font-weight: 800;
      line-height: 1.1;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
    .scarabev-action-modal-footnote {
      margin-top: 4px;
      font-size: 10px;
      color: var(--text-3);
      opacity: 0.9;
      line-height: 1.5;
      text-align: left;
      font-style: italic;
    }
    .scarabev-action-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .scarabev-action-modal-btn {
      font-family: inherit;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-group);
      color: var(--text-2);
      padding: 7px 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .scarabev-action-modal-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .scarabev-action-modal-btn-primary {
      border-color: var(--ninja-border);
      background: var(--ninja-bg);
      color: var(--ninja-accent);
      font-weight: 700;
    }
    .scarabev-action-modal-btn-primary:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  `;
  document.head.appendChild(style);
}

function closeActionModal() {
  const overlay = document.getElementById('scarabevActionModalOverlay');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  document.body.style.overflow = '';
}

function showActionModal({ title, bodyHtml, statusText, footnoteText, primaryLabel, secondaryLabel, onPrimary, onSecondary }) {
  ensureActionModalStyles();
  closeActionModal();

  const overlay = document.createElement('div');
  overlay.id = 'scarabevActionModalOverlay';
  overlay.className = 'scarabev-action-modal-overlay';
  overlay.innerHTML = `
    <div class="scarabev-action-modal" role="dialog" aria-modal="true" aria-labelledby="scarabevActionModalTitle">
      <div id="scarabevActionModalTitle" class="scarabev-action-modal-title">${title}</div>
      <div class="scarabev-action-modal-body">${bodyHtml}</div>
      <div class="scarabev-action-modal-status">${statusText}</div>
      ${footnoteText ? `<div class="scarabev-action-modal-footnote">${footnoteText}</div>` : ''}
      <div class="scarabev-action-modal-actions">
        <button type="button" class="scarabev-action-modal-btn scarabev-action-modal-btn-primary" id="scarabevActionModalPrimary">${primaryLabel}</button>
        <button type="button" class="scarabev-action-modal-btn" id="scarabevActionModalSecondary">${secondaryLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  overlay.addEventListener('click', (ev) => {
    if (ev.target !== overlay) return;
    if (typeof onSecondary === 'function') onSecondary();
  });
  const primaryBtn = document.getElementById('scarabevActionModalPrimary');
  const secondaryBtn = document.getElementById('scarabevActionModalSecondary');
  if (primaryBtn) primaryBtn.addEventListener('click', () => { if (typeof onPrimary === 'function') onPrimary(); });
  if (secondaryBtn) secondaryBtn.addEventListener('click', () => { if (typeof onSecondary === 'function') onSecondary(); });
}

export function maybeShowLeagueSessionCta(currentLeagueSharePct, opts = {}) {
  const share = Number(currentLeagueSharePct);
  if (!Number.isFinite(share)) return;
  if (share >= 100) return;

  const league = String(opts.league || '').trim() || 'Unknown';
  const dayKey = String(opts.dayKey || '').trim();
  if (!dayKey) return;

  const storageKey = buildLeagueCtaStorageKey(league, dayKey);
  if (window._leagueSessionCtaRuntimeKey === storageKey) return;
  if (wasLeagueCtaHandledToday(league, dayKey)) {
    window._leagueSessionCtaRuntimeKey = storageKey;
    return;
  }
  window._leagueSessionCtaRuntimeKey = storageKey;

  const rawTradesObserved = Number(opts.tradesObserved);
  const tradesObserved = Number.isFinite(rawTradesObserved) ? Math.max(0, Math.round(rawTradesObserved)) : 0;
  const rawScarabsVendored = Number(opts.scarabsVendored);
  const scarabsVendored = Number.isFinite(rawScarabsVendored)
    ? Math.max(0, Math.round(rawScarabsVendored))
    : (tradesObserved * 3);

  const bodyHtml = `
    <p>At league start, prior-league data is blended in until enough current-league observations are collected. Fresh logs help keep scarab weights accurate after league changes.</p>
  `;
  const statusText = `
    <div class="scarabev-action-modal-progress-title">Current progress</div>
    <div class="scarabev-action-modal-progress-grid">
      <div class="scarabev-action-modal-progress-row">
        <div class="scarabev-action-modal-progress-row-label">Trades observed</div>
        <div class="scarabev-action-modal-progress-row-value">${tradesObserved.toLocaleString()} / 30,000</div>
      </div>
      <div class="scarabev-action-modal-progress-row">
        <div class="scarabev-action-modal-progress-row-label">Scarabs vendored</div>
        <div class="scarabev-action-modal-progress-row-value">${scarabsVendored.toLocaleString()} / 90,000</div>
      </div>
      <div class="scarabev-action-modal-progress-row">
        <div class="scarabev-action-modal-progress-row-label">Current-league data share</div>
        <div class="scarabev-action-modal-progress-row-value">${share.toFixed(1)}%</div>
      </div>
    </div>
    <div class="scarabev-action-modal-progress-divider"></div>
    <div class="scarabev-action-modal-validation">
      Harmonic EV works without weighting data. Fresh observations mainly improve Atlas Optimizer and Weighted EV.
    </div>
    <div class="scarabev-action-modal-progress-divider"></div>
    <div class="scarabev-action-modal-validation">
      Only clean single-pass sessions that pass sanity checks are counted.
    </div>
    <div class="scarabev-action-modal-validation" style="margin-top:4px"><strong>Please follow the How-to workflow when submitting.</strong></div>
  `;
  showActionModal({
    title: 'Help update ScarabEV for the current league',
    bodyHtml,
    statusText,
    footnoteText: 'This daily reminder ends automatically at 100%.',
    primaryLabel: 'Submit Session Data',
    secondaryLabel: 'Dismiss',
    onPrimary: () => {
      markLeagueCtaHandledToday(league, dayKey);
      closeActionModal();
      if (typeof opts.switchTab === 'function') opts.switchTab('logger');
      if (typeof opts.ensureLoggerHowToExpanded === 'function') opts.ensureLoggerHowToExpanded();
      const loggerHowTo = document.getElementById('loggerHowToToggle');
      if (loggerHowTo && typeof loggerHowTo.scrollIntoView === 'function') {
        loggerHowTo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    onSecondary: () => {
      markLeagueCtaHandledToday(league, dayKey);
      closeActionModal();
    }
  });
}
