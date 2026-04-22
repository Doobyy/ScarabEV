#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ADMIN_URL = "https://scarabev-api.paperpandastacks.workers.dev/admin/sessions";
const DEFAULT_WORKER_URL = "https://scarabev-market-worker.paperpandastacks.workers.dev";
const DEFAULT_LIMIT = 2500;

function parseArgs(argv) {
  const out = {
    adminUrl: DEFAULT_ADMIN_URL,
    workerUrl: DEFAULT_WORKER_URL,
    limit: DEFAULT_LIMIT,
    adminKey: "",
    league: "",
    outputDir: path.resolve(process.cwd(), ".temp")
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--admin-key" && next) {
      out.adminKey = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--league" && next) {
      out.league = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--admin-url" && next) {
      out.adminUrl = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--worker-url" && next) {
      out.workerUrl = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      out.limit = Math.max(1, Number(next) || DEFAULT_LIMIT);
      i += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      out.outputDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
  }
  return out;
}

function normalizeUrlWithParams(baseUrl, params) {
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 400)}`);
  return json;
}

function normalizeLeagueInfo(rawLeague) {
  const raw = String(rawLeague || "").trim();
  const lowered = raw.toLowerCase();
  if (lowered === "standard") return { key: "standard", kind: "standard", raw };
  if (lowered.startsWith("challenge:")) {
    const seasonFromKey = lowered.slice("challenge:".length).trim() || "unknown";
    return { key: `challenge:${seasonFromKey}`, kind: "challenge", raw };
  }
  const compact = lowered.replace(/\s+/g, " ");
  const cleaned = compact.replace(/\(.*?\)/g, "").trim();
  const isStandard = cleaned === "standard" || cleaned === "hardcore" || cleaned.endsWith(" standard");
  if (isStandard) return { key: "standard", kind: "standard", raw };
  const season = cleaned.replace(/\bhardcore\b/g, "").replace(/\s+/g, " ").trim() || "unknown";
  return { key: `challenge:${season}`, kind: "challenge", raw };
}

async function detectCurrentLeague(workerUrl) {
  const url = normalizeUrlWithParams(workerUrl, { type: "CurrentLeague" });
  const data = await fetchJson(url, { cache: "no-store" });
  const league = String(data?.league || "").trim();
  if (!league) throw new Error("Could not detect current league from worker.");
  return league;
}

function normalizeSessionRecord(input) {
  const obj = input && typeof input === "object" ? input : {};
  const scarabsJson = typeof obj.scarabs_json === "string" ? obj.scarabs_json : Array.isArray(obj.scarabs) ? JSON.stringify(obj.scarabs) : "[]";
  let scarabs = [];
  try {
    const parsed = JSON.parse(scarabsJson);
    scarabs = Array.isArray(parsed) ? parsed : [];
  } catch {
    scarabs = [];
  }
  return {
    id: String(obj.id || ""),
    created_at: String(obj.created_at || ""),
    league: obj.league ?? null,
    league_key: obj.league_key ?? null,
    total_consumed: Number(obj.total_consumed) || 0,
    total_trades: Number(obj.total_trades) || 0,
    input_value: Number(obj.input_value) || 0,
    output_value: Number(obj.output_value) || 0,
    scarabs
  };
}

async function loadSessions({ adminUrl, adminKey, limit }) {
  const url = normalizeUrlWithParams(adminUrl, { limit, key: adminKey });
  const arr = await fetchJson(url, { cache: "no-store" });
  if (!Array.isArray(arr)) throw new Error("Admin endpoint did not return an array.");
  return arr.map(normalizeSessionRecord);
}

function buildPriorReceivedByScarab(sessions) {
  const out = {};
  for (const s of sessions) {
    for (const row of s.scarabs || []) {
      const name = String(row?.name || "").trim();
      if (!name) continue;
      const received = Number(row?.received) || 0;
      if (received <= 0) continue;
      out[name] = (out[name] || 0) + received;
    }
  }
  return out;
}

function normalizeSharesFromCounts(countMap, minCount = 1) {
  const entries = Object.entries(countMap || {})
    .map(([name, count]) => [name, Math.max(0, Number(count) || 0)])
    .filter(([, c]) => c >= minCount);
  const sum = entries.reduce((s, [, c]) => s + c, 0);
  const shares = {};
  if (sum <= 0) return shares;
  for (const [name, count] of entries) shares[name] = count / sum;
  return shares;
}

function allocateCounts(total, sharesMap) {
  const names = Object.keys(sharesMap || {});
  if (!names.length || total <= 0) return {};
  const raw = names.map((name) => ({ name, exact: (Number(sharesMap[name]) || 0) * total }));
  const out = {};
  let assigned = 0;
  for (const x of raw) {
    const n = Math.max(0, Math.floor(x.exact));
    out[x.name] = n;
    assigned += n;
  }
  let rem = Math.max(0, total - assigned);
  raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  let idx = 0;
  while (rem > 0 && raw.length > 0) {
    out[raw[idx % raw.length].name] += 1;
    rem -= 1;
    idx += 1;
  }
  return out;
}

function sumCounts(map) {
  return Object.values(map || {}).reduce((s, v) => s + (Number(v) || 0), 0);
}

function cloneCounts(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) out[k] = Math.max(0, Math.floor(Number(v) || 0));
  return out;
}

function shiftMass(counts, targetAdds, donorPriority) {
  const out = cloneCounts(counts);
  let totalAdd = 0;
  for (const [name, add] of Object.entries(targetAdds || {})) {
    const n = Math.max(0, Math.floor(Number(add) || 0));
    if (!n) continue;
    out[name] = (out[name] || 0) + n;
    totalAdd += n;
  }
  if (totalAdd <= 0) return out;

  const targetSet = new Set(Object.keys(targetAdds || {}));
  const donors = [...donorPriority].filter((n) => !targetSet.has(n) && (out[n] || 0) > 0);
  let remaining = totalAdd;
  let cursor = 0;
  while (remaining > 0 && donors.length > 0) {
    const d = donors[cursor % donors.length];
    if ((out[d] || 0) > 0) {
      out[d] -= 1;
      remaining -= 1;
    }
    cursor += 1;
    if (cursor > 200000) break;
  }
  if (remaining > 0) {
    const fallback = Object.keys(out).filter((n) => !targetSet.has(n) && (out[n] || 0) > 0);
    for (const d of fallback) {
      while (remaining > 0 && (out[d] || 0) > 0) {
        out[d] -= 1;
        remaining -= 1;
      }
      if (remaining <= 0) break;
    }
  }
  return out;
}

function buildSessionFromCounts({ sessionId, expectedFinal, actualFinal, counts }) {
  const names = Object.keys(counts).filter((n) => (counts[n] || 0) > 0);
  const firstName = names[0] || "Scarab of Stability";
  const consumedTotal = expectedFinal * 3;
  const scarabs = names.map((name, idx) => ({
    name,
    consumed: idx === 0 ? consumedTotal : 0,
    received: Math.max(0, Math.floor(Number(counts[name]) || 0)),
    was_vendor: false,
    ninja_price: 1
  }));

  return {
    id: sessionId,
    created_at: new Date().toISOString(),
    total_consumed: consumedTotal,
    total_trades: expectedFinal,
    input_value: consumedTotal,
    output_value: Math.max(0, actualFinal),
    scarabs
  };
}

function stableNameListByCount(priorMap) {
  return Object.entries(priorMap || {})
    .map(([name, c]) => ({ name, count: Number(c) || 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((x) => x.name);
}

function pickTemplateSessionById(sessions, id) {
  return sessions.find((s) => String(s.id) === String(id)) || null;
}

function scaleTemplateCounts(templateSession, total) {
  const map = {};
  for (const row of templateSession?.scarabs || []) {
    const name = String(row?.name || "").trim();
    const received = Math.max(0, Number(row?.received) || 0);
    if (!name || received <= 0) continue;
    map[name] = (map[name] || 0) + received;
  }
  const shares = normalizeSharesFromCounts(map, 1);
  return allocateCounts(total, shares);
}

function explainOutcome(row) {
  if (row.l1Result !== "pass") return "L1 rejected on structural drift/integrity.";
  if (row.outcome === "hold") {
    return `Hold: score ${row.finalL2Score.toFixed(2)} >= threshold ${row.dynamicPassThreshold.toFixed(2)} with corroboration ${row.corroborationCount}.`;
  }
  const gap = row.dynamicPassThreshold - row.finalL2Score;
  return `Pass: score stayed ${gap.toFixed(2)} below threshold.`;
}

function toFixedOrNull(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(d)) : null;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# L2 Calibration Stress Harness");
  lines.push("");
  lines.push(`- League template source: **${report.meta.league}**`);
  lines.push(`- Synthetic scenarios evaluated: **${report.meta.scenarioCount}**`);
  lines.push(`- Generated: **${report.meta.generatedAt}**`);
  lines.push("");
  lines.push("## Results Table");
  lines.push("");
  lines.push("| Scenario | Category | expectedFinal | actualFinal | drift | allowed | driftRatio | L1 | L2 score | threshold | volumeEvidence | leniencyScale | l1Trust | corroboration | shouldHold | outcome |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|---|");
  for (const r of report.results) {
    lines.push(`| ${r.name} | ${r.category} | ${r.expectedFinal} | ${r.actualFinal} | ${r.drift} | ${r.allowedDrift} | ${r.driftRatio.toFixed(3)} | ${r.l1Result} | ${r.finalL2Score.toFixed(3)} | ${r.dynamicPassThreshold.toFixed(3)} | ${r.volumeEvidence.toFixed(3)} | ${r.volumeLeniencyScale.toFixed(3)} | ${r.l1Trust.toFixed(3)} | ${r.corroborationCount} | ${r.shouldHold ? "yes" : "no"} | ${r.outcome} |`);
  }
  lines.push("");
  lines.push("## Grouped Summary");
  lines.push("");
  lines.push(`- Pass: ${report.summary.passCount}`);
  lines.push(`- Hold: ${report.summary.holdCount}`);
  lines.push(`- Near-threshold (|score-threshold| <= 2): ${report.summary.nearThresholdCount}`);
  lines.push(`- Suspiciously too lenient (expected hold but passed): ${report.summary.tooLenient.length}`);
  lines.push(`- Suspiciously too strict (expected pass but held): ${report.summary.tooStrict.length}`);
  lines.push("");
  lines.push("## Potential Weak Spots");
  lines.push("");
  for (const w of report.summary.weakSpotNotes) lines.push(`- ${w}`);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.adminKey) throw new Error("Missing --admin-key");

  const workerPath = path.resolve(process.cwd(), "workers", "scarabev-api", "index.js");
  const source = fs.readFileSync(workerPath, "utf8");
  const exportAppend = "\nexport { evaluateSessionIntake, evaluateL2Intake, SESSION_STATE_APPROVED_AUTO, SESSION_STATE_REVIEW_PENDING };\n";
  const workerMod = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source + exportAppend)}`);

  const league = args.league || await detectCurrentLeague(args.workerUrl);
  const allSessions = await loadSessions(args);
  const leagueKey = normalizeLeagueInfo(league).key;
  const liveLeagueSessions = allSessions.filter((s) => normalizeLeagueInfo(s.league_key || s.league || "").key === leagueKey);
  if (!liveLeagueSessions.length) throw new Error(`No sessions for league ${league}`);

  const prior = buildPriorReceivedByScarab(liveLeagueSessions);
  const sortedByCount = stableNameListByCount(prior);
  const matureNames = Object.entries(prior)
    .filter(([, c]) => (Number(c) || 0) >= 40)
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .map(([n]) => n);

  if (matureNames.length < 15) throw new Error("Not enough mature scarab names from live prior to run stress harness.");

  const matureCountMap = {};
  for (const n of matureNames) matureCountMap[n] = Number(prior[n]) || 0;
  const matureShares = normalizeSharesFromCounts(matureCountMap, 1);

  const commonNames = matureNames.slice(0, 8);
  const rareMatureNames = [...matureNames].reverse().slice(0, 8);
  const midNames = matureNames.slice(Math.max(0, Math.floor(matureNames.length / 2) - 2), Math.floor(matureNames.length / 2) + 2);

  const rare1 = rareMatureNames[0];
  const rare2 = rareMatureNames[1] || rareMatureNames[0];
  const rare3 = rareMatureNames[2] || rareMatureNames[0];
  const donorPriority = [...commonNames, ...midNames, ...sortedByCount.filter((n) => matureNames.includes(n))];

  const template88 = pickTemplateSessionById(liveLeagueSessions, "88");

  const scenarios = [];
  const addScenario = (s) => scenarios.push(s);

  function buildBaselineCounts(actualFinal, useTemplate = false) {
    if (useTemplate && template88) return scaleTemplateCounts(template88, actualFinal);
    return allocateCounts(actualFinal, matureShares);
  }

  function registerMutationScenario({ id, category, expectedFinal, drift = 0, adds = {}, useTemplate = false, expectation = "either", note = "" }) {
    const actualFinal = Math.max(1, expectedFinal + drift);
    const baseline = buildBaselineCounts(actualFinal, useTemplate);
    const mutated = shiftMass(baseline, adds, donorPriority);
    addScenario({ id, category, expectedFinal, actualFinal, drift, counts: mutated, expectation, note });
  }

  // 1) Small clean lucky logs
  registerMutationScenario({ id: "small_clean_baseline", category: "small_clean_lucky", expectedFinal: 360, drift: 0, expectation: "pass", note: "control" });
  registerMutationScenario({ id: "small_clean_plus1_rare", category: "small_clean_lucky", expectedFinal: 360, drift: 0, adds: { [rare1]: 1 }, expectation: "pass" });
  registerMutationScenario({ id: "small_clean_plus2_rare", category: "small_clean_lucky", expectedFinal: 360, drift: 0, adds: { [rare1]: 2 }, expectation: "pass" });
  registerMutationScenario({ id: "small_clean_plus3_rare", category: "small_clean_lucky", expectedFinal: 360, drift: 0, adds: { [rare1]: 3 }, expectation: "pass" });
  registerMutationScenario({ id: "small_clean_two_rares_split", category: "small_clean_lucky", expectedFinal: 360, drift: 0, adds: { [rare1]: 2, [rare2]: 2 }, expectation: "pass" });
  registerMutationScenario({ id: "small_clean_three_rares_split", category: "small_clean_lucky", expectedFinal: 360, drift: 0, adds: { [rare1]: 2, [rare2]: 2, [rare3]: 2 }, expectation: "pass" });
  registerMutationScenario({ id: "small_clean_template88_plus2", category: "small_clean_lucky", expectedFinal: 351, drift: 0, adds: { [rare1]: 2 }, useTemplate: true, expectation: "pass" });
  registerMutationScenario({ id: "small_clean_template88_plus4", category: "small_clean_lucky", expectedFinal: 351, drift: 0, adds: { [rare1]: 4 }, useTemplate: true, expectation: "pass" });

  // 2) Small clean near-edge cases
  for (const n of [4, 6, 8, 10, 12, 14, 16, 20]) {
    registerMutationScenario({ id: `small_nearedge_spike_${n}`, category: "small_clean_near_edge", expectedFinal: 420, drift: 0, adds: { [rare1]: n }, expectation: "either" });
  }

  // 3) Small warm-L1 cases
  for (const drift of [0, 1, 2, 3, 4, 5, 6, 8]) {
    registerMutationScenario({ id: `small_warm_drift_${drift}`, category: "small_warm_l1", expectedFinal: 420, drift, adds: { [rare1]: 10 }, expectation: drift <= 2 ? "pass" : "either" });
  }

  // 4) Medium logs
  registerMutationScenario({ id: "medium_believable", category: "medium", expectedFinal: 1400, drift: 0, expectation: "pass" });
  registerMutationScenario({ id: "medium_lucky_few", category: "medium", expectedFinal: 1400, drift: 0, adds: { [rare1]: 8, [rare2]: 4 }, expectation: "pass" });
  registerMutationScenario({ id: "medium_clustered", category: "medium", expectedFinal: 1400, drift: 0, adds: { [rare1]: 20 }, expectation: "either" });
  registerMutationScenario({ id: "medium_multi_signal", category: "medium", expectedFinal: 1400, drift: 0, adds: { [rare1]: 26, [rare2]: 20, [rare3]: 12 }, expectation: "hold" });
  registerMutationScenario({ id: "medium_warm_signal", category: "medium", expectedFinal: 1400, drift: 12, adds: { [rare1]: 20, [rare2]: 10 }, expectation: "hold" });
  registerMutationScenario({ id: "medium_template88_scaled", category: "medium", expectedFinal: 1200, drift: 0, adds: { [rare1]: 18 }, useTemplate: true, expectation: "either" });

  // 5) Large logs
  registerMutationScenario({ id: "large_believable", category: "large", expectedFinal: 5200, drift: 0, expectation: "pass" });
  registerMutationScenario({ id: "large_hot", category: "large", expectedFinal: 5200, drift: 0, adds: { [rare1]: 20, [rare2]: 18 }, expectation: "either" });
  registerMutationScenario({ id: "large_suspicious", category: "large", expectedFinal: 5200, drift: 0, adds: { [rare1]: 70, [rare2]: 50 }, expectation: "hold" });
  registerMutationScenario({ id: "large_stacked", category: "large", expectedFinal: 5200, drift: 0, adds: { [rare1]: 110, [rare2]: 90, [rare3]: 75 }, expectation: "hold" });
  registerMutationScenario({ id: "large_warm", category: "large", expectedFinal: 5200, drift: 70, adds: { [rare1]: 80, [rare2]: 60 }, expectation: "hold" });
  registerMutationScenario({ id: "large_extreme_concentration", category: "large", expectedFinal: 5200, drift: 0, adds: { [rare1]: 220 }, expectation: "hold" });

  // 6) Absurd / red lane
  registerMutationScenario({ id: "absurd_jackpot_stack_1", category: "absurd_red_lane", expectedFinal: 2600, drift: 0, adds: { [rare1]: 180, [rare2]: 140, [rare3]: 120 }, expectation: "hold" });
  registerMutationScenario({ id: "absurd_jackpot_stack_2", category: "absurd_red_lane", expectedFinal: 3600, drift: 0, adds: { [rare1]: 240, [rare2]: 210, [rare3]: 180 }, expectation: "hold" });
  registerMutationScenario({ id: "absurd_concentration", category: "absurd_red_lane", expectedFinal: 2800, drift: 0, adds: { [rare1]: 300 }, expectation: "hold" });
  registerMutationScenario({ id: "absurd_multi_signal_warm", category: "absurd_red_lane", expectedFinal: 2800, drift: 35, adds: { [rare1]: 210, [rare2]: 180 }, expectation: "hold" });
  registerMutationScenario({ id: "absurd_small_stack", category: "absurd_red_lane", expectedFinal: 700, drift: 0, adds: { [rare1]: 85, [rare2]: 75, [rare3]: 60 }, expectation: "hold" });
  registerMutationScenario({ id: "absurd_small_warm", category: "absurd_red_lane", expectedFinal: 700, drift: 10, adds: { [rare1]: 80, [rare2]: 65 }, expectation: "hold" });

  // 7) Near-threshold sweeps
  for (const v of [240, 360, 520, 800, 1200, 2000, 3200, 5000]) {
    registerMutationScenario({ id: `sweep_volume_${v}`, category: "sweep_volume", expectedFinal: v, drift: 0, adds: { [rare1]: Math.max(4, Math.round(v * 0.02)), [rare2]: Math.max(2, Math.round(v * 0.01)) }, expectation: "either" });
  }
  for (const d of [0, 1, 2, 3, 4, 5, 6, 8, 10, 14]) {
    registerMutationScenario({ id: `sweep_drift_${d}`, category: "sweep_drift", expectedFinal: 420, drift: d, adds: { [rare1]: 10 }, expectation: "either" });
  }
  for (const n of [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 28, 40]) {
    registerMutationScenario({ id: `sweep_spike_excess_${n}`, category: "sweep_spike_excess", expectedFinal: 420, drift: 0, adds: { [rare1]: n }, expectation: "either" });
  }
  for (const n of [6, 12, 18, 24, 30, 40, 55, 75]) {
    registerMutationScenario({ id: `sweep_concentration_${n}`, category: "sweep_concentration", expectedFinal: 1200, drift: 0, adds: { [rare1]: n }, expectation: "either" });
  }
  for (const n of [12, 18, 24, 30, 40, 52]) {
    registerMutationScenario({ id: `sweep_support_single_${n}`, category: "sweep_support", expectedFinal: 1200, drift: 0, adds: { [rare1]: n }, expectation: "either" });
    registerMutationScenario({ id: `sweep_support_split_${n}`, category: "sweep_support", expectedFinal: 1200, drift: 0, adds: { [rare1]: Math.floor(n / 3), [rare2]: Math.floor(n / 3), [rare3]: n - 2 * Math.floor(n / 3) }, expectation: "either" });
  }

  const results = [];
  for (const s of scenarios) {
    const session = buildSessionFromCounts({
      sessionId: s.id,
      expectedFinal: s.expectedFinal,
      actualFinal: s.actualFinal,
      counts: s.counts
    });

    const l1 = workerMod.evaluateSessionIntake(session);
    let l2 = null;
    if (l1?.intakeState === workerMod.SESSION_STATE_APPROVED_AUTO) {
      l2 = workerMod.evaluateL2Intake(l1, prior);
    }

    const l2Audit = l2?.l2Audit || {};
    const l1Audit = l1?.l1Audit || {};
    const shouldHold = l2?.intakeState === workerMod.SESSION_STATE_REVIEW_PENDING;
    const outcome = l1?.l1Passed ? (shouldHold ? "hold" : "pass") : "l1_reject";

    const row = {
      name: s.id,
      category: s.category,
      expectation: s.expectation,
      expectedFinal: Number(l1Audit.expectedFinal || s.expectedFinal),
      actualFinal: Number(l1Audit.actualFinalCount || s.actualFinal),
      drift: Number(l1Audit.drift || 0),
      allowedDrift: Number(l1Audit.allowedDrift || 0),
      driftRatio: Number(l2Audit.driftRatio || Math.abs(Number(l1Audit.drift || 0)) / Math.max(1, Number(l1Audit.allowedDrift || 1))),
      l1Result: l1?.l1Passed ? "pass" : "reject",
      finalL2Score: Number(l2Audit.finalL2Score || 0),
      dynamicPassThreshold: Number(l2Audit.dynamicPassThreshold || 12),
      volumeEvidence: Number(l2Audit.volumeEvidence || 0),
      volumeLeniencyScale: Number(l2Audit.volumeLeniencyScale || 0),
      l1Trust: Number(l2Audit.l1Trust || 0),
      corroborationCount: Number(l2Audit.corroborationCount || 0),
      shouldHold,
      outcome,
      explanation: explainOutcome({
        l1Result: l1?.l1Passed ? "pass" : "reject",
        outcome,
        finalL2Score: Number(l2Audit.finalL2Score || 0),
        dynamicPassThreshold: Number(l2Audit.dynamicPassThreshold || 12),
        corroborationCount: Number(l2Audit.corroborationCount || 0)
      }),
      internals: {
        spikeSeverity: toFixedOrNull(l2Audit.spikeSeverity),
        midDiv: toFixedOrNull(l2Audit.midDiv),
        concentration: toFixedOrNull(l2Audit.concentration),
        supportInconsistency: toFixedOrNull(l2Audit.supportInconsistency),
        excessCount: toFixedOrNull(l2Audit.excessCount),
        scoreAfterGuardsRaw: toFixedOrNull(l2Audit.scoreAfterGuardsRaw),
        warmL1: Boolean(l2Audit?.gates?.warmL1)
      },
      note: s.note || ""
    };
    results.push(row);
  }

  const passCases = results.filter((r) => r.outcome === "pass");
  const holdCases = results.filter((r) => r.outcome === "hold");
  const nearThreshold = results.filter((r) => r.outcome !== "l1_reject" && Math.abs(r.finalL2Score - r.dynamicPassThreshold) <= 2);
  const tooLenient = results.filter((r) => r.expectation === "hold" && r.outcome === "pass").map((r) => r.name);
  const tooStrict = results.filter((r) => r.expectation === "pass" && r.outcome === "hold").map((r) => r.name);

  const weakSpotNotes = [];
  if (tooLenient.length) weakSpotNotes.push(`Potential leniency misses in expected-hold set: ${tooLenient.join(", ")}`);
  if (tooStrict.length) weakSpotNotes.push(`Potential strictness in expected-pass set: ${tooStrict.join(", ")}`);
  if (!tooLenient.length && !tooStrict.length) weakSpotNotes.push("No expectation mismatches in the explicitly labeled pass/hold scenarios.");

  const flipByCategory = {};
  for (const r of results) {
    if (!flipByCategory[r.category]) flipByCategory[r.category] = { pass: 0, hold: 0, reject: 0 };
    if (r.outcome === "pass") flipByCategory[r.category].pass += 1;
    else if (r.outcome === "hold") flipByCategory[r.category].hold += 1;
    else flipByCategory[r.category].reject += 1;
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      league,
      scenarioCount: results.length,
      source: { adminUrl: args.adminUrl, limit: args.limit },
      liveLeagueSessionCount: liveLeagueSessions.length,
      matureNameCount: matureNames.length
    },
    priors: {
      commonNames,
      rareMatureNames,
      midNames,
      rarePicked: { rare1, rare2, rare3 }
    },
    results,
    summary: {
      passCount: passCases.length,
      holdCount: holdCases.length,
      nearThresholdCount: nearThreshold.length,
      tooLenient,
      tooStrict,
      flipByCategory,
      nearThresholdCases: nearThreshold.map((r) => ({ name: r.name, score: r.finalL2Score, threshold: r.dynamicPassThreshold, outcome: r.outcome })),
      weakSpotNotes
    }
  };

  fs.mkdirSync(args.outputDir, { recursive: true });
  const stamp = report.meta.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(args.outputDir, `l2-calibration-stress-${stamp}.json`);
  const mdPath = path.join(args.outputDir, `l2-calibration-stress-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(report), "utf8");

  console.log(`Wrote JSON report: ${jsonPath}`);
  console.log(`Wrote Markdown report: ${mdPath}`);
  console.log(`Scenario count: ${report.meta.scenarioCount}`);
  console.log(`Pass/Hold: ${report.summary.passCount}/${report.summary.holdCount}`);
  console.log(`Near-threshold cases: ${report.summary.nearThresholdCount}`);
  console.log(`Too lenient: ${report.summary.tooLenient.length}`);
  console.log(`Too strict: ${report.summary.tooStrict.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
