// Backend token source loader.
// Owns published-token fetch behavior.
// Keeps token source initialization modular and reusable.

const BACKEND_TOKEN_CACHE_KEY = 'scarabev-backend-token-cache-v1';
const BACKEND_TOKEN_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

export async function initializeBackendTokenSource(deps) {
  const { BACKEND_TOKEN_SET_URL, configureRegexEngine, state } = deps;

  try {
    const res = await fetch(BACKEND_TOKEN_SET_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('backend_token_fetch_failed_http_' + res.status);
    const payload = await res.json();
    const byName = payload?.tokensByName;
    if (!byName || typeof byName !== 'object' || !Object.keys(byName).length) {
      throw new Error('backend_token_fetch_failed_missing_tokensByName');
    }
    configureRegexEngine({ SCARAB_TOKENS: byName });
    state._regexTokenSource = 'backend';
    state._backendTokenVersion = payload.versionId || null;
    try {
      localStorage.setItem(BACKEND_TOKEN_CACHE_KEY, JSON.stringify({
        versionId: state._backendTokenVersion,
        tokensByName: byName,
        cachedAt: Date.now()
      }));
    } catch (e) {}
    return { tokensByName: byName, versionId: state._backendTokenVersion, source: 'backend' };
  } catch (e) {
    let cached = null;
    try {
      const raw = localStorage.getItem(BACKEND_TOKEN_CACHE_KEY);
      cached = raw ? JSON.parse(raw) : null;
    } catch (_err) {
      cached = null;
    }
    const cachedAt = Number(cached?.cachedAt || 0);
    const ageMs = Date.now() - cachedAt;
    const cachedByName = cached?.tokensByName;
    const isFresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= BACKEND_TOKEN_CACHE_MAX_AGE_MS;
    if (isFresh && cachedByName && typeof cachedByName === 'object' && Object.keys(cachedByName).length) {
      configureRegexEngine({ SCARAB_TOKENS: cachedByName });
      state._regexTokenSource = 'backend-cache-recent';
      state._backendTokenVersion = cached?.versionId || null;
      return { tokensByName: cachedByName, versionId: state._backendTokenVersion, source: 'backend-cache-recent' };
    }
    throw e;
  }
}
