// Market data parsing and lookup helpers.
// Owns worker/legacy response parsing and price/image lookup utilities.
// Provides CSV parsing helpers consumed by frontend orchestration.
// Reads shared market state where required.
// Does not render UI or control fetch fallback strategy.

import { state } from './state.js';

export function parseWorkerResponse(data) {
  if (!Array.isArray(data?.lines) || !data.lines.length)
    throw new Error(`no lines array (keys: ${Object.keys(data||{}).join(', ')})`);

  const idToItem = {};
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.id) idToItem[item.id] = item;
    }
  }

  const rawPrices = {};
  const rawImages = {};
  const rawSparklines = {}; // { name -> {totalChange, data: [pct...]} }
  for (const line of data.lines) {
    const price = line.primaryValue ?? line.chaosValue ?? line.chaosEquivalent ?? null;
    if (!price || price <= 0) continue;
    const item = (line.id && idToItem[line.id]) || null;
    const name = (item?.name) || line.name || null;
    if (!name) continue;
    rawPrices[name] = price;
    // Worker image paths are relative like /gen/image/..., make them absolute
    if (item?.image) {
      rawImages[name] = item.image.startsWith('http')
        ? item.image
        : `https://web.poecdn.com${item.image}`;
    }
    if (line.sparkline?.data?.length >= 2) {
      rawSparklines[name] = { totalChange: line.sparkline.totalChange, data: line.sparkline.data };
    }
  }

  // Convert % change series into synthetic price points for buildSparkline
  // We have the current price and 7 daily % changes (cumulative from 7 days ago).
  // Reconstruct absolute prices by working backwards from current price.
  const priceHistory = {};
  const priceTotalChange = {}; // { name -> totalChange % }
  const today = new Date();
  for (const [name, spark] of Object.entries(rawSparklines)) {
    const currentPrice = rawPrices[name];
    if (!currentPrice) continue;
    priceTotalChange[name] = spark.totalChange;
    const pcts = spark.data;
    // Each pcts[i] is % change relative to the price 7 days ago (same baseline).
    // baseline = currentPrice / (1 + totalChange/100)
    // price[i] = baseline * (1 + pcts[i]/100)
    const baseline = currentPrice / (1 + spark.totalChange / 100);
    if (!baseline || baseline <= 0) continue;
    const points = [];
    for (let i = 0; i < pcts.length; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (pcts.length - 1 - i));
      const dateStr = d.toISOString().slice(0, 10);
      points.push({ date: dateStr, price: parseFloat((baseline * (1 + pcts[i] / 100)).toFixed(4)) });
    }
    priceHistory[name] = points;
  }

  return { rawPrices, rawImages, priceHistory, priceTotalChange };
}

export function parseOldNinjaResponse(text, unwrap) {
  if (!text || text.length < 100) throw new Error('empty response');
  let data;
  try {
    const parsed = JSON.parse(text);
    data = (unwrap && parsed.contents) ? JSON.parse(parsed.contents) : parsed;
    if (!data.lines && data.contents) data = JSON.parse(data.contents);
  } catch(e) {
    throw new Error(`bad JSON: ${text.slice(0, 60).replace(/\n/g,' ')}`);
  }
  if (!Array.isArray(data?.lines) || !data.lines.length)
    throw new Error(`no lines array (keys: ${Object.keys(data||{}).join(', ')})`);

  const rawPrices = {};
  const rawImages = {};
  for (const item of data.lines) {
    if (!item.name) continue;
    const price = item.chaosValue ?? item.chaosEquivalent ?? null;
    if (!price || price <= 0) continue;
    rawPrices[item.name] = price;
    if (item.icon) rawImages[item.name] = item.icon;
  }
  return { rawPrices, rawImages };
}

export function buildNinjaLookup() {
  const lower = {};
  for (const [name, price] of Object.entries(state.ninjaPrices)) {
    lower[name.toLowerCase()] = { price, name };
  }
  return lower;
}

export function getNinjaPrice(scarabName, lower) {
  return state.ninjaPrices[scarabName] ?? lower[scarabName.toLowerCase()]?.price ?? 0;
}

export function getNinjaImage(scarabName) {
  return state.ninjaImages[scarabName]
    || state.ninjaImages[Object.keys(state.ninjaImages).find(k => k.toLowerCase() === scarabName.toLowerCase())]
    || null;
}

export function parseSnapCSV(text) {
  const result = {};
  const lines = text.replace(/^\uFEFF/, '').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 3) continue;
    const name = cols[0].replace(/"/g, '').trim();
    const qty  = parseInt(cols[2].replace(/"/g, '')) || 0;
    if (name && qty > 0) result[name] = (result[name] || 0) + qty;
  }
  return result;
}
