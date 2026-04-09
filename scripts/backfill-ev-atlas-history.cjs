#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const LEAGUE = process.env.LEAGUE || 'Mirage';
const NAMESPACE_ID = process.env.EV_HISTORY_NAMESPACE_ID || '45058621c81d439d9ce0d12b61dc0c66';
const WORKER_URL = process.env.WORKER_URL || 'https://scarabev-market-worker.paperpandastacks.workers.dev';
const AGGREGATE_API_URL = process.env.AGGREGATE_API_URL || 'https://scarabev-api.paperpandastacks.workers.dev/api/aggregate';
const DAYS_TO_BACKFILL = Number(process.env.BACKFILL_DAYS || 7);
const ATLAS_MAX_OPTIMIZE_STEPS = 24;
const DRY_RUN = String(process.env.DRY_RUN || '').trim() === '1';

function run(cmd) {
  return cp.execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function kvGetJson(key) {
  const cmd = `npx.cmd wrangler kv key get --remote --namespace-id ${NAMESPACE_ID} ${key}`;
  let raw = '';
  try {
    raw = run(cmd);
  } catch (err) {
    const text = String(err && (err.stderr || err.message || err));
    if (text.includes('404') || text.includes('Not Found')) return null;
    throw err;
  }
  if (!raw) return null;
  return JSON.parse(raw);
}

function kvPutJson(key, value) {
  const outDir = path.resolve(process.cwd(), '.temp');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${key.replace(/[^a-z0-9-_]/gi, '_')}.json`);
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  if (DRY_RUN) return filePath;
  const cmd = `npx.cmd wrangler kv key put --remote --namespace-id ${NAMESPACE_ID} ${key} --path "${filePath}"`;
  run(cmd);
  return filePath;
}

function extractExportArray(configText, exportName) {
  const re = new RegExp(`export const ${exportName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`);
  const m = configText.match(re);
  if (!m) throw new Error(`Could not parse ${exportName} from js/config.js`);
  return Function(`"use strict"; return (${m[1]});`)();
}

function toDateKey(s) {
  return String(s || '').slice(0, 10);
}

function derivePriceHistoryFromWorkerScarabPayload(data) {
  const idToItem = {};
  if (Array.isArray(data?.items)) {
    for (const item of data.items) {
      if (item && item.id) idToItem[item.id] = item;
    }
  }

  const currentPrices = {};
  const sparklines = {};
  for (const line of Array.isArray(data?.lines) ? data.lines : []) {
    const price = Number(line?.primaryValue ?? line?.chaosValue ?? line?.chaosEquivalent ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const item = line?.id ? idToItem[line.id] : null;
    const name = (item && item.name) || line?.name;
    if (!name) continue;
    currentPrices[name] = price;

    const spark = line?.sparkline;
    if (spark && Array.isArray(spark.data) && spark.data.length >= 2 && Number.isFinite(Number(spark.totalChange))) {
      sparklines[name] = { totalChange: Number(spark.totalChange), data: spark.data.map(Number) };
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const baseToday = new Date(`${todayIso}T00:00:00Z`);
  const priceHistoryByName = new Map();
  for (const [name, spark] of Object.entries(sparklines)) {
    const current = Number(currentPrices[name]);
    if (!Number.isFinite(current) || current <= 0) continue;
    const baseline = current / (1 + (spark.totalChange / 100));
    if (!Number.isFinite(baseline) || baseline <= 0) continue;
    const arr = [];
    for (let i = 0; i < spark.data.length; i++) {
      const d = new Date(baseToday);
      d.setUTCDate(d.getUTCDate() - (spark.data.length - 1 - i));
      const date = d.toISOString().slice(0, 10);
      const pct = Number(spark.data[i]);
      if (!Number.isFinite(pct)) continue;
      const price = baseline * (1 + pct / 100);
      if (!Number.isFinite(price) || price <= 0) continue;
      arr.push({ date, price: Number(price.toFixed(6)) });
    }
    if (arr.length) priceHistoryByName.set(name, arr);
  }
  return priceHistoryByName;
}

function buildDateMap(priceHistoryByName) {
  const dateMap = new Map();
  for (const [name, points] of priceHistoryByName.entries()) {
    for (const p of points) {
      const date = toDateKey(p.date);
      if (!date) continue;
      let byName = dateMap.get(date);
      if (!byName) {
        byName = new Map();
        dateMap.set(date, byName);
      }
      byName.set(name, Number(p.price));
    }
  }
  return dateMap;
}

function normalizeWeights(payload) {
  if (payload && payload.weights && typeof payload.weights === 'object' && Object.keys(payload.weights).length) {
    const out = {};
    for (const [k, v] of Object.entries(payload.weights)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    if (Object.keys(out).length) return out;
  }

  if (payload && payload.receivedByScarab && typeof payload.receivedByScarab === 'object') {
    const total = Object.values(payload.receivedByScarab).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    const out = {};
    for (const [k, v] of Object.entries(payload.receivedByScarab)) {
      const n = Number(v) || 0;
      if (n > 0) out[k] = n / total;
    }
    return Object.keys(out).length ? out : null;
  }

  return null;
}

function calcHarmonicThreshold(prices) {
  if (!Array.isArray(prices) || prices.length < 5) return null;
  const inv = prices.reduce((sum, p) => sum + (1 / p), 0);
  if (!Number.isFinite(inv) || inv <= 0) return null;
  const harmonic = prices.length / inv;
  const floored = Math.floor(harmonic * 100) / 100;
  return Number(floored.toFixed(4));
}

function calcWeightedThreshold(pricesByName, weights) {
  if (!weights) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [name, wRaw] of Object.entries(weights)) {
    const w = Number(wRaw);
    const price = Number(pricesByName.get(name));
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    weightedSum += w * price;
    totalWeight += w;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  const threshold = (weightedSum / totalWeight) / 3;
  return Number.isFinite(threshold) && threshold > 0 ? Number(threshold.toFixed(4)) : null;
}

function calcAtlasEvForSets(scarabList, weights, pricesByName, blocked, boosted) {
  let totalW = 0;
  for (const scarab of scarabList) {
    if (blocked.has(scarab.group)) continue;
    const weight = Number(weights[scarab.name] || 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const mult = boosted.has(scarab.group) ? 2 : 1;
    totalW += weight * mult;
  }
  if (!Number.isFinite(totalW) || totalW <= 0) return null;

  let ev = 0;
  for (const scarab of scarabList) {
    if (blocked.has(scarab.group)) continue;
    const weight = Number(weights[scarab.name] || 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const mult = boosted.has(scarab.group) ? 2 : 1;
    const w = weight * mult;
    const price = Number(pricesByName.get(scarab.name) || 0);
    ev += (w / totalW) * (Number.isFinite(price) && price > 0 ? price : 0);
  }
  return Number.isFinite(ev) && ev > 0 ? ev : null;
}

function calcAtlasBaselineOptimized(scarabList, blockable, boostable, weights, pricesByName) {
  const baseline = calcAtlasEvForSets(scarabList, weights, pricesByName, new Set(), new Set());
  if (!Number.isFinite(baseline) || baseline <= 0) return null;

  const blocked = new Set();
  const boosted = new Set();
  let current = baseline;
  for (let i = 0; i < ATLAS_MAX_OPTIMIZE_STEPS; i++) {
    let bestDelta = 0;
    let bestAction = null;

    for (const group of blockable) {
      if (blocked.has(group)) continue;
      const nextBlocked = new Set(blocked);
      nextBlocked.add(group);
      const nextEv = calcAtlasEvForSets(scarabList, weights, pricesByName, nextBlocked, boosted);
      if (!Number.isFinite(nextEv)) continue;
      const delta = nextEv - current;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestAction = { type: 'block', group, nextEv };
      }
    }

    for (const group of boostable) {
      if (boosted.has(group)) continue;
      const nextBoosted = new Set(boosted);
      nextBoosted.add(group);
      const nextEv = calcAtlasEvForSets(scarabList, weights, pricesByName, blocked, nextBoosted);
      if (!Number.isFinite(nextEv)) continue;
      const delta = nextEv - current;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestAction = { type: 'boost', group, nextEv };
      }
    }

    if (!bestAction || bestDelta <= 0.0000005) break;
    if (bestAction.type === 'block') blocked.add(bestAction.group);
    if (bestAction.type === 'boost') boosted.add(bestAction.group);
    current = bestAction.nextEv;
  }

  return {
    baselineEv: Number(baseline.toFixed(4)),
    optimizedEv: Number(current.toFixed(4))
  };
}

function upsertByDate(arr, entry) {
  const idx = arr.findIndex((r) => String(r.date) === String(entry.date));
  if (idx >= 0) arr[idx] = { ...arr[idx], ...entry };
  else arr.push(entry);
}

function keepLast90Days(arr) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return arr
    .filter((r) => String(r.date || '') >= cutoffKey)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function main() {
  const configText = fs.readFileSync(path.resolve(process.cwd(), 'js/config.js'), 'utf8');
  const SCARAB_LIST = extractExportArray(configText, 'SCARAB_LIST');
  const ATLAS_BLOCKABLE = extractExportArray(configText, 'ATLAS_BLOCKABLE');
  const ATLAS_BOOSTABLE = extractExportArray(configText, 'ATLAS_BOOSTABLE');

  const marketRes = await fetch(`${WORKER_URL}?league=${encodeURIComponent(LEAGUE)}&type=Scarab`, { cache: 'no-store' });
  if (!marketRes.ok) throw new Error(`Market fetch failed: HTTP ${marketRes.status}`);
  const marketData = await marketRes.json();
  const historyByName = derivePriceHistoryFromWorkerScarabPayload(marketData);
  const pricesByDate = buildDateMap(historyByName);
  const dates = [...pricesByDate.keys()].sort((a, b) => a.localeCompare(b)).slice(-Math.max(1, DAYS_TO_BACKFILL));
  if (!dates.length) throw new Error('No historical dates could be derived from worker scarab payload');

  const weightsRes = await fetch(`${AGGREGATE_API_URL}?league=${encodeURIComponent(LEAGUE)}`, { cache: 'no-store' });
  if (!weightsRes.ok) throw new Error(`Weights fetch failed: HTTP ${weightsRes.status}`);
  const weightsData = await weightsRes.json();
  const weights = normalizeWeights(weightsData);
  if (!weights) throw new Error('Could not resolve weights from aggregate payload');

  const evKey = `ev-history-${LEAGUE.toLowerCase()}`;
  const atlasKey = `atlas-ev-history-${LEAGUE.toLowerCase()}`;
  const evExisting = kvGetJson(evKey);
  const atlasExisting = kvGetJson(atlasKey);
  const evHistory = Array.isArray(evExisting) ? evExisting : [];
  const atlasHistory = Array.isArray(atlasExisting) ? atlasExisting : [];

  let patchedHarmonic = 0;
  let patchedWeighted = 0;
  let patchedAtlas = 0;

  for (const date of dates) {
    const pricesByName = pricesByDate.get(date) || new Map();
    const priceValues = [...pricesByName.values()].filter((n) => Number.isFinite(n) && n > 0);

    const harmonic = calcHarmonicThreshold(priceValues);
    const weighted = calcWeightedThreshold(pricesByName, weights);
    const atlas = calcAtlasBaselineOptimized(SCARAB_LIST, ATLAS_BLOCKABLE, ATLAS_BOOSTABLE, weights, pricesByName);

    if (harmonic) {
      const entry = { date, ev: harmonic, harmonicEv: harmonic };
      if (weighted) {
        entry.weightedEv = weighted;
        patchedWeighted += 1;
      }
      patchedHarmonic += 1;
      upsertByDate(evHistory, entry);
    }

    if (atlas && Number.isFinite(atlas.baselineEv) && Number.isFinite(atlas.optimizedEv)) {
      upsertByDate(atlasHistory, {
        date,
        baselineEv: atlas.baselineEv,
        optimizedEv: atlas.optimizedEv
      });
      patchedAtlas += 1;
    }
  }

  const evFinal = keepLast90Days(evHistory);
  const atlasFinal = keepLast90Days(atlasHistory);
  const evOutPath = kvPutJson(evKey, evFinal);
  const atlasOutPath = kvPutJson(atlasKey, atlasFinal);

  console.log(JSON.stringify({
    league: LEAGUE,
    dryRun: DRY_RUN,
    datesBackfilled: dates,
    harmonicPatched: patchedHarmonic,
    weightedPatched: patchedWeighted,
    atlasPatched: patchedAtlas,
    evHistoryCount: evFinal.length,
    atlasHistoryCount: atlasFinal.length,
    evOutputFile: evOutPath,
    atlasOutputFile: atlasOutPath
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
