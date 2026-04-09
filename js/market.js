// Market data parsing and lookup helpers.
// Owns worker response parsing and price/image lookup utilities.
// Provides CSV parsing helpers consumed by frontend orchestration.
// Reads shared market state where required.
// Does not render UI or control fetch fallback strategy.

import { state } from './state.js';

function toLocalDateKey(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
      const dateStr = toLocalDateKey(d);
      points.push({ date: dateStr, price: parseFloat((baseline * (1 + pcts[i] / 100)).toFixed(4)) });
    }
    priceHistory[name] = points;
  }

  return { rawPrices, rawImages, priceHistory, priceTotalChange };
}

export function buildNinjaLookup() {
  const prices = state.ninjaPrices && typeof state.ninjaPrices === 'object' ? state.ninjaPrices : {};
  const lower = {};
  for (const [name, price] of Object.entries(prices)) {
    lower[name.toLowerCase()] = { price, name };
  }
  return lower;
}

export function getNinjaPrice(scarabName, lower) {
  const prices = state.ninjaPrices && typeof state.ninjaPrices === 'object' ? state.ninjaPrices : {};
  return prices[scarabName] ?? lower?.[scarabName.toLowerCase()]?.price ?? 0;
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
