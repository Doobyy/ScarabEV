import { loadConfig, type Env, type RuntimeConfig } from "./config/env.js";
import { buildAdminUiHtml } from "./admin/ui.js";
import { captureError, logInfo, logWarn } from "./observability/logger.js";
import { serializeCookie, parseCookieHeader } from "./security/cookies.js";
import { generateToken, hashPassword, verifyPassword } from "./security/crypto.js";
import { D1SecurityRepository, type SecurityRepository } from "./security/repository.js";
import { hasRequiredRole } from "./security/roles.js";
import { getClientIp, isMutationMethod, isSessionExpired, shouldRotateSession } from "./security/session.js";
import {
  TokenGenerationFailure,
  buildDraftGenerationReport,
  buildInputFingerprint,
  generateDraftTokenEntries
} from "./tokens/generator.js";
import {
  normalizePublishToken,
  POE_REGEX_PROFILE_NAME,
  validateTokenAgainstPoeRegexProfile
} from "./tokens/poeRegexProfile.js";
import { handleAuthRoutes } from "./routes/authRoutes.js";
import { handleScarabRoutes } from "./routes/scarabRoutes.js";
import { handleTokenRoutes } from "./routes/tokenRoutes.js";
import { handleOpsRoutes } from "./routes/adminOpsRoutes.js";
import type {
  AdminRole,
  AuditLogInput,
  DraftTokenExcludedRetired,
  NewSession,
  PoeRegexViolation,
  PublishedTokenSet,
  ScarabListOptions,
  ScarabStatus,
  ScarabTextInput,
  SessionWithUser
} from "./security/types.js";

interface RequestContext {
  requestId: string;
  startedAt: number;
}

interface AuthContext {
  session: SessionWithUser;
}

interface RuntimeDeps {
  config: RuntimeConfig;
  securityRepo: SecurityRepository;
  db?: D1Database;
  backupR2?: R2Bucket;
  now: () => Date;
}

interface RouteDeps {
  config: RuntimeConfig;
  securityRepo: SecurityRepository;
  db?: D1Database;
  backupR2?: R2Bucket;
  now: () => Date;
}

const WORKSPACE_LEAGUE_ID = "workspace-generated";

function createContext(): RequestContext {
  return {
    requestId: crypto.randomUUID(),
    startedAt: Date.now()
  };
}

function jsonResponse(payload: Record<string, unknown>, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(payload), {
    ...init,
    headers
  });
}

function appendSetCookie(headers: Headers, cookieValue: string): void {
  headers.append("set-cookie", cookieValue);
}

function createSessionCookie(config: RuntimeConfig, sessionId: string): string {
  return serializeCookie(config.sessionCookieName, sessionId, {
    httpOnly: true,
    secure: config.appEnv !== "dev",
    sameSite: "Strict",
    path: "/",
    maxAgeSeconds: config.sessionTtlSeconds
  });
}

function createCsrfCookie(config: RuntimeConfig, csrfToken: string): string {
  return serializeCookie(config.csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: config.appEnv !== "dev",
    sameSite: "Strict",
    path: "/",
    maxAgeSeconds: config.sessionTtlSeconds
  });
}

function clearCookie(config: RuntimeConfig, name: string, httpOnly: boolean): string {
  return serializeCookie(name, "", {
    httpOnly,
    secure: config.appEnv !== "dev",
    sameSite: "Strict",
    path: "/",
    maxAgeSeconds: 0
  });
}

function buildAdminSecurityHeaders(): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "form-action 'self'"
  ].join("; ");
  return {
    "content-type": "text/html; charset=utf-8",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy": csp
  };
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("invalid_content_type");
  }

  return (await request.json()) as Record<string, unknown>;
}

function parseStatus(value: unknown): ScarabStatus | null {
  if (value === "draft" || value === "active" || value === "retired") {
    return value;
  }
  return null;
}

function parseNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseScarabTextInput(body: Record<string, unknown>): ScarabTextInput | null {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    description: parseNullableString(body.description),
    modifiers: parseStringArray(body.modifiers),
    flavorText: parseNullableString(body.flavorText)
  };
}

function parseStatusesFromQuery(url: URL): ScarabStatus[] | undefined {
  const raw = url.searchParams.get("status");
  if (!raw) {
    return undefined;
  }

  const statuses = raw
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => parseStatus(entry))
    .filter((entry): entry is ScarabStatus => entry !== null);

  return statuses.length > 0 ? statuses : undefined;
}

function parseScopedStringFromQuery(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function parseOrderBy(value: unknown): "name" | "created" | undefined {
  if (value === "name" || value === "created") {
    return value;
  }
  return undefined;
}

function buildRateLimitResponse(requestId: string, retryAfterSeconds: number): Response {
  return jsonResponse(
    {
      ok: false,
      error: "rate_limited",
      requestId
    },
    {
      status: 429,
      headers: {
        "retry-after": String(retryAfterSeconds),
        "x-request-id": requestId
      }
    }
  );
}

async function enforceRateLimit(
  repo: SecurityRepository,
  scope: string,
  subject: string,
  windowSeconds: number,
  limit: number,
  now: Date,
  requestId: string
): Promise<Response | null> {
  const usage = await repo.consumeRateLimit(scope, subject, windowSeconds, now);
  if (usage.count > limit) {
    return buildRateLimitResponse(requestId, usage.retryAfterSeconds);
  }
  return null;
}

class MissingDbSecurityRepository implements SecurityRepository {
  private fail(): never {
    throw new Error("DB binding is required for admin/auth routes. Configure D1 binding `DB`.");
  }

  findAdminUserByUsername(): Promise<null> {
    this.fail();
  }
  findAdminUserById(): Promise<null> {
    this.fail();
  }
  updateAdminUserPassword(): Promise<void> {
    this.fail();
  }
  findSessionById(): Promise<null> {
    this.fail();
  }
  createSession(): Promise<void> {
    this.fail();
  }
  touchSession(): Promise<void> {
    this.fail();
  }
  revokeSession(): Promise<void> {
    this.fail();
  }
  rotateSession(): Promise<void> {
    this.fail();
  }
  consumeRateLimit(): Promise<{ count: number; retryAfterSeconds: number }> {
    this.fail();
  }
  writeAuditLog(): Promise<void> {
    this.fail();
  }
  createScarab(): Promise<never> {
    this.fail();
  }
  listScarabs(): Promise<never> {
    this.fail();
  }
  findScarabById(): Promise<never> {
    this.fail();
  }
  listScarabTextVersions(): Promise<never> {
    this.fail();
  }
  updateScarab(): Promise<never> {
    this.fail();
  }
  deleteScarab(): Promise<never> {
    this.fail();
  }
  retireScarab(): Promise<never> {
    this.fail();
  }
  reactivateScarab(): Promise<never> {
    this.fail();
  }
  listTokenGenerationInputs(): Promise<never> {
    this.fail();
  }
  saveDraftTokenSet(): Promise<never> {
    this.fail();
  }
  getLatestDraftTokenSet(): Promise<never> {
    this.fail();
  }
  listLatestDraftTokensByScarabIds(): Promise<never> {
    this.fail();
  }
  publishTokenSet(): Promise<never> {
    this.fail();
  }
  getLatestPublishedTokenSet(): Promise<never> {
    this.fail();
  }
  getTokenSetById(): Promise<never> {
    this.fail();
  }
  activatePublishedTokenSet(): Promise<never> {
    this.fail();
  }
  deleteTokenSet(): Promise<never> {
    this.fail();
  }
  listTokenSets(): Promise<never> {
    this.fail();
  }
  listAuditLogs(): Promise<never> {
    this.fail();
  }
}

function getRequiredCsrfToken(request: Request, cookieToken: string | undefined): string | null {
  const headerToken = request.headers.get("x-csrf-token");
  if (!headerToken || !cookieToken) {
    return null;
  }
  if (headerToken !== cookieToken) {
    return null;
  }
  return headerToken;
}

async function writeAudit(
  repo: SecurityRepository,
  context: RequestContext,
  request: Request,
  action: string,
  statusCode: number,
  actorUserId: string | null,
  details: Record<string, unknown> | null = null
): Promise<void> {
  const url = new URL(request.url);
  const auditLog: AuditLogInput = {
    id: crypto.randomUUID(),
    actorUserId,
    action,
    method: request.method,
    path: url.pathname,
    statusCode,
    requestId: context.requestId,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent"),
    detailsJson: details ? JSON.stringify(details) : null
  };
  await repo.writeAuditLog(auditLog);
}

async function sendOperationalAlert(
  config: RuntimeConfig,
  type: "auth_failure" | "publish_failure" | "api_error",
  fields: Record<string, unknown>
): Promise<void> {
  if (!config.alertWebhookUrl) {
    return;
  }

  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type,
        app: config.appName,
        env: config.appEnv,
        at: new Date().toISOString(),
        ...fields
      })
    });
  } catch (error) {
    logWarn(config, "alert.send_failed", {
      type,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function buildNewSession(
  userId: string,
  request: Request,
  now: Date,
  config: RuntimeConfig
): Promise<NewSession> {
  return {
    id: generateToken(32),
    userId,
    csrfToken: generateToken(32),
    expiresAt: new Date(now.getTime() + config.sessionTtlSeconds * 1000).toISOString(),
    lastRotatedAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent")
  };
}

async function authenticateRequest(
  request: Request,
  deps: RouteDeps,
  context: RequestContext,
  responseHeaders: Headers
): Promise<AuthContext | Response> {
  const now = deps.now();
  const ipAddress = getClientIp(request) ?? "unknown";
  const ipThrottle = await enforceRateLimit(
    deps.securityRepo,
    "admin_ip",
    ipAddress,
    deps.config.adminRateLimitWindowSeconds,
    deps.config.adminRateLimitPerIp,
    now,
    context.requestId
  );
  if (ipThrottle) {
    return ipThrottle;
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const sessionId = cookies[deps.config.sessionCookieName];
  if (!sessionId) {
    return jsonResponse(
      {
        ok: false,
        error: "unauthorized",
        requestId: context.requestId
      },
      {
        status: 401,
        headers: {
          "x-request-id": context.requestId
        }
      }
    );
  }

  const session = await deps.securityRepo.findSessionById(sessionId);
  if (!session || !session.user.isActive) {
    return jsonResponse(
      {
        ok: false,
        error: "unauthorized",
        requestId: context.requestId
      },
      {
        status: 401,
        headers: {
          "x-request-id": context.requestId
        }
      }
    );
  }

  if (isSessionExpired(session, now)) {
    await deps.securityRepo.revokeSession(session.id, now.toISOString());
    return jsonResponse(
      {
        ok: false,
        error: "session_expired",
        requestId: context.requestId
      },
      {
        status: 401,
        headers: {
          "x-request-id": context.requestId
        }
      }
    );
  }

  const userThrottle = await enforceRateLimit(
    deps.securityRepo,
    "admin_user",
    session.user.id,
    deps.config.adminRateLimitWindowSeconds,
    deps.config.adminRateLimitPerUser,
    now,
    context.requestId
  );
  if (userThrottle) {
    return userThrottle;
  }

  if (isMutationMethod(request.method)) {
    const csrfHeaderAndCookie = getRequiredCsrfToken(request, cookies[deps.config.csrfCookieName]);
    if (!csrfHeaderAndCookie || csrfHeaderAndCookie !== session.csrfToken) {
      return jsonResponse(
        {
          ok: false,
          error: "csrf_invalid",
          requestId: context.requestId
        },
        {
          status: 403,
          headers: {
            "x-request-id": context.requestId
          }
        }
      );
    }
  }

  const nextExpiry = new Date(now.getTime() + deps.config.sessionTtlSeconds * 1000).toISOString();
  if (shouldRotateSession(session, now, deps.config.sessionRotationSeconds)) {
    const rotatedSession = await buildNewSession(session.user.id, request, now, deps.config);
    await deps.securityRepo.rotateSession(session.id, rotatedSession, now.toISOString());
    appendSetCookie(responseHeaders, createSessionCookie(deps.config, rotatedSession.id));
    appendSetCookie(responseHeaders, createCsrfCookie(deps.config, rotatedSession.csrfToken));
  } else {
    await deps.securityRepo.touchSession(session.id, nextExpiry, now.toISOString());
    appendSetCookie(responseHeaders, createSessionCookie(deps.config, session.id));
  }

  return { session };
}

function withBaseHeaders(response: Response, requestId: string, extraHeaders?: Headers): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  if (extraHeaders) {
    extraHeaders.forEach((value, key) => {
      headers.append(key, value);
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function withPublicCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.append("vary", "origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function requireRoleOrResponse(auth: AuthContext, role: AdminRole, requestId: string): Response | null {
  if (hasRequiredRole(auth.session.user.role, role)) {
    return null;
  }

  return jsonResponse(
    {
      ok: false,
      error: "forbidden",
      requestId
    },
    {
      status: 403,
      headers: {
        "x-request-id": requestId
      }
    }
  );
}

function getScarabRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/scarabs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getScarabVersionsRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/scarabs\/([^/]+)\/versions$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getScarabRetireRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/scarabs\/([^/]+)\/retire$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getScarabReactivateRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/scarabs\/([^/]+)\/reactivate$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getTokenSetActivateRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/token-sets\/([^/]+)\/activate$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getTokenSetRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/token-sets\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildTokensByName(
  published: PublishedTokenSet,
  scarabNameById: Map<string, string>
): Record<string, string> {
  const byName: Record<string, string> = {};
  for (const entry of published.entries) {
    const name = scarabNameById.get(entry.scarabId);
    if (!name) {
      continue;
    }
    byName[name] = entry.token;
  }
  return byName;
}

async function ensureLeagueExists(db: D1Database, leagueId: string, nowIso: string): Promise<void> {
  const existing = await db.prepare("SELECT id FROM leagues WHERE id = ?1 LIMIT 1").bind(leagueId).first<{ id: string }>();
  if (existing) {
    return;
  }
  await db
    .prepare(
      `
      INSERT INTO leagues (id, code, name, is_active, created_at, updated_at)
      VALUES (?1, ?2, ?3, 1, ?4, ?4)
    `
    )
    .bind(leagueId, leagueId, leagueId, nowIso)
    .run();
}

async function ensureSeasonExists(db: D1Database, seasonId: string, nowIso: string): Promise<void> {
  const existing = await db.prepare("SELECT id FROM seasons WHERE id = ?1 LIMIT 1").bind(seasonId).first<{ id: string }>();
  if (existing) {
    return;
  }
  await ensureLeagueExists(db, WORKSPACE_LEAGUE_ID, nowIso);
  await db
    .prepare(
      `
      INSERT INTO seasons (id, league_id, code, name, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    `
    )
    .bind(seasonId, WORKSPACE_LEAGUE_ID, seasonId, seasonId, nowIso)
    .run();
}

async function ensureScarabMetadataForeignKeys(
  deps: RouteDeps,
  leagueId: string | null,
  seasonId: string | null,
  nowIso: string
): Promise<void> {
  if (!deps.db) {
    return;
  }
  if (leagueId) {
    await ensureLeagueExists(deps.db, leagueId, nowIso);
  }
  if (seasonId) {
    await ensureSeasonExists(deps.db, seasonId, nowIso);
  }
}

async function cachePublishedTokenPayload(
  published: PublishedTokenSet,
  tokensByName: Record<string, string>
): Promise<void> {
  if (typeof caches === "undefined" || !("default" in caches)) {
    return;
  }
  const cache = caches.default as Cache;
  const versionUrl = `https://cache.internal/public/tokens/${published.id}`;
  const latestUrl = "https://cache.internal/public/tokens/latest";
  const payload = {
    ok: true,
    versionId: published.id,
    regexProfile: published.regexProfileName,
    itemCount: published.entries.length,
    tokens: published.entries,
    tokensByName
  };
  const response = jsonResponse(payload, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=60"
    }
  });

  await cache.put(new Request(versionUrl, { method: "GET" }), response.clone());
  await cache.put(new Request(latestUrl, { method: "GET" }), response.clone());
}

async function getCachedPublishedLatest(): Promise<Response | null> {
  if (typeof caches === "undefined" || !("default" in caches)) {
    return null;
  }
  const cache = caches.default as Cache;
  const latestUrl = "https://cache.internal/public/tokens/latest";
  const cached = await cache.match(new Request(latestUrl, { method: "GET" }));
  return cached ?? null;
}

async function clearCachedPublishedLatest(): Promise<void> {
  if (typeof caches === "undefined" || !("default" in caches)) {
    return;
  }
  const cache = caches.default as Cache;
  const latestUrl = "https://cache.internal/public/tokens/latest";
  await cache.delete(new Request(latestUrl, { method: "GET" }));
}

interface BackupSnapshotSummary {
  id: string;
  triggerType: "scheduled" | "manual";
  initiatedByUserId: string | null;
  status: "ok" | "failed";
  itemCount: number;
  externalKey: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface BackupStorageUsageSummary {
  prefix: string;
  objectCount: number;
  totalBytes: number;
  truncated: boolean;
}

async function listBackupSnapshots(db: D1Database, limit = 10): Promise<BackupSnapshotSummary[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 10;
  const rows = await db
    .prepare(
      `
      SELECT id, trigger_type, initiated_by_user_id, status, item_count, error_message, created_at
           , external_key
      FROM backup_snapshots
      ORDER BY created_at DESC, id DESC
      LIMIT ?1
    `
    )
    .bind(safeLimit)
    .all<{
      id: string;
      trigger_type: "scheduled" | "manual";
      initiated_by_user_id: string | null;
      status: "ok" | "failed";
      item_count: number;
      external_key: string | null;
      error_message: string | null;
      created_at: string;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    triggerType: row.trigger_type,
    initiatedByUserId: row.initiated_by_user_id,
    status: row.status,
    itemCount: row.item_count,
    externalKey: typeof row.external_key === "string" ? row.external_key : null,
    errorMessage: row.error_message,
    createdAt: row.created_at
  }));
}

async function computeBackupStorageUsage(
  backupR2: R2Bucket | undefined,
  prefix: string
): Promise<BackupStorageUsageSummary | null> {
  if (!backupR2) {
    return null;
  }

  let objectCount = 0;
  let totalBytes = 0;
  let truncated = false;
  let cursor: string | undefined;
  let pages = 0;
  const maxPages = 100;

  do {
    const page = await backupR2.list({
      prefix,
      cursor,
      limit: 1000
    });
    for (const obj of page.objects) {
      objectCount += 1;
      totalBytes += obj.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;
    if (cursor && pages >= maxPages) {
      truncated = true;
      break;
    }
  } while (cursor);

  return {
    prefix,
    objectCount,
    totalBytes,
    truncated
  };
}

async function collectBackupRows(db: D1Database): Promise<Record<string, unknown[]>> {
  const tableQueries: Array<{ key: string; sql: string }> = [
    { key: "leagues", sql: "SELECT * FROM leagues ORDER BY created_at ASC, id ASC" },
    { key: "seasons", sql: "SELECT * FROM seasons ORDER BY created_at ASC, id ASC" },
    { key: "scarabs", sql: "SELECT * FROM scarabs ORDER BY created_at ASC, id ASC" },
    { key: "scarabTextVersions", sql: "SELECT * FROM scarab_text_versions ORDER BY scarab_id ASC, version ASC" },
    { key: "draftTokenSets", sql: "SELECT * FROM draft_token_sets ORDER BY created_at ASC, id ASC" },
    { key: "draftTokenEntries", sql: "SELECT * FROM draft_token_entries ORDER BY created_at ASC, id ASC" },
    { key: "draftTokenReports", sql: "SELECT * FROM draft_token_reports ORDER BY created_at ASC, draft_set_id ASC" },
    { key: "tokenSets", sql: "SELECT * FROM token_sets ORDER BY created_at ASC, id ASC" },
    { key: "tokenSetEntries", sql: "SELECT * FROM token_set_entries ORDER BY created_at ASC, id ASC" },
    { key: "auditLogs", sql: "SELECT * FROM audit_logs ORDER BY created_at ASC, id ASC" }
  ];

  const payload: Record<string, unknown[]> = {};
  for (const entry of tableQueries) {
    const rows = await db.prepare(entry.sql).all<Record<string, unknown>>();
    payload[entry.key] = rows.results;
  }

  return payload;
}

async function runBackupSnapshot(
  deps: RouteDeps,
  triggerType: "scheduled" | "manual",
  initiatedByUserId: string | null
): Promise<BackupSnapshotSummary | null> {
  if (!deps.db) {
    return null;
  }

  const nowIso = deps.now().toISOString();
  const snapshotId = crypto.randomUUID();
  try {
    const payloadRows = await collectBackupRows(deps.db);
    const totalItems = Object.values(payloadRows).reduce((acc, rows) => acc + rows.length, 0);
    const payload = {
      schemaVersion: "block8_v1",
      capturedAt: nowIso,
      environment: deps.config.appEnv,
      rows: payloadRows
    };

    let externalKey: string | null = null;
    if (deps.backupR2) {
      const compactTs = nowIso.replace(/[-:.TZ]/g, "").slice(0, 14);
      externalKey = `${deps.config.backupObjectPrefix}/${deps.config.appEnv}/${compactTs}_${snapshotId}.json`;
      await deps.backupR2.put(externalKey, JSON.stringify(payload), {
        httpMetadata: {
          contentType: "application/json"
        }
      });
    } else if (deps.config.backupRequireExternal) {
      throw new Error("backup_external_required_but_not_configured");
    }

    await deps.db
      .prepare(
        `
        INSERT INTO backup_snapshots (
          id,
          trigger_type,
          initiated_by_user_id,
          status,
          item_count,
          external_key,
          payload_json,
          error_message,
          created_at
        ) VALUES (?1, ?2, ?3, 'ok', ?4, ?5, ?6, NULL, ?7)
      `
      )
      .bind(snapshotId, triggerType, initiatedByUserId, totalItems, externalKey, JSON.stringify(payload), nowIso)
      .run();

    const cutoffIso = new Date(deps.now().getTime() - deps.config.backupRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    await deps.db
      .prepare(
        `
        DELETE FROM backup_snapshots
        WHERE created_at < ?1
      `
      )
      .bind(cutoffIso)
      .run();

    return {
      id: snapshotId,
      triggerType,
      initiatedByUserId,
      status: "ok",
      itemCount: totalItems,
      externalKey,
      errorMessage: null,
      createdAt: nowIso
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await deps.db
      .prepare(
        `
        INSERT INTO backup_snapshots (
          id,
          trigger_type,
          initiated_by_user_id,
          status,
          item_count,
          external_key,
          payload_json,
          error_message,
          created_at
        ) VALUES (?1, ?2, ?3, 'failed', 0, NULL, '{}', ?4, ?5)
      `
      )
      .bind(snapshotId, triggerType, initiatedByUserId, err.message.slice(0, 800), nowIso)
      .run();

    return {
      id: snapshotId,
      triggerType,
      initiatedByUserId,
      status: "failed",
      itemCount: 0,
      externalKey: null,
      errorMessage: err.message,
      createdAt: nowIso
    };
  }
}

async function handleSystemRoutes(request: Request, url: URL, deps: RouteDeps, context: RequestContext): Promise<Response | null> {
  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({
      ok: true,
      service: deps.config.appName,
      environment: deps.config.appEnv,
      requestId: context.requestId
    });
  }

  if (request.method === "GET" && url.pathname === "/admin/ui") {
    return new Response(buildAdminUiHtml(), {
      status: 200,
      headers: buildAdminSecurityHeaders()
    });
  }

  return null;
}


async function routeRequest(request: Request, deps: RouteDeps, context: RequestContext): Promise<Response> {
  const url = new URL(request.url);
  const responseCookieHeaders = new Headers();

  const systemResponse = await handleSystemRoutes(request, url, deps, context);
  if (systemResponse) return systemResponse;

  const authRouteResponse = await handleAuthRoutes(request, url, deps, context, responseCookieHeaders, {
    enforceRateLimit,
    getClientIp,
    parseJsonBody,
    jsonResponse,
    verifyPassword,
    writeAudit,
    sendOperationalAlert,
    buildNewSession,
    appendSetCookie,
    createSessionCookie,
    createCsrfCookie,
    withBaseHeaders,
    authenticateRequest,
    clearCookie,
    requireRoleOrResponse,
    hashPassword
  });
  if (authRouteResponse) return authRouteResponse;

  const scarabRouteResponse = await handleScarabRoutes(request, url, deps, context, responseCookieHeaders, {
    authenticateRequest,
    writeAudit,
    parseStatusesFromQuery,
    parseOrderBy,
    parseScopedStringFromQuery,
    jsonResponse,
    withBaseHeaders,
    parseJsonBody,
    parseScarabTextInput,
    parseStatus,
    parseNullableString,
    ensureScarabMetadataForeignKeys,
    getScarabVersionsRouteId,
    getScarabRouteId,
    getScarabRetireRouteId,
    getScarabReactivateRouteId,
    requireRoleOrResponse,
    normalizePublishToken,
    validateTokenAgainstPoeRegexProfile,
    POE_REGEX_PROFILE_NAME
  });
  if (scarabRouteResponse) return scarabRouteResponse;

  const tokenRouteResponse = await handleTokenRoutes(request, url, deps, context, responseCookieHeaders, {
    authenticateRequest,
    jsonResponse,
    withBaseHeaders,
    parseStatusesFromQuery,
    parseOrderBy,
    parseScopedStringFromQuery,
    writeAudit,
    parseJsonBody,
    normalizePublishToken,
    validateTokenAgainstPoeRegexProfile,
    POE_REGEX_PROFILE_NAME,
    buildTokensByName,
    cachePublishedTokenPayload,
    requireRoleOrResponse,
    buildInputFingerprint,
    generateDraftTokenEntries,
    buildDraftGenerationReport,
    TokenGenerationFailure,
    getTokenSetActivateRouteId,
    getTokenSetRouteId,
    clearCachedPublishedLatest,
    getCachedPublishedLatest,
    withPublicCorsHeaders,
    parseNullableString,
    sendOperationalAlert
  });
  if (tokenRouteResponse) return tokenRouteResponse;

  const opsRouteResponse = await handleOpsRoutes(request, url, deps, context, responseCookieHeaders, {
    authenticateRequest,
    writeAudit,
    requireRoleOrResponse,
    listBackupSnapshots,
    computeBackupStorageUsage,
    runBackupSnapshot,
    jsonResponse,
    withBaseHeaders,
    parseNullableString
  });
  if (opsRouteResponse) return opsRouteResponse;

  if (request.method === "POST" && url.pathname.startsWith("/admin/")) {
    return jsonResponse(
      {
        ok: false,
        error: "not_found",
        requestId: context.requestId
      },
      { status: 404 }
    );
  }

  return jsonResponse(
    {
      ok: false,
      error: "not_found",
      requestId: context.requestId
    },
    { status: 404 }
  );
}

function createRuntimeDeps(env: Env): RuntimeDeps {
  const config = loadConfig(env);
  const securityRepo = env.DB ? new D1SecurityRepository(env.DB) : new MissingDbSecurityRepository();

  return {
    config,
    securityRepo,
    db: env.DB,
    backupR2: env.BACKUP_R2,
    now: () => new Date()
  };
}

export function createWorker(depsFactory: (env: Env) => RuntimeDeps = createRuntimeDeps): ExportedHandler<Env> {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const reqCtx = createContext();
      const runtimeDeps = depsFactory(env);

      logInfo(runtimeDeps.config, "request.start", {
        requestId: reqCtx.requestId,
        method: request.method,
        path: new URL(request.url).pathname
      });

      try {
        const response = await routeRequest(
          request,
          {
            config: runtimeDeps.config,
            securityRepo: runtimeDeps.securityRepo,
            db: runtimeDeps.db,
            backupR2: runtimeDeps.backupR2,
            now: runtimeDeps.now
          },
          reqCtx
        );
        const withBase = withBaseHeaders(response, reqCtx.requestId);
        logInfo(runtimeDeps.config, "request.finish", {
          requestId: reqCtx.requestId,
          status: withBase.status,
          durationMs: Date.now() - reqCtx.startedAt
        });
        return withBase;
      } catch (error) {
        captureError(runtimeDeps.config, error, {
          requestId: reqCtx.requestId,
          durationMs: Date.now() - reqCtx.startedAt
        });
        await sendOperationalAlert(runtimeDeps.config, "api_error", {
          requestId: reqCtx.requestId,
          errorMessage: error instanceof Error ? error.message : String(error)
        });

        return jsonResponse(
          {
            ok: false,
            error: "internal_error",
            requestId: reqCtx.requestId
          },
          {
            status: 500,
            headers: {
              "x-request-id": reqCtx.requestId
            }
          }
        );
      } finally {
        if (new URL(request.url).pathname.startsWith("/admin/")) {
          logWarn(runtimeDeps.config, "admin.request", {
            requestId: reqCtx.requestId,
            method: request.method,
            path: new URL(request.url).pathname
          });
        }
      }
    },
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
      const runtimeDeps = depsFactory(env);
      if (!runtimeDeps.config.backupEnabled) {
        return;
      }

      const snapshot = await runBackupSnapshot(
        {
          config: runtimeDeps.config,
          securityRepo: runtimeDeps.securityRepo,
          db: runtimeDeps.db,
          backupR2: runtimeDeps.backupR2,
          now: runtimeDeps.now
        },
        "scheduled",
        null
      );

      if (!snapshot) {
        logWarn(runtimeDeps.config, "backup.skipped", {
          reason: "backup_unavailable"
        });
        return;
      }

      if (snapshot.status === "ok") {
        logInfo(runtimeDeps.config, "backup.completed", {
          snapshotId: snapshot.id,
          itemCount: snapshot.itemCount
        });
        return;
      }

      logWarn(runtimeDeps.config, "backup.failed", {
        snapshotId: snapshot.id,
        errorMessage: snapshot.errorMessage
      });
    }
  };
}

export default createWorker();
