// Backend token source loader.
// Owns published-token fetch and local cache fallback behavior.
// Keeps token source initialization modular and reusable.

const BACKEND_TOKEN_CACHE_KEY = 'scarabev-backend-token-cache-v1';

export async function initializeBackendTokenSource(deps) {
  const { BACKEND_TOKEN_SET_URL, configureRegexEngine, state } = deps;

  try {
    const res = await fetch(BACKEND_TOKEN_SET_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    const byName = payload?.tokensByName;
    if (!byName || typeof byName !== 'object' || !Object.keys(byName).length) {
      throw new Error('missing_tokensByName');
    }
    configureRegexEngine({ POE_RE_TOKENS: byName });
    state._regexTokenSource = 'backend';
    state._backendTokenVersion = payload.versionId || null;
    try {
      localStorage.setItem(BACKEND_TOKEN_CACHE_KEY, JSON.stringify({
        versionId: state._backendTokenVersion,
        tokensByName: byName
      }));
    } catch (e) {}
  } catch (e) {
    let cached = null;
    try {
      const raw = localStorage.getItem(BACKEND_TOKEN_CACHE_KEY);
      cached = raw ? JSON.parse(raw) : null;
    } catch (err) {
      cached = null;
    }
    const cachedByName = cached?.tokensByName;
    if (cachedByName && typeof cachedByName === 'object' && Object.keys(cachedByName).length) {
      configureRegexEngine({ POE_RE_TOKENS: cachedByName });
      state._regexTokenSource = 'backend-cache';
      state._backendTokenVersion = cached?.versionId || null;
      return;
    }
    configureRegexEngine({ POE_RE_TOKENS: {} });
    state._regexTokenSource = 'backend-unavailable';
    state._backendTokenVersion = null;
  }
}
