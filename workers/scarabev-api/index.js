var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var MAX_SESSIONS_PER_IP_PER_HOUR = 20;
var HANDOVER_CONSUMED = 9e4;
var MIN_WEIGHT_OUTPUTS = 100;
var WEIGHT_SEED_VERSION = "phase1-canonical-seeded-v1";
var RARE_SLOT_HASH_SALT = "scarabev-phase1-rare-slot";
var SEED_NORMAL_BASE = 4;
var SEED_NORMAL_MID = 2;
var SEED_NORMAL_RARE = 1;
var SEED_MISC_FLAT = 0.5;
var SEED_HORNED_FLAT = 0.25;
var SPECIAL_GROUP_MISC = "Misc";
var SPECIAL_GROUP_HORNED = "Horned";
var CANONICAL_SCARAB_LIST = [
  { name: "Cartography Scarab of Escalation", group: "Cartography", icon: "LesserScarabMaps.webp" },
  { name: "Cartography Scarab of Risk", group: "Cartography", icon: "NormalScarabMaps.webp" },
  { name: "Cartography Scarab of Corruption", group: "Cartography", icon: "GreaterScarabMaps.webp" },
  { name: "Cartography Scarab of the Multitude", group: "Cartography", icon: "AltNormalScarabMaps.webp" },
  { name: "Divination Scarab of The Cloister", group: "Divination", icon: "LesserScarabDivination.webp" },
  { name: "Divination Scarab of Plenty", group: "Divination", icon: "NormalScarabDivination.webp" },
  { name: "Divination Scarab of Pilfering", group: "Divination", icon: "GreaterScarabDivination.webp" },
  { name: "Bestiary Scarab", group: "Bestiary", icon: "LesserScarabBeasts.webp" },
  { name: "Bestiary Scarab of the Herd", group: "Bestiary", icon: "NormalScarabBeasts.webp" },
  { name: "Bestiary Scarab of Duplicating", group: "Bestiary", icon: "GreaterScarabBeasts.webp" },
  { name: "Betrayal Scarab", group: "Betrayal", icon: "LesserScarabBetrayal.webp" },
  { name: "Betrayal Scarab of the Allflame", group: "Betrayal", icon: "NormalScarabBetrayal.webp" },
  { name: "Betrayal Scarab of Reinforcements", group: "Betrayal", icon: "GreaterScarabBetrayal.webp" },
  { name: "Betrayal Scarab of Unbreaking", group: "Betrayal", icon: "Tier4ScarabBetrayal.webp" },
  { name: "Incursion Scarab", group: "Incursion", icon: "LesserScarabIncursion.webp" },
  { name: "Incursion Scarab of Invasion", group: "Incursion", icon: "NormalScarabIncursion.webp" },
  { name: "Incursion Scarab of Champions", group: "Incursion", icon: "GreaterScarabIncursion.webp" },
  { name: "Incursion Scarab of Timelines", group: "Incursion", icon: "Tier4ScarabIncursion.webp" },
  { name: "Sulphite Scarab", group: "Sulphite", icon: "LesserScarabSulphite.webp" },
  { name: "Sulphite Scarab of Fumes", group: "Sulphite", icon: "GreaterScarabSulphite.webp" },
  { name: "Ambush Scarab", group: "Ambush", icon: "LesserScarabStrongboxes.webp" },
  { name: "Ambush Scarab of Hidden Compartments", group: "Ambush", icon: "NormalScarabStrongboxes.webp" },
  { name: "Ambush Scarab of Potency", group: "Ambush", icon: "GreaterScarabStrongboxes.webp" },
  { name: "Ambush Scarab of Discernment", group: "Ambush", icon: "AltTier4ScarabStrongboxes.webp" },
  { name: "Ambush Scarab of Containment", group: "Ambush", icon: "Tier4ScarabStrongboxes.webp" },
  { name: "Anarchy Scarab", group: "Anarchy", icon: "LesserScarabAnarchy.webp" },
  { name: "Anarchy Scarab of Gigantification", group: "Anarchy", icon: "NormalScarabAnarchy.webp" },
  { name: "Anarchy Scarab of Partnership", group: "Anarchy", icon: "GreaterScarabAnarchy.webp" },
  { name: "Anarchy Scarab of the Exceptional", group: "Anarchy", icon: "GreaterScarabAnarchy.webp" },
  { name: "Beyond Scarab", group: "Beyond", icon: "LesserScarabBeyond.webp" },
  { name: "Beyond Scarab of Haemophilia", group: "Beyond", icon: "NormalScarabBeyond.webp" },
  { name: "Beyond Scarab of Resurgence", group: "Beyond", icon: "AltGreaterScarabBeyond.webp" },
  { name: "Beyond Scarab of the Invasion", group: "Beyond", icon: "Tier4ScarabBeyond.webp" },
  { name: "Domination Scarab", group: "Domination", icon: "LesserScarabDomination.webp" },
  { name: "Domination Scarab of Apparitions", group: "Domination", icon: "NormalScarabDomination.webp" },
  { name: "Domination Scarab of Evolution", group: "Domination", icon: "GreaterScarabDomination.webp" },
  { name: "Domination Scarab of Terrors", group: "Domination", icon: "Tier4ScarabDomination.webp" },
  { name: "Essence Scarab", group: "Essence", icon: "LesserScarabEssence.webp" },
  { name: "Essence Scarab of Ascent", group: "Essence", icon: "NormalScarabEssence.webp" },
  { name: "Essence Scarab of Stability", group: "Essence", icon: "GreaterScarabEssence.webp" },
  { name: "Essence Scarab of Calcification", group: "Essence", icon: "Tier4ScarabEssence.webp" },
  { name: "Essence Scarab of Adaptation", group: "Essence", icon: "AltTier4ScarabEssence.webp" },
  { name: "Torment Scarab", group: "Torment", icon: "LesserScarabTorment.webp" },
  { name: "Torment Scarab of Peculiarity", group: "Torment", icon: "NormalScarabTorment.webp" },
  { name: "Torment Scarab of Possession", group: "Torment", icon: "Tier4ScarabTorment.webp" },
  { name: "Influencing Scarab of the Shaper", group: "Influencing", icon: "LesserScarabShaper.webp" },
  { name: "Influencing Scarab of the Elder", group: "Influencing", icon: "LesserScarabElder.webp" },
  { name: "Influencing Scarab of Hordes", group: "Influencing", icon: "GreaterScarabElder.webp" },
  { name: "Influencing Scarab of Interference", group: "Influencing", icon: "Tier4ScarabShaper.webp" },
  { name: "Titanic Scarab", group: "Titanic", icon: "LesserScarabUnique.webp" },
  { name: "Titanic Scarab of Treasures", group: "Titanic", icon: "NormalScarabUnique.webp" },
  { name: "Titanic Scarab of Legend", group: "Titanic", icon: "GreaterScarabUnique.webp" },
  { name: "Abyss Scarab", group: "Abyss", icon: "LesserScarabAbyss.webp" },
  { name: "Abyss Scarab of Multitudes", group: "Abyss", icon: "NormalScarabAbyss.webp" },
  { name: "Abyss Scarab of Edifice", group: "Abyss", icon: "GreaterScarabAbyss.webp" },
  { name: "Abyss Scarab of Profound Depth", group: "Abyss", icon: "AltTier4ScarabAbyss.webp" },
  { name: "Abyss Scarab of Descending", group: "Abyss", icon: "AltNormalScarabAbyss.webp" },
  { name: "Blight Scarab", group: "Blight", icon: "LesserScarabBlight.webp" },
  { name: "Blight Scarab of the Blightheart", group: "Blight", icon: "GreaterScarabBlight.webp" },
  { name: "Blight Scarab of Blooming", group: "Blight", icon: "Tier4ScarabBlight.webp" },
  { name: "Blight Scarab of Invigoration", group: "Blight", icon: "AltTier4ScarabBlight.webp" },
  { name: "Breach Scarab of the Hive", group: "Breach", icon: "LesserScarabBreach.webp" },
  { name: "Breach Scarab of Instability", group: "Breach", icon: "NormalScarabBreach.webp" },
  { name: "Breach Scarab of the Marshal", group: "Breach", icon: "AltGreaterScarabBreach.webp" },
  { name: "Breach Scarab of the Incensed Swarm", group: "Breach", icon: "GreaterScarabBreach.webp" },
  { name: "Breach Scarab of Resonant Cascade", group: "Breach", icon: "AltTier4ScarabBreach.webp" },
  { name: "Delirium Scarab", group: "Delirium", icon: "LesserScarabDelirium.webp" },
  { name: "Delirium Scarab of Mania", group: "Delirium", icon: "NormalScarabDelirium.webp" },
  { name: "Delirium Scarab of Paranoia", group: "Delirium", icon: "GreaterScarabDelirium.webp" },
  { name: "Delirium Scarab of Neuroses", group: "Delirium", icon: "AltGreaterScarabDelirium.webp" },
  { name: "Delirium Scarab of Delusions", group: "Delirium", icon: "Tier4ScarabDelirium.webp" },
  { name: "Expedition Scarab", group: "Expedition", icon: "LesserScarabExpedition.webp" },
  { name: "Expedition Scarab of Runefinding", group: "Expedition", icon: "NormalScarabExpedition.webp" },
  { name: "Expedition Scarab of Verisium Powder", group: "Expedition", icon: "GreaterScarabExpedition.webp" },
  { name: "Expedition Scarab of Archaeology", group: "Expedition", icon: "Tier4ScarabExpedition.webp" },
  { name: "Expedition Scarab of Infusion", group: "Expedition", icon: "AltGreaterScarabExpedition.webp" },
  { name: "Harvest Scarab", group: "Harvest", icon: "LesserScarabHarvest.webp" },
  { name: "Harvest Scarab of Doubling", group: "Harvest", icon: "GreaterScarabHarvest.webp" },
  { name: "Harvest Scarab of Cornucopia", group: "Harvest", icon: "Tier4ScarabHarvest.webp" },
  { name: "Kalguuran Scarab", group: "Kalguuran", icon: "LesserScarabSettlers.webp" },
  { name: "Kalguuran Scarab of Guarded Riches", group: "Kalguuran", icon: "NormalScarabSettlers.webp" },
  { name: "Kalguuran Scarab of Refinement", group: "Kalguuran", icon: "GreaterScarabSettlers.webp" },
  { name: "Kalguuran Scarab of Enriching", group: "Kalguuran", icon: "GreaterScarabSettlers.webp" },
  { name: "Legion Scarab", group: "Legion", icon: "LesserScarabLegion.webp" },
  { name: "Legion Scarab of Officers", group: "Legion", icon: "NormalScarabLegion.webp" },
  { name: "Legion Scarab of Treasures", group: "Legion", icon: "AltNormalScarabLegion.webp" },
  { name: "Legion Scarab of Eternal Conflict", group: "Legion", icon: "Tier4ScarabLegion.webp" },
  { name: "Ritual Scarab of Selectiveness", group: "Ritual", icon: "LesserScarabRitual.webp" },
  { name: "Ritual Scarab of Wisps", group: "Ritual", icon: "NormalScarabRitual.webp" },
  { name: "Ritual Scarab of Abundance", group: "Ritual", icon: "GreaterScarabRitual.webp" },
  { name: "Ritual Scarab of Corpses", group: "Ritual", icon: "NormalScarabRitual.webp" },
  { name: "Ultimatum Scarab", group: "Ultimatum", icon: "LesserScarabUltimatum.webp" },
  { name: "Ultimatum Scarab of Bribing", group: "Ultimatum", icon: "NormalScarabUltimatum.webp" },
  { name: "Ultimatum Scarab of Dueling", group: "Ultimatum", icon: "GreaterScarabUltimatum.webp" },
  { name: "Ultimatum Scarab of Catalysing", group: "Ultimatum", icon: "Tier4ScarabUltimatum.webp" },
  { name: "Ultimatum Scarab of Inscription", group: "Ultimatum", icon: "AltTier4ScarabUltimatum.webp" },
  { name: "Scarab of Monstrous Lineage", group: "Misc", icon: "LesserScarabMisc.webp" },
  { name: "Scarab of Adversaries", group: "Misc", icon: "AltLesserScarabMisc.webp" },
  { name: "Scarab of Divinity", group: "Misc", icon: "NormalScarabMisc.webp" },
  { name: "Scarab of the Sinistral", group: "Misc", icon: "GreaterScarabMisc.webp" },
  { name: "Scarab of Stability", group: "Misc", icon: "Tier4ScarabMisc.webp" },
  { name: "Scarab of Wisps", group: "Misc", icon: "GreaterScarabMisc1.webp" },
  { name: "Scarab of Radiant Storms", group: "Misc", icon: "Tier4ScarabMisc2.webp" },
  { name: "Scarab of the Dextral", group: "Misc", icon: "AltLesserScarabMisc.webp" },
  { name: "Horned Scarab of Bloodlines", group: "Horned", icon: "SuperScarab1.webp" },
  { name: "Horned Scarab of Nemeses", group: "Horned", icon: "SuperScarab2.webp" },
  { name: "Horned Scarab of Preservation", group: "Horned", icon: "SuperScarab3.webp" },
  { name: "Horned Scarab of Awakening", group: "Horned", icon: "SuperScarab1.webp" },
  { name: "Horned Scarab of Glittering", group: "Horned", icon: "SuperScarab2.webp" },
  { name: "Horned Scarab of Pandemonium", group: "Horned", icon: "SuperScarab3.webp" },
  { name: "Horned Scarab of Tradition", group: "Horned", icon: "SuperScarab1.webp" }
];
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");
function getSessionFlags(session) {
  const flags = [];
  const totalConsumed = session.total_consumed || 0;
  const totalTrades = session.total_trades || 0;
  const totalInput = session.input_value || 0;
  const totalOutput = session.output_value || 0;
  const scarabs = session.scarabs || [];
  if (totalInput > 0 && Math.abs(totalOutput - totalInput) < 1 && totalConsumed === 0)
    flags.push("no change detected");
  if (totalConsumed < 500)
    flags.push("low sample");
  const keeperOutputs = scarabs.filter((r) => !r.was_vendor && (r.received || 0) > 0).length;
  if (totalConsumed >= 500 && keeperOutputs === 0)
    flags.push("zero keeper outputs");
  const totalReceived = scarabs.reduce((s, r) => s + (r.received || 0), 0);
  if (totalReceived > totalConsumed)
    flags.push("outputs > inputs");

  // Recycling check — vendor-target outputs should be ≥ 15% of all received scarabs
  // in a clean single-pass session. Below this threshold indicates the person recycled
  // their cheap outputs back through the vendor multiple times in one session,
  // which skews the weight distribution toward expensive keepers.
  if (totalConsumed >= 500 && totalReceived >= 10) {
    const vendorReceived = scarabs
      .filter(r => r.was_vendor)
      .reduce((s, r) => s + (r.received || 0), 0);
    const vendorReturnRatio = totalReceived > 0 ? vendorReceived / totalReceived : 0;
    if (vendorReturnRatio < 0.15) {
      flags.push("recycled session");
    }
  }

  return flags;
}
__name(getSessionFlags, "getSessionFlags");
async function hashIP(ip) {
  const enc = new TextEncoder().encode(ip || "unknown");
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
__name(hashIP, "hashIP");
async function checkRateLimit(env, ipHash) {
  const windowStart = Math.floor(Date.now() / 36e5);
  const row = await env.DB.prepare("SELECT window_start, count FROM rate_limit WHERE ip_hash = ?").bind(ipHash).first();
  if (row && row.window_start === windowStart && row.count >= MAX_SESSIONS_PER_IP_PER_HOUR)
    return { allowed: false };
  const count = row && row.window_start === windowStart ? row.count + 1 : 1;
  await env.DB.prepare(
    `INSERT INTO rate_limit (ip_hash, window_start, count) VALUES (?, ?, ?)
     ON CONFLICT(ip_hash) DO UPDATE SET
       window_start = excluded.window_start,
       count = CASE WHEN rate_limit.window_start = excluded.window_start THEN rate_limit.count + 1 ELSE 1 END`
  ).bind(ipHash, windowStart, count).run();
  return { allowed: true };
}
__name(checkRateLimit, "checkRateLimit");
function clamp01(n) {
  if (!Number.isFinite(n))
    return 0;
  return Math.max(0, Math.min(1, n));
}
__name(clamp01, "clamp01");
function safeParseJsonMap(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}
__name(safeParseJsonMap, "safeParseJsonMap");
function safeParseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
__name(safeParseJsonArray, "safeParseJsonArray");
function splitCanonicalGroups(catalog) {
  const groups = /* @__PURE__ */ new Map();
  for (const item of catalog) {
    if (!item || !item.name || !item.group)
      continue;
    if (!groups.has(item.group))
      groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  return groups;
}
__name(splitCanonicalGroups, "splitCanonicalGroups");
function buildCanonicalScarabCatalog() {
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const item of CANONICAL_SCARAB_LIST) {
    const name = String(item?.name || "").trim();
    const group = String(item?.group || "").trim();
    if (!name || !group || seen.has(name))
      continue;
    seen.add(name);
    ordered.push({ name, group, icon: String(item?.icon || "") });
  }
  const byName = /* @__PURE__ */ new Set(ordered.map((x) => x.name));
  const groups = splitCanonicalGroups(ordered);
  return { ordered, byName, groups };
}
__name(buildCanonicalScarabCatalog, "buildCanonicalScarabCatalog");
var CANONICAL_SCARAB_CATALOG = buildCanonicalScarabCatalog();
function pickObviousBaseScarab(groupItems) {
  if (!Array.isArray(groupItems) || groupItems.length === 0)
    return null;
  const groupName = String(groupItems[0]?.group || "").trim();
  const byName = /* @__PURE__ */ new Map(groupItems.map((item) => [item.name, item]));
  const obvious = `${groupName} Scarab`;
  if (byName.has(obvious))
    return obvious;
  const lesserByIcon = groupItems.filter((item) => /LesserScarab/i.test(item.icon || ""));
  if (lesserByIcon.length > 0) {
    lesserByIcon.sort((a, b) => a.name.localeCompare(b.name));
    return lesserByIcon[0].name;
  }
  const sortedByName = [...groupItems].sort((a, b) => a.name.localeCompare(b.name));
  return sortedByName[0]?.name || null;
}
__name(pickObviousBaseScarab, "pickObviousBaseScarab");
function stableHash32(input) {
  let h = 2166136261 >>> 0;
  const str = String(input || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
__name(stableHash32, "stableHash32");
function pickDeterministicRareSlot(groupName, candidates, leagueKey) {
  if (!Array.isArray(candidates) || candidates.length === 0)
    return null;
  if (candidates.length === 1)
    return candidates[0];
  const joined = candidates.join("|");
  const seedKey = `${String(leagueKey || "")}::${String(groupName || "")}::${joined}::${RARE_SLOT_HASH_SALT}`;
  const idx = stableHash32(seedKey) % candidates.length;
  return candidates[idx];
}
__name(pickDeterministicRareSlot, "pickDeterministicRareSlot");
function normalizeWeightMapStable(weightMap, catalog) {
  let sum = 0;
  for (const v of Object.values(weightMap || {}))
    sum += Number(v) || 0;
  if (sum <= 0)
    return {};
  const out = {};
  for (const item of catalog.ordered) {
    const raw = Number(weightMap[item.name]) || 0;
    if (raw > 0)
      out[item.name] = raw / sum;
  }
  return out;
}
__name(normalizeWeightMapStable, "normalizeWeightMapStable");
function seedCanonicalWeights(rawWeights, leagueKey) {
  const catalog = CANONICAL_SCARAB_CATALOG;
  const source = rawWeights && typeof rawWeights === "object" ? rawWeights : {};
  const canonical = {};
  let removedCount = 0;
  let preservedObservedCount = 0;
  for (const [name, value] of Object.entries(source)) {
    if (!catalog.byName.has(name)) {
      removedCount += 1;
      continue;
    }
    const n = Number(value) || 0;
    if (n > 0) {
      canonical[name] = n;
      preservedObservedCount += 1;
    }
  }
  let seededCount = 0;
  for (const [groupName, groupItems] of catalog.groups.entries()) {
    if (groupName === SPECIAL_GROUP_MISC) {
      for (const item of groupItems) {
        if ((Number(canonical[item.name]) || 0) > 0)
          continue;
        canonical[item.name] = SEED_MISC_FLAT;
        seededCount += 1;
      }
      continue;
    }
    if (groupName === SPECIAL_GROUP_HORNED) {
      for (const item of groupItems) {
        if ((Number(canonical[item.name]) || 0) > 0)
          continue;
        canonical[item.name] = SEED_HORNED_FLAT;
        seededCount += 1;
      }
      continue;
    }
    const baseName = pickObviousBaseScarab(groupItems);
    if (baseName && (Number(canonical[baseName]) || 0) <= 0) {
      canonical[baseName] = SEED_NORMAL_BASE;
      seededCount += 1;
    }
    const remainingMissing = groupItems.map((item) => item.name).filter((name) => name !== baseName && (Number(canonical[name]) || 0) <= 0);
    if (remainingMissing.length === 0)
      continue;
    const rareName = pickDeterministicRareSlot(groupName, remainingMissing, leagueKey);
    for (const name of remainingMissing) {
      canonical[name] = name === rareName ? SEED_NORMAL_RARE : SEED_NORMAL_MID;
      seededCount += 1;
    }
  }
  return {
    weights: normalizeWeightMapStable(canonical, catalog),
    meta: {
      version: WEIGHT_SEED_VERSION,
      canonicalPoolSize: catalog.ordered.length,
      removedNonCanonicalCount: removedCount,
      preservedObservedCount,
      seededCount,
      placeholders: {
        base: SEED_NORMAL_BASE,
        mid: SEED_NORMAL_MID,
        rare: SEED_NORMAL_RARE,
        misc: SEED_MISC_FLAT,
        horned: SEED_HORNED_FLAT
      }
    }
  };
}
__name(seedCanonicalWeights, "seedCanonicalWeights");
function normalizeLeagueInfo(rawLeague) {
  const raw = String(rawLeague || "").trim();
  const lowered = raw.toLowerCase();
  if (lowered === "standard") {
    return {
      raw,
      key: "standard",
      kind: "standard",
      season: "standard"
    };
  }
  if (lowered.startsWith("challenge:")) {
    const seasonFromKey = lowered.slice("challenge:".length).trim() || "unknown";
    return {
      raw,
      key: `challenge:${seasonFromKey}`,
      kind: "challenge",
      season: seasonFromKey
    };
  }
  const compact = lowered.replace(/\s+/g, " ");
  const cleaned = compact.replace(/\(.*?\)/g, "").trim();
  const isStandard = cleaned === "standard" || cleaned === "hardcore" || cleaned.endsWith(" standard");
  if (isStandard) {
    return {
      raw,
      key: "standard",
      kind: "standard",
      season: "standard"
    };
  }
  const season = cleaned.replace(/\bhardcore\b/g, "").replace(/\s+/g, " ").trim() || "unknown";
  return {
    raw,
    key: `challenge:${season}`,
    kind: "challenge",
    season
  };
}
__name(normalizeLeagueInfo, "normalizeLeagueInfo");
function createLeagueStats(key, kind) {
  return {
    key,
    kind,
    sessionCount: 0,
    totalConsumed: 0,
    totalTrades: 0,
    totalInput: 0,
    totalOutput: 0,
    totalInputDivine: 0,
    totalOutputDivine: 0,
    divineSessionCount: 0,
    receivedByScarab: {},
    latestCreatedAt: ""
  };
}
__name(createLeagueStats, "createLeagueStats");
function finalizeWeights(receivedByScarab) {
  const totalReceived = Object.values(receivedByScarab).reduce((sum, n) => sum + (Number(n) || 0), 0);
  if (totalReceived <= 0)
    return { totalReceived: 0, weights: {} };
  const weights = {};
  for (const [name, count] of Object.entries(receivedByScarab)) {
    const c = Number(count) || 0;
    if (c > 0)
      weights[name] = c / totalReceived;
  }
  return { totalReceived, weights };
}
__name(finalizeWeights, "finalizeWeights");
function buildLeagueStats(rows) {
  const byKey = {};
  for (const row of rows) {
    const info = normalizeLeagueInfo(row.league_key || row.league);
    if (!byKey[info.key])
      byKey[info.key] = createLeagueStats(info.key, info.kind);
    const stats = byKey[info.key];
    stats.sessionCount += 1;
    stats.totalConsumed += Number(row.total_consumed) || 0;
    stats.totalTrades += Number(row.total_trades) || 0;
    stats.totalInput += Number(row.input_value) || 0;
    stats.totalOutput += Number(row.output_value) || 0;
    const divineRate = Number(row.divine_rate) || 0;
    if (divineRate > 0) {
      stats.totalInputDivine += (Number(row.input_value) || 0) / divineRate;
      stats.totalOutputDivine += (Number(row.output_value) || 0) / divineRate;
      stats.divineSessionCount += 1;
    }
    if (row.created_at && String(row.created_at) > stats.latestCreatedAt)
      stats.latestCreatedAt = String(row.created_at);
    const scarabs = safeParseJsonArray(row.scarabs_json);
    for (const s of scarabs) {
      if (!s || !s.name)
        continue;
      const received = Number(s.received) || 0;
      if (received <= 0)
        continue;
      stats.receivedByScarab[s.name] = (stats.receivedByScarab[s.name] || 0) + received;
    }
  }
  for (const stats of Object.values(byKey)) {
    const finalized = finalizeWeights(stats.receivedByScarab);
    stats.totalReceived = finalized.totalReceived;
    stats.weights = finalized.weights;
  }
  return byKey;
}
__name(buildLeagueStats, "buildLeagueStats");
function combineLeagueStats(statsList) {
  const combined = createLeagueStats("combined", "challenge");
  for (const stats of statsList) {
    if (!stats)
      continue;
    combined.sessionCount += stats.sessionCount || 0;
    combined.totalConsumed += stats.totalConsumed || 0;
    combined.totalTrades += stats.totalTrades || 0;
    combined.totalInput += stats.totalInput || 0;
    combined.totalOutput += stats.totalOutput || 0;
    combined.totalInputDivine += stats.totalInputDivine || 0;
    combined.totalOutputDivine += stats.totalOutputDivine || 0;
    combined.divineSessionCount += stats.divineSessionCount || 0;
    if (stats.latestCreatedAt && stats.latestCreatedAt > combined.latestCreatedAt)
      combined.latestCreatedAt = stats.latestCreatedAt;
    for (const [name, count] of Object.entries(stats.receivedByScarab || {})) {
      combined.receivedByScarab[name] = (combined.receivedByScarab[name] || 0) + (Number(count) || 0);
    }
  }
  const finalized = finalizeWeights(combined.receivedByScarab);
  combined.totalReceived = finalized.totalReceived;
  combined.weights = finalized.weights;
  return combined;
}
__name(combineLeagueStats, "combineLeagueStats");
function blendWeightMaps(newWeights, oldWeights, alpha) {
  const a = clamp01(alpha);
  const names = new Set([...Object.keys(newWeights || {}), ...Object.keys(oldWeights || {})]);
  const blended = {};
  let sum = 0;
  for (const name of names) {
    const w = a * (newWeights[name] || 0) + (1 - a) * (oldWeights[name] || 0);
    if (w > 0) {
      blended[name] = w;
      sum += w;
    }
  }
  if (sum <= 0)
    return {};
  for (const name of Object.keys(blended))
    blended[name] = blended[name] / sum;
  return blended;
}
__name(blendWeightMaps, "blendWeightMaps");
function pickLeagueModel(leagueInfo, byKey) {
  const challengeStats = Object.values(byKey).filter((s) => s.kind === "challenge");
  challengeStats.sort((a, b) => {
    if (a.latestCreatedAt !== b.latestCreatedAt)
      return a.latestCreatedAt < b.latestCreatedAt ? 1 : -1;
    return (b.totalConsumed || 0) - (a.totalConsumed || 0);
  });
  const challengeKeys = challengeStats.map((s) => s.key);
  const challengeCombined = combineLeagueStats(challengeStats);
  if (leagueInfo.kind === "standard") {
    const priorChallenge = challengeStats.length >= 2 ? challengeStats[1] : challengeStats[0] || null;
    if (priorChallenge && priorChallenge.totalReceived >= MIN_WEIGHT_OUTPUTS) {
      return {
        weights: priorChallenge.weights,
        sourceStats: priorChallenge,
        mode: "standard-prior-challenge",
        alphaGlobal: 0,
        priorLeagueKey: priorChallenge.key,
        supportsWeighted: true,
        challengeKeys
      };
    }
    if (challengeCombined.totalReceived >= MIN_WEIGHT_OUTPUTS) {
      return {
        weights: challengeCombined.weights,
        sourceStats: challengeCombined,
        mode: "standard-cumulative-challenge",
        alphaGlobal: 0,
        priorLeagueKey: null,
        supportsWeighted: true,
        challengeKeys
      };
    }
    return {
      weights: null,
      sourceStats: createLeagueStats("none", "challenge"),
      mode: "insufficient-data",
      alphaGlobal: 0,
      priorLeagueKey: null,
      supportsWeighted: false,
      reason: "No completed challenge-league weights available yet.",
      challengeKeys
    };
  }
  const current = byKey[leagueInfo.key] || null;
  const prior = challengeStats.find((s) => s.key !== leagueInfo.key) || null;
  if (current && prior && current.totalReceived >= MIN_WEIGHT_OUTPUTS && prior.totalReceived >= MIN_WEIGHT_OUTPUTS) {
    const alpha = clamp01((current.totalConsumed || 0) / HANDOVER_CONSUMED);
    const blended = blendWeightMaps(current.weights, prior.weights, alpha);
    if (Object.keys(blended).length > 0) {
      return {
        weights: blended,
        sourceStats: current,
        mode: "challenge-blend",
        alphaGlobal: alpha,
        priorLeagueKey: prior.key,
        supportsWeighted: true,
        supportingSessionCount: (current.sessionCount || 0) + (prior.sessionCount || 0),
        supportingOutputs: (current.totalReceived || 0) + (prior.totalReceived || 0),
        challengeKeys
      };
    }
  }
  if (current && current.totalReceived >= MIN_WEIGHT_OUTPUTS) {
    return {
      weights: current.weights,
      sourceStats: current,
      mode: "challenge-current-only",
      alphaGlobal: 1,
      priorLeagueKey: prior ? prior.key : null,
      supportsWeighted: true,
      challengeKeys
    };
  }
  if (prior && prior.totalReceived >= MIN_WEIGHT_OUTPUTS) {
    return {
      weights: prior.weights,
      sourceStats: prior,
      mode: "challenge-prior-fallback",
      alphaGlobal: 0,
      priorLeagueKey: prior.key,
      supportsWeighted: true,
      challengeKeys
    };
  }
  if (challengeCombined.totalReceived >= MIN_WEIGHT_OUTPUTS) {
    return {
      weights: challengeCombined.weights,
      sourceStats: challengeCombined,
      mode: "challenge-cumulative-fallback",
      alphaGlobal: 0,
      priorLeagueKey: null,
      supportsWeighted: true,
      challengeKeys
    };
  }
  return {
    weights: null,
    sourceStats: createLeagueStats("none", "challenge"),
    mode: "insufficient-data",
    alphaGlobal: 0,
    priorLeagueKey: null,
    supportsWeighted: false,
    reason: "Not enough community output data for weighted EV yet.",
    challengeKeys
  };
}
__name(pickLeagueModel, "pickLeagueModel");
async function computeLeagueAggregate(env, rawLeague) {
  const { results: rows } = await env.DB.prepare(
    "SELECT created_at, league, league_key, total_consumed, total_trades, input_value, output_value, divine_rate, scarabs_json FROM sessions"
  ).all();
  const byKey = buildLeagueStats(rows || []);
  const leagueInfo = normalizeLeagueInfo(rawLeague);
  const model = pickLeagueModel(leagueInfo, byKey);
  const stats = model.sourceStats || createLeagueStats("none", "challenge");
  const canonicalized = seedCanonicalWeights(model.weights || {}, leagueInfo.key);
  return {
    sessionCount: stats.sessionCount || 0,
    totalConsumed: stats.totalConsumed || 0,
    totalTrades: stats.totalTrades || 0,
    totalInput: stats.totalInput || 0,
    totalOutput: stats.totalOutput || 0,
    totalInputDivine: stats.divineSessionCount > 0 ? stats.totalInputDivine : null,
    totalOutputDivine: stats.divineSessionCount > 0 ? stats.totalOutputDivine : null,
    receivedByScarab: stats.receivedByScarab || {},
    weights: canonicalized.weights,
    weightSessionCount: model.supportingSessionCount || stats.sessionCount || 0,
    weightMeta: {
      targetLeague: leagueInfo.raw || rawLeague || null,
      targetLeagueKey: leagueInfo.key,
      targetKind: leagueInfo.kind,
      mode: model.mode,
      supportsWeighted: model.supportsWeighted,
      reason: model.reason || null,
      alphaGlobal: model.alphaGlobal || 0,
      handoverConsumed: HANDOVER_CONSUMED,
      consumedCurrent: byKey[leagueInfo.key]?.totalConsumed || 0,
      priorLeagueKey: model.priorLeagueKey || null,
      challengeLeagueOrder: model.challengeKeys || [],
      supportingOutputs: model.supportingOutputs || stats.totalReceived || 0
      ,
      divineSessionCount: stats.divineSessionCount || 0,
      canonicalization: canonicalized.meta
    },
    _debug: {
      byKey,
      selected: leagueInfo,
      model
    }
  };
}
__name(computeLeagueAggregate, "computeLeagueAggregate");
async function recomputeAggregate(env) {
  const { results: rows } = await env.DB.prepare(
    "SELECT total_consumed, total_trades, input_value, output_value, scarabs_json FROM sessions"
  ).all();
  let totalSessions = 0;
  let totalConsumed = 0;
  let totalTrades = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const receivedByScarab = {};
  for (const r of rows) {
    totalSessions += 1;
    totalConsumed += r.total_consumed || 0;
    totalTrades += r.total_trades || 0;
    totalInput += r.input_value || 0;
    totalOutput += r.output_value || 0;
    try {
      const scarabs = JSON.parse(r.scarabs_json || "[]");
      for (const s of scarabs) {
        if (s.received > 0 && s.name) {
          receivedByScarab[s.name] = (receivedByScarab[s.name] || 0) + s.received;
        }
      }
    } catch (_) {
    }
  }
  await env.DB.prepare(
    `UPDATE aggregate SET total_sessions = ?, total_consumed = ?, total_trades = ?, total_input = ?, total_output = ?, received_by_scarab = ? WHERE id = 1`
  ).bind(totalSessions, totalConsumed, totalTrades, totalInput, totalOutput, JSON.stringify(receivedByScarab)).run();
  return { totalSessions, totalConsumed, totalTrades, totalInput, totalOutput, receivedByScarab };
}
__name(recomputeAggregate, "recomputeAggregate");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname;
    // --- START REPAIR LOGIC ---
if (path.startsWith("/api/sync-repair") && request.method === "POST") {
      try {
        try {
          await env.DB.prepare("ALTER TABLE sessions ADD COLUMN divine_rate REAL").run();
        } catch (_) {
        }
        const sessions = await request.json();
        
        // 1. Clear existing sessions to prevent duplicates
        const clearTable = env.DB.prepare("DELETE FROM sessions");

        // 2. Prepare fresh inserts for your 19 clean sessions
        const inserts = sessions.map(s => {
          const leagueInfo = normalizeLeagueInfo(s.league_key || s.league || "unknown");
          return env.DB.prepare(`
            INSERT INTO sessions (
              created_at, league, regex, total_consumed, 
              total_trades, input_value, output_value, divine_rate, scarabs_json, league_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            s.created_at,
            s.league || 'Mirage',
            s.regex || '',
            Number(s.total_consumed) || 0,
            Number(s.total_trades) || 0,
            Number(s.input_value) || 0,
            Number(s.output_value) || 0,
            Number(s.divine_rate) || null,
            JSON.stringify(s.scarabs || []),
            leagueInfo.key
          );
        });

        // 3. Execute everything in a single transaction
        // If any part fails, nothing changes (ACID compliance)
        await env.DB.batch([clearTable, ...inserts]);
        
        return json({ success: true, message: `Database rebuilt with ${sessions.length} clean sessions.` }, 200);
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
if (path.startsWith("/api/recalculate-globals") && request.method === "POST") {
      try {
        const { results } = await env.DB.prepare("SELECT scarabs_json FROM sessions").all();
        
        let receivedByScarab = {}; 

        for (const row of results) {
            const scarabs = JSON.parse(row.scarabs_json || "[]");
            scarabs.forEach(s => {
                if (s.received > 0) {
                    // This creates an entry for EVERY scarab type (Ambush, Divination, etc.)
                    receivedByScarab[s.name] = (receivedByScarab[s.name] || 0) + s.received;
                }
            });
        }

        const finalStats = await env.DB.prepare(`
          SELECT COUNT(*) as total_sessions, SUM(total_consumed) as c, SUM(total_trades) as t, 
          SUM(input_value) as i, SUM(output_value) as o FROM sessions
        `).first();

        // Overwrite the aggregate record with the full map of all scarabs
        await env.DB.prepare(`
          UPDATE aggregate 
          SET total_sessions = ?, total_consumed = ?, total_trades = ?, 
              total_input = ?, total_output = ?, received_by_scarab = ? 
          WHERE id = 1
        `).bind(
          finalStats.total_sessions, finalStats.c, finalStats.t, 
          finalStats.i, finalStats.o, JSON.stringify(receivedByScarab)
        ).run();

        return json({ success: true, full_inventory: receivedByScarab }, 200);
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    // --- END REPAIR LOGIC ---
    if (path === "/health") {
      const row = await env.DB.prepare("SELECT total_sessions AS sessionCount FROM aggregate WHERE id = 1").first();
      return json({ ok: true, sessionCount: row?.sessionCount ?? 0 });
    }
    if (path === "/api/aggregate") {
      const requestedLeague = url.searchParams.get("league");
      if (requestedLeague) {
        const leagueAgg = await computeLeagueAggregate(env, requestedLeague);
        return json({
          sessionCount: leagueAgg.sessionCount,
          totalConsumed: leagueAgg.totalConsumed,
          totalTrades: leagueAgg.totalTrades,
          totalInput: leagueAgg.totalInput,
          totalOutput: leagueAgg.totalOutput,
          totalInputDivine: leagueAgg.totalInputDivine,
          totalOutputDivine: leagueAgg.totalOutputDivine,
          receivedByScarab: leagueAgg.receivedByScarab,
          weights: leagueAgg.weights,
          weightSessionCount: leagueAgg.weightSessionCount,
          weightMeta: leagueAgg.weightMeta
        });
      }
      const recompute = url.searchParams.get("recompute") === "1";
      if (recompute) {
        const agg = await recomputeAggregate(env);
        return json({
          sessionCount: agg.totalSessions,
          totalConsumed: agg.totalConsumed,
          totalTrades: agg.totalTrades,
          totalInput: agg.totalInput,
          totalOutput: agg.totalOutput,
          receivedByScarab: agg.receivedByScarab
        });
      }
      const row = await env.DB.prepare(
        "SELECT total_sessions, total_consumed, total_trades, total_input, total_output, received_by_scarab FROM aggregate WHERE id = 1"
      ).first();
      let receivedByScarab = {};
      try {
        receivedByScarab = JSON.parse(row?.received_by_scarab || "{}");
      } catch (_) {
      }
      return json({
        sessionCount: row?.total_sessions ?? 0,
        totalConsumed: row?.total_consumed ?? 0,
        totalTrades: row?.total_trades ?? 0,
        totalInput: row?.total_input ?? 0,
        totalOutput: row?.total_output ?? 0,
        receivedByScarab
      });
    }
    if (path === "/api/admin/weights-debug" && request.method === "GET") {
      const urlKey = url.searchParams.get("key");
      if (!urlKey || urlKey !== env.ADMIN_KEY)
        return json({ error: "Unauthorized" }, 401);
      const requestedLeague = url.searchParams.get("league") || "";
      if (!requestedLeague)
        return json({ error: "Missing league query param" }, 400);
      const data = await computeLeagueAggregate(env, requestedLeague);
      return json({
        sessionCount: data.sessionCount,
        totalConsumed: data.totalConsumed,
        totalTrades: data.totalTrades,
        totalInput: data.totalInput,
        totalOutput: data.totalOutput,
        totalInputDivine: data.totalInputDivine,
        totalOutputDivine: data.totalOutputDivine,
        receivedByScarab: data.receivedByScarab,
        weights: data.weights,
        weightSessionCount: data.weightSessionCount,
        weightMeta: data.weightMeta,
        debug: data._debug
      });
    }
    if (path === "/api/sessions" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
      const ipHash = await hashIP(ip);
      const rate = await checkRateLimit(env, ipHash);
      if (!rate.allowed)
        return json({ error: "Rate limit exceeded", detail: `Max ${MAX_SESSIONS_PER_IP_PER_HOUR} sessions per hour per IP` }, 429);
      let session;
      try {
        session = await request.json();
      } catch (_) {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!session || typeof session !== "object")
        return json({ error: "Invalid body" }, 400);
      const totalConsumed = session.total_consumed || 0;
      const totalTrades = session.total_trades || 0;
      const totalInput = session.input_value || 0;
      const totalOutput = session.output_value || 0;
      const divineRate = Number(session.divine_rate) || null;
      const scarabs = Array.isArray(session.scarabs) ? session.scarabs : [];
      if (totalInput > 0 && Math.abs(totalOutput - totalInput) < 1 && totalConsumed === 0)
        return json({ error: "No changes detected", counted: false }, 400);
      const flags = getSessionFlags(session);
      if (flags.length > 0)
        return json({ counted: false, reason: "flagged", flags }, 200);
      const scarabsJson = JSON.stringify(scarabs.map((r) => ({
        name: r.name,
        received: r.received || 0,
        consumed: r.consumed || 0,
        was_vendor: r.was_vendor || false,
        ninja_price: r.ninja_price || 0
      })));
      const league = session.league || null;
      const leagueInfo = normalizeLeagueInfo(league || "unknown");
      const regex  = session.regex  || null;
      const insert = env.DB.prepare(
        "INSERT INTO sessions (total_consumed, total_trades, input_value, output_value, divine_rate, scarabs_json, league, regex, league_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(totalConsumed, totalTrades, totalInput, totalOutput, divineRate, scarabsJson, league, regex, leagueInfo.key);
      const aggRow = await env.DB.prepare(
        "SELECT total_sessions, total_consumed, total_trades, total_input, total_output, received_by_scarab FROM aggregate WHERE id = 1"
      ).first();
      let receivedByScarab = {};
      try {
        receivedByScarab = JSON.parse(aggRow?.received_by_scarab || "{}");
      } catch (_) {
      }
      for (const r of scarabs) {
        if (r.received > 0 && r.name)
          receivedByScarab[r.name] = (receivedByScarab[r.name] || 0) + r.received;
      }
      const newTotalSessions = (aggRow?.total_sessions || 0) + 1;
      const newTotalConsumed = (aggRow?.total_consumed || 0) + totalConsumed;
      const newTotalTrades = (aggRow?.total_trades || 0) + totalTrades;
      const newTotalInput = (aggRow?.total_input || 0) + totalInput;
      const newTotalOutput = (aggRow?.total_output || 0) + totalOutput;
      const updateAgg = env.DB.prepare(
        "UPDATE aggregate SET total_sessions = ?, total_consumed = ?, total_trades = ?, total_input = ?, total_output = ?, received_by_scarab = ? WHERE id = 1"
      ).bind(newTotalSessions, newTotalConsumed, newTotalTrades, newTotalInput, newTotalOutput, JSON.stringify(receivedByScarab));
      await env.DB.batch([insert, updateAgg]);
      return json({ counted: true, sessionCount: newTotalSessions }, 200);
    }
    if (path.startsWith("/admin/sessions")) {
      const urlKey = url.searchParams.get("key");
      if (!urlKey || urlKey !== env.ADMIN_KEY)
        return json({ error: "Unauthorized" }, 401);
      if (request.method === "DELETE") {
        const id = decodeURIComponent(path.replace("/admin/sessions/", ""));
        const res = await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
        return json({ ok: true, deleted: res.meta.changes ?? 0 });
      }
      if (request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 200);
        const { results } = await env.DB.prepare(
          "SELECT id, created_at, league, league_key, regex, total_consumed, total_trades, input_value, output_value, divine_rate, scarabs_json FROM sessions ORDER BY created_at DESC LIMIT ?"
        ).bind(limit).all();
        return json(results);
      }
      return json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
