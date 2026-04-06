const CACHE_PREFIX = "market-cache-v2";
const KEY_CURRENT_LEAGUE = `${CACHE_PREFIX}:current-league`;
const BACKOFF_STEPS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const UPSTREAM_TIMEOUT_MS = 8000;

const POLICY = {
  currentLeague: {
    freshMs: 10 * 60 * 1000,
    maxStaleMs: 24 * 60 * 60 * 1000
  },
  market: {
    freshMs: 60 * 1000,
    maxStaleMs: 15 * 60 * 1000
  }
};

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const cron = String(event.cron || "");
    if (cron === "0 0 * * *") {
      ctx.waitUntil(runDailyEVSnapshot(env));
      return;
    }
    if (cron === "*/10 * * * *") {
      ctx.waitUntil(refreshCurrentLeagueCache(env));
      return;
    }
    if (cron === "* * * * *") {
      ctx.waitUntil(refreshHotMarketCaches(env));
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
  if (type === "CurrentLeague") return handleCurrentLeague(env);

  if (type === "Scarab" || type === "Currency") {
    return handleCachedMarketProxy(league, type, env);
  }
  return handleNinjaProxy(league, type);
}

async function handleCurrentLeague(env) {
  const fetcher = async () => {
    const payload = await fetchCurrentLeagueData();
    return { data: payload };
  };
  return handleCachedResource(env, KEY_CURRENT_LEAGUE, POLICY.currentLeague, fetcher, "current-league");
}

async function handleCachedMarketProxy(league, type, env) {
  const key = `${CACHE_PREFIX}:${type.toLowerCase()}:${league.toLowerCase()}`;
  const fetcher = async () => {
    const data = await fetchNinjaExchange(league, type);
    return { data };
  };
  return handleCachedResource(env, key, POLICY.market, fetcher, "market");
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
    const fresh = await fetcher();
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

async function refreshHotMarketCaches(env) {
  if (!env.EV_HISTORY) return;
  const now = Date.now();
  const leagueData = await getCachedCurrentLeagueValue(env);
  const leagues = new Set(["Standard"]);
  if (leagueData) leagues.add(String(leagueData.league));

  for (const league of leagues) {
    for (const type of ["Scarab", "Currency"]) {
      const key = `${CACHE_PREFIX}:${type.toLowerCase()}:${String(league).toLowerCase()}`;
      const existing = await readCacheState(env.EV_HISTORY, key);
      await tryRefreshState(env.EV_HISTORY, key, existing, async () => ({ data: await fetchNinjaExchange(league, type) }), now);
    }
  }
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

async function runDailyEVSnapshot(env) {
  if (!env.EV_HISTORY) return;
  const leagues = [];
  try {
    const pair = await fetchCurrentChallengeLeaguePair();
    if (pair.softcore) leagues.push(pair.softcore);
    if (pair.hardcore) leagues.push(pair.hardcore);
  } catch (_e) {
    return;
  }
  leagues.push("Standard");

  for (const league of leagues) {
    try {
      const data = await fetchNinjaExchange(league, "Scarab");
      if (!Array.isArray(data?.lines) || !data.lines.length) continue;

      const today = new Date().toISOString().slice(0, 10);
      const ev = calcHarmonicEV(data.lines);
      if (ev && ev > 0) {
        const evKey = `ev-history-${league.toLowerCase()}`;
        const evStored = await env.EV_HISTORY.get(evKey);
        const evHistory = evStored ? JSON.parse(evStored) : [];
        if (!evHistory.some((e) => e.date === today)) {
          evHistory.push({ date: today, ev: Number(ev.toFixed(4)) });
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 90);
          const cutoffStr = cutoff.toISOString().slice(0, 10);
          await env.EV_HISTORY.put(
            evKey,
            JSON.stringify(evHistory.filter((e) => e.date >= cutoffStr))
          );
        }
      }

      const priceKey = `price-history-${league.toLowerCase()}`;
      const priceStored = await env.EV_HISTORY.get(priceKey);
      const priceHistory = priceStored ? JSON.parse(priceStored) : {};
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      for (const line of data.lines) {
        const name = line.name;
        const price = line.chaosValue ?? line.chaosEquivalent ?? line.primaryValue ?? null;
        if (!name || !price || price <= 0) continue;
        if (!priceHistory[name]) priceHistory[name] = [];
        if (priceHistory[name].some((e) => e.date === today)) continue;
        priceHistory[name].push({ date: today, price: Number(price.toFixed(4)) });
        priceHistory[name] = priceHistory[name].filter((e) => e.date >= cutoffStr);
      }
      await env.EV_HISTORY.put(priceKey, JSON.stringify(priceHistory));
    } catch (_e) {
      // Keep cron resilient.
    }
  }
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
