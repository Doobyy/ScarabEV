var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var MAX_SESSIONS_PER_IP_PER_HOUR = 20;
var L1_NEGATIVE_DRIFT_RATE = 0.0125;
var L1_POSITIVE_DRIFT_RATE = 0.015;
var L1_MIN_ALLOWED_DRIFT = 3;
var L2_PASS_THRESHOLD = 12;
var L2_HIGH_PRIORITY_THRESHOLD = 20;
var L2_WEIGHT_SPIKE = 0.5;
var L2_WEIGHT_MID_DIV = 0.3;
var L2_WEIGHT_CONCENTRATION = 0.12;
var L2_WEIGHT_SUPPORT = 0.08;
var L2_LENIENCY_OUTPUT_FLOOR = 800;
var L2_LENIENCY_OUTPUT_FULL = 3200;
var L2_LENIENCY_MIN_SCALE = 0.35;
var L2_TRUST_MAX_THRESHOLD_BONUS = 6;
var L2_TRUST_WARM_DRIFT_RATIO = 0.55;
var L2_CORROBORATION_SPIKE = 0.2;
var L2_CORROBORATION_MID_DIV = 0.14;
var L2_CORROBORATION_CONCENTRATION = 0.1;
var L2_CORROBORATION_SUPPORT = 0.08;
var L2_CORROBORATION_EXCESS_MULT = 1.35;
var L2_MULTI_SIGNAL_HOLD_MIN = 2;
var L2_EXTREME_HOLD_SCORE = 26;
var L2_ABSURD_SPIKE = 0.45;
var L2_ABSURD_MID_DIV = 0.28;
var L2_ABSURD_CONCENTRATION = 0.22;
var L2_ABSURD_EXCESS_MULT = 2.4;
var HANDOVER_CONSUMED = 9e4;
var MIN_WEIGHT_OUTPUTS = 100;
var WEIGHT_SEED_VERSION = "phase1-canonical-seeded-v1";
var SESSION_STATE_L1_REJECT = "l1_reject";
var SESSION_STATE_APPROVED_AUTO = "approved_auto";
var SESSION_STATE_REVIEW_PENDING = "review_pending";
var SESSION_STATE_APPROVED_MANUAL = "approved_manual";
var SESSION_STATE_RESEARCH = "research";
var APPROVED_INTAKE_STATES = [SESSION_STATE_APPROVED_AUTO, SESSION_STATE_APPROVED_MANUAL];
var SESSION_REVIEWABLE_STATES = [SESSION_STATE_REVIEW_PENDING, SESSION_STATE_RESEARCH];
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
function sqlQuoted(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}
__name(sqlQuoted, "sqlQuoted");
var APPROVED_STATE_SQL_LIST = APPROVED_INTAKE_STATES.map((s) => sqlQuoted(s)).join(", ");
var APPROVED_STATE_WHERE = `(intake_state IS NULL OR intake_state IN (${APPROVED_STATE_SQL_LIST}))`;
var intakeSchemaReady = null;
async function ensureIntakeSchema(env) {
  if (intakeSchemaReady)
    return intakeSchemaReady;
  intakeSchemaReady = (async () => {
    const alterStatements = [
      "ALTER TABLE sessions ADD COLUMN intake_state TEXT",
      "ALTER TABLE sessions ADD COLUMN intake_class TEXT",
      "ALTER TABLE sessions ADD COLUMN intake_health_pct REAL",
      "ALTER TABLE sessions ADD COLUMN intake_expected_trades INTEGER",
      "ALTER TABLE sessions ADD COLUMN intake_actual_outputs INTEGER",
      "ALTER TABLE sessions ADD COLUMN intake_drift INTEGER",
      "ALTER TABLE sessions ADD COLUMN intake_reasons_json TEXT",
      "ALTER TABLE sessions ADD COLUMN intake_l1_json TEXT",
      "ALTER TABLE sessions ADD COLUMN intake_l2_json TEXT",
      "ALTER TABLE sessions ADD COLUMN intake_fingerprint TEXT",
      "ALTER TABLE sessions ADD COLUMN admin_note TEXT",
      "ALTER TABLE sessions ADD COLUMN reviewed_at TEXT"
    ];
    for (const sql of alterStatements) {
      try {
        await env.DB.prepare(sql).run();
      } catch (_) {
      }
    }
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS session_intake_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
        session_id TEXT,
        action TEXT NOT NULL,
        intake_state TEXT NOT NULL,
        admin_actor TEXT,
        admin_note TEXT,
        ip_hash TEXT,
        league TEXT,
        league_key TEXT,
        total_consumed INTEGER,
        total_trades INTEGER,
        input_value REAL,
        output_value REAL,
        expected_trades INTEGER,
        actual_outputs INTEGER,
        output_drift INTEGER,
        reasons_json TEXT,
        meta_json TEXT
      )`
    ).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_intake_state_created ON sessions(intake_state, created_at DESC)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_intake_fingerprint ON sessions(intake_fingerprint)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_intake_events_created ON session_intake_events(created_at DESC)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_intake_events_session ON session_intake_events(session_id)").run();
  })().catch((err) => {
    intakeSchemaReady = null;
    throw err;
  });
  return intakeSchemaReady;
}
__name(ensureIntakeSchema, "ensureIntakeSchema");
function toNonNegativeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n)
    return null;
  return n;
}
__name(toNonNegativeInteger, "toNonNegativeInteger");
function toOptionalNonNegativeInteger(value) {
  if (value === null || value === void 0 || value === "")
    return null;
  return toNonNegativeInteger(value);
}
__name(toOptionalNonNegativeInteger, "toOptionalNonNegativeInteger");
function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    return null;
  return n;
}
__name(toNonNegativeNumber, "toNonNegativeNumber");
function toOptionalNonNegativeNumber(value) {
  if (value === null || value === void 0 || value === "")
    return null;
  return toNonNegativeNumber(value);
}
__name(toOptionalNonNegativeNumber, "toOptionalNonNegativeNumber");
function normalizeNumberForFingerprint(value) {
  const n = Number(value);
  if (!Number.isFinite(n))
    return null;
  return Math.round(n * 1e6) / 1e6;
}
__name(normalizeNumberForFingerprint, "normalizeNumberForFingerprint");
function buildNormalizedSubmissionPayload(session) {
  if (!session || typeof session !== "object")
    return null;
  if (!Array.isArray(session.scarabs))
    return null;
  const rows = [];
  for (const row of session.scarabs) {
    if (!row || typeof row !== "object")
      return null;
    const name = String(row.name || "").trim();
    if (!name)
      return null;
    const consumed = toOptionalNonNegativeInteger(row.consumed);
    const received = toOptionalNonNegativeInteger(row.received);
    if (consumed === null || received === null)
      return null;
    const ninjaPrice = normalizeNumberForFingerprint(row.ninja_price);
    if (ninjaPrice === null)
      return null;
    rows.push({
      name,
      consumed,
      received,
      was_vendor: !!row.was_vendor,
      ninja_price: ninjaPrice
    });
  }
  rows.sort((a, b) => {
    const n = a.name.localeCompare(b.name);
    if (n !== 0)
      return n;
    if (a.consumed !== b.consumed)
      return a.consumed - b.consumed;
    if (a.received !== b.received)
      return a.received - b.received;
    if (a.was_vendor !== b.was_vendor)
      return a.was_vendor ? 1 : -1;
    return a.ninja_price - b.ninja_price;
  });
  const totalConsumed = toOptionalNonNegativeInteger(session.total_consumed);
  const totalTrades = toOptionalNonNegativeInteger(session.total_trades);
  const inputValue = toNonNegativeNumber(session.input_value);
  const outputValue = toNonNegativeNumber(session.output_value);
  const divineRate = toOptionalNonNegativeNumber(session.divine_rate);
  const normalized = {
    league: String(session.league || "").trim(),
    regex: String(session.regex || "").trim(),
    total_consumed: totalConsumed === null ? null : totalConsumed,
    total_trades: totalTrades === null ? null : totalTrades,
    input_value: inputValue === null ? null : normalizeNumberForFingerprint(inputValue),
    output_value: outputValue === null ? null : normalizeNumberForFingerprint(outputValue),
    divine_rate: divineRate === null ? null : divineRate,
    scarabs: rows
  };
  return normalized;
}
__name(buildNormalizedSubmissionPayload, "buildNormalizedSubmissionPayload");
async function computeSubmissionFingerprint(session) {
  const normalized = buildNormalizedSubmissionPayload(session);
  if (!normalized)
    return null;
  const enc = new TextEncoder();
  const payload = JSON.stringify(normalized);
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(payload));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    fingerprint: `sha256:${hex}`,
    normalizedPayload: normalized
  };
}
__name(computeSubmissionFingerprint, "computeSubmissionFingerprint");
async function findDuplicateSubmission(env, fingerprint) {
  if (!fingerprint)
    return null;
  const row = await env.DB.prepare(
    `SELECT id, created_at, intake_state
     FROM sessions
     WHERE intake_fingerprint = ?
     ORDER BY id DESC
     LIMIT 1`
  ).bind(fingerprint).first();
  if (!row)
    return null;
  return {
    id: String(row.id),
    createdAt: row.created_at || null,
    intakeState: row.intake_state || null
  };
}
__name(findDuplicateSubmission, "findDuplicateSubmission");
function evaluateSessionIntake(session) {
  const structuralIssues = [];
  const scarabsRaw = Array.isArray(session?.scarabs) ? session.scarabs : null;
  if (!scarabsRaw || scarabsRaw.length === 0) {
    structuralIssues.push("Missing scarab rows in payload.");
  }
  const normalizedScarabs = [];
  let actualConsumedRowTotal = 0;
  let actualOutputTotal = 0;
  if (scarabsRaw) {
    for (let idx = 0; idx < scarabsRaw.length; idx += 1) {
      const row = scarabsRaw[idx];
      if (!row || typeof row !== "object") {
        structuralIssues.push(`Row ${idx + 1} is not an object.`);
        continue;
      }
      const name = String(row.name || "").trim();
      if (!name) {
        structuralIssues.push(`Row ${idx + 1} is missing scarab name.`);
        continue;
      }
      const consumed = toNonNegativeInteger(row.consumed);
      const received = toNonNegativeInteger(row.received);
      if (consumed === null) {
        structuralIssues.push(`Row ${idx + 1} has invalid consumed count.`);
        continue;
      }
      if (received === null) {
        structuralIssues.push(`Row ${idx + 1} has invalid received count.`);
        continue;
      }
      actualConsumedRowTotal += consumed;
      actualOutputTotal += received;
      normalizedScarabs.push({
        name,
        consumed,
        received,
        was_vendor: !!row.was_vendor,
        ninja_price: Math.max(0, Number(row.ninja_price) || 0)
      });
    }
  }
  const declaredTotalConsumed = toOptionalNonNegativeInteger(session?.total_consumed);
  if (declaredTotalConsumed === null) {
    structuralIssues.push("Declared total_consumed is missing or invalid.");
  } else if (declaredTotalConsumed !== actualConsumedRowTotal) {
    structuralIssues.push(
      `Declared total_consumed (${declaredTotalConsumed}) does not match row consumed sum (${actualConsumedRowTotal}).`
    );
  }
  const declaredTotalTrades = toOptionalNonNegativeInteger(session?.total_trades);
  const totalInput = toNonNegativeNumber(session?.input_value);
  const totalOutput = toNonNegativeNumber(session?.output_value);
  if (totalInput === null)
    structuralIssues.push("Declared input_value is missing or invalid.");
  if (totalOutput === null)
    structuralIssues.push("Declared output_value is missing or invalid.");
  if (actualConsumedRowTotal === 0 && actualOutputTotal === 0)
    structuralIssues.push("No scarab movement detected.");
  const expectedTrades = Math.floor(actualConsumedRowTotal / 3);
  const leftovers = actualConsumedRowTotal % 3;
  const expectedFinal = expectedTrades + leftovers;
  const actualFinalCount = actualOutputTotal;
  const drift = actualFinalCount - expectedFinal;
  const absDrift = Math.abs(drift);
  const driftRate = drift < 0 ? L1_NEGATIVE_DRIFT_RATE : L1_POSITIVE_DRIFT_RATE;
  const allowedDrift = Math.max(L1_MIN_ALLOWED_DRIFT, Math.ceil(expectedFinal * driftRate));
  const l1Passed = absDrift <= allowedDrift;
  const driftPct = expectedFinal > 0 ? drift / expectedFinal * 100 : 0;
  const l1Audit = {
    inputQty: actualConsumedRowTotal,
    totalConsumed: actualConsumedRowTotal,
    expectedTrades,
    leftovers,
    expectedFinal,
    actualFinalCount,
    drift,
    driftPct,
    allowedDrift,
    l1_result: l1Passed ? "pass" : "reject"
  };
  const reasons = [];
  if (l1Passed) {
    reasons.push(
      `L1 pass: final count is structurally plausible (${actualFinalCount} vs expected final ${expectedFinal}, drift ${drift >= 0 ? "+" : ""}${drift}, allowed ${allowedDrift}).`
    );
  } else {
    reasons.push(
      `L1 reject: drift exceeds structural tolerance (${actualFinalCount} vs expected final ${expectedFinal}, drift ${drift >= 0 ? "+" : ""}${drift}, allowed ${allowedDrift}).`
    );
  }
  if (declaredTotalTrades !== null && declaredTotalTrades !== expectedTrades) {
    reasons.push(
      `Declared total_trades (${declaredTotalTrades}) differs from expected trades (${expectedTrades}); backend uses expected trades.`
    );
  }
  if (structuralIssues.length > 0) {
    return {
      counted: false,
      classification: SESSION_STATE_L1_REJECT,
      l1Passed: false,
      intakeState: SESSION_STATE_L1_REJECT,
      healthPct: 0,
      reasons: [...structuralIssues, ...reasons],
      expectedTrades,
      leftovers,
      expectedFinal,
      allowedDrift,
      actualOutputs: actualFinalCount,
      actualFinalCount,
      drift,
      driftPct,
      totalConsumed: actualConsumedRowTotal,
      actualConsumedRowTotal,
      totalInput: totalInput === null ? 0 : totalInput,
      totalOutput: totalOutput === null ? 0 : totalOutput,
      l1_result: "reject",
      l1Audit,
      normalizedScarabs
    };
  }
  const classification = l1Passed ? "l1_pass_structural" : "l1_reject_structural";
  const intakeState = l1Passed ? SESSION_STATE_APPROVED_AUTO : SESSION_STATE_L1_REJECT;
  return {
    counted: false,
    l1Passed,
    intakeState,
    classification,
    healthPct: l1Passed ? 100 : 0,
    reasons,
    expectedTrades,
    leftovers,
    expectedFinal,
    allowedDrift,
    actualOutputs: actualFinalCount,
    actualFinalCount,
    drift,
    driftPct,
    totalConsumed: actualConsumedRowTotal,
    actualConsumedRowTotal,
    totalInput,
    totalOutput,
    l1_result: l1Passed ? "pass" : "reject",
    l1Audit,
    normalizedScarabs
  };
}
__name(evaluateSessionIntake, "evaluateSessionIntake");
function l1DistanceNormalized(aMap, bMap, names) {
  if (!Array.isArray(names) || names.length === 0)
    return 0;
  let sum = 0;
  for (const name of names) {
    const a = Number(aMap?.[name] || 0);
    const b = Number(bMap?.[name] || 0);
    sum += Math.abs(a - b);
  }
  return clamp01(sum / 2);
}
__name(l1DistanceNormalized, "l1DistanceNormalized");
function computeHhi(shareMap, names) {
  let hhi = 0;
  for (const name of names || []) {
    const s = Math.max(0, Number(shareMap?.[name] || 0));
    hhi += s * s;
  }
  return hhi;
}
__name(computeHhi, "computeHhi");
function computeSessionReceivedShareMap(rows) {
  const receivedByName = {};
  let totalReceived = 0;
  for (const row of rows || []) {
    const name = String(row?.name || "").trim();
    if (!name)
      continue;
    const received = Math.max(0, Number(row?.received) || 0);
    if (received <= 0)
      continue;
    receivedByName[name] = (receivedByName[name] || 0) + received;
    totalReceived += received;
  }
  const shareByName = {};
  if (totalReceived > 0) {
    for (const [name, count] of Object.entries(receivedByName)) {
      shareByName[name] = Number(count) / totalReceived;
    }
  }
  return { receivedByName, shareByName, totalReceived };
}
__name(computeSessionReceivedShareMap, "computeSessionReceivedShareMap");
function computeL2ShapeTerms(priorReceivedByScarab, scarabRows, expectedFinal) {
  const observedBefore = priorReceivedByScarab || {};
  const { receivedByName, shareByName: sessionShares } = computeSessionReceivedShareMap(scarabRows);
  const priorCounts = Object.entries(observedBefore || {}).map(([name, count]) => [String(name), Math.max(0, Number(count) || 0)]);
  const commonNames = priorCounts.filter(([, count]) => count >= 200).map(([name]) => name);
  const midNames = priorCounts.filter(([, count]) => count >= 40 && count < 200).map(([name]) => name);
  const matureNames = [...new Set([...commonNames, ...midNames])];
  const totalCommonPrior = commonNames.reduce((sum, name) => sum + (Number(observedBefore?.[name]) || 0), 0);
  const totalMidPrior = midNames.reduce((sum, name) => sum + (Number(observedBefore?.[name]) || 0), 0);
  const totalMaturePrior = matureNames.reduce((sum, name) => sum + (Number(observedBefore?.[name]) || 0), 0);
  const expectedCommonShares = {};
  const expectedMidShares = {};
  const expectedMatureShares = {};
  for (const name of commonNames)
    expectedCommonShares[name] = totalCommonPrior > 0 ? (Number(observedBefore[name]) || 0) / totalCommonPrior : 0;
  for (const name of midNames)
    expectedMidShares[name] = totalMidPrior > 0 ? (Number(observedBefore[name]) || 0) / totalMidPrior : 0;
  for (const name of matureNames)
    expectedMatureShares[name] = totalMaturePrior > 0 ? (Number(observedBefore[name]) || 0) / totalMaturePrior : 0;
  const sessionCommonMass = commonNames.reduce((sum, name) => sum + (Number(sessionShares[name]) || 0), 0);
  const sessionMidMass = midNames.reduce((sum, name) => sum + (Number(sessionShares[name]) || 0), 0);
  const sessionMatureMass = matureNames.reduce((sum, name) => sum + (Number(sessionShares[name]) || 0), 0);
  const sessionCommonNorm = {};
  const sessionMidNorm = {};
  const sessionMatureNorm = {};
  for (const name of commonNames)
    sessionCommonNorm[name] = sessionCommonMass > 0 ? (Number(sessionShares[name]) || 0) / sessionCommonMass : 0;
  for (const name of midNames)
    sessionMidNorm[name] = sessionMidMass > 0 ? (Number(sessionShares[name]) || 0) / sessionMidMass : 0;
  for (const name of matureNames)
    sessionMatureNorm[name] = sessionMatureMass > 0 ? (Number(sessionShares[name]) || 0) / sessionMatureMass : 0;
  const midDiv = l1DistanceNormalized(sessionMidNorm, expectedMidShares, midNames);
  let spike = 0;
  let spikeScarab = null;
  let spikeExpectedShare = 0;
  let spikeActualShare = 0;
  for (const name of matureNames) {
    const expected = Math.max(1e-3, Number(expectedMatureShares[name] || 0));
    const actual = Math.max(0, Number(sessionMatureNorm[name] || 0));
    const ratio = actual / expected;
    const severity = clamp01((ratio - 1) / 6);
    if (severity > spike) {
      spike = severity;
      spikeScarab = name;
      spikeExpectedShare = expected;
      spikeActualShare = actual;
    }
  }
  const concentrationRaw = matureNames.length > 0 ? clamp01(computeHhi(sessionMatureNorm, matureNames) / 0.35) : 0;
  let supportRaw = 0;
  if (spikeScarab && spikeActualShare > spikeExpectedShare) {
    const topExcess = spikeActualShare - spikeExpectedShare;
    let otherPositiveExcess = 0;
    for (const name of matureNames) {
      if (name === spikeScarab)
        continue;
      const excess = Number(sessionMatureNorm[name] || 0) - Number(expectedMatureShares[name] || 0);
      if (excess > 0)
        otherPositiveExcess += excess;
    }
    supportRaw = clamp01(1 - otherPositiveExcess / Math.max(1e-9, topExcess + otherPositiveExcess));
  }
  const spikeExcessCount = Math.max(0, (spikeActualShare - spikeExpectedShare) * Math.max(0, Number(expectedFinal) || 0));
  return {
    spikeScarab,
    spikeExpectedShare,
    spikeActualShare,
    spikeExcessCount,
    maturePriorTotal: totalMaturePrior,
    spike,
    midDiv,
    concentration: concentrationRaw,
    support: supportRaw
  };
}
__name(computeL2ShapeTerms, "computeL2ShapeTerms");
function evaluateL2Intake(intake, priorReceivedByScarab) {
  const expectedFinal = Math.max(0, Number(intake.expectedFinal) || 0);
  const shape = computeL2ShapeTerms(priorReceivedByScarab || {}, intake.normalizedScarabs || [], expectedFinal);
  const sizeScale = clamp01(expectedFinal / 3500);
  const volumeEvidence = clamp01((expectedFinal - L2_LENIENCY_OUTPUT_FLOOR) / Math.max(1, L2_LENIENCY_OUTPUT_FULL - L2_LENIENCY_OUTPUT_FLOOR));
  const volumeLeniencyScale = L2_LENIENCY_MIN_SCALE + (1 - L2_LENIENCY_MIN_SCALE) * volumeEvidence;
  const driftRatio = Math.abs(Number(intake.drift) || 0) / Math.max(1, Number(intake.allowedDrift) || 1);
  const l1Trust = clamp01(1 - driftRatio / L2_TRUST_WARM_DRIFT_RATIO);
  const l1TrustThresholdBonus = L2_TRUST_MAX_THRESHOLD_BONUS * l1Trust;
  const spikeGate = clamp01((shape.spike + shape.midDiv) / 0.25);
  const supportGate = clamp01(shape.spike / 0.15);
  const concentration_adjusted = shape.concentration * sizeScale * spikeGate;
  const support_adjusted_base = shape.support * supportGate;
  const excessFloor = Math.max(12, Math.ceil(expectedFinal * 4e-3));
  const shareEsc = clamp01((shape.spikeExpectedShare - 0.015) / 0.02);
  const excessEsc = clamp01((shape.spikeExcessCount - excessFloor) / Math.max(10, 2 * excessFloor));
  const maturityEsc = clamp01((shape.maturePriorTotal - 400) / 2e3);
  const escalation = Math.max(0.08, Math.max(shareEsc, excessEsc) * (0.35 + 0.65 * maturityEsc));
  const spike_guarded = shape.spike * escalation;
  const support_adjusted = support_adjusted_base * escalation;
  const midDiv_guarded = shape.midDiv * (0.45 + 0.55 * volumeEvidence);
  const concentration_lenient = concentration_adjusted * volumeLeniencyScale;
  const spike_lenient = spike_guarded * volumeLeniencyScale;
  const support_lenient = support_adjusted * volumeLeniencyScale;
  const scoreBeforeGuards = 100 * (L2_WEIGHT_SPIKE * shape.spike + L2_WEIGHT_MID_DIV * shape.midDiv + L2_WEIGHT_CONCENTRATION * concentration_adjusted + L2_WEIGHT_SUPPORT * support_adjusted_base);
  const scoreAfterGuardsRaw = 100 * (L2_WEIGHT_SPIKE * spike_guarded + L2_WEIGHT_MID_DIV * shape.midDiv + L2_WEIGHT_CONCENTRATION * concentration_adjusted + L2_WEIGHT_SUPPORT * support_adjusted);
  let corroborationCount = 0;
  if (shape.spike >= L2_CORROBORATION_SPIKE)
    corroborationCount += 1;
  if (shape.midDiv >= L2_CORROBORATION_MID_DIV)
    corroborationCount += 1;
  if (concentration_adjusted >= L2_CORROBORATION_CONCENTRATION)
    corroborationCount += 1;
  if (support_adjusted >= L2_CORROBORATION_SUPPORT)
    corroborationCount += 1;
  if (shape.spikeExcessCount >= excessFloor * L2_CORROBORATION_EXCESS_MULT)
    corroborationCount += 1;
  const corroborationLift = 1 + 0.2 * clamp01((corroborationCount - 1) / 3);
  const finalScoreBase = 100 * (L2_WEIGHT_SPIKE * spike_lenient + L2_WEIGHT_MID_DIV * midDiv_guarded + L2_WEIGHT_CONCENTRATION * concentration_lenient + L2_WEIGHT_SUPPORT * support_lenient);
  const finalScore = finalScoreBase * corroborationLift;
  const dynamicPassThreshold = Math.max(
    L2_PASS_THRESHOLD,
    Math.min(
      30,
      L2_PASS_THRESHOLD + (1 - volumeEvidence) * 7 + l1TrustThresholdBonus - Math.max(0, corroborationCount - 1) * 1.5
    )
  );
  const warmL1 = driftRatio >= L2_TRUST_WARM_DRIFT_RATIO;
  const absurdComposition = shape.spike >= L2_ABSURD_SPIKE && (shape.midDiv >= L2_ABSURD_MID_DIV || concentration_adjusted >= L2_ABSURD_CONCENTRATION || shape.spikeExcessCount >= excessFloor * L2_ABSURD_EXCESS_MULT);
  const strongMultiSignal = corroborationCount >= 3 && finalScore >= L2_PASS_THRESHOLD;
  const shouldHold = finalScore >= dynamicPassThreshold && (corroborationCount >= L2_MULTI_SIGNAL_HOLD_MIN || warmL1 || finalScore >= L2_EXTREME_HOLD_SCORE || absurdComposition || strongMultiSignal);
  const matureGuard = shape.maturePriorTotal >= 400 && shape.spikeExpectedShare >= 0.015;
  const excessGuard = shape.spikeExcessCount >= excessFloor;
  const l2Audit = {
    spikeScarab: shape.spikeScarab || null,
    expectedShare: shape.spikeExpectedShare,
    actualShare: shape.spikeActualShare,
    excessCount: shape.spikeExcessCount,
    maturePriorTotal: shape.maturePriorTotal,
    matureGuard,
    excessGuard,
    spikeSeverity: shape.spike,
    midDiv: shape.midDiv,
    concentration: shape.concentration,
    supportInconsistency: shape.support,
    concentrationAdjusted: concentration_adjusted,
    supportAdjustedBase: support_adjusted_base,
    supportAdjusted: support_adjusted,
    volumeEvidence,
    volumeLeniencyScale,
    driftRatio,
    l1Trust,
    l1TrustThresholdBonus,
    corroborationCount,
    corroborationLift,
    scoreBeforeGuards,
    scoreAfterGuardsRaw,
    scoreAfterGuards: finalScore,
    dynamicPassThreshold,
    finalL2Score: finalScore,
    highPriorityReview: shouldHold && (finalScore >= L2_HIGH_PRIORITY_THRESHOLD || absurdComposition || corroborationCount >= 3),
    interpretation: !shouldHold ? "L2 pass: composition variance stays within lenient low-concern intake bounds." : finalScore >= L2_HIGH_PRIORITY_THRESHOLD || absurdComposition ? "L2 review hold: extreme composition anomaly with high aggregate-risk signal." : "L2 review hold: corroborated composition anomaly requires manual moderation.",
    gates: {
      sizeScale,
      spikeGate,
      supportGate,
      shareEsc,
      excessEsc,
      maturityEsc,
      escalation,
      excessFloor,
      volumeEvidence,
      volumeLeniencyScale,
      dynamicPassThreshold,
      warmL1
    }
  };
  if (!shouldHold) {
    return {
      counted: true,
      intakeState: SESSION_STATE_APPROVED_AUTO,
      classification: SESSION_STATE_APPROVED_AUTO,
      healthPct: 100,
      reasons: intake.reasons,
      l2Audit
    };
  }
  return {
    counted: false,
    intakeState: SESSION_STATE_REVIEW_PENDING,
    classification: SESSION_STATE_REVIEW_PENDING,
    healthPct: Math.max(65, Number(intake.healthPct) || 0),
    reasons: [...intake.reasons, l2Audit.interpretation],
    l2Audit
  };
}
__name(evaluateL2Intake, "evaluateL2Intake");
function parseScarabRows(raw) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
__name(parseScarabRows, "parseScarabRows");
function buildSessionPayloadFromStoredRow(row) {
  const scarabRows = parseScarabRows(row?.scarabs_json || "[]");
  const normalizedRows = [];
  let consumedSeen = false;
  for (const item of scarabRows || []) {
    const name = String(item?.name || "").trim();
    if (!name)
      continue;
    const received = Math.max(0, Number(item?.received) || 0);
    let consumed = Number(item?.consumed);
    if (!Number.isFinite(consumed) || consumed < 0)
      consumed = 0;
    if (consumed > 0)
      consumedSeen = true;
    normalizedRows.push({
      name,
      consumed: Math.floor(consumed),
      received: Math.floor(received),
      was_vendor: !!item?.was_vendor,
      ninja_price: Math.max(0, Number(item?.ninja_price) || 0)
    });
  }
  if (!normalizedRows.length)
    return null;
  if (!consumedSeen) {
    const declared = Math.max(0, Math.floor(Number(row?.total_consumed) || 0));
    if (declared > 0) {
      normalizedRows[0].consumed = declared;
    }
  }
  return {
    league: row?.league || null,
    regex: row?.regex || null,
    total_consumed: Math.max(0, Math.floor(Number(row?.total_consumed) || 0)),
    total_trades: Math.max(0, Math.floor(Number(row?.total_trades) || 0)),
    input_value: Math.max(0, Number(row?.input_value) || 0),
    output_value: Math.max(0, Number(row?.output_value) || 0),
    divine_rate: Number(row?.divine_rate) || null,
    scarabs: normalizedRows
  };
}
__name(buildSessionPayloadFromStoredRow, "buildSessionPayloadFromStoredRow");
function buildReceivedByScarabMap(scarabs) {
  const out = {};
  for (const row of scarabs || []) {
    const name = String(row?.name || "").trim();
    if (!name)
      continue;
    const received = Number(row?.received) || 0;
    if (received <= 0)
      continue;
    out[name] = (out[name] || 0) + received;
  }
  return out;
}
__name(buildReceivedByScarabMap, "buildReceivedByScarabMap");
async function applySessionAggregateDelta(env, sessionRow, direction) {
  const dir = Number(direction) >= 0 ? 1 : -1;
  const aggRow = await env.DB.prepare(
    "SELECT total_sessions, total_consumed, total_trades, total_input, total_output, received_by_scarab FROM aggregate WHERE id = 1"
  ).first();
  let receivedByScarab = {};
  try {
    receivedByScarab = JSON.parse(aggRow?.received_by_scarab || "{}");
  } catch (_) {
    receivedByScarab = {};
  }
  const deltaMap = buildReceivedByScarabMap(parseScarabRows(sessionRow?.scarabs_json || "[]"));
  for (const [name, count] of Object.entries(deltaMap)) {
    const next = (Number(receivedByScarab[name]) || 0) + dir * (Number(count) || 0);
    if (next > 0)
      receivedByScarab[name] = next;
    else
      delete receivedByScarab[name];
  }
  const nextSessions = Math.max(0, (Number(aggRow?.total_sessions) || 0) + dir);
  const nextConsumed = Math.max(0, (Number(aggRow?.total_consumed) || 0) + dir * (Number(sessionRow?.total_consumed) || 0));
  const nextTrades = Math.max(0, (Number(aggRow?.total_trades) || 0) + dir * (Number(sessionRow?.total_trades) || 0));
  const nextInput = Math.max(0, (Number(aggRow?.total_input) || 0) + dir * (Number(sessionRow?.input_value) || 0));
  const nextOutput = Math.max(0, (Number(aggRow?.total_output) || 0) + dir * (Number(sessionRow?.output_value) || 0));
  await env.DB.prepare(
    "UPDATE aggregate SET total_sessions = ?, total_consumed = ?, total_trades = ?, total_input = ?, total_output = ?, received_by_scarab = ? WHERE id = 1"
  ).bind(nextSessions, nextConsumed, nextTrades, nextInput, nextOutput, JSON.stringify(receivedByScarab)).run();
  return { sessionCount: nextSessions };
}
__name(applySessionAggregateDelta, "applySessionAggregateDelta");
async function insertIntakeEvent(env, payload) {
  await env.DB.prepare(
    `INSERT INTO session_intake_events (
      session_id, action, intake_state, admin_actor, admin_note, ip_hash,
      league, league_key, total_consumed, total_trades, input_value, output_value,
      expected_trades, actual_outputs, output_drift, reasons_json, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    payload.sessionId || null,
    payload.action || "event",
    payload.intakeState || SESSION_STATE_L1_REJECT,
    payload.adminActor || null,
    payload.adminNote || null,
    payload.ipHash || null,
    payload.league || null,
    payload.leagueKey || null,
    Number(payload.totalConsumed) || 0,
    Number(payload.totalTrades) || 0,
    Number(payload.totalInput) || 0,
    Number(payload.totalOutput) || 0,
    Number(payload.expectedTrades) || 0,
    Number(payload.actualOutputs) || 0,
    Number(payload.drift) || 0,
    JSON.stringify(Array.isArray(payload.reasons) ? payload.reasons : []),
    payload.meta ? JSON.stringify(payload.meta) : null
  ).run();
}
__name(insertIntakeEvent, "insertIntakeEvent");
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
async function loadApprovedReceivedByScarab(env) {
  const row = await env.DB.prepare("SELECT received_by_scarab FROM aggregate WHERE id = 1").first();
  return safeParseJsonMap(row?.received_by_scarab || "{}");
}
__name(loadApprovedReceivedByScarab, "loadApprovedReceivedByScarab");
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
      enabled: true,
      mode: "seeded-canonical",
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
    `SELECT created_at, league, league_key, total_consumed, total_trades, input_value, output_value, divine_rate, scarabs_json
     FROM sessions
     WHERE ${APPROVED_STATE_WHERE}`
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
    `SELECT total_consumed, total_trades, input_value, output_value, scarabs_json
     FROM sessions
     WHERE ${APPROVED_STATE_WHERE}`
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
    await ensureIntakeSchema(env);
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
        const { results } = await env.DB.prepare(`SELECT scarabs_json FROM sessions WHERE ${APPROVED_STATE_WHERE}`).all();
        
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
          SUM(input_value) as i, SUM(output_value) as o FROM sessions WHERE ${APPROVED_STATE_WHERE}
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
      const league = session.league || null;
      const leagueInfo = normalizeLeagueInfo(league || "unknown");
      const fingerprintResult = await computeSubmissionFingerprint(session);
      if (fingerprintResult?.fingerprint) {
        const dup = await findDuplicateSubmission(env, fingerprintResult.fingerprint);
        if (dup) {
          const reasons = ["duplicate_submission"];
          const l1Audit = {
            l1_result: "reject",
            rejection_reason: "duplicate_submission",
            duplicateOfSessionId: dup.id,
            duplicateOfCreatedAt: dup.createdAt,
            duplicateOfState: dup.intakeState,
            submissionFingerprint: fingerprintResult.fingerprint
          };
          await insertIntakeEvent(env, {
            action: "l1_reject",
            intakeState: SESSION_STATE_L1_REJECT,
            ipHash,
            league,
            leagueKey: leagueInfo.key,
            reasons,
            meta: {
              duplicate_submission: true,
              l1Audit,
              normalizedPayload: fingerprintResult.normalizedPayload
            }
          });
          return json({
            counted: false,
            intakeState: SESSION_STATE_L1_REJECT,
            classification: SESSION_STATE_L1_REJECT,
            healthPct: 0,
            reasons,
            l1_result: "reject",
            l1Audit,
            l2Audit: null
          }, 200);
        }
      }
      const l1 = evaluateSessionIntake(session);
      if (!l1.l1Passed) {
        await insertIntakeEvent(env, {
          action: "l1_reject",
          intakeState: SESSION_STATE_L1_REJECT,
          ipHash,
          league,
          leagueKey: leagueInfo.key,
          totalConsumed: l1.totalConsumed,
          totalTrades: l1.expectedTrades,
          totalInput: l1.totalInput,
          totalOutput: l1.totalOutput,
          expectedTrades: l1.expectedTrades,
          actualOutputs: l1.actualOutputs,
          drift: l1.drift,
          reasons: l1.reasons,
          meta: {
            scarabRows: Array.isArray(l1.normalizedScarabs) ? l1.normalizedScarabs.length : 0,
            expectedFinal: Number(l1.expectedFinal) || 0,
            allowedDrift: Number(l1.allowedDrift) || 0,
            l1Audit: l1.l1Audit || null
          }
        });
        return json({
          counted: false,
          intakeState: SESSION_STATE_L1_REJECT,
          classification: SESSION_STATE_L1_REJECT,
          healthPct: l1.healthPct,
          reasons: l1.reasons,
          expectedTrades: l1.expectedTrades,
          leftovers: l1.leftovers,
          expectedFinal: l1.expectedFinal,
          allowedDrift: l1.allowedDrift,
          actualOutputs: l1.actualOutputs,
          actualFinalCount: l1.actualFinalCount,
          drift: l1.drift,
          driftPct: l1.driftPct,
          l1_result: l1.l1_result,
          l1Audit: l1.l1Audit
        }, 200);
      }
      const priorReceivedByScarab = await loadApprovedReceivedByScarab(env);
      const l2 = evaluateL2Intake(l1, priorReceivedByScarab);
      const totalConsumed = l1.totalConsumed;
      const totalTrades = l1.expectedTrades;
      const totalInput = l1.totalInput;
      const totalOutput = l1.totalOutput;
      const divineRate = Number(session.divine_rate) || null;
      const scarabs = l1.normalizedScarabs;
      const scarabsJson = JSON.stringify(scarabs.map((r) => ({
        name: r.name,
        received: r.received,
        consumed: r.consumed,
        was_vendor: r.was_vendor,
        ninja_price: r.ninja_price
      })));
      const regex = session.regex || null;
      const intakeReasonsJson = JSON.stringify(l2.reasons || l1.reasons || []);
      const intakeL1Json = JSON.stringify(l1.l1Audit || {});
      const intakeL2Json = JSON.stringify(l2.l2Audit || {});
      const intakeFingerprint = fingerprintResult?.fingerprint || null;
      const intakeState = l2.intakeState || SESSION_STATE_REVIEW_PENDING;
      const insert = env.DB.prepare(
        `INSERT INTO sessions (
          total_consumed, total_trades, input_value, output_value, divine_rate, scarabs_json, league, regex, league_key,
          intake_state, intake_class, intake_health_pct, intake_expected_trades, intake_actual_outputs, intake_drift, intake_reasons_json,
          intake_l1_json, intake_l2_json, intake_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        totalConsumed, totalTrades, totalInput, totalOutput, divineRate, scarabsJson, league, regex, leagueInfo.key,
        intakeState, l2.classification || intakeState, Number(l2.healthPct) || Number(l1.healthPct) || 0, l1.expectedTrades, l1.actualOutputs, l1.drift, intakeReasonsJson,
        intakeL1Json, intakeL2Json, intakeFingerprint
      );
      const insertResult = await insert.run();
      const sessionId = insertResult?.meta?.last_row_id ? String(insertResult.meta.last_row_id) : null;
      if (APPROVED_INTAKE_STATES.includes(intakeState)) {
        await applySessionAggregateDelta(env, {
          total_consumed: totalConsumed,
          total_trades: totalTrades,
          input_value: totalInput,
          output_value: totalOutput,
          scarabs_json: scarabsJson
        }, +1);
      }
      await insertIntakeEvent(env, {
        sessionId,
        action: "submitted",
        intakeState,
        ipHash,
        league,
        leagueKey: leagueInfo.key,
        totalConsumed,
        totalTrades,
        totalInput,
        totalOutput,
        expectedTrades: l1.expectedTrades,
        actualOutputs: l1.actualOutputs,
        drift: l1.drift,
        reasons: l2.reasons || l1.reasons,
        meta: {
          expectedFinal: Number(l1.expectedFinal) || 0,
          allowedDrift: Number(l1.allowedDrift) || 0,
          l1Audit: l1.l1Audit || null,
          l2Audit: l2.l2Audit || null
        }
      });
      const aggRow = await env.DB.prepare("SELECT total_sessions FROM aggregate WHERE id = 1").first();
      return json({
        counted: APPROVED_INTAKE_STATES.includes(intakeState),
        intakeState,
        classification: l2.classification || intakeState,
        healthPct: l2.healthPct,
        reasons: l2.reasons || l1.reasons,
        expectedTrades: l1.expectedTrades,
        leftovers: l1.leftovers,
        expectedFinal: l1.expectedFinal,
        allowedDrift: l1.allowedDrift,
        actualOutputs: l1.actualOutputs,
        actualFinalCount: l1.actualFinalCount,
        drift: l1.drift,
        driftPct: l1.driftPct,
        l1_result: l1.l1_result,
        l1Audit: l1.l1Audit,
        l2Audit: l2.l2Audit || null,
        sessionCount: aggRow?.total_sessions ?? 0
      }, 200);
    }
    if (path.startsWith("/admin/sessions")) {
      const urlKey = url.searchParams.get("key");
      if (!urlKey || urlKey !== env.ADMIN_KEY)
        return json({ error: "Unauthorized" }, 401);
      const subPath = path.slice("/admin/sessions".length);
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));
      if (request.method === "GET" && subPath === "/review") {
        const { results } = await env.DB.prepare(
          `SELECT id, created_at, league, league_key, regex, total_consumed, total_trades, input_value, output_value,
                  divine_rate, scarabs_json, intake_state, intake_class, intake_health_pct, intake_expected_trades,
                  intake_actual_outputs, intake_drift, intake_reasons_json, intake_l1_json, intake_l2_json, admin_note, reviewed_at
           FROM sessions
           WHERE intake_state = ?
           ORDER BY created_at DESC
           LIMIT ?`
        ).bind(SESSION_STATE_REVIEW_PENDING, limit).all();
        return json(results);
      }
      if (request.method === "GET" && subPath === "/research") {
        const { results } = await env.DB.prepare(
          `SELECT id, created_at, league, league_key, regex, total_consumed, total_trades, input_value, output_value,
                  divine_rate, scarabs_json, intake_state, intake_class, intake_health_pct, intake_expected_trades,
                  intake_actual_outputs, intake_drift, intake_reasons_json, intake_l1_json, intake_l2_json, admin_note, reviewed_at
           FROM sessions
           WHERE intake_state = ?
           ORDER BY created_at DESC
           LIMIT ?`
        ).bind(SESSION_STATE_RESEARCH, limit).all();
        return json(results);
      }
      if (request.method === "GET" && subPath === "/analytics") {
        const { results: stateRows } = await env.DB.prepare(
          `SELECT intake_state, COUNT(*) AS count
           FROM sessions
           GROUP BY intake_state`
        ).all();
        const counts = {
          approved_auto: 0,
          review_pending: 0,
          approved_manual: 0,
          research: 0
        };
        for (const row of stateRows || []) {
          const state = String(row?.intake_state || "").trim();
          const count = Number(row?.count) || 0;
          if (Object.prototype.hasOwnProperty.call(counts, state))
            counts[state] = count;
        }
        const l1Rejected = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM session_intake_events WHERE intake_state = ? AND action = ?"
        ).bind(SESSION_STATE_L1_REJECT, "l1_reject").first();
        const l1RejectCount = Number(l1Rejected?.count) || 0;
        const duplicateRejected = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM session_intake_events WHERE intake_state = ? AND action = ? AND reasons_json LIKE ?"
        ).bind(SESSION_STATE_L1_REJECT, "l1_reject", "%duplicate_submission%").first();
        const duplicateSubmissionCount = Number(duplicateRejected?.count) || 0;
        const totalSubmissions = counts.approved_auto + counts.review_pending + counts.approved_manual + counts.research + l1RejectCount;
        const { results: l2Rows } = await env.DB.prepare(
          `SELECT intake_l2_json
           FROM sessions
           WHERE intake_l2_json IS NOT NULL
             AND intake_l2_json != ''`
        ).all();
        const scores = [];
        for (const row of l2Rows || []) {
          try {
            const parsed = JSON.parse(String(row?.intake_l2_json || "{}"));
            const score = Number(parsed?.finalL2Score);
            if (Number.isFinite(score))
              scores.push(score);
          } catch (_) {
          }
        }
        scores.sort((a, b) => a - b);
        let averageL2Score = 0;
        let medianL2Score = 0;
        if (scores.length > 0) {
          averageL2Score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
          const mid = Math.floor(scores.length / 2);
          medianL2Score = scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
        }
        const scoreHistogram = {
          lt12: 0,
          b12to20: 0,
          b20to35: 0,
          gte35: 0
        };
        for (const score of scores) {
          if (score < 12)
            scoreHistogram.lt12 += 1;
          else if (score < 20)
            scoreHistogram.b12to20 += 1;
          else if (score < 35)
            scoreHistogram.b20to35 += 1;
          else
            scoreHistogram.gte35 += 1;
        }
        return json({
          totalSubmissions,
          counts,
          l1RejectCount,
          duplicateSubmissionCount,
          l2ScoreCount: scores.length,
          averageL2Score,
          medianL2Score,
          scoreHistogram
        });
      }
      if (request.method === "GET" && subPath === "/metrics") {
        const { results } = await env.DB.prepare(
          `SELECT intake_state, COUNT(*) AS count
           FROM sessions
           GROUP BY intake_state`
        ).all();
        const counts = {
          approved_auto: 0,
          approved_manual: 0,
          review_pending: 0,
          research: 0,
          legacy_approved: 0
        };
        for (const row of results || []) {
          const state = row?.intake_state;
          const count = Number(row?.count) || 0;
          if (state === null || state === "")
            counts.legacy_approved += count;
          else if (Object.prototype.hasOwnProperty.call(counts, state))
            counts[state] = count;
        }
        const l1Rejected = await env.DB.prepare("SELECT COUNT(*) AS count FROM session_intake_events WHERE intake_state = ?").bind(SESSION_STATE_L1_REJECT).first();
        return json({
          counts,
          l1RejectCount: Number(l1Rejected?.count) || 0
        });
      }
      if (request.method === "POST" && subPath === "/rerun-intake") {
        let ids = [];
        let dryRun = false;
        try {
          const body = await request.json();
          if (body && Array.isArray(body.ids))
            ids = body.ids;
          dryRun = String(body?.dryRun || "").trim() === "1" || body?.dryRun === true;
        } catch (_) {
        }
        const selectedIdList = Array.from(
          new Set(
            ids.map((id) => String(id || "").trim()).filter(Boolean)
          )
        ).slice(0, 2e3);
        if (selectedIdList.length === 0) {
          return json({ error: "Provide at least one session id in ids[]" }, 400);
        }
        const selectedIdSet = new Set(selectedIdList);
        const approvedPriorByScarab = {};
        const { results: streamRows } = await env.DB.prepare(
          `SELECT id, created_at, league, league_key, regex, total_consumed, total_trades, input_value, output_value,
                  divine_rate, scarabs_json, intake_state
           FROM sessions
           ORDER BY created_at ASC, id ASC`
        ).all();
        let found = 0;
        let processed = 0;
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        let changed = 0;
        const stateCounts = {
          approved_auto: 0,
          review_pending: 0,
          l1_reject: 0
        };
        for (const row of streamRows || []) {
          const rowId = String(row?.id || "");
          const isSelected = selectedIdSet.has(rowId);
          if (!isSelected) {
            const state = String(row?.intake_state || "").trim();
            if (APPROVED_INTAKE_STATES.includes(state)) {
              const deltaMap = buildReceivedByScarabMap(parseScarabRows(row?.scarabs_json || "[]"));
              for (const [name, count] of Object.entries(deltaMap)) {
                approvedPriorByScarab[name] = (Number(approvedPriorByScarab[name]) || 0) + (Number(count) || 0);
              }
            }
            continue;
          }
          found += 1;
          processed += 1;
          const prevState = String(row?.intake_state || "").trim();
          try {
            const payload = buildSessionPayloadFromStoredRow(row);
            if (!payload) {
              skipped += 1;
              continue;
            }
            const l1 = evaluateSessionIntake(payload);
            let intakeState = SESSION_STATE_L1_REJECT;
            let classification = SESSION_STATE_L1_REJECT;
            let healthPct = Number(l1.healthPct) || 0;
            let reasons = Array.isArray(l1.reasons) ? l1.reasons : [];
            let l2Audit = null;
            if (l1.l1Passed) {
              const l2 = evaluateL2Intake(l1, approvedPriorByScarab);
              intakeState = String(l2.intakeState || SESSION_STATE_REVIEW_PENDING);
              classification = String(l2.classification || intakeState);
              healthPct = Number(l2.healthPct) || healthPct;
              reasons = Array.isArray(l2.reasons) ? l2.reasons : reasons;
              l2Audit = l2.l2Audit || null;
            }
            if (prevState !== intakeState)
              changed += 1;
            if (Object.prototype.hasOwnProperty.call(stateCounts, intakeState))
              stateCounts[intakeState] += 1;
            if (!dryRun) {
              await env.DB.prepare(
                `UPDATE sessions
                 SET intake_state = ?, intake_class = ?, intake_health_pct = ?, intake_expected_trades = ?, intake_actual_outputs = ?,
                     intake_drift = ?, intake_reasons_json = ?, intake_l1_json = ?, intake_l2_json = ?
                 WHERE id = ?`
              ).bind(
                intakeState,
                classification,
                healthPct,
                Number(l1.expectedTrades) || 0,
                Number(l1.actualOutputs) || 0,
                Number(l1.drift) || 0,
                JSON.stringify(reasons || []),
                JSON.stringify(l1.l1Audit || {}),
                JSON.stringify(l2Audit || {}),
                rowId
              ).run();
              await insertIntakeEvent(env, {
                sessionId: rowId,
                action: "rerun_intake_selected",
                intakeState,
                adminActor: "admin_key",
                league: row?.league || null,
                leagueKey: row?.league_key || null,
                totalConsumed: row?.total_consumed,
                totalTrades: row?.total_trades,
                totalInput: row?.input_value,
                totalOutput: row?.output_value,
                expectedTrades: l1.expectedTrades,
                actualOutputs: l1.actualOutputs,
                drift: l1.drift,
                reasons,
                meta: {
                  source: "selected_rerun",
                  previousState: prevState || null,
                  l1Audit: l1.l1Audit || null,
                  l2Audit
                }
              });
            }
            updated += 1;
            if (intakeState === SESSION_STATE_APPROVED_AUTO) {
              const deltaMap = buildReceivedByScarabMap(payload.scarabs);
              for (const [name, count] of Object.entries(deltaMap)) {
                approvedPriorByScarab[name] = (Number(approvedPriorByScarab[name]) || 0) + (Number(count) || 0);
              }
            }
          } catch (_) {
            errors += 1;
          }
        }
        let aggregateRecomputed = false;
        if (!dryRun) {
          await recomputeAggregate(env);
          aggregateRecomputed = true;
        }
        return json({
          ok: true,
          dryRun,
          selected: selectedIdList.length,
          found,
          missing: Math.max(0, selectedIdList.length - found),
          processed,
          updated,
          changed,
          skipped,
          errors,
          stateCounts,
          aggregateRecomputed
        });
      }
      if (request.method === "POST" && subPath === "/backfill-intake") {
        const dryRun = String(url.searchParams.get("dryRun") || "").trim() === "1";
        const maxRows = Math.max(1, Math.min(2e3, Number(url.searchParams.get("limit") || 500)));
        const { results: legacyRows } = await env.DB.prepare(
          `SELECT id, created_at, league, league_key, regex, total_consumed, total_trades, input_value, output_value,
                  divine_rate, scarabs_json, intake_state
           FROM sessions
           WHERE intake_state IS NULL OR intake_state = ''
           ORDER BY created_at ASC, id ASC
           LIMIT ?`
        ).bind(maxRows).all();
        if (!Array.isArray(legacyRows) || legacyRows.length === 0) {
          return json({
            ok: true,
            dryRun,
            selected: 0,
            processed: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            stateCounts: {
              approved_auto: 0,
              review_pending: 0,
              l1_reject: 0
            },
            aggregateRecomputed: false
          });
        }
        const approvedPriorByScarab = {};
        const { results: streamRows } = await env.DB.prepare(
          `SELECT id, created_at, scarabs_json, intake_state
           FROM sessions
           ORDER BY created_at ASC, id ASC`
        ).all();
        const legacyIdSet = new Set((legacyRows || []).map((r) => String(r?.id || "")));
        const legacyById = {};
        for (const row of legacyRows || [])
          legacyById[String(row?.id || "")] = row;
        let processed = 0;
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        const stateCounts = {
          approved_auto: 0,
          review_pending: 0,
          l1_reject: 0
        };
        for (const row of streamRows || []) {
          const id = String(row?.id || "");
          if (!legacyIdSet.has(id)) {
            const state = String(row?.intake_state || "").trim();
            if (APPROVED_INTAKE_STATES.includes(state)) {
              const deltaMap = buildReceivedByScarabMap(parseScarabRows(row?.scarabs_json || "[]"));
              for (const [name, count] of Object.entries(deltaMap)) {
                approvedPriorByScarab[name] = (Number(approvedPriorByScarab[name]) || 0) + (Number(count) || 0);
              }
            }
            continue;
          }
          const legacy = legacyById[id];
          processed += 1;
          try {
            const payload = buildSessionPayloadFromStoredRow(legacy);
            if (!payload) {
              skipped += 1;
              continue;
            }
            const l1 = evaluateSessionIntake(payload);
            let intakeState = SESSION_STATE_L1_REJECT;
            let classification = SESSION_STATE_L1_REJECT;
            let healthPct = Number(l1.healthPct) || 0;
            let reasons = Array.isArray(l1.reasons) ? l1.reasons : [];
            let l2Audit = null;
            if (l1.l1Passed) {
              const l2 = evaluateL2Intake(l1, approvedPriorByScarab);
              intakeState = String(l2.intakeState || SESSION_STATE_REVIEW_PENDING);
              classification = String(l2.classification || intakeState);
              healthPct = Number(l2.healthPct) || healthPct;
              reasons = Array.isArray(l2.reasons) ? l2.reasons : reasons;
              l2Audit = l2.l2Audit || null;
            }
            if (intakeState === SESSION_STATE_APPROVED_AUTO) {
              const deltaMap = buildReceivedByScarabMap(payload.scarabs);
              for (const [name, count] of Object.entries(deltaMap)) {
                approvedPriorByScarab[name] = (Number(approvedPriorByScarab[name]) || 0) + (Number(count) || 0);
              }
            }
            if (Object.prototype.hasOwnProperty.call(stateCounts, intakeState))
              stateCounts[intakeState] += 1;
            if (!dryRun) {
              await env.DB.prepare(
                `UPDATE sessions
                 SET intake_state = ?, intake_class = ?, intake_health_pct = ?, intake_expected_trades = ?, intake_actual_outputs = ?,
                     intake_drift = ?, intake_reasons_json = ?, intake_l1_json = ?, intake_l2_json = ?
                 WHERE id = ?`
              ).bind(
                intakeState,
                classification,
                healthPct,
                Number(l1.expectedTrades) || 0,
                Number(l1.actualOutputs) || 0,
                Number(l1.drift) || 0,
                JSON.stringify(reasons || []),
                JSON.stringify(l1.l1Audit || {}),
                JSON.stringify(l2Audit || {}),
                id
              ).run();
              await insertIntakeEvent(env, {
                sessionId: id,
                action: "backfill_intake",
                intakeState,
                adminActor: "admin_key",
                league: legacy?.league || null,
                leagueKey: legacy?.league_key || null,
                totalConsumed: legacy?.total_consumed,
                totalTrades: legacy?.total_trades,
                totalInput: legacy?.input_value,
                totalOutput: legacy?.output_value,
                expectedTrades: l1.expectedTrades,
                actualOutputs: l1.actualOutputs,
                drift: l1.drift,
                reasons,
                meta: {
                  source: "legacy_backfill",
                  l1Audit: l1.l1Audit || null,
                  l2Audit
                }
              });
            }
            updated += 1;
          } catch (_) {
            errors += 1;
          }
        }
        let aggregateRecomputed = false;
        if (!dryRun) {
          await recomputeAggregate(env);
          aggregateRecomputed = true;
        }
        return json({
          ok: true,
          dryRun,
          selected: legacyRows.length,
          processed,
          updated,
          skipped,
          errors,
          stateCounts,
          aggregateRecomputed
        });
      }
      const approveMatch = subPath.match(/^\/([^/]+)\/approve$/);
      if (approveMatch && request.method === "POST") {
        const id = decodeURIComponent(approveMatch[1] || "");
        const row = await env.DB.prepare(
          `SELECT id, intake_state, total_consumed, total_trades, input_value, output_value, scarabs_json, league, league_key,
                  intake_expected_trades, intake_actual_outputs, intake_drift, intake_reasons_json
           FROM sessions WHERE id = ?`
        ).bind(id).first();
        if (!row)
          return json({ error: "Session not found" }, 404);
        if (!SESSION_REVIEWABLE_STATES.includes(String(row.intake_state || "")) && row.intake_state !== SESSION_STATE_APPROVED_AUTO && row.intake_state !== SESSION_STATE_APPROVED_MANUAL) {
          return json({ error: "Session is not reviewable" }, 409);
        }
        let note = null;
        try {
          const body = await request.json();
          note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
        } catch (_) {
          note = null;
        }
        const previousState = row.intake_state || null;
        await env.DB.prepare(
          "UPDATE sessions SET intake_state = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(SESSION_STATE_APPROVED_MANUAL, note, id).run();
        if (!APPROVED_INTAKE_STATES.includes(String(previousState || ""))) {
          await applySessionAggregateDelta(env, row, +1);
        }
        await insertIntakeEvent(env, {
          sessionId: String(id),
          action: "approve",
          intakeState: SESSION_STATE_APPROVED_MANUAL,
          adminActor: "admin_key",
          adminNote: note,
          league: row.league,
          leagueKey: row.league_key,
          totalConsumed: row.total_consumed,
          totalTrades: row.total_trades,
          totalInput: row.input_value,
          totalOutput: row.output_value,
          expectedTrades: row.intake_expected_trades,
          actualOutputs: row.intake_actual_outputs,
          drift: row.intake_drift,
          reasons: safeParseJsonArray(row.intake_reasons_json)
        });
        return json({ ok: true, id, intakeState: SESSION_STATE_APPROVED_MANUAL });
      }
      const rejectMatch = subPath.match(/^\/([^/]+)\/reject$/);
      if (rejectMatch && request.method === "POST") {
        const id = decodeURIComponent(rejectMatch[1] || "");
        const row = await env.DB.prepare(
          `SELECT id, intake_state, total_consumed, total_trades, input_value, output_value, scarabs_json, league, league_key,
                  intake_expected_trades, intake_actual_outputs, intake_drift, intake_reasons_json
           FROM sessions WHERE id = ?`
        ).bind(id).first();
        if (!row)
          return json({ error: "Session not found" }, 404);
        if (String(row.intake_state || "") === SESSION_STATE_RESEARCH)
          return json({ ok: true, id, intakeState: SESSION_STATE_RESEARCH });
        let note = null;
        try {
          const body = await request.json();
          note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
        } catch (_) {
          note = null;
        }
        const wasApproved = APPROVED_INTAKE_STATES.includes(String(row.intake_state || ""));
        await env.DB.prepare(
          "UPDATE sessions SET intake_state = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(SESSION_STATE_RESEARCH, note, id).run();
        if (wasApproved) {
          await applySessionAggregateDelta(env, row, -1);
        }
        await insertIntakeEvent(env, {
          sessionId: String(id),
          action: "reject",
          intakeState: SESSION_STATE_RESEARCH,
          adminActor: "admin_key",
          adminNote: note,
          league: row.league,
          leagueKey: row.league_key,
          totalConsumed: row.total_consumed,
          totalTrades: row.total_trades,
          totalInput: row.input_value,
          totalOutput: row.output_value,
          expectedTrades: row.intake_expected_trades,
          actualOutputs: row.intake_actual_outputs,
          drift: row.intake_drift,
          reasons: safeParseJsonArray(row.intake_reasons_json)
        });
        return json({ ok: true, id, intakeState: SESSION_STATE_RESEARCH });
      }
      if (request.method === "DELETE") {
        const id = decodeURIComponent(path.replace("/admin/sessions/", ""));
        const row = await env.DB.prepare(
          "SELECT id, intake_state, total_consumed, total_trades, input_value, output_value, scarabs_json FROM sessions WHERE id = ?"
        ).bind(id).first();
        if (!row)
          return json({ ok: true, deleted: 0 });
        const wasApproved = APPROVED_INTAKE_STATES.includes(String(row.intake_state || "")) || row.intake_state === null;
        const res = await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
        if (wasApproved && (res?.meta?.changes || 0) > 0) {
          await applySessionAggregateDelta(env, row, -1);
        }
        return json({ ok: true, deleted: res.meta.changes ?? 0 });
      }
      if (request.method === "GET" && subPath === "/events") {
        const { results } = await env.DB.prepare(
          `SELECT id, created_at, session_id, action, intake_state, admin_actor, admin_note, league, league_key,
                  total_consumed, total_trades, input_value, output_value, expected_trades, actual_outputs, output_drift, reasons_json
           FROM session_intake_events
           ORDER BY created_at DESC
           LIMIT ?`
        ).bind(limit).all();
        return json(results);
      }
      if (request.method === "GET") {
        const intakeState = String(url.searchParams.get("state") || "").trim();
        let query = `SELECT id, created_at, league, league_key, regex, total_consumed, total_trades, input_value, output_value,
                            divine_rate, scarabs_json, intake_state, intake_class, intake_health_pct, intake_expected_trades,
                            intake_actual_outputs, intake_drift, intake_reasons_json, intake_l1_json, intake_l2_json, admin_note, reviewed_at
                     FROM sessions`;
        const bindArgs = [];
        if (intakeState) {
          query += " WHERE intake_state = ?";
          bindArgs.push(intakeState);
        }
        query += " ORDER BY created_at DESC LIMIT ?";
        bindArgs.push(limit);
        const { results } = await env.DB.prepare(query).bind(...bindArgs).all();
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

