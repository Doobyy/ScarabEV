import { SCARAB_LIST, ATLAS_BLOCKABLE, ATLAS_BOOSTABLE } from "../../js/config.js";

const CACHE_PREFIX = "market-cache-v2";
const KEY_CURRENT_LEAGUE = `${CACHE_PREFIX}:current-league`;
const BACKOFF_STEPS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const UPSTREAM_TIMEOUT_MS = 8000;
const DEFAULT_PRODUCTION_AGGREGATE_API_URL = "https://scarabev-api.paperpandastacks.workers.dev/api/aggregate";
const DEFAULT_STAGING_AGGREGATE_API_URL = "https://scarabev-api-staging.paperpandastacks.workers.dev/api/aggregate";
const ATLAS_MAX_OPTIMIZE_STEPS = 24;
const SNAPSHOT_RETRY_KEY = `${CACHE_PREFIX}:snapshot-retry`;
const SNAPSHOT_STATUS_KEY = `${CACHE_PREFIX}:snapshot-status`;
const SNAPSHOT_LAST_SUCCESS_KEY = `${CACHE_PREFIX}:snapshot-last-success`;
const SNAPSHOT_BACKSTOP_KEY = `${CACHE_PREFIX}:snapshot-backstop`;
const SNAPSHOT_INLINE_ATTEMPTS = 3;
const SNAPSHOT_RETRY_DELAY_MS = 15 * 60 * 1000;
const SNAPSHOT_RETRY_MAX_ATTEMPTS = 24;
const REQUIRED_SNAPSHOT_WRITES = ["ev", "atlas", "price"];
const FAILURE_LOG_PREFIX = `${CACHE_PREFIX}:failure-log`;
const FAILURE_LOG_RETENTION_DAYS = 30;
const FAILURE_LOG_MAX_EVENTS_PER_DAY = 500;
const PRICE_HISTORY_GUARD_MIN_DAYS = 5;
const PRICE_HISTORY_GUARD_FLOOR_DAYS = 3;
const BACKUP_SCOPE_PREFIXES = {
  "price-history": "price-history-",
  "price-history-backup": "price-history-backup-",
  "ev-history": "ev-history-",
  "atlas-ev-history": "atlas-ev-history-",
  "snapshot-state": `${CACHE_PREFIX}:snapshot-`,
  "failure-logs": `${FAILURE_LOG_PREFIX}:`
};
const BACKUP_SCOPE_LIST = Object.keys(BACKUP_SCOPE_PREFIXES);
const BACKUP_EXPORT_MAX_KEYS = 1200;
const BACKUP_SMOKE_STATUS_KEY = `${CACHE_PREFIX}:backup-smoke-status`;
const BACKUP_SMOKE_TEMP_PREFIX = `${CACHE_PREFIX}:backup-smoke-temp`;
const PRICE_HISTORY_BACKFILL_FALLBACK_KEY = `${CACHE_PREFIX}:price-history-backfill-fallback`;
const PRICE_HISTORY_BACKFILL_FALLBACK_MAX_MS = 6 * 60 * 60 * 1000;
const WEIGHTED_HISTORY_GAP_WINDOW_DAYS = 7;
const BULK_NAME_MAP_KEY = `${CACHE_PREFIX}:bulk-name-map`;
const BULK_MISMATCH_LOG_KEY = `${CACHE_PREFIX}:bulk-mismatch-log`;
const BULK_MISMATCH_LOG_MAX = 500;
const SNAPSHOT_KICKOFF_HOUR_UTC = 18;
const SNAPSHOT_KICKOFF_MINUTE_UTC = 0;
const SNAPSHOT_BACKSTOP_GRACE_MS = 15 * 60 * 1000;
const INCIDENT_STATE_PREFIX = `${CACHE_PREFIX}:incident-state`;
const runtimeIncidentRepeatCounts = new Map();

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
    let runtime;
    try {
      runtime = resolveRuntimeConfig(env);
    } catch (error) {
      console.error("market-worker runtime config error", String(error?.message || error || "unknown_error"));
      return;
    }
    if (!runtime.cron.enabled) {
      console.log("market-worker cron disabled by runtime config");
      return;
    }
    const cron = String(event.cron || "");
    const now = new Date(event?.scheduledTime || Date.now());
    const utcMinute = now.getUTCMinutes();
    if (cron === "0 18 * * *") {
      if (!runtime.cron.dailySnapshotEnabled) {
        console.log("market-worker daily snapshot cron disabled by runtime config");
        return;
      }
      ctx.waitUntil(pruneFailureLogs(env, now));
      ctx.waitUntil(runDailyEVSnapshot(env));
      return;
    }
    if (cron === "*/5 * * * *") {
      if (!runtime.cron.marketRefreshEnabled) {
        console.log("market-worker market refresh cron disabled by runtime config");
        return;
      }
      ctx.waitUntil(refreshCurrentLeagueMarketBundle(env));
      if (utcMinute === 5) ctx.waitUntil(refreshStandardMarketBundle(env));
      if (utcMinute === 10) ctx.waitUntil(refreshCurrentLeagueCache(env));
      ctx.waitUntil(runPendingSnapshotRetry(env));
      ctx.waitUntil(runSnapshotKickoffBackstop(env, now));
      return;
    }
  }
};

async function handleRequest(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const league = (url.searchParams.get("league") || "Mirage").trim();
  const type = (url.searchParams.get("type") || "Scarab").trim();
  let runtime;
  try {
    runtime = resolveRuntimeConfig(env);
  } catch (error) {
    return withCors(jsonResponse({
      ok: false,
      error: "environment_guard_violation",
      errorDetail: String(error?.message || error || "runtime_config_invalid")
    }, 500));
  }

  if (type === "RuntimeConfig") return handleRuntimeConfig(runtime, env);

  if (type === "EVHistory") return handleEVHistory(league, env);
  if (type === "PriceHistory") return handlePriceHistory(league, env);
  if (type === "AtlasEVHistory") return handleAtlasEVHistory(league, env);
  if (type === "SnapshotStatus") return handleSnapshotStatus(env);
  if (type === "FailureLogs") return handleFailureLogs(request, url, env);
  if (type === "ManualRetry") return handleManualRetry(request, url, env, ctx);
  if (type === "BackupExport") return handleBackupExport(request, url, env);
  if (type === "BackupImport") return handleBackupImport(request, env);
  if (type === "BackupSmokeStatus") return handleBackupSmokeStatus(request, env);
  if (type === "BackupSmokeTest") return handleBackupSmokeTest(request, env);
  if (type === "BulkNameMap") return handleBulkNameMap(request, env);
  if (type === "BulkMismatchLog") return handleBulkMismatchLog(request, env);
  if (type === "CurrentLeague") return handleCurrentLeague(env);

  if (type === "Scarab" || type === "Currency") {
    return handleCachedMarketProxy(league, type, env);
  }
  return handleNinjaProxy(league, type);
}

function parseEnvBool(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return !!fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return !!fallback;
}

function resolveRuntimeConfig(env) {
  const appEnvRaw = String(env?.APP_ENV || "production").trim().toLowerCase();
  const appEnv = (appEnvRaw === "staging" || appEnvRaw === "dev") ? "staging" : "production";
  const aggregateApiUrl = String(env?.AGGREGATE_API_URL || (appEnv === "production" ? DEFAULT_PRODUCTION_AGGREGATE_API_URL : DEFAULT_STAGING_AGGREGATE_API_URL)).trim();
  const stagingCronEnabled = parseEnvBool(env?.STAGING_CRON_ENABLED, false);
  const cronEnabled = appEnv === "staging" ? stagingCronEnabled : true;
  const marketRefreshEnabled = parseEnvBool(env?.MARKET_REFRESH_CRON_ENABLED, cronEnabled);
  const dailySnapshotEnabled = parseEnvBool(env?.DAILY_SNAPSHOT_CRON_ENABLED, cronEnabled);
  const lowerAggregateUrl = aggregateApiUrl.toLowerCase();
  if (appEnv === "production" && lowerAggregateUrl.includes("staging")) {
    throw new Error(`AGGREGATE_API_URL points to staging in production (${aggregateApiUrl})`);
  }
  if (
    appEnv === "staging"
    && (
      lowerAggregateUrl.includes("production")
      || lowerAggregateUrl.includes("scarabev-api.paperpandastacks.workers.dev")
    )
  ) {
    throw new Error(`AGGREGATE_API_URL points to production in staging (${aggregateApiUrl})`);
  }
  return {
    appEnv,
    aggregateApiUrl,
    cron: {
      enabled: cronEnabled,
      marketRefreshEnabled,
      dailySnapshotEnabled
    }
  };
}

function handleRuntimeConfig(runtime, env) {
  return withCors(jsonResponse({
    ok: true,
    appEnv: runtime.appEnv,
    aggregateApiUrl: runtime.aggregateApiUrl,
    serviceBindingPresent: !!(env?.SCARABEV_API && typeof env.SCARABEV_API.fetch === "function"),
    kvBindingPresent: !!env?.EV_HISTORY,
    cron: {
      enabled: !!runtime.cron.enabled,
      marketRefreshEnabled: !!runtime.cron.marketRefreshEnabled,
      dailySnapshotEnabled: !!runtime.cron.dailySnapshotEnabled
    }
  }));
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
    if (now < Number(state?.nextRetryAt || 0)) {
      return jsonWithMeta(state.data, buildMetaFromState(state, "stale", "current-league"));
    }
    const refreshed = await tryRefreshState(
      env.EV_HISTORY,
      KEY_CURRENT_LEAGUE,
      state,
      async () => ({ data: await fetchCurrentLeagueData() }),
      now
    );
    if (refreshed.ok && refreshed.state?.data) {
      return jsonWithMeta(refreshed.state.data, buildMetaFromState(refreshed.state, "live", "current-league"));
    }
    const fallbackState = refreshed.state || state;
    const fallbackHasData = !!fallbackState?.data && Number.isFinite(fallbackState?.lastSuccessAt);
    if (fallbackHasData) {
      const fallbackAgeMs = now - Number(fallbackState.lastSuccessAt);
      if (fallbackAgeMs <= POLICY.currentLeague.maxStaleMs) {
        return jsonWithMeta(fallbackState.data, buildMetaFromState(fallbackState, "stale", "current-league"));
      }
    }
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
    if (now < Number(state?.nextRetryAt || 0)) {
      return jsonWithMeta(currentSelected, withMarketMeta(buildMetaFromState(state, "stale", "market"), state?.data));
    }
    const refreshed = await tryRefreshState(
      env.EV_HISTORY,
      key,
      state,
      async (previousBundle) => {
        const nextBundle = await buildMarketBundleForLeague(normalizedLeague, previousBundle || state?.data || null);
        const nextSelected = selectMarketTypeFromBundle(nextBundle, normalizedType);
        if (!isValidMarketPayload(nextSelected)) {
          throw new Error("market_type_unavailable");
        }
        return { data: nextBundle };
      },
      now
    );
    if (refreshed.ok && refreshed.state) {
      const refreshedSelected = selectMarketTypeFromBundle(refreshed.state.data, normalizedType);
      if (isValidMarketPayload(refreshedSelected)) {
        return jsonWithMeta(
          refreshedSelected,
          withMarketMeta(buildMetaFromState(refreshed.state, "live", "market"), refreshed.state.data)
        );
      }
    }
    const fallbackState = refreshed.state || state;
    const fallbackSelected = selectMarketTypeFromBundle(fallbackState?.data, normalizedType);
    const fallbackHasData = Number.isFinite(fallbackState?.lastSuccessAt) && isValidMarketPayload(fallbackSelected);
    if (fallbackHasData) {
      const fallbackAgeMs = now - Number(fallbackState.lastSuccessAt);
      if (fallbackAgeMs <= policy.maxStaleMs) {
        return jsonWithMeta(
          fallbackSelected,
          withMarketMeta(buildMetaFromState(fallbackState, "stale", "market"), fallbackState.data)
        );
      }
    }
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
  const existingFailureStartedAt = Number(existing?.failureStartedAt || 0);
  const incidentEnv = { EV_HISTORY: kv };
  try {
    const fresh = await fetcher(existing?.data || null);
    const next = {
      data: fresh.data,
      lastSuccessAt: now,
      lastAttemptAt: now,
      failCount: 0,
      nextRetryAt: now,
      failureStartedAt: null
    };
    await kv.put(key, JSON.stringify(next));
    await markIncidentRecovered(incidentEnv, "cache_refresh", {
      message: "Market cache refresh recovered.",
      subsystem: "cache-refresh",
      identifiers: { cacheKey: key },
      nowMs: now,
      attempts: failCount,
      attemptsSource: "authoritative",
      retryIntervalMs: (() => {
        const nextRetryAt = Number(existing?.nextRetryAt || 0);
        const lastAttemptAt = Number(existing?.lastAttemptAt || 0);
        const interval = nextRetryAt - lastAttemptAt;
        return Number.isFinite(interval) && interval > 0 ? interval : null;
      })(),
      retryCadenceLabel: "dynamic-backoff",
      finalStep: "refresh_fetch_success"
    });
    return { ok: true, state: next };
  } catch (e) {
    const nextFail = failCount + 1;
    const backoffMs = BACKOFF_STEPS_MS[Math.min(nextFail - 1, BACKOFF_STEPS_MS.length - 1)];
    const failureStartedAt = failCount > 0 && Number.isFinite(existingFailureStartedAt) && existingFailureStartedAt > 0
      ? existingFailureStartedAt
      : now;
    const failed = {
      data: existing?.data || null,
      lastSuccessAt,
      lastAttemptAt: now,
      failCount: nextFail,
      nextRetryAt: now + backoffMs,
      failureStartedAt
    };
    await kv.put(key, JSON.stringify(failed));
    await markIncidentFailed(incidentEnv, "cache_refresh", {
      message: "Market cache refresh failed.",
      subsystem: "cache-refresh",
      identifiers: { cacheKey: key },
      rootError: String(e?.message || e || "cache_refresh_failed"),
      nowMs: now,
      status: "retrying"
    });
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

async function handleSnapshotStatus(env) {
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "snapshot-status");
  const today = new Date().toISOString().slice(0, 10);
  const [rawStatus, rawRetry, rawLastSuccess] = await Promise.all([
    env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY),
    env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY),
    env.EV_HISTORY.get(SNAPSHOT_LAST_SUCCESS_KEY)
  ]);
  const status = parseJsonObject(rawStatus);
  const retry = parseJsonObject(rawRetry);
  const lastSuccess = parseJsonObject(rawLastSuccess);
  const sameDayStatus = String(status?.date || "") === today ? status : null;
  const sameDayRetry = String(retry?.date || "") === today ? retry : null;
  const sameDaySummary = buildSnapshotHealthSummary(sameDayStatus, sameDayRetry, today);
  const lastKnown = normalizeSnapshotSummary(lastSuccess);

  return withCors(jsonResponse({
    ok: true,
    date: sameDaySummary.date,
    status: sameDaySummary.status,
    targetLeagues: sameDaySummary.targetLeagues,
    completedLeagues: sameDaySummary.completedLeagues,
    pendingLeagues: sameDaySummary.pendingLeagues,
    failedLeagues: sameDaySummary.failedLeagues,
    incompleteLeagues: sameDaySummary.incompleteLeagues,
    retryCount: sameDaySummary.retryCount,
    nextRetryAt: sameDaySummary.nextRetryAt,
    lastAttemptAt: sameDaySummary.lastAttemptAt,
    errors: sameDayRetry?.errors || {},
    leagues: sameDaySummary.leagues,
    lastKnown
  }));
}

function requireAdminOpsToken(request, env) {
  const expected = String(env?.MANUAL_RETRY_TOKEN || "").trim();
  if (!expected) {
    return errorResponse("admin_ops_not_configured", "Admin ops token is not configured.", 503, "admin-ops-auth");
  }
  const provided = String(
    request?.headers?.get("x-admin-token")
    || request?.headers?.get("x-manual-retry-token")
    || ""
  ).trim();
  if (!provided || provided !== expected) {
    return errorResponse("admin_ops_forbidden", "Admin ops token is invalid.", 403, "admin-ops-auth");
  }
  return null;
}

async function handleFailureLogs(request, url, env) {
  const authFailure = requireAdminOpsToken(request, env);
  if (authFailure) return authFailure;
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "failure-logs");
  const daysRaw = Number(url.searchParams.get("days") || FAILURE_LOG_RETENTION_DAYS);
  const days = Math.max(1, Math.min(FAILURE_LOG_RETENTION_DAYS, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : FAILURE_LOG_RETENTION_DAYS));
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const keys = dates.map((date) => `${FAILURE_LOG_PREFIX}:${date}`);
  const raws = await Promise.all(keys.map((key) => env.EV_HISTORY.get(key)));
  const events = [];
  for (let i = 0; i < raws.length; i++) {
    const date = dates[i];
    const parsed = parseJsonObject(raws[i]);
    const list = Array.isArray(parsed?.events) ? parsed.events : [];
    for (const event of list) {
      events.push({
        date,
        at: event?.at || null,
        source: event?.source || "market-worker",
        code: event?.code || "unknown_error",
        message: event?.message || "",
        severity: event?.severity || "error",
        context: event?.context && typeof event.context === "object" ? event.context : {}
      });
    }
  }
  events.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return withCors(jsonResponse({ ok: true, days, count: events.length, events }));
}

async function handleManualRetry(request, url, env, ctx) {
  const authFailure = requireAdminOpsToken(request, env);
  if (authFailure) return authFailure;
  const action = String(url.searchParams.get("action") || "").trim().toLowerCase();
  if (!action) return errorResponse("invalid_action", "Missing manual retry action.", 400, "manual-retry");
  const startedAt = Date.now();
  try {
    if (action === "snapshot-retry") {
      const runSnapshotRetry = async () => {
        const pending = await getPendingSnapshotRetryState(env);
        if (pending.leagues.length) {
          await runDailyEVSnapshot(env, {
            leagues: pending.leagues,
            retryCount: pending.retryCount + 1
          });
          return;
        }
        const incomplete = await getIncompleteSnapshotLeaguesForToday(env);
        if (incomplete.length) {
          await runDailyEVSnapshot(env, { leagues: incomplete, retryCount: 0 });
        }
      };
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil((async () => {
          try {
            await runSnapshotRetry();
          } catch (error) {
            await logFailureEvent(env, "manual_retry_failed", "Manual retry action failed.", {
              action,
              error: String(error?.message || error || "manual_retry_failed")
            });
          }
        })());
        return withCors(jsonResponse({
          ok: true,
          action,
          accepted: true,
          queued: true,
          elapsedMs: Math.max(0, Date.now() - startedAt)
        }));
      }
      await runSnapshotRetry();
    } else if (action === "snapshot-run") {
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil((async () => {
          try {
            await runDailyEVSnapshot(env);
          } catch (error) {
            await logFailureEvent(env, "manual_retry_failed", "Manual retry action failed.", {
              action,
              error: String(error?.message || error || "manual_retry_failed")
            });
          }
        })());
        return withCors(jsonResponse({
          ok: true,
          action,
          accepted: true,
          queued: true,
          elapsedMs: Math.max(0, Date.now() - startedAt)
        }));
      }
      await runDailyEVSnapshot(env);
    } else if (action === "cache-current-league") {
      await refreshCurrentLeagueCache(env);
    } else if (action === "cache-current-market") {
      await refreshCurrentLeagueMarketBundle(env);
    } else if (action === "cache-standard-market") {
      await refreshStandardMarketBundle(env);
    } else if (action === "cache-all") {
      await Promise.all([
        refreshCurrentLeagueCache(env),
        refreshCurrentLeagueMarketBundle(env),
        refreshStandardMarketBundle(env)
      ]);
    } else if (action === "clear-failure-logs") {
      await clearFailureLogs(env);
    } else if (action === "price-history-backfill-enable-once") {
      if (!env?.EV_HISTORY) throw new Error("kv_not_configured");
      const enabledAt = Date.now();
      const expiresAt = enabledAt + PRICE_HISTORY_BACKFILL_FALLBACK_MAX_MS;
      await env.EV_HISTORY.put(PRICE_HISTORY_BACKFILL_FALLBACK_KEY, JSON.stringify({
        enabled: true,
        enabledAt,
        expiresAt,
        mode: "once-window"
      }));
      await logFailureEvent(env, "price_history_backfill_fallback_enabled", "Emergency price-history sparkline backfill fallback enabled.", {
        enabledAt: new Date(enabledAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString()
      }, {
        severity: "warn"
      });
    } else if (action === "price-history-backfill-disable") {
      if (!env?.EV_HISTORY) throw new Error("kv_not_configured");
      await env.EV_HISTORY.delete(PRICE_HISTORY_BACKFILL_FALLBACK_KEY);
      await logFailureEvent(env, "price_history_backfill_fallback_disabled", "Emergency price-history sparkline backfill fallback disabled.", {
        disabledAt: new Date().toISOString()
      }, {
        severity: "warn"
      });
      await markIncidentRecovered(env, "price_history_backfill_degraded", {
        message: "Price-history fallback mode recovered.",
        subsystem: "price-history",
        identifiers: { scope: "global" },
        finalStep: "fallback_disabled"
      });
    } else if (action === "ev-history-backfill-weighted") {
      const requestedLeague = String(url.searchParams.get("league") || "Standard").trim() || "Standard";
      const backfillResult = await backfillStoredWeightedEvHistoryForLeague(env, requestedLeague);
      return withCors(jsonResponse({
        ok: true,
        action,
        league: requestedLeague,
        backfillResult,
        elapsedMs: Math.max(0, Date.now() - startedAt)
      }));
    } else {
      return errorResponse("invalid_action", `Unsupported action: ${action}`, 400, "manual-retry");
    }
    return withCors(jsonResponse({
      ok: true,
      action,
      elapsedMs: Math.max(0, Date.now() - startedAt)
    }));
  } catch (error) {
    await logFailureEvent(env, "manual_retry_failed", "Manual retry action failed.", {
      action,
      error: String(error?.message || error || "manual_retry_failed")
    });
    return errorResponse("manual_retry_failed", String(error?.message || error || "manual_retry_failed"), 500, "manual-retry");
  }
}

function parseBackupScopes(raw) {
  if (!raw || typeof raw !== "string") {
    return [...BACKUP_SCOPE_LIST];
  }
  const parsed = raw
    .split(",")
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(parsed.filter((scope) => BACKUP_SCOPE_LIST.includes(scope)))];
  return unique.length ? unique : [...BACKUP_SCOPE_LIST];
}

function getBackupScopeForKey(key) {
  const normalized = String(key || "");
  for (const scope of BACKUP_SCOPE_LIST) {
    const prefix = BACKUP_SCOPE_PREFIXES[scope];
    if (normalized.startsWith(prefix)) return scope;
  }
  return null;
}

function normalizeBulkNameMap(mapRaw) {
  const out = {};
  if (!mapRaw || typeof mapRaw !== "object" || Array.isArray(mapRaw)) return out;
  for (const [rawKey, rawValue] of Object.entries(mapRaw)) {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key) continue;
    const value = String(rawValue || "").trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

async function handleBulkNameMap(request, env) {
  if (!env?.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "bulk-name-map");

  if (request.method === "GET") {
    try {
      const raw = await env.EV_HISTORY.get(BULK_NAME_MAP_KEY);
      if (!raw) {
        return withCors(jsonResponse({
          ok: true,
          map: {},
          updatedAt: null,
          source: "empty"
        }));
      }
      const parsed = JSON.parse(raw);
      const map = normalizeBulkNameMap(parsed?.map || {});
      const updatedAt = parsed?.updatedAt ? String(parsed.updatedAt) : null;
      return withCors(jsonResponse({
        ok: true,
        map,
        updatedAt,
        source: "kv"
      }));
    } catch (_error) {
      return withCors(jsonResponse({
        ok: true,
        map: {},
        updatedAt: null,
        source: "invalid"
      }));
    }
  }

  if (request.method === "POST") {
    const authFailure = requireAdminOpsToken(request, env);
    if (authFailure) return authFailure;
    let mapInput = {};
    try {
      const payload = await request.json();
      mapInput = payload && typeof payload === "object" ? payload.map : {};
    } catch (_error) {
      return errorResponse("invalid_body", "Invalid bulk name map payload.", 400, "bulk-name-map");
    }
    const normalized = normalizeBulkNameMap(mapInput);
    const record = {
      updatedAt: new Date().toISOString(),
      map: normalized
    };
    await env.EV_HISTORY.put(BULK_NAME_MAP_KEY, JSON.stringify(record));
    return withCors(jsonResponse({
      ok: true,
      map: normalized,
      updatedAt: record.updatedAt
    }));
  }

  return errorResponse("method_not_allowed", "Unsupported method.", 405, "bulk-name-map");
}

async function handleBulkMismatchLog(request, env) {
  if (!env?.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "bulk-mismatch-log");

  const readRows = async () => {
    try {
      const raw = await env.EV_HISTORY.get(BULK_MISMATCH_LOG_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const normalizeRow = (row) => {
    const rawName = String(row?.rawName || "");
    const source = String(row?.source || "unknown").trim().slice(0, 40);
    const qtyNum = Number(row?.qty);
    return {
      rawName: rawName.slice(0, 160),
      qty: Number.isFinite(qtyNum) ? Math.max(0, Math.min(1_000_000, Math.floor(qtyNum))) : null,
      source: source || "unknown",
      timestamp: row?.timestamp ? String(row.timestamp) : new Date().toISOString()
    };
  };

  if (request.method === "POST") {
    let payload = {};
    try {
      payload = await request.json();
    } catch (_error) {
      return errorResponse("invalid_body", "Invalid mismatch payload.", 400, "bulk-mismatch-log");
    }
    const incoming = Array.isArray(payload?.rows) ? payload.rows : [payload];
    const normalizedRows = incoming
      .map((entry) => normalizeRow(entry))
      .filter((row) => String(row.rawName || "").trim().length > 0);
    if (!normalizedRows.length) {
      return errorResponse("invalid_payload", "Missing rawName.", 400, "bulk-mismatch-log");
    }
    const rows = await readRows();
    const seen = new Set(rows.map((entry) => String(entry?.rawName || "")));
    let added = 0;
    for (const row of normalizedRows) {
      const key = String(row.rawName || "");
      if (seen.has(key)) continue;
      rows.push(row);
      seen.add(key);
      added += 1;
    }
    if (added <= 0) {
      return withCors(jsonResponse({ ok: true, count: Math.min(rows.length, BULK_MISMATCH_LOG_MAX), added: 0 }));
    }
    const trimmed = rows.slice(-BULK_MISMATCH_LOG_MAX);
    await env.EV_HISTORY.put(BULK_MISMATCH_LOG_KEY, JSON.stringify(trimmed));
    return withCors(jsonResponse({ ok: true, count: trimmed.length, added }));
  }

  if (request.method === "GET") {
    const authFailure = requireAdminOpsToken(request, env);
    if (authFailure) return authFailure;
    const rows = await readRows();
    const latest = rows.map(normalizeRow).slice(-200).reverse();
    return withCors(jsonResponse({
      ok: true,
      count: latest.length,
      rows: latest
    }));
  }

  if (request.method === "DELETE") {
    const authFailure = requireAdminOpsToken(request, env);
    if (authFailure) return authFailure;
    await env.EV_HISTORY.delete(BULK_MISMATCH_LOG_KEY);
    return withCors(jsonResponse({ ok: true, count: 0 }));
  }

  return errorResponse("method_not_allowed", "Unsupported method.", 405, "bulk-mismatch-log");
}

async function listKeysForPrefix(env, prefix, cap) {
  const keys = [];
  let cursor = undefined;
  const limit = Math.max(10, Math.min(1000, cap));
  while (keys.length < cap) {
    const page = await env.EV_HISTORY.list({ prefix, cursor, limit });
    for (const item of page.keys || []) {
      const name = String(item?.name || "");
      if (!name) continue;
      keys.push(name);
      if (keys.length >= cap) break;
    }
    if (!page.list_complete && page.cursor) {
      cursor = page.cursor;
      continue;
    }
    break;
  }
  return keys;
}

async function collectScopedBackupKeys(env, scopes, maxKeysRaw) {
  const maxKeys = Math.max(1, Math.min(BACKUP_EXPORT_MAX_KEYS, Number(maxKeysRaw) || BACKUP_EXPORT_MAX_KEYS));
  const result = {};
  let total = 0;
  for (const scope of scopes) {
    const prefix = BACKUP_SCOPE_PREFIXES[scope];
    const remaining = Math.max(0, maxKeys - total);
    if (!prefix || remaining <= 0) {
      result[scope] = [];
      continue;
    }
    const keys = await listKeysForPrefix(env, prefix, remaining);
    result[scope] = keys;
    total += keys.length;
  }
  return {
    keysByScope: result,
    totalKeys: total,
    capped: total >= maxKeys
  };
}

async function readKeyValuesBatched(kv, keys, concurrency = 24) {
  const list = Array.isArray(keys) ? keys.map((key) => String(key || "").trim()).filter(Boolean) : [];
  const batchSize = Math.max(1, Math.min(64, Number(concurrency) || 24));
  const out = {};
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const pairs = await Promise.all(batch.map(async (key) => {
      const raw = await kv.get(key);
      return [key, raw];
    }));
    for (const [key, raw] of pairs) {
      if (typeof raw === "string") out[key] = raw;
    }
  }
  return out;
}

function buildBackupCoverage(keysByScope, generatedAt, capped, maxKeys) {
  const scopes = BACKUP_SCOPE_LIST.map((scope) => {
    const keys = Array.isArray(keysByScope?.[scope]) ? keysByScope[scope] : [];
    return {
      scope,
      keyCount: keys.length,
      sampleKeys: keys.slice(0, 5)
    };
  });
  const totalKeys = scopes.reduce((sum, entry) => sum + (Number(entry.keyCount) || 0), 0);
  return {
    generatedAt,
    totalKeys,
    capped: !!capped,
    maxKeys: Math.max(1, Number(maxKeys) || BACKUP_EXPORT_MAX_KEYS),
    scopes
  };
}

async function handleBackupExport(request, url, env) {
  const authFailure = requireAdminOpsToken(request, env);
  if (authFailure) return authFailure;
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "backup-export");

  const mode = String(url.searchParams.get("mode") || "summary").trim().toLowerCase();
  if (mode !== "summary" && mode !== "full") {
    return errorResponse("invalid_mode", "Backup export mode must be summary or full.", 400, "backup-export");
  }
  const scopes = parseBackupScopes(url.searchParams.get("scopes"));
  const maxKeys = Math.max(1, Math.min(BACKUP_EXPORT_MAX_KEYS, Number(url.searchParams.get("maxKeys")) || BACKUP_EXPORT_MAX_KEYS));
  const generatedAt = new Date().toISOString();
  const keyResult = await collectScopedBackupKeys(env, scopes, maxKeys);
  const coverage = buildBackupCoverage(keyResult.keysByScope, generatedAt, keyResult.capped, maxKeys);
  if (mode === "summary") {
    return withCors(jsonResponse({
      ok: true,
      mode,
      scopes,
      coverage
    }));
  }

  const dataByKey = {};
  for (const scope of scopes) {
    const keys = Array.isArray(keyResult.keysByScope?.[scope]) ? keyResult.keysByScope[scope] : [];
    const scopedValues = await readKeyValuesBatched(env.EV_HISTORY, keys, 24);
    Object.assign(dataByKey, scopedValues);
  }
  return withCors(jsonResponse({
    ok: true,
    mode,
    scopes,
    coverage,
    dataByKey
  }));
}

async function handleBackupImport(request, env) {
  const authFailure = requireAdminOpsToken(request, env);
  if (authFailure) return authFailure;
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "backup-import");
  if (request.method !== "POST") {
    return errorResponse("method_not_allowed", "Backup import requires POST.", 405, "backup-import");
  }

  let body = null;
  try {
    body = await request.json();
  } catch (_e) {
    return errorResponse("invalid_body", "Backup import body must be valid JSON.", 400, "backup-import");
  }
  const scopes = Array.isArray(body?.scopes)
    ? [...new Set(body.scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter((scope) => BACKUP_SCOPE_LIST.includes(scope)))]
    : [...BACKUP_SCOPE_LIST];
  const dryRun = !!body?.dryRun;
  const dataByKey = body?.dataByKey && typeof body.dataByKey === "object" ? body.dataByKey : null;
  if (!dataByKey || !Object.keys(dataByKey).length) {
    return errorResponse("missing_data", "Backup import payload requires dataByKey entries.", 400, "backup-import");
  }

  let restoredKeys = 0;
  let skippedKeys = 0;
  for (const [keyRaw, valueRaw] of Object.entries(dataByKey)) {
    const key = String(keyRaw || "").trim();
    const scope = getBackupScopeForKey(key);
    if (!key || !scope || !scopes.includes(scope)) {
      skippedKeys += 1;
      continue;
    }
    const value = typeof valueRaw === "string" ? valueRaw : JSON.stringify(valueRaw);
    if (!dryRun) {
      await env.EV_HISTORY.put(key, value);
    }
    restoredKeys += 1;
  }
  return withCors(jsonResponse({
    ok: true,
    dryRun,
    scopes,
    restoredKeys,
    skippedKeys
  }));
}

async function readSmokeSource(env) {
  const candidates = [SNAPSHOT_STATUS_KEY, SNAPSHOT_RETRY_KEY];
  for (const key of candidates) {
    const raw = await env.EV_HISTORY.get(key);
    if (typeof raw === "string" && raw.length > 0) {
      return { key, raw };
    }
  }
  const listed = await env.EV_HISTORY.list({
    prefix: BACKUP_SCOPE_PREFIXES["snapshot-state"],
    limit: 10
  });
  const keys = Array.isArray(listed?.keys) ? listed.keys.map((entry) => String(entry?.name || "")).filter(Boolean) : [];
  for (const key of keys) {
    const raw = await env.EV_HISTORY.get(key);
    if (typeof raw === "string" && raw.length > 0) {
      return { key, raw };
    }
  }
  throw new Error("snapshot_state_source_missing");
}

async function handleBackupSmokeStatus(request, env) {
  const authFailure = requireAdminOpsToken(request, env);
  if (authFailure) return authFailure;
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "backup-smoke-status");
  const raw = await env.EV_HISTORY.get(BACKUP_SMOKE_STATUS_KEY);
  const status = parseJsonObject(raw);
  return withCors(jsonResponse({
    ok: true,
    status: status || null
  }));
}

async function handleBackupSmokeTest(request, env) {
  const authFailure = requireAdminOpsToken(request, env);
  if (authFailure) return authFailure;
  if (!env.EV_HISTORY) return errorResponse("kv_not_configured", "KV not configured", 500, "backup-smoke-test");
  const startedAt = Date.now();
  const testedAt = new Date(startedAt).toISOString();
  let tempKey = "";
  try {
    const source = await readSmokeSource(env);
    tempKey = `${BACKUP_SMOKE_TEMP_PREFIX}:${startedAt}`;
    await env.EV_HISTORY.put(tempKey, source.raw);
    const readback = await env.EV_HISTORY.get(tempKey);
    const readbackOk = typeof readback === "string" && readback === source.raw;
    await env.EV_HISTORY.delete(tempKey);
    const status = {
      ok: !!readbackOk,
      testedAt,
      sourceKey: source.key,
      bytes: source.raw.length,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      error: readbackOk ? null : "smoke_readback_mismatch"
    };
    await env.EV_HISTORY.put(BACKUP_SMOKE_STATUS_KEY, JSON.stringify(status));
    if (!readbackOk) {
      await markIncidentFailed(env, "backup_smoke", {
        message: "Backup smoke restore readback mismatch.",
        subsystem: "backup-smoke",
        identifiers: { scope: "global" },
        rootError: "smoke_readback_mismatch",
        status: "degraded",
        nowMs: startedAt,
        severity: "warn"
      });
      return withCors(jsonResponse({
        ok: false,
        status
      }, 500));
    }
    await markIncidentRecovered(env, "backup_smoke", {
      message: "Backup smoke restore test recovered.",
      subsystem: "backup-smoke",
      identifiers: { scope: "global" },
      nowMs: startedAt,
      finalStep: "smoke_readback_success"
    });
    return withCors(jsonResponse({
      ok: true,
      status
    }));
  } catch (error) {
    if (tempKey) {
      try { await env.EV_HISTORY.delete(tempKey); } catch (_e) {}
    }
    const status = {
      ok: false,
      testedAt,
      sourceKey: null,
      bytes: 0,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      error: String(error?.message || error || "backup_smoke_failed")
    };
    await env.EV_HISTORY.put(BACKUP_SMOKE_STATUS_KEY, JSON.stringify(status));
    await markIncidentFailed(env, "backup_smoke", {
      message: "Backup smoke restore test failed.",
      subsystem: "backup-smoke",
      identifiers: { scope: "global" },
      rootError: status.error,
      status: "degraded",
      nowMs: startedAt,
      severity: "warn"
    });
    return withCors(jsonResponse({
      ok: false,
      status
    }, 500));
  }
}

async function clearFailureLogs(env) {
  if (!env?.EV_HISTORY) {
    throw new Error("kv_not_configured");
  }
  const deletes = [];
  for (let i = 0; i < FAILURE_LOG_RETENTION_DAYS; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = `${FAILURE_LOG_PREFIX}:${d.toISOString().slice(0, 10)}`;
    deletes.push(env.EV_HISTORY.delete(key));
  }
  await Promise.all(deletes);
}

async function getPendingSnapshotRetryState(env) {
  if (!env.EV_HISTORY) return { leagues: [], retryCount: 0 };
  const raw = await env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY);
  const retry = parseJsonObject(raw);
  const today = new Date().toISOString().slice(0, 10);
  if (!retry || String(retry.date || "") !== today) return { leagues: [], retryCount: 0 };
  const leagues = Array.isArray(retry.pendingLeagues)
    ? retry.pendingLeagues.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  return {
    leagues: [...new Set(leagues)],
    retryCount: Math.max(0, Number(retry.retryCount) || 0)
  };
}

async function getIncompleteSnapshotLeaguesForToday(env) {
  if (!env.EV_HISTORY) return [];
  const raw = await env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY);
  const status = parseJsonObject(raw);
  const today = new Date().toISOString().slice(0, 10);
  if (!status || String(status.date || "") !== today) return [];
  const target = Array.isArray(status.targetLeagues)
    ? status.targetLeagues.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const leagues = (status.leagues && typeof status.leagues === "object") ? status.leagues : {};
  return target.filter((league) => {
    const info = leagues[league] || {};
    const writes = (info.writes && typeof info.writes === "object") ? info.writes : {};
    return listMissingRequiredWrites(writes).length > 0;
  });
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
  const snapshotIdentifiers = { league, date: today };
  try {
    const data = await fetchNinjaExchange(league, "Scarab");
    if (!Array.isArray(data?.lines) || !data.lines.length) {
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed: no scarab lines.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: "no_scarab_lines",
        stage: "fetch_scarab",
        status: "retrying"
      });
      return { ok: false, error: "no_scarab_lines" };
    }

    const harmonicEv = calcHarmonicEV(data.lines);
    if (!Number.isFinite(harmonicEv)) {
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed: harmonic EV unavailable.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: "harmonic_unavailable",
        stage: "compute_harmonic",
        status: "retrying"
      });
      return { ok: false, error: "harmonic_unavailable" };
    }

    const weightResult = await fetchObservedWeightsForLeague(env, league);
    const weights = weightResult && weightResult.weights;
    if (!weights || typeof weights !== "object" || !Object.keys(weights).length) {
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed: observed weights unavailable.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: String(weightResult?.error || "weights_unavailable"),
        stage: "fetch_weights",
        status: "retrying"
      });
      return { ok: false, error: "weights_unavailable" };
    }
    const weightedEv = calcWeightedThresholdEV(data.lines, weights);
    if (!Number.isFinite(weightedEv) || weightedEv <= 0) {
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed: weighted EV unavailable.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: "weighted_unavailable",
        stage: "compute_weighted_ev",
        status: "retrying"
      });
      return { ok: false, error: "weighted_unavailable" };
    }
    const atlasSnapshot = calcAtlasBaselineOptimizedEV(data.lines, weights);
    if (!atlasSnapshot || !Number.isFinite(atlasSnapshot.baselineEv) || !Number.isFinite(atlasSnapshot.optimizedEv)) {
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed: atlas EV unavailable.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: "atlas_unavailable",
        stage: "compute_atlas_ev",
        status: "retrying"
      });
      return { ok: false, error: "atlas_unavailable" };
    }

    const evKey = `ev-history-${league.toLowerCase()}`;
    const atlasKey = `atlas-ev-history-${league.toLowerCase()}`;
    const evStored = await env.EV_HISTORY.get(evKey);
    const evHistory = evStored ? JSON.parse(evStored) : [];
    const evIdx = evHistory.findIndex((e) => e.date === today);
    const evEntry = {
      date: today,
      ev: Number(harmonicEv.toFixed(4)), // backward compatibility
      harmonicEv: Number(harmonicEv.toFixed(4))
    };
    if (Number.isFinite(weightedEv)) evEntry.weightedEv = Number(weightedEv.toFixed(4));
    if (evIdx >= 0) evHistory[evIdx] = { ...evHistory[evIdx], ...evEntry };
    else evHistory.push(evEntry);

    const evCutoff = new Date();
    evCutoff.setDate(evCutoff.getDate() - 90);
    const evCutoffStr = evCutoff.toISOString().slice(0, 10);
    let nextEvHistory = evHistory.filter((e) => e.date >= evCutoffStr);

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
    const nextAtlasHistory = atlasHistory.filter((e) => e.date >= atlasCutoffStr);

    const priceKey = `price-history-${league.toLowerCase()}`;
    const backupKey = `price-history-backup-${league.toLowerCase()}`;
    const priceStored = await env.EV_HISTORY.get(priceKey);
    const priceHistory = priceStored ? JSON.parse(priceStored) : {};
    const previousPriceHistory = priceHistory && typeof priceHistory === "object"
      ? JSON.parse(JSON.stringify(priceHistory))
      : {};
    const previousDistinctDays = countPriceHistoryDistinctDays(previousPriceHistory);
    const backfillFallback = await getPriceHistoryBackfillFallbackState(env);
    const backfillFallbackActive = !!backfillFallback?.enabled;
    const priceCutoff = new Date();
    priceCutoff.setDate(priceCutoff.getDate() - 7);
    const priceCutoffStr = priceCutoff.toISOString().slice(0, 10);

    for (const line of data.lines) {
      const name = line.name;
      const price = line.chaosValue ?? line.chaosEquivalent ?? line.primaryValue ?? null;
      if (!name || !price || price <= 0) continue;
      const existing = Array.isArray(priceHistory[name]) ? priceHistory[name] : [];
      const byDate = {};
      for (const entry of existing) {
        const date = String(entry?.date || "");
        const val = Number(entry?.price);
        if (!date || !Number.isFinite(val) || val <= 0) continue;
        byDate[date] = Number(val.toFixed(4));
      }

      if (backfillFallbackActive) {
        // Emergency-only backfill mode: derive historical points from upstream sparkline.
        const sparklineSeries = deriveDailyPriceSeriesFromSparkline(line, today);
        for (const point of sparklineSeries) {
          byDate[point.date] = point.price;
        }
      }

      // Always stamp today's observed market price from this snapshot.
      byDate[today] = Number(Number(price).toFixed(4));

      priceHistory[name] = Object.keys(byDate)
        .sort((a, b) => a.localeCompare(b))
        .map((date) => ({ date, price: byDate[date] }))
        .filter((e) => e.date >= priceCutoffStr);
    }
    const nextPriceHistory = priceHistory;
    const weightedRepair = reconcileMissingWeightedEvHistoryEntries(nextEvHistory, nextPriceHistory, weights, {
      minDateInclusive: evCutoffStr,
      maxDateInclusive: today,
      fallbackPriceHistory: previousPriceHistory
    });
    nextEvHistory = weightedRepair.history;

    const previousDistinctDaysWithinCutoff = countPriceHistoryDistinctDays(previousPriceHistory, priceCutoffStr);
    const nextDistinctDaysWithinCutoff = countPriceHistoryDistinctDays(nextPriceHistory, priceCutoffStr);
    const shrinkGuardFloor = Math.max(
      PRICE_HISTORY_GUARD_FLOOR_DAYS,
      previousDistinctDaysWithinCutoff - 3
    );
    const suspiciousShrink = previousDistinctDaysWithinCutoff >= PRICE_HISTORY_GUARD_MIN_DAYS
      && nextDistinctDaysWithinCutoff < shrinkGuardFloor;
    if (suspiciousShrink) {
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed: price history shrink guard triggered.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: "price_history_shrink_guard",
        stage: "write_price_history",
        status: "retrying"
      });
      return { ok: false, error: "price_history_shrink_guard" };
    }

    const backupPayload = previousDistinctDays > 0
      ? JSON.stringify({
        capturedAt: new Date().toISOString(),
        league,
        previousDistinctDays,
        data: previousPriceHistory
      })
      : null;
    const backupStored = backupPayload ? await env.EV_HISTORY.get(backupKey) : null;

    const committed = [];
    try {
      if (backupPayload) {
        await env.EV_HISTORY.put(backupKey, backupPayload);
        committed.push({ key: backupKey, previousRaw: backupStored });
      }
      await env.EV_HISTORY.put(evKey, JSON.stringify(nextEvHistory));
      committed.push({ key: evKey, previousRaw: evStored });
      await env.EV_HISTORY.put(atlasKey, JSON.stringify(nextAtlasHistory));
      committed.push({ key: atlasKey, previousRaw: atlasStored });
      await env.EV_HISTORY.put(priceKey, JSON.stringify(nextPriceHistory));
      committed.push({ key: priceKey, previousRaw: priceStored });
    } catch (commitError) {
      for (let i = committed.length - 1; i >= 0; i--) {
        const entry = committed[i];
        try {
          if (entry.previousRaw == null) await env.EV_HISTORY.delete(entry.key);
          else await env.EV_HISTORY.put(entry.key, entry.previousRaw);
        } catch (_rollbackError) {
          // best effort rollback only
        }
      }
      await markIncidentFailed(env, "snapshot_league", {
        message: "Snapshot failed during commit; attempted rollback.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: String(commitError?.message || commitError || "snapshot_commit_failed"),
        stage: "commit",
        status: "retrying"
      });
      return { ok: false, error: "snapshot_commit_failed" };
    }

    if (backfillFallbackActive) {
      await markIncidentFailed(env, "price_history_backfill_degraded", {
        message: "Emergency price-history sparkline backfill fallback is active.",
        subsystem: "price-history",
        identifiers: { scope: "global" },
        rootError: "backfill_fallback_active",
        status: "degraded",
        severity: "warn"
      });
    } else {
      await markIncidentRecovered(env, "price_history_backfill_degraded", {
        message: "Price-history fallback mode recovered.",
        subsystem: "price-history",
        identifiers: { scope: "global" },
        finalStep: "fallback_inactive_during_snapshot"
      });
    }
    if (weightedRepair.filledDates.length > 0) {
      await logFailureEvent(env, "ev_history_weighted_backfill_applied", "Weighted EV history was backfilled from stored daily price history.", {
        league,
        date: today,
        filledCount: weightedRepair.filledDates.length,
        firstFilledDate: weightedRepair.filledDates[0],
        lastFilledDate: weightedRepair.filledDates[weightedRepair.filledDates.length - 1]
      }, {
        severity: "warn"
      });
    }
    const weightedGapDates = getRecentWeightedGapDates(nextEvHistory, today, WEIGHTED_HISTORY_GAP_WINDOW_DAYS);
    if (weightedGapDates.length > 0) {
      await markIncidentFailed(env, "snapshot_weighted_history_gap", {
        message: "Recent weighted EV history has missing points.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        rootError: "weighted_history_gap_recent",
        status: "degraded",
        severity: "warn",
        details: {
          windowDays: WEIGHTED_HISTORY_GAP_WINDOW_DAYS,
          missingDates: weightedGapDates
        }
      });
    } else {
      await markIncidentRecovered(env, "snapshot_weighted_history_gap", {
        message: "Recent weighted EV history is complete.",
        subsystem: "daily-snapshot",
        identifiers: snapshotIdentifiers,
        finalStep: "recent_weighted_history_complete"
      });
    }
    return {
      ok: true,
      writes: {
        ev: true,
        atlas: true,
        price: true
      },
      values: {
        harmonicEv: Number(harmonicEv.toFixed(4)),
        weightedEv: Number.isFinite(weightedEv) ? Number(weightedEv.toFixed(4)) : null
      }
    };
  } catch (e) {
    await markIncidentFailed(env, "snapshot_league", {
      message: "Snapshot failed with exception.",
      subsystem: "daily-snapshot",
      identifiers: snapshotIdentifiers,
      rootError: String(e?.message || e || "snapshot_failed"),
      stage: "exception",
      status: "retrying"
    });
    return { ok: false, error: String(e?.message || e || "snapshot_failed") };
  }
}

async function getPriceHistoryBackfillFallbackState(env) {
  if (!env?.EV_HISTORY) return { enabled: false, expiresAt: null };
  try {
    const raw = await env.EV_HISTORY.get(PRICE_HISTORY_BACKFILL_FALLBACK_KEY);
    if (!raw) return { enabled: false, expiresAt: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      await env.EV_HISTORY.delete(PRICE_HISTORY_BACKFILL_FALLBACK_KEY);
      return { enabled: false, expiresAt: null };
    }
    const enabled = parsed.enabled === true;
    const expiresAt = Number(parsed.expiresAt) || 0;
    const now = Date.now();
    if (!enabled || !Number.isFinite(expiresAt) || expiresAt <= now) {
      await env.EV_HISTORY.delete(PRICE_HISTORY_BACKFILL_FALLBACK_KEY);
      await logFailureEvent(env, "price_history_backfill_fallback_expired", "Emergency price-history sparkline backfill fallback expired and was disabled.", {
        expiredAt: Number.isFinite(expiresAt) && expiresAt > 0 ? new Date(expiresAt).toISOString() : null
      }, {
        severity: "warn"
      });
      await markIncidentRecovered(env, "price_history_backfill_degraded", {
        message: "Price-history fallback mode recovered.",
        subsystem: "price-history",
        identifiers: { scope: "global" },
        finalStep: "fallback_expired_cleanup"
      });
      return { enabled: false, expiresAt: null };
    }
    return { enabled: true, expiresAt };
  } catch {
    return { enabled: false, expiresAt: null };
  }
}

function deriveDailyPriceSeriesFromSparkline(line, todayKey) {
  const spark = line?.sparkline;
  const data = Array.isArray(spark?.data) ? spark.data : null;
  const totalChange = Number(spark?.totalChange);
  const currentPrice = Number(line?.chaosValue ?? line?.chaosEquivalent ?? line?.primaryValue ?? NaN);
  if (!data || data.length < 2 || !Number.isFinite(totalChange) || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return [];
  }
  const denom = 1 + (totalChange / 100);
  if (!Number.isFinite(denom) || denom <= 0) return [];
  const baseline = currentPrice / denom;
  if (!Number.isFinite(baseline) || baseline <= 0) return [];

  const end = parseDateKeyUtc(todayKey);
  if (!end) return [];
  const series = [];
  for (let i = 0; i < data.length; i++) {
    const pct = Number(data[i]);
    if (!Number.isFinite(pct)) continue;
    const d = new Date(end.getTime());
    d.setUTCDate(d.getUTCDate() - (data.length - 1 - i));
    const pointPrice = baseline * (1 + (pct / 100));
    if (!Number.isFinite(pointPrice) || pointPrice <= 0) continue;
    series.push({
      date: formatDateKeyUtc(d),
      price: Number(pointPrice.toFixed(4))
    });
  }
  return series;
}

function parseDateKeyUtc(key) {
  const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function formatDateKeyUtc(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function countPriceHistoryDistinctDays(history, minDateInclusive = "") {
  if (!history || typeof history !== "object") return 0;
  const minDate = String(minDateInclusive || "");
  const dates = new Set();
  for (const seriesRaw of Object.values(history)) {
    const series = Array.isArray(seriesRaw) ? seriesRaw : [];
    for (const entry of series) {
      const date = String(entry?.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (minDate && date < minDate) continue;
      dates.add(date);
    }
  }
  return dates.size;
}

function buildPriceByDateLookup(priceHistory) {
  const byDate = new Map();
  if (!priceHistory || typeof priceHistory !== "object") return byDate;
  for (const [nameRaw, seriesRaw] of Object.entries(priceHistory)) {
    const name = String(nameRaw || "").trim();
    if (!name) continue;
    const series = Array.isArray(seriesRaw) ? seriesRaw : [];
    for (const entry of series) {
      const date = String(entry?.date || "");
      const price = Number(entry?.price);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!Number.isFinite(price) || price <= 0) continue;
      let dayMap = byDate.get(date);
      if (!dayMap) {
        dayMap = new Map();
        byDate.set(date, dayMap);
      }
      dayMap.set(name, Number(price.toFixed(4)));
    }
  }
  return byDate;
}

function calcWeightedThresholdEVFromPriceMap(priceByName, weights) {
  if (!priceByName || typeof priceByName.get !== "function") return null;
  if (!weights || typeof weights !== "object") return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [name, wRaw] of Object.entries(weights)) {
    const w = Number(wRaw);
    if (!Number.isFinite(w) || w <= 0) continue;
    const price = Number(priceByName.get(name));
    if (!Number.isFinite(price) || price <= 0) continue;
    weightedSum += w * price;
    totalWeight += w;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  const thresholdEv = (weightedSum / totalWeight) / 3;
  if (!Number.isFinite(thresholdEv) || thresholdEv <= 0) return null;
  return thresholdEv;
}

function reconcileMissingWeightedEvHistoryEntries(evHistory, priceHistory, weights, opts = {}) {
  const minDateInclusive = String(opts?.minDateInclusive || "");
  const maxDateInclusive = String(opts?.maxDateInclusive || "");
  const nextHistory = Array.isArray(evHistory) ? evHistory.map((entry) => ({ ...entry })) : [];
  const priceByDate = buildPriceByDateLookup(priceHistory);
  const fallbackPriceHistory = opts?.fallbackPriceHistory && typeof opts.fallbackPriceHistory === "object"
    ? opts.fallbackPriceHistory
    : null;
  if (fallbackPriceHistory) {
    const fallbackLookup = buildPriceByDateLookup(fallbackPriceHistory);
    for (const [date, fallbackMap] of fallbackLookup.entries()) {
      let target = priceByDate.get(date);
      if (!target) {
        target = new Map();
        priceByDate.set(date, target);
      }
      for (const [name, price] of fallbackMap.entries()) {
        if (!target.has(name)) target.set(name, price);
      }
    }
  }
  const filledDates = [];

  for (const entry of nextHistory) {
    const date = String(entry?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (minDateInclusive && date < minDateInclusive) continue;
    if (maxDateInclusive && date > maxDateInclusive) continue;
    const existing = Number(entry?.weightedEv);
    if (Number.isFinite(existing) && existing > 0) continue;
    const priceByName = priceByDate.get(date);
    if (!priceByName) continue;
    const repaired = calcWeightedThresholdEVFromPriceMap(priceByName, weights);
    if (!Number.isFinite(repaired) || repaired <= 0) continue;
    entry.weightedEv = Number(repaired.toFixed(4));
    filledDates.push(date);
  }

  return {
    history: nextHistory,
    filledDates
  };
}

function getRecentWeightedGapDates(evHistory, todayKey, windowDays = WEIGHTED_HISTORY_GAP_WINDOW_DAYS) {
  const today = String(todayKey || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (Math.max(1, Number(windowDays) || 1) - 1));
  const startKey = start.toISOString().slice(0, 10);

  const missing = [];
  const source = Array.isArray(evHistory) ? evHistory : [];
  for (const entry of source) {
    const date = String(entry?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < startKey || date > today) continue;
    const harmonicEv = Number(entry?.harmonicEv ?? entry?.ev);
    if (!Number.isFinite(harmonicEv) || harmonicEv <= 0) continue;
    const weightedEv = Number(entry?.weightedEv);
    if (Number.isFinite(weightedEv) && weightedEv > 0) continue;
    missing.push(date);
  }
  return [...new Set(missing)].sort((a, b) => a.localeCompare(b));
}

async function backfillStoredWeightedEvHistoryForLeague(env, league) {
  if (!env?.EV_HISTORY) return { ok: false, error: "kv_not_configured" };
  const normalizedLeague = String(league || "").trim() || "Standard";
  const evKey = `ev-history-${normalizedLeague.toLowerCase()}`;
  const priceKey = `price-history-${normalizedLeague.toLowerCase()}`;
  const backupKey = `price-history-backup-${normalizedLeague.toLowerCase()}`;
  const [evRaw, priceRaw, backupRaw] = await Promise.all([
    env.EV_HISTORY.get(evKey),
    env.EV_HISTORY.get(priceKey),
    env.EV_HISTORY.get(backupKey)
  ]);
  const evHistory = evRaw ? JSON.parse(evRaw) : [];
  const priceHistory = priceRaw ? JSON.parse(priceRaw) : {};
  const backupPayload = backupRaw ? JSON.parse(backupRaw) : null;
  const backupPriceHistory = backupPayload && typeof backupPayload === "object" && backupPayload.data && typeof backupPayload.data === "object"
    ? backupPayload.data
    : null;
  if (!Array.isArray(evHistory) || !evHistory.length) {
    return { ok: true, updated: false, reason: "empty_ev_history", filledCount: 0 };
  }
  const weightResult = await fetchObservedWeightsForLeague(env, normalizedLeague);
  const weights = weightResult && weightResult.weights;
  if (!weights || typeof weights !== "object" || !Object.keys(weights).length) {
    return {
      ok: true,
      updated: false,
      reason: String(weightResult?.error || "weights_unavailable"),
      filledCount: 0
    };
  }
  const repaired = reconcileMissingWeightedEvHistoryEntries(evHistory, priceHistory, weights, {
    fallbackPriceHistory: backupPriceHistory
  });
  if (!repaired.filledDates.length) {
    return { ok: true, updated: false, reason: "no_missing_weighted_entries", filledCount: 0 };
  }
  await env.EV_HISTORY.put(evKey, JSON.stringify(repaired.history));
  await logFailureEvent(env, "ev_history_weighted_backfill_applied", "Manual weighted EV history backfill completed.", {
    league: normalizedLeague,
    filledCount: repaired.filledDates.length,
    firstFilledDate: repaired.filledDates[0],
    lastFilledDate: repaired.filledDates[repaired.filledDates.length - 1]
  }, {
    severity: "warn"
  });
  return {
    ok: true,
    updated: true,
    filledCount: repaired.filledDates.length,
    firstFilledDate: repaired.filledDates[0],
    lastFilledDate: repaired.filledDates[repaired.filledDates.length - 1]
  };
}

async function saveSnapshotRetryState(env, date, failures, retryCount) {
  if (!env.EV_HISTORY) return;
  const nowMs = Date.now();
  const rawExisting = await env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY);
  const existing = parseJsonObject(rawExisting);
  const existingFirstFailureAt = Number(existing?.firstFailureAt || 0);
  const firstFailureAt = String(existing?.date || "") === String(date) && Number.isFinite(existingFirstFailureAt) && existingFirstFailureAt > 0
    ? existingFirstFailureAt
    : nowMs;
  const errors = {};
  for (const f of failures) errors[f.league] = String(f.error || "snapshot_failed");
  await markIncidentFailed(env, "snapshot_retry_queue", {
    message: "Snapshot retry queue entered degraded state.",
    subsystem: "snapshot-retry",
    identifiers: { date },
    rootError: failures.map((f) => String(f.error || "snapshot_failed")).join(","),
    status: "retrying",
    nowMs
  });
  if ((Number(retryCount) || 0) >= SNAPSHOT_RETRY_MAX_ATTEMPTS) {
    await logFailureEvent(env, "snapshot_retry_exhausted", "Snapshot retries exhausted for one or more leagues.", {
      date,
      retryCount: Number(retryCount) || 0,
      failedLeagues: failures.map((f) => f.league),
      errors
    });
    await env.EV_HISTORY.put(SNAPSHOT_RETRY_KEY, JSON.stringify({
      date,
      firstFailureAt,
      status: "failed",
      failedLeagues: failures.map((f) => f.league),
      errors,
      retryCount: Number(retryCount) || 0,
      lastAttemptAt: new Date().toISOString(),
      nextRetryAt: null
    }));
    await markIncidentClosedUnresolved(env, "snapshot_retry_queue", {
      message: "Snapshot retry queue closed unresolved after max attempts.",
      subsystem: "snapshot-retry",
      identifiers: { date },
      terminalCodeSuffix: "exhausted_unresolved",
      attempts: Math.max(1, Number(retryCount || 0) + 1),
      attemptsSource: "authoritative",
      retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
      retryCadenceLabel: "15m-scheduled-retry",
      reason: "retry_max_attempts_reached",
      finalError: failures.map((f) => String(f.error || "snapshot_failed")).join(","),
      cleanup: {
        retryStatePersistedAsFailed: true
      }
    });
    for (const failure of failures) {
      await markIncidentClosedUnresolved(env, "snapshot_league", {
        message: "League snapshot closed unresolved after retries exhausted.",
        subsystem: "daily-snapshot",
        identifiers: { league: failure.league, date },
        terminalCodeSuffix: "exhausted_unresolved",
        attempts: Math.max(1, Number(failure?.attempts || retryCount || 0)),
        attemptsSource: "authoritative",
        retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
        retryCadenceLabel: "inline-then-15m-retry",
        reason: "retry_max_attempts_reached",
        finalError: String(failure.error || "snapshot_failed"),
        cleanup: {
          retryStatePersistedAsFailed: true
        }
      });
    }
    return;
  }
  await env.EV_HISTORY.put(SNAPSHOT_RETRY_KEY, JSON.stringify({
    date,
    firstFailureAt,
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
  const statusState = await readSnapshotStatusState(env, today, leagues);

  const failures = [];
  for (const league of leagues) {
    let success = false;
    let lastError = "snapshot_failed";
    let writes = { ev: false, atlas: false, price: false };
    let values = { harmonicEv: null, weightedEv: null };
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= SNAPSHOT_INLINE_ATTEMPTS; attempt++) {
      attemptsUsed++;
      const result = await snapshotLeagueForDate(env, league, today);
      if (result.ok) {
        writes = {
          ev: !!result?.writes?.ev,
          atlas: !!result?.writes?.atlas,
          price: !!result?.writes?.price
        };
        values = {
          harmonicEv: Number.isFinite(result?.values?.harmonicEv) ? Number(result.values.harmonicEv) : null,
          weightedEv: Number.isFinite(result?.values?.weightedEv) ? Number(result.values.weightedEv) : null
        };
        const missingRequired = listMissingRequiredWrites(writes);
        if (!missingRequired.length) {
          success = true;
          lastError = null;
          break;
        }
        lastError = `incomplete_writes:${missingRequired.join(",")}`;
        continue;
      }
      lastError = result.error || "snapshot_failed";
    }
    const previous = statusState.leagues[league] || {};
    statusState.leagues[league] = {
      state: success ? "success" : "retrying",
      attempts: (Number(previous.attempts) || 0) + attemptsUsed,
      lastAttemptAt: new Date().toISOString(),
      lastError: success ? null : lastError,
      writes,
      values
    };
    if (!success) {
      failures.push({
        league,
        error: lastError,
        attempts: Number(statusState.leagues[league].attempts || attemptsUsed)
      });
    } else {
      await markIncidentRecovered(env, "snapshot_league", {
        message: "League snapshot recovered.",
        subsystem: "daily-snapshot",
        identifiers: { league, date: today },
        attempts: Number(statusState.leagues[league].attempts || attemptsUsed),
        attemptsSource: "authoritative",
        retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
        retryCadenceLabel: "inline-then-15m-retry",
        finalStep: "snapshot_commit_success"
      });
    }
  }

  statusState.lastAttemptAt = new Date().toISOString();
  const exhausted = (Number(opts.retryCount) || 0) >= SNAPSHOT_RETRY_MAX_ATTEMPTS;
  let lastSuccessSummary = null;
  if (failures.length) {
    await saveSnapshotRetryState(env, today, failures, Number(opts.retryCount) || 0);
    for (const failure of failures) {
      if (!statusState.leagues[failure.league]) continue;
      statusState.leagues[failure.league].state = exhausted ? "failed" : "retrying";
      statusState.leagues[failure.league].lastError = String(failure.error || "snapshot_failed");
    }
    if (exhausted) {
      statusState.status = failures.length === leagues.length ? "failed" : "partial_failed";
    } else if (failures.length === leagues.length) {
      statusState.status = "retrying";
    } else {
      statusState.status = "partial_retrying";
    }
  } else {
    await clearSnapshotRetryState(env, today);
    statusState.status = "success";
    lastSuccessSummary = buildSnapshotHealthSummary(statusState, null, today);
    await markIncidentRecovered(env, "snapshot_retry_queue", {
      message: "Snapshot retry queue recovered.",
      subsystem: "snapshot-retry",
      identifiers: { date: today },
      attempts: Math.max(1, Number(opts.retryCount || 0) + 1),
      attemptsSource: "authoritative",
      retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
      retryCadenceLabel: "15m-scheduled-retry",
      finalStep: "retry_queue_cleared"
    });
  }
  await env.EV_HISTORY.put(SNAPSHOT_STATUS_KEY, JSON.stringify(statusState));
  if (lastSuccessSummary) {
    await env.EV_HISTORY.put(SNAPSHOT_LAST_SUCCESS_KEY, JSON.stringify(lastSuccessSummary));
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
    await logFailureEvent(env, "snapshot_retry_state_corrupt", "Retry state was corrupt and was reset.", { stage: "parse_retry_state" });
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    const rawStatus = await env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY);
    const status = parseJsonObject(rawStatus);
    const statusDate = String(status?.date || new Date().toISOString().slice(0, 10));
    const leaguesMap = status?.leagues && typeof status.leagues === "object" ? status.leagues : {};
    for (const [league, info] of Object.entries(leaguesMap)) {
      if (String(info?.state || "") !== "retrying") continue;
      await markIncidentClosedUnresolved(env, "snapshot_league", {
        message: "League snapshot closed unresolved due to corrupt retry state.",
        subsystem: "daily-snapshot",
        identifiers: { league, date: statusDate },
        terminalCodeSuffix: "corrupt_state_unresolved",
        attempts: Math.max(1, Number(info?.attempts || 0)),
        attemptsSource: "persisted",
        retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
        retryCadenceLabel: "inline-then-15m-retry",
        reason: "retry_state_corrupt",
        finalError: String(info?.lastError || "snapshot_failed"),
        cleanup: {
          retryStateDeleted: true
        }
      });
    }
    await closeAllActiveIncidentsUnresolved(env, "snapshot_retry_queue", {
      message: "Snapshot retry queue closed unresolved due to corrupt retry state.",
      subsystem: "snapshot-retry",
      terminalCodeSuffix: "corrupt_state_unresolved",
      attemptsSource: "persisted",
      retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
      retryCadenceLabel: "15m-scheduled-retry",
      reason: "retry_state_corrupt",
      finalError: "snapshot_retry_state_corrupt",
      cleanup: {
        retryStateDeleted: true
      }
    });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (String(state?.date || "") !== today) {
    const rawStatus = await env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY);
    const status = parseJsonObject(rawStatus);
    if (status && String(status.date || "") === String(state?.date || "")) {
      status.status = "failed_expired";
      status.lastAttemptAt = new Date().toISOString();
      await env.EV_HISTORY.put(SNAPSHOT_STATUS_KEY, JSON.stringify(status));
    }
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    await markIncidentClosedUnresolved(env, "snapshot_retry_queue", {
      message: "Snapshot retry queue closed unresolved after date rollover.",
      subsystem: "snapshot-retry",
      identifiers: { date: String(state?.date || "") },
      terminalCodeSuffix: "expired_unresolved",
      attempts: Math.max(1, Number(state?.retryCount || 0)),
      attemptsSource: "persisted",
      retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
      retryCadenceLabel: "15m-scheduled-retry",
      reason: "retry_date_rolled_over",
      finalError: "snapshot_retry_expired",
      cleanup: {
        retryStateDeleted: true
      }
    });
    const expiredPendingLeagues = Array.isArray(state?.pendingLeagues)
      ? [...new Set(state.pendingLeagues.map((s) => String(s || "").trim()).filter(Boolean))]
      : [];
    for (const league of expiredPendingLeagues) {
      await markIncidentClosedUnresolved(env, "snapshot_league", {
        message: "League snapshot closed unresolved after retry state expired.",
        subsystem: "daily-snapshot",
        identifiers: { league, date: String(state?.date || "") },
        terminalCodeSuffix: "expired_unresolved",
        attempts: Math.max(1, Number(state?.retryCount || 0)),
        attemptsSource: "persisted",
        retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
        retryCadenceLabel: "inline-then-15m-retry",
        reason: "retry_date_rolled_over",
        finalError: (state?.errors && state.errors[league]) ? String(state.errors[league]) : "snapshot_failed",
        cleanup: {
          retryStateDeleted: true
        }
      });
    }
    await logFailureEvent(env, "snapshot_retry_expired", "Retry state expired because date rolled over.", {
      retryDate: String(state?.date || ""),
      today
    });
    return;
  }
  if (String(state?.status || "") === "failed") return;
  const pendingLeagues = Array.isArray(state?.pendingLeagues)
    ? [...new Set(state.pendingLeagues.map((s) => String(s).trim()).filter(Boolean))]
    : [];
  if (!pendingLeagues.length) {
    await env.EV_HISTORY.delete(SNAPSHOT_RETRY_KEY);
    await markIncidentClosedUnresolved(env, "snapshot_retry_queue", {
      message: "Snapshot retry queue closed unresolved due to empty pending set.",
      subsystem: "snapshot-retry",
      identifiers: { date: today },
      terminalCodeSuffix: "closed_unresolved",
      attempts: Math.max(1, Number(state?.retryCount || 0)),
      attemptsSource: "persisted",
      retryIntervalMs: SNAPSHOT_RETRY_DELAY_MS,
      retryCadenceLabel: "15m-scheduled-retry",
      reason: "pending_leagues_empty_cleanup",
      finalError: "snapshot_retry_empty_pending",
      cleanup: {
        retryStateDeleted: true
      }
    });
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

async function runSnapshotKickoffBackstop(env, nowDate = new Date()) {
  if (!env?.EV_HISTORY) return;
  const nowMs = nowDate instanceof Date ? nowDate.getTime() : Date.now();
  if (!Number.isFinite(nowMs) || nowMs <= 0) return;

  const kickoffAt = new Date(nowMs);
  kickoffAt.setUTCHours(SNAPSHOT_KICKOFF_HOUR_UTC, SNAPSHOT_KICKOFF_MINUTE_UTC, 0, 0);
  if (nowMs < (kickoffAt.getTime() + SNAPSHOT_BACKSTOP_GRACE_MS)) return;

  const today = new Date(nowMs).toISOString().slice(0, 10);
  const [rawBackstop, rawStatus, rawRetry] = await Promise.all([
    env.EV_HISTORY.get(SNAPSHOT_BACKSTOP_KEY),
    env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY),
    env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY)
  ]);
  const backstop = parseJsonObject(rawBackstop);
  if (String(backstop?.date || "") === today) return;

  const status = parseJsonObject(rawStatus);
  const retry = parseJsonObject(rawRetry);
  const statusToday = status && String(status.date || "") === today ? status : null;
  const retryToday = retry && String(retry.date || "") === today ? retry : null;
  const statusHasStarted = !!statusToday && (
    !!statusToday.lastAttemptAt
    || (statusToday.leagues && typeof statusToday.leagues === "object" && Object.keys(statusToday.leagues).length > 0)
    || (Array.isArray(statusToday.targetLeagues) && statusToday.targetLeagues.length > 0)
  );
  const retryHasStarted = !!retryToday;
  if (statusHasStarted || retryHasStarted) return;

  await env.EV_HISTORY.put(SNAPSHOT_BACKSTOP_KEY, JSON.stringify({
    date: today,
    triggeredAt: new Date(nowMs).toISOString()
  }));
  await runDailyEVSnapshot(env);
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

function parseJsonObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function buildIncidentStateKey(incidentKey, identifiers = {}) {
  const safeIncident = String(incidentKey || "unknown_incident").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
  const idObj = identifiers && typeof identifiers === "object" ? identifiers : {};
  const pairs = Object.keys(idObj)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const value = idObj[key];
      return `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value == null ? "" : value))}`;
    });
  const suffix = pairs.length ? `:${pairs.join("&")}` : "";
  return `${INCIDENT_STATE_PREFIX}:${safeIncident}${suffix}`;
}

function buildIncidentSignature(payload = {}) {
  const stage = payload?.stage == null ? "" : String(payload.stage);
  const rootError = payload?.rootError == null ? "" : String(payload.rootError);
  const status = payload?.status == null ? "" : String(payload.status);
  return `${stage}|${rootError}|${status}`;
}

function getRuntimeRepeatCount(incidentStateKey) {
  return Math.max(0, Number(runtimeIncidentRepeatCounts.get(incidentStateKey) || 0));
}

function addRuntimeRepeatCount(incidentStateKey, increment = 1) {
  const next = Math.max(0, getRuntimeRepeatCount(incidentStateKey) + Math.max(0, Number(increment) || 0));
  if (next > 0) runtimeIncidentRepeatCounts.set(incidentStateKey, next);
  return next;
}

function clearRuntimeRepeatCount(incidentStateKey) {
  runtimeIncidentRepeatCounts.delete(incidentStateKey);
}

function buildClosureAttemptTelemetry(options, attempts, durationMs) {
  const attemptsSourceRaw = String(options?.attemptsSource || "").trim().toLowerCase();
  const attemptsSource = ["runtime", "persisted", "authoritative", "unknown"].includes(attemptsSourceRaw)
    ? attemptsSourceRaw
    : "runtime";
  const retryIntervalMsRaw = Number(options?.retryIntervalMs || 0);
  const retryIntervalMs = Number.isFinite(retryIntervalMsRaw) && retryIntervalMsRaw > 0
    ? Math.floor(retryIntervalMsRaw)
    : null;
  const estimatedAttempts = retryIntervalMs
    ? Math.max(1, Math.round(Math.max(0, Number(durationMs) || 0) / retryIntervalMs))
    : null;
  const estimatedAttemptsSource = estimatedAttempts == null ? null : "duration";
  const retryCadenceLabel = options?.retryCadenceLabel == null ? null : String(options.retryCadenceLabel);
  const attemptsDelta = estimatedAttempts == null ? null : (Number(attempts) - estimatedAttempts);
  return {
    attemptsSource,
    estimatedAttempts,
    estimatedAttemptsSource,
    retryIntervalMs,
    retryCadenceLabel,
    attemptsDelta
  };
}

async function markIncidentFailed(env, incidentKey, options = {}) {
  if (!env?.EV_HISTORY) return null;
  const nowMs = Number(options?.nowMs) || Date.now();
  const identifiers = options?.identifiers && typeof options.identifiers === "object" ? options.identifiers : {};
  const subsystem = String(options?.subsystem || "market-worker");
  const source = String(options?.source || "market-worker");
  const severity = String(options?.severity || "error");
  const rootError = String(options?.rootError || "");
  const stage = options?.stage == null ? null : String(options.stage);
  const status = options?.status == null ? null : String(options.status);
  const logOnMaterialChange = options?.logOnMaterialChange !== false;
  const suppressRepeatStateWrite = options?.suppressRepeatStateWrite !== false;
  const key = buildIncidentStateKey(incidentKey, identifiers);
  const prior = parseJsonObject(await env.EV_HISTORY.get(key));
  const wasActive = !!prior?.active;
  const startedAtMs = wasActive && Number.isFinite(Number(prior?.startedAtMs || 0)) && Number(prior.startedAtMs) > 0
    ? Number(prior.startedAtMs)
    : nowMs;
  const signature = buildIncidentSignature({ stage, rootError, status });
  const signatureChanged = String(prior?.signature || "") !== signature;
  const repeatCount = getRuntimeRepeatCount(key);
  if (wasActive && !signatureChanged && suppressRepeatStateWrite) {
    const nextRepeat = addRuntimeRepeatCount(key, 1);
    const baseFailCount = Math.max(1, Number(prior?.failCount || 0));
    return {
      ...prior,
      failCount: baseFailCount + nextRepeat
    };
  }
  const baseFailCount = wasActive ? Math.max(0, Number(prior?.failCount || 0)) : 0;
  const explicitFailCount = Number(options?.failCount || 0);
  const computedFailCount = baseFailCount + 1 + repeatCount;
  const failCount = Number.isFinite(explicitFailCount) && explicitFailCount > 0
    ? Math.max(explicitFailCount, computedFailCount)
    : computedFailCount;
  const shouldEmit = !wasActive || (logOnMaterialChange && signatureChanged);
  const nextState = {
    active: true,
    incidentKey: String(incidentKey || ""),
    startedAtMs,
    failCount,
    lastFailedAtMs: nowMs,
    subsystem,
    source,
    severity,
    identifiers,
    rootError,
    stage,
    status,
    signature
  };
  await env.EV_HISTORY.put(key, JSON.stringify(nextState));
  clearRuntimeRepeatCount(key);
  if (!shouldEmit) return nextState;
  await logFailureEvent(
    env,
    `${incidentKey}_failed`,
    String(options?.message || "Incident entered failed state."),
    {
      incidentKey,
      subsystem,
      identifiers,
      startedAt: new Date(startedAtMs).toISOString(),
      currentFailCount: failCount,
      rootError: rootError || null,
      stage,
      status,
      materialChange: wasActive && signatureChanged
    },
    { severity, source }
  );
  return nextState;
}

async function markIncidentRecovered(env, incidentKey, options = {}) {
  if (!env?.EV_HISTORY) return null;
  const nowMs = Number(options?.nowMs) || Date.now();
  const identifiers = options?.identifiers && typeof options.identifiers === "object" ? options.identifiers : {};
  const subsystem = String(options?.subsystem || "market-worker");
  const source = String(options?.source || "market-worker");
  const key = buildIncidentStateKey(incidentKey, identifiers);
  const prior = parseJsonObject(await env.EV_HISTORY.get(key));
  if (!prior?.active) return null;
  const startedAtMs = Number(prior?.startedAtMs || nowMs) || nowMs;
  const repeatCount = getRuntimeRepeatCount(key);
  const explicitAttempts = Number(options?.attempts || options?.failCount || 0);
  const failCountFromState = Math.max(1, Number(prior?.failCount || 0) + repeatCount);
  const failCount = Number.isFinite(explicitAttempts) && explicitAttempts > 0
    ? Math.max(explicitAttempts, failCountFromState)
    : failCountFromState;
  const durationMs = Math.max(0, nowMs - startedAtMs);
  const attemptTelemetry = buildClosureAttemptTelemetry(options, failCount, durationMs);
  await env.EV_HISTORY.delete(key);
  clearRuntimeRepeatCount(key);
  await logFailureEvent(
    env,
    `${incidentKey}_recovered`,
    String(options?.message || "Incident recovered."),
    {
      incidentKey,
      recovered: true,
      subsystem,
      identifiers,
      startedAt: new Date(startedAtMs).toISOString(),
      recoveredAt: new Date(nowMs).toISOString(),
      durationMs,
      durationSeconds: Math.floor(durationMs / 1000),
      failCount,
      attempts: failCount,
      attemptsSource: attemptTelemetry.attemptsSource,
      estimatedAttempts: attemptTelemetry.estimatedAttempts,
      estimatedAttemptsSource: attemptTelemetry.estimatedAttemptsSource,
      retryIntervalMs: attemptTelemetry.retryIntervalMs,
      retryCadenceLabel: attemptTelemetry.retryCadenceLabel,
      attemptsDelta: attemptTelemetry.attemptsDelta,
      finalStep: options?.finalStep == null ? null : String(options.finalStep)
    },
    { severity: String(options?.severity || "info"), source }
  );
  return {
    startedAtMs,
    recoveredAtMs: nowMs,
    durationMs,
    failCount
  };
}

async function markIncidentClosedUnresolved(env, incidentKey, options = {}) {
  if (!env?.EV_HISTORY) return null;
  const nowMs = Number(options?.nowMs) || Date.now();
  const identifiers = options?.identifiers && typeof options.identifiers === "object" ? options.identifiers : {};
  const key = buildIncidentStateKey(incidentKey, identifiers);
  const prior = parseJsonObject(await env.EV_HISTORY.get(key));
  if (!prior?.active) return null;
  const startedAtMs = Number(prior?.startedAtMs || nowMs) || nowMs;
  const repeatCount = getRuntimeRepeatCount(key);
  const explicitAttempts = Number(options?.attempts || options?.failCount || 0);
  const failCountFromState = Math.max(1, Number(prior?.failCount || 0) + repeatCount);
  const failCount = Number.isFinite(explicitAttempts) && explicitAttempts > 0
    ? Math.max(explicitAttempts, failCountFromState)
    : failCountFromState;
  const durationMs = Math.max(0, nowMs - startedAtMs);
  const attemptTelemetry = buildClosureAttemptTelemetry(options, failCount, durationMs);
  const subsystem = String(options?.subsystem || prior?.subsystem || "market-worker");
  const source = String(options?.source || prior?.source || "market-worker");
  const reason = String(options?.reason || "unresolved");
  const finalError = options?.finalError == null ? null : String(options.finalError);
  const cleanup = options?.cleanup && typeof options.cleanup === "object" ? options.cleanup : null;
  const codeSuffix = String(options?.terminalCodeSuffix || "closed_unresolved");
  await env.EV_HISTORY.delete(key);
  clearRuntimeRepeatCount(key);
  await logFailureEvent(
    env,
    `${incidentKey}_${codeSuffix}`,
    String(options?.message || "Incident closed unresolved."),
    {
      incidentKey,
      recovered: false,
      subsystem,
      identifiers: prior?.identifiers && typeof prior.identifiers === "object" ? prior.identifiers : identifiers,
      startedAt: new Date(startedAtMs).toISOString(),
      closedAt: new Date(nowMs).toISOString(),
      durationMs,
      durationSeconds: Math.floor(durationMs / 1000),
      failCount,
      attempts: failCount,
      attemptsSource: attemptTelemetry.attemptsSource,
      estimatedAttempts: attemptTelemetry.estimatedAttempts,
      estimatedAttemptsSource: attemptTelemetry.estimatedAttemptsSource,
      retryIntervalMs: attemptTelemetry.retryIntervalMs,
      retryCadenceLabel: attemptTelemetry.retryCadenceLabel,
      attemptsDelta: attemptTelemetry.attemptsDelta,
      reason,
      finalError,
      lastError: prior?.rootError == null ? null : String(prior.rootError),
      cleanup
    },
    { severity: String(options?.severity || "warn"), source }
  );
  return {
    startedAtMs,
    closedAtMs: nowMs,
    durationMs,
    failCount
  };
}

async function closeAllActiveIncidentsUnresolved(env, incidentKey, options = {}) {
  if (!env?.EV_HISTORY) return;
  const safeIncident = String(incidentKey || "unknown_incident").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
  const prefix = `${INCIDENT_STATE_PREFIX}:${safeIncident}`;
  let cursor = undefined;
  const nowMs = Number(options?.nowMs) || Date.now();
  do {
    const listed = await env.EV_HISTORY.list({ prefix, cursor, limit: 100 });
    const keys = Array.isArray(listed?.keys) ? listed.keys : [];
    for (const entry of keys) {
      const keyName = String(entry?.name || "");
      if (!keyName) continue;
      const raw = await env.EV_HISTORY.get(keyName);
      const state = parseJsonObject(raw);
      if (!state?.active) continue;
      await markIncidentClosedUnresolved(env, incidentKey, {
        ...options,
        identifiers: state?.identifiers && typeof state.identifiers === "object" ? state.identifiers : {},
        nowMs
      });
    }
    cursor = listed?.list_complete ? undefined : listed?.cursor;
  } while (cursor);
}

function buildSnapshotHealthSummary(statusObj, retryObj, fallbackDate) {
  const safeDate = String(statusObj?.date || fallbackDate || new Date().toISOString().slice(0, 10));
  const leaguesMap = (statusObj?.leagues && typeof statusObj.leagues === "object")
    ? statusObj.leagues
    : {};
  const targetLeagues = Array.isArray(statusObj?.targetLeagues)
    ? statusObj.targetLeagues.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const isLeagueSnapshotComplete = (value) => listMissingRequiredWrites((value && value.writes) || {}).length === 0;
  const completedLeagues = Object.entries(leaguesMap)
    .filter(([, value]) => String(value?.state || "") === "success" && isLeagueSnapshotComplete(value))
    .map(([league]) => league);
  const incompleteLeagues = Object.entries(leaguesMap)
    .filter(([, value]) => String(value?.state || "") === "success" && !isLeagueSnapshotComplete(value))
    .map(([league]) => league);
  const failedLeagues = Object.entries(leaguesMap)
    .filter(([, value]) => String(value?.state || "") === "failed")
    .map(([league]) => league);
  const failedSet = new Set([...failedLeagues, ...incompleteLeagues]);
  const pendingLeagues = Array.isArray(retryObj?.pendingLeagues)
    ? retryObj.pendingLeagues.map((s) => String(s || "").trim()).filter(Boolean)
    : targetLeagues.filter((league) => String(leaguesMap?.[league]?.state || "") === "retrying" && !failedSet.has(league));
  const anyCompleted = completedLeagues.length > 0;
  const anyPending = pendingLeagues.length > 0;
  const anyFailed = failedSet.size > 0 || String(retryObj?.status || "") === "failed";
  let overallStatus = "idle";
  if (targetLeagues.length) {
    if (anyPending) overallStatus = anyCompleted ? "partial_retrying" : "retrying";
    else if (anyFailed) overallStatus = anyCompleted ? "partial_failed" : "failed";
    else if (completedLeagues.length === targetLeagues.length) overallStatus = "success";
    else overallStatus = "partial";
  }
  return {
    date: safeDate,
    status: overallStatus,
    targetLeagues,
    completedLeagues,
    pendingLeagues,
    failedLeagues: [...failedSet],
    incompleteLeagues,
    retryCount: Number(retryObj?.retryCount || 0),
    nextRetryAt: retryObj?.nextRetryAt || null,
    lastAttemptAt: statusObj?.lastAttemptAt || retryObj?.lastAttemptAt || null,
    leagues: leaguesMap
  };
}

function normalizeSnapshotSummary(value) {
  if (!value || typeof value !== "object") return null;
  const normalized = buildSnapshotHealthSummary(value, value, value?.date || null);
  if (String(normalized.status || "") !== "success") return null;
  return normalized;
}

function listMissingRequiredWrites(writes) {
  const map = writes && typeof writes === "object" ? writes : {};
  return REQUIRED_SNAPSHOT_WRITES.filter((key) => !map[key]);
}

async function readSnapshotStatusState(env, today, leagues) {
  const raw = await env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY);
  const parsed = parseJsonObject(raw);
  const sameDate = String(parsed?.date || "") === today;
  const base = sameDate
    ? parsed
    : {
      date: today,
      status: "pending",
      targetLeagues: leagues,
      lastAttemptAt: null,
      leagues: {}
    };
  if (!Array.isArray(base.targetLeagues)) base.targetLeagues = [];
  for (const league of leagues) {
    if (!base.targetLeagues.includes(league)) base.targetLeagues.push(league);
  }
  if (!base.leagues || typeof base.leagues !== "object") base.leagues = {};
  return base;
}

async function fetchObservedWeightsForLeague(env, league) {
  const attempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchAggregateForLeague(env, league);
      if (!res.ok) throw new Error(`aggregate_http_${res.status}`);
      const data = await res.json();
      const provided = data?.weights && typeof data.weights === "object" ? data.weights : null;
      if (provided && Object.keys(provided).length > 0) return { weights: provided, error: null };
      return { weights: null, error: "aggregate_missing_weights" };
    } catch (e) {
      lastError = String(e?.message || e || "weights_fetch_failed");
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  return { weights: null, error: lastError || "weights_fetch_failed" };
}

async function fetchAggregateForLeague(env, league, userAgent = "ScarabEV/1.1 (market-worker weighted snapshot)") {
  const runtime = resolveRuntimeConfig(env);
  const init = {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json"
    }
  };
  const path = `/api/aggregate?league=${encodeURIComponent(league)}`;
  if (env?.SCARABEV_API && typeof env.SCARABEV_API.fetch === "function") {
    return fetchServiceWithTimeout(env.SCARABEV_API, `https://scarabev-api.internal${path}`, init, UPSTREAM_TIMEOUT_MS);
  }
  return fetchWithTimeout(`${runtime.aggregateApiUrl}?league=${encodeURIComponent(league)}`, init, UPSTREAM_TIMEOUT_MS);
}

async function fetchServiceWithTimeout(serviceBinding, url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const timeout = Math.max(250, Number(timeoutMs) || UPSTREAM_TIMEOUT_MS);
  let timer = null;
  try {
    return await Promise.race([
      serviceBinding.fetch(url, init),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("upstream_timeout")), timeout);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
  const payload = await res.json();
  return normalizeExchangePayload(payload);
}

function normalizeExchangePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!items.length || !lines.length) return payload;
  const nameById = new Map();
  const nameByDetailsId = new Map();
  for (const item of items) {
    const id = String(item?.id || "").trim();
    const detailsId = String(item?.detailsId || "").trim();
    const name = String(item?.name || "").trim();
    if (!name) continue;
    if (id) nameById.set(id, name);
    if (detailsId) nameByDetailsId.set(detailsId, name);
  }
  const normalizedLines = lines.map((line) => {
    if (!line || typeof line !== "object") return line;
    if (String(line.name || "").trim()) return line;
    const id = String(line.id || "").trim();
    const detailsId = String(line.detailsId || "").trim();
    const mappedName = (id && nameById.get(id)) || (detailsId && nameByDetailsId.get(detailsId)) || "";
    if (!mappedName) return line;
    return { ...line, name: mappedName };
  });
  return { ...payload, lines: normalizedLines };
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

async function logFailureEvent(env, code, message, context = {}, options = {}) {
  if (!env?.EV_HISTORY) return;
  try {
    const now = new Date();
    const date = String(options?.date || now.toISOString().slice(0, 10));
    const key = `${FAILURE_LOG_PREFIX}:${date}`;
    const raw = await env.EV_HISTORY.get(key);
    const parsed = parseJsonObject(raw);
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    events.push({
      at: now.toISOString(),
      source: String(options?.source || "market-worker"),
      severity: String(options?.severity || "error"),
      code: String(code || "unknown_error"),
      message: String(message || "Failure"),
      context: context && typeof context === "object" ? context : {}
    });
    while (events.length > FAILURE_LOG_MAX_EVENTS_PER_DAY) events.shift();
    await env.EV_HISTORY.put(key, JSON.stringify({
      date,
      updatedAt: now.toISOString(),
      count: events.length,
      events
    }));
  } catch (_e) {
    // best-effort logging only
  }
}

async function pruneFailureLogs(env, now = new Date()) {
  if (!env?.EV_HISTORY) return;
  const pruneDate = new Date(now.getTime());
  pruneDate.setUTCDate(pruneDate.getUTCDate() - (FAILURE_LOG_RETENTION_DAYS + 1));
  const key = `${FAILURE_LOG_PREFIX}:${pruneDate.toISOString().slice(0, 10)}`;
  await env.EV_HISTORY.delete(key);
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
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, User-Agent, x-admin-token, x-manual-retry-token");
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, User-Agent, x-admin-token, x-manual-retry-token",
    "Cache-Control": "no-store"
  };
}
