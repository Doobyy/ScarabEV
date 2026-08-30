import assert from "node:assert/strict";

import {
  applyLeagueAggregateDelta,
  computeLeagueAggregate,
  computeLeagueAggregateFromRawSessions,
  rebuildMaterializedLeagueAggregates
} from "./index.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = String(sql || "");
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async all() {
    const sql = this.sql;
    if (sql.includes("FROM sessions") && sql.includes("WHERE (intake_state IS NULL")) {
      return { results: this.db.sessions.filter((row) => row.intake_state === null || row.intake_state === undefined || row.intake_state === "approved_auto" || row.intake_state === "approved_manual") };
    }
    if (sql.includes("FROM league_aggregates")) {
      return { results: [...this.db.leagueAggregates.values()].map((row) => ({ ...row })) };
    }
    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async first() {
    const sql = this.sql;
    if (sql.includes("FROM league_aggregates") && sql.includes("WHERE league_key = ?")) {
      return this.db.leagueAggregates.get(String(this.args[0])) || null;
    }
    if (sql.includes("FROM aggregate")) {
      return { ...this.db.aggregate };
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async run() {
    const sql = this.sql;
    if (sql.startsWith("DELETE FROM league_aggregates")) {
      this.db.leagueAggregates.clear();
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO league_aggregates")) {
      const [
        league_key,
        league_kind,
        session_count,
        total_consumed,
        total_trades,
        total_input,
        total_output,
        total_input_divine,
        total_output_divine,
        divine_session_count,
        total_received,
        latest_created_at,
        received_by_scarab
      ] = this.args;
      const existing = this.db.leagueAggregates.get(String(league_key));
      this.db.leagueAggregates.set(String(league_key), {
        league_key,
        league_kind,
        session_count,
        total_consumed,
        total_trades,
        total_input,
        total_output,
        total_input_divine,
        total_output_divine,
        divine_session_count,
        total_received,
        latest_created_at,
        received_by_scarab,
        version: existing ? Number(existing.version || 0) + 1 : 1,
        updated_at: "2026-08-25 00:00:00"
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE aggregate SET")) {
      const [total_sessions, total_consumed, total_trades, total_input, total_output, received_by_scarab] = this.args;
      this.db.aggregate = { total_sessions, total_consumed, total_trades, total_input, total_output, received_by_scarab };
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

class FakeD1 {
  constructor(sessions) {
    this.sessions = sessions.map((row) => ({ ...row }));
    this.leagueAggregates = new Map();
    this.aggregate = {
      total_sessions: 0,
      total_consumed: 0,
      total_trades: 0,
      total_input: 0,
      total_output: 0,
      received_by_scarab: "{}"
    };
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    for (const stmt of statements) {
      await stmt.run();
    }
    return statements.map(() => ({ success: true }));
  }
}

const scarabs = (entries) => JSON.stringify(entries.map(([name, received]) => ({ name, received })));

const baseSessions = [
  {
    id: "1",
    created_at: "2026-08-01 00:00:00",
    league: "Mercenaries",
    league_key: "challenge:mercenaries",
    intake_state: "approved_auto",
    total_consumed: 600,
    total_trades: 200,
    input_value: 100,
    output_value: 140,
    divine_rate: 200,
    scarabs_json: scarabs([
      ["Ambush Scarab", 70],
      ["Cartography Scarab of Risk", 30]
    ])
  },
  {
    id: "2",
    created_at: "2026-07-01 00:00:00",
    league: "Phrecia",
    league_key: "challenge:phrecia",
    intake_state: "approved_manual",
    total_consumed: 90000,
    total_trades: 30000,
    input_value: 1000,
    output_value: 1500,
    divine_rate: 250,
    scarabs_json: scarabs([
      ["Ambush Scarab", 40],
      ["Bestiary Scarab", 80]
    ])
  },
  {
    id: "3",
    created_at: "2026-08-02 00:00:00",
    league: "Mercenaries",
    league_key: "challenge:mercenaries",
    intake_state: "review_pending",
    total_consumed: 600,
    total_trades: 200,
    input_value: 100,
    output_value: 110,
    divine_rate: 200,
    scarabs_json: scarabs([["Ambush Scarab", 999]])
  }
];

function publicAggregateShape(data) {
  return {
    sessionCount: data.sessionCount,
    totalConsumed: data.totalConsumed,
    totalTrades: data.totalTrades,
    totalInput: data.totalInput,
    totalOutput: data.totalOutput,
    totalInputDivine: data.totalInputDivine,
    totalOutputDivine: data.totalOutputDivine,
    receivedByScarab: data.receivedByScarab,
    weightSessionCount: data.weightSessionCount,
    weightMeta: {
      targetLeagueKey: data.weightMeta.targetLeagueKey,
      mode: data.weightMeta.mode,
      supportsWeighted: data.weightMeta.supportsWeighted,
      alphaGlobal: data.weightMeta.alphaGlobal,
      priorLeagueKey: data.weightMeta.priorLeagueKey,
      challengeLeagueOrder: data.weightMeta.challengeLeagueOrder,
      supportingOutputs: data.weightMeta.supportingOutputs,
      divineSessionCount: data.weightMeta.divineSessionCount
    }
  };
}

{
  const db = new FakeD1(baseSessions);
  const env = { DB: db };
  const rebuilt = await rebuildMaterializedLeagueAggregates(env);
  assert.deepEqual(rebuilt, { ok: true, scannedSessions: 2, leagueCount: 2 });

  const raw = await computeLeagueAggregateFromRawSessions(env, "Mercenaries");
  const materialized = await computeLeagueAggregate(env, "Mercenaries");
  assert.deepEqual(publicAggregateShape(materialized), publicAggregateShape(raw));
  assert.deepEqual(Object.keys(materialized.weights).sort(), Object.keys(raw.weights).sort());
}

{
  const db = new FakeD1([]);
  const env = { DB: db };
  await rebuildMaterializedLeagueAggregates(env);
  await applyLeagueAggregateDelta(env, baseSessions[0], +1);
  let materialized = await computeLeagueAggregate(env, "Mercenaries");
  assert.equal(materialized.sessionCount, 1);
  assert.equal(materialized.receivedByScarab["Ambush Scarab"], 70);

  db.sessions.push({ ...baseSessions[0] });
  await applyLeagueAggregateDelta(env, baseSessions[1], +1);
  materialized = await computeLeagueAggregate(env, "Mercenaries");
  assert.equal(materialized.sessionCount, 1);
  assert.equal(materialized.weightMeta.challengeLeagueOrder[0], "challenge:mercenaries");
  assert.equal((await computeLeagueAggregate(env, "Phrecia")).sessionCount, 1);
}

{
  const db = new FakeD1(baseSessions.slice(0, 2));
  const env = { DB: db };
  await rebuildMaterializedLeagueAggregates(env);
  db.sessions = db.sessions.filter((row) => row.id !== "1");
  await applyLeagueAggregateDelta(env, baseSessions[0], -1);
  const materialized = await computeLeagueAggregate(env, "Mercenaries");
  assert.equal(materialized.sessionCount, 1);
  assert.equal(materialized.weightMeta.mode, "challenge-prior-fallback");
}

{
  const db = new FakeD1(baseSessions.slice(0, 2));
  const env = { DB: db };
  await rebuildMaterializedLeagueAggregates(env);
  db.sessions[0].intake_state = "research";
  await applyLeagueAggregateDelta(env, baseSessions[0], -1);
  assert.equal((await computeLeagueAggregate(env, "Mercenaries")).sessionCount, 1);
  db.sessions[0].intake_state = "approved_manual";
  await applyLeagueAggregateDelta(env, db.sessions[0], +1);
  assert.equal((await computeLeagueAggregate(env, "Mercenaries")).sessionCount, 1);
  assert.equal((await computeLeagueAggregate(env, "Mercenaries")).receivedByScarab["Ambush Scarab"], 70);
}

console.log("materialized aggregate tests passed");
