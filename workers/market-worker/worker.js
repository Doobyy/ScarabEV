import { SCARAB_LIST, ATLAS_BLOCKABLE, ATLAS_BOOSTABLE } from "../../js/config.js";

const CACHE_PREFIX = "market-cache-v2";
const KEY_CURRENT_LEAGUE = `${CACHE_PREFIX}:current-league`;
const BACKOFF_STEPS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const UPSTREAM_TIMEOUT_MS = 8000;
const AGGREGATE_API_URL = "https://scarabev-api.paperpandastacks.workers.dev/api/aggregate";
const ATLAS_MAX_OPTIMIZE_STEPS = 24;
const SNAPSHOT_RETRY_KEY = `${CACHE_PREFIX}:snapshot-retry`;
const SNAPSHOT_INLINE_ATTEMPTS = 3;
const SNAPSHOT_RETRY_DELAY_MS = 60 * 60 * 1000;
const SNAPSHOT_RETRY_MAX_ATTEMPTS = 3;

const POLICY = {
  currentLeague: {
    freshMs: 10 * 60 * 1000,
    maxStaleMs: 24 * 60 * 60 * 1000
  },
  marketCurrent: {
    freshMs: 5 * 60 * 1000,
    maxStaleMs: 30 * 60 * 1000
  },
  marketStandard: {
    freshMs: 60 * 60 * 1000,
    maxStaleMs: 6 * 60 * 60 * 1000
  }
};

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const cron = String(event.cron || "");
    if (cron === "0 18 * * *") {
      ctx.waitUntil(runDailyEVSnapshot(env));
      return;
    }
    if (cron === "0 * * * *") {
      ctx.waitUntil(runPendingSnapshotRetry(env));
      return;
    }
    if (cron === "10 * * * *") {
      ctx.waitUntil(refreshCurrentLeagueCache(env));
      return;
    }
    if (cron === "*/5 * * * *") {
      ctx.waitUntil(refreshCurrentLeagueMarketBundle(env));
      return;
    }
    if (cron === "5 * * * *") {
      ctx.waitUntil(refreshStandardMarketBundle(env));
    }
  }
};

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const league = (url.searchParams.get("league") || "Mirage").trim();
  const type = (url.searchParams.get("type") || "Scarab").trim();

  if (type === "EVHistory") return handleEVHistory(league, env);
  if (type === "PriceHistory") return handlePriceHistory(league, env);
  if (type === "AtlasEVHistory") return handleAtlasEVHistory(league, env);
  if (type === "CurrentLeague") return handleCurrentLeague(env);

  if (type === "Scarab" || type === "Currency") {
    return handleCachedMarketProxy(league, type, env);
  }
  return handleNinjaProxy(league, type);
}

async function handleCurrentLeague(env) {
  if (!env.EV_HISTORY) {
    try {
      const live = await fetchCurrentLeagueData();
      return jsonWithMeta(live, {
        ok: true,
        dataState: "live",
        stale: false,
        source: "live-no-kv",
        ageSeconds: 0,
        lastSuccessAt: new Date().toISOString(),
        cacheKind: "current-league"
      });
    } catch (e) {
      return errorResponse("upstream_unavailable", String(e?.message || e), 503, "current-league");
    }
  }

  const now = Date.now();
  const state = await readCacheState(env.EV_HISTORY, KEY_CURRENT_LEAGUE);
  const hasData = !!state && !!state.data && Number.isFinite(state.lastSuccessAt);
  const ageMs = hasData ? now - state.lastSuccessAt : Infinity;

  if (hasData && ageMs <= POLICY.currentLeague.freshMs) {
    return jsonWithMeta(state.data, buildMetaFromState(state, "live", "current-league"));
  }
  if (hasData && ageMs <= POLICY.currentLeague.maxStaleMs) {
    return jsonWithMeta(state.data, buildMetaFromState(state, "stale", "current-league"));
  }

  try {
    const live = await fetchCurrentLeagueData();
    return jsonWithMeta(live, {
      ok: true,
      dataState: "live",
      stale: false,
      source: "live-pass-through",
      ageSeconds: 0,
      lastSuccessAt: new Date().toISOString(),
      cacheKind: "current-league"
    });
  } catch (e) {
    if (hasData) {
      return errorResponse(
        "stale_expired",
        "Cached data is too old and upstream refresh is failing.",
        503,
        "current-league",
        state
      );
    }
    return errorResponse("upstream_unavailable", String(e?.message || e), 503, "current-league");
  }
}

async function handleCachedMarketProxy(league, type, env) {
  const normalizedLeague = String(league || "").trim();
  const normalizedType = String(type || "").trim().toLowerCase();
  const policy = normalizedLeague.toLowerCase() === "standard" ? POLICY.marketStandard : POLICY.marketCurrent;
  const key = getMarketBundleKey(normalizedLeague);
  const now = Date.now();

  if (!env.EV_HISTORY) {
    try {
      const bundle = await buildMarketBundleForLeague(normalizedLeague, null);
      const selected = selectMarketTypeFromBundle(bundle, normalizedType);
      if (!isValidMarketPayload(selected)) {
        return errorResponse("market_type_unavailable", `No ${type} market data available.`, 503, "market");
      }
      return jsonWithMeta(selected, {
        ok: true,
        dataState: "live",
        stale: false,
        source: "live-no-kv",
        ageSeconds: 0,
        lastSuccessAt: new Date().toISOString(),
        cacheKind: "market",
        currencySource: bundle.currencySource || null
      });
    } catch (e) {
      return errorResponse("upstream_unavailable", String(e?.message || e), 503, "market");
    }
  }

  const state = await readCacheState(env.EV_HISTORY, key);
  const currentSelected = selectMarketTypeFromBundle(state?.data, normalizedType);
  const hasData = Number.isFinite(state?.lastSuccessAt) && isValidMarketPayload(currentSelected);
  const ageMs = hasData ? (now - Number(state.lastSuccessAt)) : Infinity;

  const withMarketMeta = (metaBase, bundle) => ({
    ...metaBase,
    currencySource: bundle?.currencySource || null
  });

  if (hasData && ageMs <= policy.freshMs) {
    return jsonWithMeta(currentSelected, withMarketMeta(buildMetaFromState(state, "live", "market"), state?.data));
  }

  if (hasData && ageMs <= policy.maxStaleMs) {
    return jsonWithMeta(currentSelected, withMarketMeta(buildMetaFromState(state, "stale", "market"), state?.data));
  }

  try {
    const liveBundle = await buildMarketBundleForLeague(normalizedLeague, state?.data || null);
    const liveSelected = selectMarketTypeFromBundle(liveBundle, normalizedType);
    if (!isValidMarketPayload(liveSelected)) {
      return errorResponse("market_type_unavailable", `No ${type} market data available.`, 503, "market");
    }
    return jsonWithMeta(liveSelected, {
      ok: true,
      dataState: "live",
      stale: false,
      source: "live-pass-through",
      ageSeconds: 0,
      lastSuccessAt: new Date().toISOString(),
      cacheKind: "market",
      currencySource: liveBundle.currencySource || null
    });
  } catch (e) {
    if (hasData) {
      return errorResponse(
        "stale_expired",
        "Cached data is too old and upstream refresh is failing.",
        503,
        "market",
        state
      );
    }
    return errorResponse("upstream_unavailable", String(e?.message || e), 503, "market");
  }
}

async function handleCachedResource(env, key, policy, fetcher, cacheKind) {
  if (!env.EV_HISTORY) {
    try {
      const fresh = await fetcher();
      return jsonWithMeta(fresh.data, {
        ok: true,
        dataState: "live",
        stale: false,
        source: "live-no-kv",
        ageSeconds: 0,
        lastSuccessAt: new Date().toISOString(),
        cacheKind
      });
    } catch (e) {
      return errorResponse("upstream_unavailable", String(e?.message || e), 503, cacheKind);
    }
  }

  const now = Date.now();
  const state = await readCacheState(env.EV_HISTORY, key);
  const hasData = !!state && !!state.data && Number.isFinite(state.lastSuccessAt);
  const ageMs = hasData ? now - state.lastSuccessAt : Infinity;

  if (hasData && ageMs <= policy.freshMs) {
    return jsonWithMeta(state.data, buildMetaFromState(state, "live", cacheKind));
  }

  if (hasData && now < (state.nextRetryAt || 0) && ageMs <= policy.maxStaleMs) {
    return jsonWithMeta(state.data, buildMetaFromState(state, "stale", cacheKind));
  }

  const refreshed = await tryRefreshState(env.EV_HISTORY, key, state, fetcher, now);
  if (refreshed.ok && refreshed.state) {
    return jsonWithMeta(refreshed.state.data, buildMetaFromState(refreshed.state, "live", cacheKind));
  }

  const fallbackState = refreshed.state || state;
  const fallbackHasData = !!fallbackState && !!fallbackState.data && Number.isFinite(fallbackState.lastSuccessAt);
  if (fallbackHasData) {
    const fallbackAgeMs = now - fallbackState.lastSuccessAt;
    if (fallbackAgeMs <= policy.maxStaleMs) {
      return jsonWithMeta(fallbackState.data, buildMetaFromState(fallbackState, "stale", cacheKind));
    }
    return errorResponse(
      "stale_expired",
      "Cached data is too old and upstream refresh is failing.",
      503,
      cacheKind,
      fallbackState
    );
  }

  return errorResponse("upstream_unavailable", "No cached data and upstream refresh failed.", 503, cacheKind);
}

async function tryRefreshState(kv, key, existing, fetcher, now) {
  const failCount = Number(existing?.failCount || 0);
  const lastSuccessAt = Number(existing?.lastSuccessAt || 0) || null;
  try {
    const fresh = await fetcher(existing?.data || null);
    const next = {
      data: fresh.data,
      lastSuccessAt: now,
      lastAttemptAt: now,
      failCount: 0,
      nextRetryAt: now
    };
    await kv.put(key, JSON.stringify(next));
    return { ok: true, state: next };
  } catch (_e) {
    const nextFail = failCount + 1;
    const backoffMs = BACKOFF_STEPS_MS[Math.min(nextFail - 1, BACKOFF_STEPS_MS.length - 1)];
    const failed = {
      data: existing?.data || null,
      lastSuccessAt,
      lastAttemptAt: now,
      failCount: nextFail,
      nextRetryAt: now + backoffMs
    };
    await kv.put(key, JSON.stringify(failed));
    return { ok: false, state: failed };
  }
}

function buildMetaFromState(state, dataState, cacheKind) {
  const now = Date.now();
  const lastSuccessAt = Number(state.lastSuccessAt || 0);
  const ageSeconds = Number.isFinite(lastSuccessAt) && lastSuccessAt > 0 ? Math.max(0, Math.floor((now - lastSuccessAt) / 1000)) : null;
  return {
    ok: true,
    dataState,
    stale: dataState === "stale",
    source: "kv-cache",
    cacheKind,
    ageSeconds,
    lastSuccessAt: Number.isFinite(lastSuccessAt) && lastSuccessAt > 0 ? new Date(lastSuccessAt).toISOString() : null
  };
}

async function readCacheState(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_e) {
    return null;
  }
}

async function refreshCurrentLeagueCache(env) {
  if (!env.EV_HISTORY) return;
  const now = Date.now();
  const existing = await readCacheState(env.EV_HISTORY, KEY_CURRENT_LEAGUE);
  await tryRefreshState(env.EV_HISTORY, KEY_CURRENT_LEAGUE, existing, async () => ({ data: await fetchCurrentLeagueData() }), now);
}

async function refreshCurrentLeagueMarketBundle(env) {
  if (!env.EV_HISTORY) return;
  const now = Date.now();
  const leagueData = await getCachedCurrentLeagueValue(env);
  const league = leagueData?.league ? String(leagueData.league) : null;
  if (!league) return;
  const key = getMarketBundleKey(league);
  const existing = await readCacheState(env.EV_HISTORY, key);
  await tryRefreshState(
    env.EV_HISTORY,
    key,
    existing,
    async (previousBundle) => ({ data: await buildMarketBundleForLeague(league, previousBundle) }),
    now
  );
}

async function refreshStandardMarketBundle(env) {
  if (!env.EV_HISTORY) return;
  const now = Date.now();
  const league = "Standard";
  const key = getMarketBundleKey(league);
  const existing = await readCacheState(env.EV_HISTORY, key);
  await tryRefreshState(
    env.EV_HISTORY,
    key,
    existing,
    async (previousBundle) => ({ data: await buildMarketBundleForLeague(league, previousBundle) }),
    now
  );
}

async function getCachedCurrentLeagueValue(env) {
  const cached = await readCacheState(env.EV_HISTORY, KEY_CURRENT_LEAGUE);
  if (cached?.data?.league) return cached.data;
  try {
    const data = await fetchCurrentLeagueData();
    return data;
  } catch (_e) {
    return null;
  }
}

async function fetchCurrentLeagueData() {
  const res = await fetchWithTimeout("https://api.pathofexile.com/leagues?type=main&realm=pc&limit=50", {
    headers: {
      "User-Agent": "ScarabEV/1.1 (contact: doobyy.github.io)",
      Accept: "application/json"
    }
  }, UPSTREAM_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`GGG leagues API ${res.status}`);
  }
  const data = await res.json();
  const leagues = data.result || data;
  const current = Array.isArray(leagues)
    ? leagues.find((l) => l?.category?.current === true && Array.isArray(l.rules) && l.rules.length === 0)
    : null;
  if (!current?.id) {
    throw new Error("Could not determine current league");
  }
  return { league: current.id };
}

async function handleEVHistory(league, env) {
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "ev-history");
  const key = `ev-history-${league.toLowerCase()}`;
  const stored = await env.EV_HISTORY.get(key);
  const history = stored ? JSON.parse(stored) : [];
  return withCors(jsonResponse({ history }));
}

async function handlePriceHistory(league, env) {
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "price-history");
  const key = `price-history-${league.toLowerCase()}`;
  const stored = await env.EV_HISTORY.get(key);
  const prices = stored ? JSON.parse(stored) : {};
  return withCors(jsonResponse({ prices }));
}

async function handleAtlasEVHistory(league, env) {
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "atlas-ev-history");
  const key = `atlas-ev-history-${league.toLowerCase()}`;
  const stored = await env.EV_HISTORY.get(key);
  const history = stored ? JSON.parse(stored) : [];
  return withCors(jsonResponse({ history }));
}

async function resolveSnapshotLeagues() {
  const leagues = new Set(["Standard"]);
  try {
    const pair = await fetchCurrentChallengeLeaguePair();
    if (pair.softcore) leagues.add(pair.softcore);
    if (pair.hardcore) leagues.add(pair.hardcore);
  } catch (_e) {
    // Keep Standard snapshotting even if league lookup has a transient failure.
  }
  return [...leagues];
}

async function snapshotLeagueForDate(env, league, today) {
  try {
    const data = await fetchNinjaExchange(league, "Scarab");
    if (!Array.isArray(data?.lines) || !data.lines.length) return { ok: false, error: "no_scarab_lines" };

    const harmonicEv = calcHarmonicEV(data.lines);
    if (!Number.isFinite(harmonicEv) || harmonicEv <= 0) return { ok: false, error: "harmonic_unavailable" };

    const weights = await fetchObservedWeightsForLeague(league);
    const weightedEv = calcWeightedThresholdEV(data.lines, weights);
    const atlasSnapshot = calcAtlasBaselineOptimizedEV(data.lines, weights);

    const evKey = `ev-history-${league.toLowerCase()}`;
    const evStored = await env.EV_HISTORY.get(evKey);
    const evHistory = evStored ? JSON.parse(evStored) : [];
    const evIdx = evHistory.findIndex((e) => e.date === today);
    const evEntry = {
      date: today,
      ev: Number(harmonicEv.toFixed(4)), // backward compatibility
      harmonicEv: Number(harmonicEv.toFixed(4))
    };
    if (Number.isFinite(weightedEv) && weightedEv > 0) evEntry.weightedEv = Number(weightedEv.toFixed(4));
    if (evIdx >= 0) evHistory[evIdx] = { ...evHistory[evIdx], ...evEntry };
    else evHistory.push(evEntry);

    const evCutoff = new Date();
    evCutoff.setDate(evCutoff.getDate() - 90);
    const evCutoffStr = evCutoff.toISOString().slice(0, 10);
    await env.EV_HISTORY.put(evKey, JSON.stringify(evHistory.filter((e) => e.date >= evCutoffStr)));

    if (atlasSnapshot && atlasSnapshot.baselineEv > 0 && atlasSnapshot.optimizedEv > 0) {
      const atlasKey = `atlas-ev-history-${league.toLowerCase()}`;
      const atlasStored = await env.EV_HISTORY.get(atlasKey);
      const atlasHistory = atlasStored ? JSON.parse(atlasStored) : [];
      const atlasIdx = atlasHistory.findIndex((e) => e.date === today);
      const atlasEntry = {
        date: today,
        baselineEv: Number(atlasSnapshot.baselineEv.toFixed(4)),
        optimizedEv: Number(atlasSnapshot.optimizedEv.toFixed(4))
      };
      if (atlasIdx >= 0) atlasHistory[atlasIdx] = { ...atlasHistory[atlasIdx], ...atlasEntry };
      else atlasHistory.push(atlasEntry);

      const atlasCutoff = new Date();
      atlasCutoff.setDate(atlasCutoff.getDate() - 90);
      const atlasCutoffStr = atlasCutoff.toISOString().slice(0, 10);
      await env.EV_HISTORY.put(atlasKey, JSON.stringify(atlasHistory.filter((e) => e.date >= atlasCutoffStr)));
    }

    const priceKey = `price-history-${league.toLowerCase()}`;
    const priceStored = await env.EV_HISTORY.get(priceKey);
    const priceHistory = priceStored ? JSON.parse(priceStored) : {};
    const priceCutoff = new Date();
    priceCutoff.setDate(priceCutoff.getDate() - 7);
    const priceCutoffStr = priceCutoff.toISOString().slice(0, 10);

    for (const line of data.lines) {
      const name = line.name;
      const price = line.chaosValue ?? line.chaosEquivalent ?? line.primaryValue ?? null;
      if (!name || !price || price <= 0) continue;
      if (!priceHistory[name]) priceHistory[name] = [];
      if (priceHistory[name].some((e) => e.date === today)) continue;
      priceHistory[name].push({ date: today, price: Number(price.toFixed(4)) });
      priceHistory[name] = priceHistory[name].filter((e) => e.date >= priceCutoffStr);
    }
    await env.EV_HISTORY.put(priceKey, JSON.stringify(priceHistory));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || "snapshot_failed") };
  }
}

async function saveSnapshotRetryState(env, date, failures, retryCount) {
  if (!env.EV_HISTORY) return;
  const errors = {};
  for (const f of failures) errors[f.league] = String(f.error || "snapshot_failed");
  if ((Number(retryCount) || 0) >= SNAPSHOT_RETRY_MAX_ATTEMPTS) {
    await env.EV_HISTORY.put(SNAPSHOT_RETRY_KEY, JSON.stringify({
      date,
      status: "failed",
      failedLeagues: failures.map((f) => f.league),
      errors,
      retryCount: Number(retryCount) || 0,
      lastAttemptAt: new Date().toISOString(),
      nextRetryAt: null
    }));
    return;
  }
  await env.EV_HISTORY.put(SNAPSHOT_RETRY_KEY, JSON.stringify({
    date,
    status: "pending",
    pendingLeagues: failures.map((f) => f.league),
    errors,
    retryCount: Number(retryCount) || 0,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: Date.now() + SNAPSHOT_RETRY_DELAY_MS
  }));
}

async function clearSnapshotRetryState(env, date) {
  if (!env.EV_HISTORY) return;
  const raw = await env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    if (!date || String(state?.date || "") === String(date)) {
      await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    }
  } catch (_e) {
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
  }
}

async function runDailyEVSnapshot(env, opts = {}) {
  if (!env.EV_HISTORY) return;
  const today = new Date().toISOString().slice(0, 10);
  const leagues = Array.isArray(opts.leagues) && opts.leagues.length
    ? [...new Set(opts.leagues.map((s) => String(s).trim()).filter(Boolean))]
    : await resolveSnapshotLeagues();
  if (!leagues.length) return;

  const failures = [];
  for (const league of leagues) {
    let success = false;
    let lastError = "snapshot_failed";
    for (let attempt = 1; attempt <= SNAPSHOT_INLINE_ATTEMPTS; attempt++) {
      const result = await snapshotLeagueForDate(env, league, today);
      if (result.ok) {
        success = true;
        break;
      }
      lastError = result.error || "snapshot_failed";
    }
    if (!success) failures.push({ league, error: lastError });
  }

  if (failures.length) {
    await saveSnapshotRetryState(env, today, failures, Number(opts.retryCount) || 0);
  } else {
    await clearSnapshotRetryState(env, today);
  }
}

async function runPendingSnapshotRetry(env) {
  if (!env.EV_HISTORY) return;
  const raw = await env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY);
  if (!raw) return;
  let state = null;
  try {
    state = JSON.parse(raw);
  } catch (_e) {
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (String(state?.date || "") !== today) {
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    return;
  }
  if (String(state?.status || "") === "failed") return;
  const pendingLeagues = Array.isArray(state?.pendingLeagues)
    ? [...new Set(state.pendingLeagues.map((s) => String(s).trim()).filter(Boolean))]
    : [];
  if (!pendingLeagues.length) {
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    return;
  }
  const retryCount = Number(state?.retryCount || 0);
  if (retryCount >= SNAPSHOT_RETRY_MAX_ATTEMPTS) {
    await saveSnapshotRetryState(
      env,
      today,
      pendingLeagues.map((league) => ({ league, error: (state?.errors && state.errors[league]) || "snapshot_failed" })),
      retryCount
    );
    return;
  }
  const nextRetryAt = Number(state?.nextRetryAt || 0);
  if (Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) return;
  await runDailyEVSnapshot(env, {
    leagues: pendingLeagues,
    retryCount: (retryCount + 1)
  });
}

async function fetchCurrentChallengeLeaguePair() {
  const res = await fetchWithTimeout("https://api.pathofexile.com/leagues?type=main&realm=pc&limit=50", {
    headers: {
      "User-Agent": "ScarabEV/1.1 (contact: doobyy.github.io)",
      Accept: "application/json"
    }
  }, UPSTREAM_TIMEOUT_MS);
  if (!res.ok) throw new Error(`GGG leagues API ${res.status}`);
  const data = await res.json();
  const leagues = data.result || data;
  const current = Array.isArray(leagues)
    ? leagues.filter((l) => l?.category?.current === true && Array.isArray(l.rules) && l.rules.length === 0)
    : [];
  const softcore = current.find((l) => !String(l.id || "").toLowerCase().startsWith("hardcore "))?.id || null;
  const hardcore = current.find((l) => String(l.id || "").toLowerCase().startsWith("hardcore "))?.id || null;
  return { softcore, hardcore };
}

function calcHarmonicEV(lines) {
  const prices = lines
    .map((l) => l.chaosValue ?? l.chaosEquivalent ?? l.primaryValue ?? null)
    .filter((p) => p != null && p > 0);
  if (prices.length < 5) return null;
  const sum = prices.reduce((s, p) => s + 1 / p, 0);
  const harmonic = prices.length / sum;
  return Math.floor(harmonic * 100) / 100;
}

async function fetchObservedWeightsForLeague(league) {
  try {
    const url = `${AGGREGATE_API_URL}?league=${encodeURIComponent(league)}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "ScarabEV/1.1 (market-worker weighted snapshot)",
        Accept: "application/json"
      }
    }, UPSTREAM_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    const provided = data?.weights && typeof data.weights === "object" ? data.weights : null;
    if (provided && Object.keys(provided).length > 0) return provided;

    const received = data?.receivedByScarab && typeof data.receivedByScarab === "object"
      ? data.receivedByScarab
      : null;
    if (!received) return null;
    const total = Object.values(received).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if (!Number.isFinite(total) || total <= 0) return null;

    const normalized = {};
    for (const [name, count] of Object.entries(received)) {
      const c = Number(count) || 0;
      if (c > 0) normalized[name] = c / total;
    }
    return Object.keys(normalized).length ? normalized : null;
  } catch (_e) {
    return null;
  }
}

function calcWeightedThresholdEV(lines, weights) {
  if (!weights || typeof weights !== "object") return null;
  const byName = new Map();
  for (const l of lines || []) {
    const name = l?.name;
    const price = l?.chaosValue ?? l?.chaosEquivalent ?? l?.primaryValue ?? null;
    if (!name || !Number.isFinite(Number(price)) || Number(price) <= 0) continue;
    byName.set(name, Number(price));
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [name, wRaw] of Object.entries(weights)) {
    const w = Number(wRaw);
    const price = byName.get(name);
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    weightedSum += w * price;
    totalWeight += w;
  }

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  const outputEv = weightedSum / totalWeight;
  const thresholdEv = outputEv / 3;
  if (!Number.isFinite(thresholdEv) || thresholdEv <= 0) return null;
  return thresholdEv;
}

function calcAtlasBaselineOptimizedEV(lines, weights) {
  if (!weights || typeof weights !== "object") return null;
  const priceByName = new Map();
  for (const line of lines || []) {
    const name = line?.name;
    const price = Number(line?.chaosValue ?? line?.chaosEquivalent ?? line?.primaryValue ?? 0);
    if (!name || !Number.isFinite(price) || price <= 0) continue;
    priceByName.set(name, price);
  }

  const baselineBlocked = new Set();
  const baselineBoosted = new Set();
  const baselineEv = calcAtlasEVFromSets(weights, priceByName, baselineBlocked, baselineBoosted);
  if (!Number.isFinite(baselineEv) || baselineEv <= 0) return null;

  const blocked = new Set();
  const boosted = new Set();
  let currentEv = baselineEv;

  for (let step = 0; step < ATLAS_MAX_OPTIMIZE_STEPS; step++) {
    let bestDelta = 0;
    let bestAction = null;

    for (const group of ATLAS_BLOCKABLE) {
      if (blocked.has(group)) continue;
      const nextBlocked = new Set(blocked);
      nextBlocked.add(group);
      const nextEv = calcAtlasEVFromSets(weights, priceByName, nextBlocked, boosted);
      if (!Number.isFinite(nextEv)) continue;
      const delta = nextEv - currentEv;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestAction = { type: "block", group, nextEv };
      }
    }

    for (const group of ATLAS_BOOSTABLE) {
      if (boosted.has(group)) continue;
      const nextBoosted = new Set(boosted);
      nextBoosted.add(group);
      const nextEv = calcAtlasEVFromSets(weights, priceByName, blocked, nextBoosted);
      if (!Number.isFinite(nextEv)) continue;
      const delta = nextEv - currentEv;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestAction = { type: "boost", group, nextEv };
      }
    }

    if (!bestAction || bestDelta <= 0.0000005) break;
    if (bestAction.type === "block") blocked.add(bestAction.group);
    if (bestAction.type === "boost") boosted.add(bestAction.group);
    currentEv = bestAction.nextEv;
  }

  return {
    baselineEv,
    optimizedEv: currentEv
  };
}

function calcAtlasEVFromSets(weights, priceByName, blockedGroups, boostedGroups) {
  const active = SCARAB_LIST.filter((s) => !blockedGroups.has(s.group));
  if (!active.length) return null;

  let totalW = 0;
  for (const scarab of active) {
    const weight = Number(weights[scarab.name] || 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const mult = boostedGroups.has(scarab.group) ? 2 : 1;
    totalW += weight * mult;
  }
  if (!Number.isFinite(totalW) || totalW <= 0) return null;

  let ev = 0;
  for (const scarab of active) {
    const weight = Number(weights[scarab.name] || 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const mult = boostedGroups.has(scarab.group) ? 2 : 1;
    const w = weight * mult;
    const price = Number(priceByName.get(scarab.name) || 0);
    ev += (w / totalW) * (Number.isFinite(price) && price > 0 ? price : 0);
  }
  return Number.isFinite(ev) && ev > 0 ? ev : null;
}

async function handleNinjaProxy(league, type) {
  try {
    const data = await fetchNinjaExchange(league, type);
    return withCors(jsonResponse(data));
  } catch (e) {
    return errorResponse("upstream_error", String(e?.message || e), 502, "proxy");
  }
}

async function fetchNinjaExchange(league, type) {
  const ninjaUrl = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
  const res = await fetchWithTimeout(ninjaUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      Referer: `https://poe.ninja/poe1/economy/${String(league).toLowerCase()}/${String(type).toLowerCase()}s`,
      Origin: "https://poe.ninja",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    }
  }, UPSTREAM_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`poe.ninja returned ${res.status}`);
  }
  return res.json();
}

function getMarketBundleKey(league) {
  return `${CACHE_PREFIX}:bundle:${String(league || "").toLowerCase()}`;
}

function selectMarketTypeFromBundle(bundle, typeLower) {
  if (!bundle || typeof bundle !== "object") return null;
  if (typeLower === "currency") return bundle.currency || null;
  return bundle.scarab || null;
}

function isValidMarketPayload(payload) {
  return !!(payload && Array.isArray(payload.lines) && payload.lines.length > 0);
}

async function fetchNinjaExchangeWithRetry(league, type, attempts = 2) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastErr = null;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fetchNinjaExchange(league, type);
    } catch (e) {
      lastErr = e;
      if (i >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, i * 300));
    }
  }
  throw lastErr || new Error("upstream_unavailable");
}

async function buildMarketBundleForLeague(league, previousBundle) {
  const prior = (previousBundle && typeof previousBundle === "object") ? previousBundle : {};
  const scarab = await fetchNinjaExchangeWithRetry(league, "Scarab", 3);
  if (!isValidMarketPayload(scarab)) {
    throw new Error("scarab_unavailable");
  }

  let currency = null;
  let currencySource = "live";
  let currencyLastUpdatedAt = new Date().toISOString();
  try {
    const fetchedCurrency = await fetchNinjaExchangeWithRetry(league, "Currency", 2);
    if (isValidMarketPayload(fetchedCurrency)) {
      currency = fetchedCurrency;
    } else {
      throw new Error("currency_invalid");
    }
  } catch (_e) {
    if (isValidMarketPayload(prior.currency)) {
      currency = prior.currency;
      currencySource = "cached";
      currencyLastUpdatedAt = prior.currencyLastUpdatedAt || null;
    } else {
      currency = null;
      currencySource = "missing";
      currencyLastUpdatedAt = null;
    }
  }

  return {
    league: String(league || ""),
    scarab,
    currency,
    currencySource,
    currencyLastUpdatedAt
  };
}

async function fetchWithTimeout(url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || UPSTREAM_TIMEOUT_MS));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("upstream_timeout");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function jsonWithMeta(data, meta) {
  const payload = data && typeof data === "object" ? { ...data, _meta: meta } : { data, _meta: meta };
  return withCors(jsonResponse(payload));
}

function errorResponse(error, message, status, cacheKind, state) {
  const lastSuccessAt = state && Number.isFinite(Number(state.lastSuccessAt || 0)) && Number(state.lastSuccessAt) > 0
    ? new Date(Number(state.lastSuccessAt)).toISOString()
    : null;
  const ageSeconds = lastSuccessAt ? Math.max(0, Math.floor((Date.now() - Date.parse(lastSuccessAt)) / 1000)) : null;
  return withCors(
    jsonResponse(
      {
        ok: false,
        error,
        message,
        dataState: "error",
        stale: false,
        _meta: {
          ok: false,
          error,
          dataState: "error",
          stale: false,
          cacheKind,
          lastSuccessAt,
          ageSeconds
        }
      },
      status
    )
  );
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, User-Agent");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, User-Agent",
    "Cache-Control": "no-store"
  };
}
