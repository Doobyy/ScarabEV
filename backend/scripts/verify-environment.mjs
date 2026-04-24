import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`OK: ${message}`);
}

function readText(path) {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    fail(`Missing file: ${path}`);
    return "";
  }
  return readFileSync(abs, "utf8");
}

function extractString(text, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\"([^\"]*)\"\\s*$`, "m");
  const m = text.match(re);
  return m ? m[1] : "";
}

function requireEnv(varName) {
  if (!String(process.env[varName] || "").trim()) {
    fail(`Missing required secret/env: ${varName}`);
  } else {
    pass(`${varName} is set`);
  }
}

function assertContains(label, value, needle) {
  if (!String(value || "").toLowerCase().includes(String(needle).toLowerCase())) {
    fail(`${label} must include "${needle}" (got: ${value || "<empty>"})`);
  } else {
    pass(`${label} includes "${needle}"`);
  }
}

function assertNotContains(label, value, needle) {
  if (String(value || "").toLowerCase().includes(String(needle).toLowerCase())) {
    fail(`${label} must not include "${needle}" (got: ${value || "<empty>"})`);
  } else {
    pass(`${label} does not include "${needle}"`);
  }
}

const args = process.argv.slice(2);
const targetArg = args.find((arg) => arg.startsWith("--target="));
const target = targetArg ? targetArg.split("=")[1] : "";
if (target !== "staging" && target !== "production") {
  console.error("Usage: node scripts/verify-environment.mjs --target=staging|production");
  process.exit(2);
}

const backendCfg = readText(target === "production" ? "wrangler.production.toml" : "wrangler.staging.toml");
const marketWorkerCfg = readText(target === "production" ? "../workers/market-worker/wrangler.toml" : "../workers/market-worker/wrangler.staging.toml");
const sessionApiCfg = readText(target === "production" ? "../workers/scarabev-api/wrangler.production.toml" : "../workers/scarabev-api/wrangler.staging.toml");

const backendEnv = extractString(backendCfg, "APP_ENV");
const backendMarketWorkerUrl = extractString(backendCfg, "MARKET_WORKER_URL");
const backendSessionApiBase = extractString(backendCfg, "SESSION_API_BASE_URL");
const backendD1Label = extractString(backendCfg, "D1_RESOURCE_LABEL");
const backendR2Label = extractString(backendCfg, "BACKUP_R2_BUCKET_LABEL");
const backendBackupCronEnabled = extractString(backendCfg, "BACKUP_CRON_ENABLED");
const backendBackupEnabled = extractString(backendCfg, "BACKUP_ENABLED");
const backendDbName = extractString(backendCfg, "database_name");
const backendBucketName = extractString(backendCfg, "bucket_name");
const marketAggregateUrl = extractString(marketWorkerCfg, "AGGREGATE_API_URL");
const marketAppEnv = extractString(marketWorkerCfg, "APP_ENV");
const stagingCronEnabled = extractString(marketWorkerCfg, "STAGING_CRON_ENABLED");
const marketKvId = extractString(marketWorkerCfg, "id");
const sessionApiDbName = extractString(sessionApiCfg, "database_name");
const sessionApiDbId = extractString(sessionApiCfg, "database_id");

console.log(`Verifying ${target} environment...`);

if (target === "production") {
  assertContains("backend APP_ENV", backendEnv, "production");
  assertContains("market-worker APP_ENV", marketAppEnv, "production");
  assertNotContains("backend MARKET_WORKER_URL", backendMarketWorkerUrl, "staging");
  assertNotContains("backend SESSION_API_BASE_URL", backendSessionApiBase, "staging");
  assertNotContains("backend D1 label", `${backendD1Label} ${backendDbName}`, "staging");
  assertNotContains("backend R2 label", `${backendR2Label} ${backendBucketName}`, "staging");
  assertNotContains("market-worker AGGREGATE_API_URL", marketAggregateUrl, "staging");
  assertNotContains("session-api DB name", sessionApiDbName, "staging");
  assertContains("BACKUP_CRON_ENABLED", backendBackupCronEnabled, "true");
  requireEnv("CLOUDFLARE_API_TOKEN");
  requireEnv("CLOUDFLARE_ACCOUNT_ID");
  requireEnv("MARKET_WORKER_ADMIN_TOKEN");
}

if (target === "staging") {
  assertContains("backend APP_ENV", backendEnv, "staging");
  assertContains("market-worker APP_ENV", marketAppEnv, "staging");
  assertContains("backend MARKET_WORKER_URL", backendMarketWorkerUrl, "staging");
  assertContains("backend SESSION_API_BASE_URL", backendSessionApiBase, "staging");
  assertNotContains("backend DB/bucket", `${backendD1Label} ${backendDbName} ${backendR2Label} ${backendBucketName}`, "production");
  assertContains("market-worker AGGREGATE_API_URL", marketAggregateUrl, "staging");
  assertNotContains("session-api DB name", sessionApiDbName, "production");
  assertContains("BACKUP_CRON_ENABLED", backendBackupCronEnabled, "false");
  assertContains("STAGING_CRON_ENABLED", stagingCronEnabled, "false");
  if (marketKvId.includes("REPLACE_WITH_STAGING")) {
    fail("market-worker staging KV namespace ID is still placeholder");
  } else {
    pass("market-worker staging KV namespace ID is set");
  }
  if (sessionApiDbId.includes("REPLACE_WITH_STAGING")) {
    fail("scarabev-api staging D1 database_id is still placeholder");
  } else {
    pass("scarabev-api staging D1 database_id is set");
  }
  if (String(backendBackupEnabled).toLowerCase() === "true") {
    requireEnv("MARKET_WORKER_ADMIN_TOKEN");
  }
}

if (process.exitCode && process.exitCode !== 0) {
  console.error(`Verification failed for ${target}.`);
} else {
  console.log(`Verification passed for ${target}.`);
}
