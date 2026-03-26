// Scarab EV calculation engine.
// Owns calculation helpers for manual and ninja EV paths.
// Uses injected dependencies for scarab lists and price lookups.
// Reads shared state where required, without DOM concerns.
// Does not render UI or orchestrate fetch/network flows.

import { state } from './state.js';

let SCARAB_LIST;
let getP;
let buildNinjaLookup;
let getNinjaPrice;

export function configureScarabEngine(deps) {
  SCARAB_LIST = deps.SCARAB_LIST;
  getP = deps.getP;
  buildNinjaLookup = deps.buildNinjaLookup;
  getNinjaPrice = deps.getNinjaPrice;
}

export function computeWeightBasedRate() {
  // Weights are true observed drop frequencies from community sessions.
  if (!state._observedWeights || !state.ninjaLoaded) return null;
  const lower = buildNinjaLookup();

  const pairs = [];
  for (const s of SCARAB_LIST) {
    const price = getNinjaPrice(s.name, lower);
    if (price <= 0) continue;
    const weight = state._observedWeights[s.name] || 0;
    pairs.push({ name: s.name, weight, price });
  }
  if (!pairs.length) return null;

  const totalWeight = pairs.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return null;

  // Re-normalise so weights of observed scarabs sum to 1.0
  const mean = pairs.reduce((s, p) => s + (p.weight / totalWeight) * p.price, 0) / 3;
  if (mean <= 0) return null;

  // `conservative` is kept as a compatibility alias for existing call sites.
  return { mean, conservative: mean };
}

export function calcEV(entries) {
  // entries = [{chaosEa}], filter out zeros
  const valid = entries.filter(e => e.chaosEa > 0);
  if (valid.length < 2) return null;
  let sumW = 0;
  for (const e of valid) sumW += 1 / e.chaosEa;
  const ev = valid.length / sumW;
  return Math.floor(ev * 100) / 100;
}

export function getManualEntries() {
  return SCARAB_LIST.map(s => {
    const p = getP(s.name);
    return { name: s.name, group: s.group, chaosEa: p.cost > 0 && p.qty > 0 ? p.cost / p.qty : 0 };
  });
}

export function getNinjaEntries() {
  const lower = buildNinjaLookup();
  return SCARAB_LIST.map(s => {
    // Manual override takes priority over poe.ninja price
    const p = getP(s.name);
    const manualPrice = p.cost > 0 && p.qty > 0 ? p.cost / p.qty : 0;
    const ninjaPrice = getNinjaPrice(s.name, lower);
    const chaosEa = manualPrice > 0 ? manualPrice : ninjaPrice;
    return { ...s, chaosEa, isManualOverride: manualPrice > 0 };
  });
}

export function calcAutoEV() {
  if (state._evMode === 'weighted' && state._calibratedMean !== null) {
    // Weighted EV threshold: the expected return per input scarab given observed drop frequencies.
    // Vendor anything worth less than this; keep anything worth more.
    return state._calibratedMean;
  }
  const lower = buildNinjaLookup();
  const entries = SCARAB_LIST.map(s => ({ chaosEa: getNinjaPrice(s.name, lower) }));
  const priced = entries.filter(e => e.chaosEa > 0);
  return calcEV(priced);
}
