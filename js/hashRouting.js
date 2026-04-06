// Hash routing helper.
// Keeps URL hash tab routing modular and reusable.

const VALID_TABS = ['scarabEV', 'atlas', 'bulk', 'logger', 'analysis', 'faq'];

export function initHashRouting(switchTab) {
  function loadFromHash() {
    const raw = window.location.hash.replace('#', '');
    const hash = raw === 'scarabEV' ? 'ninja' : raw;
    if (VALID_TABS.includes(raw)) switchTab(hash, true);
  }

  loadFromHash();
  window.addEventListener('hashchange', () => loadFromHash());
}

