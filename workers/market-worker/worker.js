import { SCARAB_LIST, ATLAS_BLOCKABLE, ATLAS_BOOSTABLE } from "../../js/config.js";

const CACHE_PREFIX = "market-cache-v2";
const KEY_CURRENT_LEAGUE = `${CACHE_PREFIX}:current-league`;
const BACKOFF_STEPS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const UPSTREAM_TIMEOUT_MS = 8000;
const AGGREGATE_API_URL = "https://scarabev-api.paperpandastacks.workers.dev/api/aggregate";
const ATLAS_MAX_OPTIMIZE_STEPS = 24;
const SNAPSHOT_RETRY_KEY = `${CACHE_PREFIX}:snapshot-retry`;
const SNAPSHOT_STATUS_KEY = `${CACHE_PREFIX}:snapshot-status`;
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
const BULK_NAME_MAP_KEY = `${CACHE_PREFIX}:bulk-name-map`;
const BULK_MISMATCH_LOG_KEY = `${CACHE_PREFIX}:bulk-mismatch-log`;
const BULK_MISMATCH_LOG_MAX = 500;

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
    const now = new Date(event?.scheduledTime || Date.now());
    const utcMinute = now.getUTCMinutes();
    if (cron === "0 18 * * *") {
      ctx.waitUntil(pruneFailureLogs(env, now));
      ctx.waitUntil(runDailyEVSnapshot(env));
      return;
    }
    if (cron === "*/5 * * * *") {
      ctx.waitUntil(refreshCurrentLeagueMarketBundle(env));
      if (utcMinute === 5) ctx.waitUntil(refreshStandardMarketBundle(env));
      if (utcMinute === 10) ctx.waitUntil(refreshCurrentLeagueCache(env));
      ctx.waitUntil(runPendingSnapshotRetry(env));
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
    await logFailureEvent(
      { EV_HISTORY: kv },
      "cache_refresh_failed",
      "Market cache refresh failed.",
      {
        cacheKey: key,
        failCount: nextFail,
        nextRetryAt: new Date(now + backoffMs).toISOString()
      }
    );
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
  const [rawStatus, rawRetry] = await Promise.all([
    env.EV_HISTORY.get(SNAPSHOT_STATUS_KEY),
    env.EV_HISTORY.get(SNAPSHOT_RETRY_KEY)
  ]);
  const status = parseJsonObject(rawStatus);
  const retry = parseJsonObject(rawRetry);
  const sameDayStatus = String(status?.date || "") === today ? status : null;
  const sameDayRetry = String(retry?.date || "") === today ? retry : null;
  const leaguesMap = (sameDayStatus?.leagues && typeof sameDayStatus.leagues === "object")
    ? sameDayStatus.leagues
    : {};
  const targetLeagues = Array.isArray(sameDayStatus?.targetLeagues)
    ? sameDayStatus.targetLeagues.map((s) => String(s)).filter(Boolean)
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
  const pendingLeagues = Array.isArray(sameDayRetry?.pendingLeagues)
    ? sameDayRetry.pendingLeagues.map((s) => String(s)).filter(Boolean)
    : targetLeagues.filter((league) => String(leaguesMap?.[league]?.state || "") === "retrying" && !failedSet.has(league));
  const anyCompleted = completedLeagues.length > 0;
  const anyPending = pendingLeagues.length > 0;
  const anyFailed = failedSet.size > 0 || String(sameDayRetry?.status || "") === "failed";
  let overallStatus = "idle";
  if (targetLeagues.length) {
    if (anyPending) overallStatus = anyCompleted ? "partial_retrying" : "retrying";
    else if (anyFailed) overallStatus = anyCompleted ? "partial_failed" : "failed";
    else if (completedLeagues.length === targetLeagues.length) overallStatus = "success";
    else overallStatus = "partial";
  }

  return withCors(jsonResponse({
    ok: true,
    date: sameDayStatus?.date || today,
    status: overallStatus,
    targetLeagues,
    completedLeagues,
    pendingLeagues,
    failedLeagues: [...failedSet],
    incompleteLeagues,
    retryCount: Number(sameDayRetry?.retryCount || 0),
    nextRetryAt: sameDayRetry?.nextRetryAt || null,
    lastAttemptAt: sameDayStatus?.lastAttemptAt || sameDayRetry?.lastAttemptAt || null,
    errors: sameDayRetry?.errors || {},
    leagues: leaguesMap
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
      await logFailureEvent(env, "backup_smoke_failed", "Backup smoke restore readback mismatch.", {
        sourceKey: source.key,
        testedAt
      }, {
        severity: "warn"
      });
      return withCors(jsonResponse({
        ok: false,
        status
      }, 500));
    }
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
    await logFailureEvent(env, "backup_smoke_failed", "Backup smoke restore test failed.", {
      testedAt,
      error: status.error
    }, {
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
  try {
    const data = await fetchNinjaExchange(league, "Scarab");
    if (!Array.isArray(data?.lines) || !data.lines.length) {
      await logFailureEvent(env, "snapshot_no_scarab_lines", "Snapshot failed: no scarab lines.", { league, date: today, stage: "fetch_scarab" });
      return { ok: false, error: "no_scarab_lines" };
    }

    const harmonicEv = calcHarmonicEV(data.lines);
    if (!Number.isFinite(harmonicEv)) {
      await logFailureEvent(env, "snapshot_harmonic_unavailable", "Snapshot failed: harmonic EV unavailable.", { league, date: today, stage: "compute_harmonic" });
      return { ok: false, error: "harmonic_unavailable" };
    }

    const weightResult = await fetchObservedWeightsForLeague(env, league);
    const weights = weightResult && weightResult.weights;
    if (!weights || typeof weights !== "object" || !Object.keys(weights).length) {
      await logFailureEvent(env, "snapshot_weights_unavailable", "Snapshot failed: observed weights unavailable.", {
        league,
        date: today,
        stage: "fetch_weights",
        fetchError: String(weightResult?.error || "unknown")
      });
      return { ok: false, error: "weights_unavailable" };
    }
    const weightedEv = calcWeightedThresholdEV(data.lines, weights);
    if (!Number.isFinite(weightedEv) || weightedEv <= 0) {
      await logFailureEvent(env, "snapshot_weighted_unavailable", "Snapshot failed: weighted EV unavailable.", {
        league,
        date: today,
        stage: "compute_weighted_ev"
      });
      return { ok: false, error: "weighted_unavailable" };
    }
    const atlasSnapshot = calcAtlasBaselineOptimizedEV(data.lines, weights);
    if (!atlasSnapshot || !Number.isFinite(atlasSnapshot.baselineEv) || !Number.isFinite(atlasSnapshot.optimizedEv)) {
      await logFailureEvent(env, "snapshot_atlas_unavailable", "Snapshot failed: atlas EV unavailable.", {
        league,
        date: today,
        stage: "compute_atlas_ev"
      });
      return { ok: false, error: "atlas_unavailable" };
    }

    const evKey = `ev-history-${league.toLowerCase()}`;
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
    await env.EV_HISTORY.put(evKey, JSON.stringify(evHistory.filter((e) => e.date >= evCutoffStr)));

    let wroteAtlas = false;
    if (
      atlasSnapshot &&
      Number.isFinite(atlasSnapshot.baselineEv) &&
      Number.isFinite(atlasSnapshot.optimizedEv)
    ) {
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
      wroteAtlas = true;
    }

    const priceKey = `price-history-${league.toLowerCase()}`;
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
    if (backfillFallbackActive) {
      await logFailureEvent(env, "price_history_backfill_fallback_used", "Emergency price-history sparkline backfill fallback applied.", {
        league,
        date: today,
        expiresAt: backfillFallback?.expiresAt ? new Date(backfillFallback.expiresAt).toISOString() : null
      }, {
        severity: "warn"
      });
    }

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

    const nextDistinctDays = countPriceHistoryDistinctDays(priceHistory);
    const shrinkGuardFloor = Math.max(
      PRICE_HISTORY_GUARD_FLOOR_DAYS,
      previousDistinctDays - 3
    );
    const suspiciousShrink = previousDistinctDays >= PRICE_HISTORY_GUARD_MIN_DAYS
      && nextDistinctDays < shrinkGuardFloor;
    if (suspiciousShrink) {
      await logFailureEvent(env, "price_history_shrink_guard", "Price history write blocked due to suspicious history-depth drop.", {
        league,
        date: today,
        previousDistinctDays,
        nextDistinctDays,
        shrinkGuardFloor
      });
      return { ok: false, error: "price_history_shrink_guard" };
    }

    // Keep a rolling backup of the prior state before mutating primary history.
    if (previousDistinctDays > 0) {
      const backupKey = `price-history-backup-${league.toLowerCase()}`;
      await env.EV_HISTORY.put(backupKey, JSON.stringify({
        capturedAt: new Date().toISOString(),
        league,
        previousDistinctDays,
        data: previousPriceHistory
      }));
    }

    await env.EV_HISTORY.put(priceKey, JSON.stringify(priceHistory));
    return {
      ok: true,
      writes: {
        ev: true,
        atlas: wroteAtlas,
        price: true
      },
      values: {
        harmonicEv: Number(harmonicEv.toFixed(4)),
        weightedEv: Number.isFinite(weightedEv) ? Number(weightedEv.toFixed(4)) : null
      }
    };
  } catch (e) {
    await logFailureEvent(env, "snapshot_exception", "Snapshot failed with exception.", { league, date: today, error: String(e?.message || e || "snapshot_failed") });
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

function countPriceHistoryDistinctDays(history) {
  if (!history || typeof history !== "object") return 0;
  const dates = new Set();
  for (const seriesRaw of Object.values(history)) {
    const series = Array.isArray(seriesRaw) ? seriesRaw : [];
    for (const entry of series) {
      const date = String(entry?.date || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
    }
  }
  return dates.size;
}

async function saveSnapshotRetryState(env, date, failures, retryCount) {
  if (!env.EV_HISTORY) return;
  const errors = {};
  for (const f of failures) errors[f.league] = String(f.error || "snapshot_failed");
  if ((Number(retryCount) || 0) >= SNAPSHOT_RETRY_MAX_ATTEMPTS) {
    await logFailureEvent(env, "snapshot_retry_exhausted", "Snapshot retries exhausted for one or more leagues.", {
      date,
      retryCount: Number(retryCount) || 0,
      failedLeagues: failures.map((f) => f.league),
      errors
    });
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
    if (!success) failures.push({ league, error: lastError });
    if (!success) {
      await logFailureEvent(env, "snapshot_league_incomplete", "League snapshot incomplete; retry queued.", {
        league,
        date: today,
        error: String(lastError || "snapshot_failed"),
        writes,
        attemptsUsed
      });
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
  }

  statusState.lastAttemptAt = new Date().toISOString();
  const exhausted = (Number(opts.retryCount) || 0) >= SNAPSHOT_RETRY_MAX_ATTEMPTS;
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
  }
  await env.EV_HISTORY.put(SNAPSHOT_STATUS_KEY, JSON.stringify(statusState));
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

function parseJsonObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_e) {
    return null;
  }
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

    const received = data?.receivedByScarab && typeof data.receivedByScarab === "object"
      ? data.receivedByScarab
      : null;
    if (!received) return { weights: null, error: "aggregate_missing_received" };
    const total = Object.values(received).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if (!Number.isFinite(total) || total <= 0) return { weights: null, error: "aggregate_received_total_zero" };

    const normalized = {};
    for (const [name, count] of Object.entries(received)) {
      const c = Number(count) || 0;
      if (c > 0) normalized[name] = c / total;
    }
    return Object.keys(normalized).length ? { weights: normalized, error: null } : { weights: null, error: "aggregate_received_normalized_empty" };
    } catch (e) {
      lastError = String(e?.message || e || "weights_fetch_failed");
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  return { weights: null, error: lastError || "weights_fetch_failed" };
}

async function fetchAggregateForLeague(env, league, userAgent = "ScarabEV/1.1 (market-worker weighted snapshot)") {
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
  return fetchWithTimeout(`${AGGREGATE_API_URL}?league=${encodeURIComponent(league)}`, init, UPSTREAM_TIMEOUT_MS);
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
