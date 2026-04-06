import { loadLegacyData } from "./loadLegacyData.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

async function run() {
  const baseUrl = requiredEnv("BACKEND_BASE_URL").replace(/\/+$/, "");
  const { legacyTokens } = await loadLegacyData();

  const response = await fetch(`${baseUrl}/public/token-set/latest`, {
    method: "GET",
    headers: {
      "cache-control": "no-store"
    }
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (response.status !== 200 || !json) {
    throw new Error(`Failed to fetch published token set (${response.status}): ${text}`);
  }

  const backendByName = json.tokensByName && typeof json.tokensByName === "object" ? json.tokensByName : {};
  const missingInBackend = [];
  const mismatched = [];
  for (const [name, token] of Object.entries(legacyTokens)) {
    if (!(name in backendByName)) {
      missingInBackend.push(name);
      continue;
    }
    if (String(backendByName[name]) !== String(token)) {
      mismatched.push({
        name,
        legacy: token,
        backend: backendByName[name]
      });
    }
  }

  const extraInBackend = Object.keys(backendByName).filter((name) => !(name in legacyTokens));
  const report = {
    ok: missingInBackend.length === 0 && mismatched.length === 0,
    baseUrl,
    publishedVersionId: json.versionId,
    legacyCount: Object.keys(legacyTokens).length,
    backendCount: Object.keys(backendByName).length,
    missingInBackend,
    mismatched,
    extraInBackend
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
