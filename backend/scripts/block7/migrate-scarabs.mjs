import { loadLegacyData } from "./loadLegacyData.mjs";

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    dryRun: !argv.includes("--apply"),
    includeFlavor: argv.includes("--include-flavor")
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function buildCookieHeader(jar) {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function parseSetCookie(setCookieValue) {
  const firstPart = setCookieValue.split(";", 1)[0];
  const eqIndex = firstPart.indexOf("=");
  if (eqIndex <= 0) return null;
  return {
    name: firstPart.slice(0, eqIndex).trim(),
    value: firstPart.slice(eqIndex + 1).trim()
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasScarabDrift(existing, payload) {
  const current = existing?.currentText ?? {};
  if (existing?.status !== payload.status) return true;
  if (normalizeNullableString(current.name) !== normalizeNullableString(payload.name)) return true;
  if (normalizeNullableString(current.description) !== normalizeNullableString(payload.description)) return true;
  if (normalizeNullableString(current.flavorText) !== normalizeNullableString(payload.flavorText)) return true;

  const currentModifiers = normalizeStringArray(current.modifiers);
  const payloadModifiers = normalizeStringArray(payload.modifiers);
  if (currentModifiers.length !== payloadModifiers.length) return true;
  for (let index = 0; index < currentModifiers.length; index += 1) {
    if (currentModifiers[index] !== payloadModifiers[index]) {
      return true;
    }
  }
  return false;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = requiredEnv("BACKEND_BASE_URL").replace(/\/+$/, "");
  const username = requiredEnv("BACKEND_USERNAME");
  const password = requiredEnv("BACKEND_PASSWORD");
  const { scarabList } = await loadLegacyData();
  const cookieJar = new Map();

  async function request(method, pathname, body, { auth = false, csrf = false } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth) {
      const cookieHeader = buildCookieHeader(cookieJar);
      if (cookieHeader) headers.cookie = cookieHeader;
    }
    if (csrf) headers["x-csrf-token"] = cookieJar.get("scarabev_csrf") ?? "";

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const getSetCookie = response.headers.getSetCookie ? response.headers.getSetCookie.bind(response.headers) : null;
    for (const cookie of getSetCookie ? getSetCookie() : []) {
      const parsed = parseSetCookie(cookie);
      if (parsed) cookieJar.set(parsed.name, parsed.value);
    }

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { response, json, text };
  }

  async function requestWithRetry(method, pathname, body, options, label) {
    let last = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      last = await request(method, pathname, body, options);
      if (last.response.status !== 500 && last.response.status !== 429) {
        return last;
      }
      const retryAfterHeader = last.response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
      const serverDelayMs = Number.isFinite(retryAfterSeconds) ? Math.max(retryAfterSeconds, 1) * 1000 : 0;
      const backoffDelayMs = 500 * 2 ** (attempt - 1);
      await sleep(Math.max(serverDelayMs, backoffDelayMs));
    }
    throw new Error(`${label} failed after retries (${last?.response.status}): ${last?.text}`);
  }

  const login = await request("POST", "/admin/auth/login", { username, password });
  if (login.response.status !== 200) {
    throw new Error(`Login failed (${login.response.status}): ${login.text}`);
  }

  const listed = await request("GET", "/admin/scarabs?status=draft,active,retired", undefined, { auth: true });
  if (listed.response.status !== 200 || !listed.json) {
    throw new Error(`Failed to list scarabs (${listed.response.status}): ${listed.text}`);
  }

  const existingByName = new Map(
    listed.json.items.map((item) => [String(item.currentText?.name ?? "").toLowerCase(), item])
  );
  const legacyNameSet = new Set(scarabList.map((entry) => String(entry.name ?? "").trim().toLowerCase()).filter(Boolean));

  const plan = {
    mode: args.dryRun ? "dry-run" : "apply",
    baseUrl,
    sourceCount: scarabList.length,
    existingCount: listed.json.items.length,
    createCount: 0,
    updateCount: 0,
    failedCount: 0,
    retiredExtrasCount: 0,
    createNames: [],
    updateNames: [],
    failedNames: []
  };

  for (const scarab of scarabList) {
    const name = String(scarab.name ?? "").trim();
    if (!name) continue;

    const payload = {
      status: "active",
      name,
      description: `Migrated from legacy frontend config (group: ${scarab.group ?? "unknown"}).`,
      modifiers: [scarab.group ? `group ${scarab.group}` : "group unknown"],
      flavorText: args.includeFlavor ? `legacy-icon:${scarab.icon ?? "none"}` : null,
      changeNote: "block7 migration"
    };

    const existing = existingByName.get(name.toLowerCase());
    if (!existing) {
      plan.createCount += 1;
      plan.createNames.push(name);
      if (args.apply) {
        const created = await requestWithRetry("POST", "/admin/scarabs", payload, { auth: true, csrf: true }, `create ${name}`);
        if (created.response.status !== 201) {
          plan.failedCount += 1;
          plan.failedNames.push(name);
        }
      }
      continue;
    }

    if (!hasScarabDrift(existing, payload)) {
      continue;
    }

    plan.updateCount += 1;
    plan.updateNames.push(name);
    if (args.apply) {
      const updated = await requestWithRetry(
        "PUT",
        `/admin/scarabs/${encodeURIComponent(existing.id)}`,
        payload,
        { auth: true, csrf: true },
        `update ${name}`
      );
      if (updated.response.status !== 200) {
        plan.failedCount += 1;
        plan.failedNames.push(name);
      }
    }
  }

  if (args.apply) {
    const latestAfterUpsert = await request("GET", "/admin/scarabs?status=active", undefined, { auth: true });
    if (latestAfterUpsert.response.status === 200 && latestAfterUpsert.json?.items) {
      for (const active of latestAfterUpsert.json.items) {
        const lowerName = String(active.currentText?.name ?? "").toLowerCase();
        if (legacyNameSet.has(lowerName)) continue;
        const retired = await request(
          "POST",
          `/admin/scarabs/${encodeURIComponent(active.id)}/retire`,
          { retirementNote: "block7 retire non-legacy active scarab" },
          { auth: true, csrf: true }
        );
        if (retired.response.status === 200) {
          plan.retiredExtrasCount += 1;
        } else {
          plan.failedCount += 1;
          plan.failedNames.push(`retire:${active.currentText?.name ?? active.id}`);
        }
      }
    }

    const generated = await requestWithRetry(
      "POST",
      "/admin/token-drafts/generate",
      undefined,
      { auth: true, csrf: true },
      "generate draft"
    );
    if (generated.response.status !== 201) {
      throw new Error(`Draft generation failed (${generated.response.status}): ${generated.text}`);
    }

    const legacyTokens = (await loadLegacyData()).legacyTokens;
    const published = await request("POST", "/admin/token-sets/import-legacy", { tokensByName: legacyTokens }, { auth: true, csrf: true });
    if (published.response.status !== 201) {
      throw new Error(`Legacy publish failed (${published.response.status}): ${published.text}`);
    }
  }

  const logout = await request("POST", "/admin/auth/logout", {}, { auth: true, csrf: true });
  if (logout.response.status !== 200) {
    throw new Error(`Logout failed (${logout.response.status}): ${logout.text}`);
  }

  console.log(JSON.stringify({ ok: plan.failedCount === 0, plan }, null, 2));
  if (plan.failedCount > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
