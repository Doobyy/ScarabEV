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
      color: var(--text);
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
    }
    .scarabev-action-modal-status strong {
      color: var(--accent);
      font-weight: 700;
    }
    .scarabev-action-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 14px;
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

function showActionModal({ title, bodyHtml, statusText, primaryLabel, secondaryLabel, onPrimary, onSecondary }) {
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

  const bodyHtml = `
    <p>ScarabEV is still blending prior-league data. Submitting session logs helps move weights toward fully current-league data and improves accuracy.</p>
    <p style="margin-top:8px">Please submit clean <strong>single-pass</strong> sessions and follow the How-to workflow so logs pass sanity checks and can be accepted into community weights.</p>
  `;
  const statusText = `Current-league data share: <strong>${share.toFixed(1)}%</strong>`;
  showActionModal({
    title: 'Help improve current-league scarab weights',
    bodyHtml,
    statusText,
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
