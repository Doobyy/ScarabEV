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

async function routeRequest(request: Request, deps: RouteDeps, context: RequestContext): Promise<Response> {
  const url = new URL(request.url);
  const responseCookieHeaders = new Headers();

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
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-frame-options": "DENY"
      }
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/auth/login") {
    const now = deps.now();
    const ipAddress = getClientIp(request) ?? "unknown";
    const ipThrottle = await enforceRateLimit(
      deps.securityRepo,
      "auth_ip",
      ipAddress,
      deps.config.authRateLimitWindowSeconds,
      deps.config.authRateLimitPerIp,
      now,
      context.requestId
    );
    if (ipThrottle) {
      return ipThrottle;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_credentials",
          requestId: context.requestId
        },
        { status: 401 }
      );
    }

    const userThrottle = await enforceRateLimit(
      deps.securityRepo,
      "auth_user",
      username.toLowerCase(),
      deps.config.authRateLimitWindowSeconds,
      deps.config.authRateLimitPerUser,
      now,
      context.requestId
    );
    if (userThrottle) {
      return userThrottle;
    }

    const user = await deps.securityRepo.findAdminUserByUsername(username);
    const passwordOk = user
      ? await verifyPassword(password, user.passwordSalt, user.passwordIterations, user.passwordHash)
      : false;

    if (!user || !user.isActive || !passwordOk) {
      await writeAudit(deps.securityRepo, context, request, "auth.login", 401, null, {
        username
      });
      await sendOperationalAlert(deps.config, "auth_failure", {
        requestId: context.requestId,
        username,
        ipAddress,
        reason: "invalid_credentials"
      });
      return jsonResponse(
        {
          ok: false,
          error: "invalid_credentials",
          requestId: context.requestId
        },
        { status: 401 }
      );
    }

    const session = await buildNewSession(user.id, request, now, deps.config);
    await deps.securityRepo.createSession(session);

    appendSetCookie(responseCookieHeaders, createSessionCookie(deps.config, session.id));
    appendSetCookie(responseCookieHeaders, createCsrfCookie(deps.config, session.csrfToken));

    await writeAudit(deps.securityRepo, context, request, "auth.login", 200, user.id, {
      role: user.role
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        session: {
          expiresAt: session.expiresAt
        },
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/auth/logout") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "auth.logout", auth.status, null);
      return auth;
    }

    const now = deps.now();
    await deps.securityRepo.revokeSession(auth.session.id, now.toISOString());
    appendSetCookie(responseCookieHeaders, clearCookie(deps.config, deps.config.sessionCookieName, true));
    appendSetCookie(responseCookieHeaders, clearCookie(deps.config, deps.config.csrfCookieName, false));

    await writeAudit(deps.securityRepo, context, request, "auth.logout", 200, auth.session.user.id);
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/auth/session") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        user: {
          id: auth.session.user.id,
          username: auth.session.user.username,
          role: auth.session.user.role
        }
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/healthz") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        actor: {
          id: auth.session.user.id,
          username: auth.session.user.username,
          role: auth.session.user.role
        }
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/owner/ping") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.owner_ping", auth.status, null);
      return auth;
    }

    const forbidden = requireRoleOrResponse(auth, "owner", context.requestId);
    if (forbidden) {
      await writeAudit(deps.securityRepo, context, request, "admin.owner_ping", 403, auth.session.user.id);
      return forbidden;
    }

    await writeAudit(deps.securityRepo, context, request, "admin.owner_ping", 200, auth.session.user.id);

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        result: "owner_mutation_accepted"
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/owner/change-password") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.change_password", auth.status, null);
      return auth;
    }

    const forbidden = requireRoleOrResponse(auth, "owner", context.requestId);
    if (forbidden) {
      await writeAudit(deps.securityRepo, context, request, "admin.change_password", 403, auth.session.user.id);
      return forbidden;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      await writeAudit(deps.securityRepo, context, request, "admin.change_password", 400, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword || newPassword.length < 16 || newPassword.length > 128) {
      await writeAudit(deps.securityRepo, context, request, "admin.change_password", 400, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_password_policy",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const user = await deps.securityRepo.findAdminUserById(auth.session.user.id);
    if (!user || !user.isActive) {
      await writeAudit(deps.securityRepo, context, request, "admin.change_password", 401, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "unauthorized",
          requestId: context.requestId
        },
        { status: 401 }
      );
    }

    const currentPasswordValid = await verifyPassword(
      currentPassword,
      user.passwordSalt,
      user.passwordIterations,
      user.passwordHash
    );
    if (!currentPasswordValid) {
      await writeAudit(deps.securityRepo, context, request, "admin.change_password", 401, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_credentials",
          requestId: context.requestId
        },
        { status: 401 }
      );
    }

    const nextPassword = await hashPassword(newPassword);
    await deps.securityRepo.updateAdminUserPassword(
      auth.session.user.id,
      nextPassword.hash,
      nextPassword.salt,
      nextPassword.iterations
    );
    await deps.securityRepo.revokeSession(auth.session.id, deps.now().toISOString());
    appendSetCookie(responseCookieHeaders, clearCookie(deps.config, deps.config.sessionCookieName, true));
    appendSetCookie(responseCookieHeaders, clearCookie(deps.config, deps.config.csrfCookieName, false));

    await writeAudit(deps.securityRepo, context, request, "admin.change_password", 200, auth.session.user.id);
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/scarabs/token-inputs") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const statuses = parseStatusesFromQuery(url) ?? ["active"];
    const orderBy = parseOrderBy(url.searchParams.get("order"));
    const scope = {
      leagueId: parseScopedStringFromQuery(url, "leagueId"),
      seasonId: parseScopedStringFromQuery(url, "seasonId"),
      orderBy
    };
    const inputs = await deps.securityRepo.listTokenGenerationInputs(statuses, scope);
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        filter: {
          statuses,
          leagueId: scope.leagueId ?? null,
          seasonId: scope.seasonId ?? null,
          orderBy: scope.orderBy ?? "name"
        },
        items: inputs
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/scarabs") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const statuses = parseStatusesFromQuery(url);
    const leagueId = parseScopedStringFromQuery(url, "leagueId");
    const seasonId = parseScopedStringFromQuery(url, "seasonId");
    const orderBy = parseOrderBy(url.searchParams.get("order"));
    const options: ScarabListOptions | undefined =
      statuses || leagueId !== undefined || seasonId !== undefined || orderBy !== undefined
        ? {
            statuses,
            leagueId,
            seasonId,
            orderBy
          }
        : undefined;
    const scarabs = await deps.securityRepo.listScarabs(options);
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        items: scarabs
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/scarabs") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.create", auth.status, null);
      return auth;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.create", 400, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const text = parseScarabTextInput(body);
    const status = parseStatus(body.status) ?? "draft";
    if (!text) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.create", 400, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_scarab_payload",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const nowIso = deps.now().toISOString();
    const leagueId = parseNullableString(body.leagueId);
    const seasonId = parseNullableString(body.seasonId);
    try {
      await ensureScarabMetadataForeignKeys(deps, leagueId, seasonId, nowIso);
    } catch (error) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.create", 400, auth.session.user.id, {
        reason: "metadata_fk_prepare_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      return jsonResponse(
        {
          ok: false,
          error: "invalid_metadata_scope",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    let created;
    try {
      created = await deps.securityRepo.createScarab({
        id: crypto.randomUUID(),
        status,
        name: text.name,
        description: text.description,
        modifiers: text.modifiers,
        flavorText: text.flavorText,
        leagueId,
        seasonId,
        createdByUserId: auth.session.user.id,
        changeNote: parseNullableString(body.changeNote),
        createdAt: nowIso
      });
    } catch (error) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.create", 400, auth.session.user.id, {
        reason: "create_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      return jsonResponse(
        {
          ok: false,
          error: "create_failed",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    await writeAudit(deps.securityRepo, context, request, "admin.scarab.create", 201, auth.session.user.id, {
      scarabId: created.id,
      status: created.status
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scarab: created
      },
      { status: 201 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && getScarabVersionsRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const scarabId = getScarabVersionsRouteId(url.pathname) as string;
    const scarab = await deps.securityRepo.findScarabById(scarabId);
    if (!scarab) {
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    const versions = await deps.securityRepo.listScarabTextVersions(scarabId);
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scarab: {
          id: scarab.id,
          status: scarab.status,
          currentTextVersion: scarab.currentTextVersion
        },
        versions
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && getScarabRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const scarabId = getScarabRouteId(url.pathname) as string;
    const scarab = await deps.securityRepo.findScarabById(scarabId);
    if (!scarab) {
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scarab
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "PUT" && getScarabRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.update", auth.status, null);
      return auth;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.update", 400, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const text = parseScarabTextInput(body);
    const status = parseStatus(body.status);
    if (!text || !status || status === "retired") {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.update", 400, auth.session.user.id);
      return jsonResponse(
        {
          ok: false,
          error: "invalid_scarab_payload",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const scarabId = getScarabRouteId(url.pathname) as string;
    const updatedAt = deps.now().toISOString();
    const leagueId = parseNullableString(body.leagueId);
    const seasonId = parseNullableString(body.seasonId);
    try {
      await ensureScarabMetadataForeignKeys(deps, leagueId, seasonId, updatedAt);
    } catch (error) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.update", 400, auth.session.user.id, {
        scarabId,
        reason: "metadata_fk_prepare_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      return jsonResponse(
        {
          ok: false,
          error: "invalid_metadata_scope",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const updated = await deps.securityRepo.updateScarab({
      scarabId,
      status,
      text,
      leagueId,
      seasonId,
      changeNote: parseNullableString(body.changeNote),
      actorUserId: auth.session.user.id,
      updatedAt
    });

    if (!updated) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.update", 404, auth.session.user.id, {
        scarabId
      });
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    await writeAudit(deps.securityRepo, context, request, "admin.scarab.update", 200, auth.session.user.id, {
      scarabId,
      status: updated.status,
      currentTextVersion: updated.currentTextVersion
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scarab: updated
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "DELETE" && getScarabRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.delete", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.delete", 403, auth.session.user.id);
      return ownerOnly;
    }

    const scarabId = getScarabRouteId(url.pathname) as string;
    const deleted = await deps.securityRepo.deleteScarab(scarabId);
    if (!deleted) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.delete", 404, auth.session.user.id, {
        scarabId
      });
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    await writeAudit(deps.securityRepo, context, request, "admin.scarab.delete", 200, auth.session.user.id, {
      scarabId
    });
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        deletedScarabId: scarabId
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && getScarabRetireRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.retire", auth.status, null);
      return auth;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      body = {};
    }

    const scarabId = getScarabRetireRouteId(url.pathname) as string;
    const retiredLeagueId = parseNullableString(body.retiredLeagueId);
    const retiredSeasonId = parseNullableString(body.retiredSeasonId);
    const retiredAt = deps.now().toISOString();
    try {
      await ensureScarabMetadataForeignKeys(deps, retiredLeagueId, retiredSeasonId, retiredAt);
    } catch (error) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.retire", 400, auth.session.user.id, {
        scarabId,
        reason: "metadata_fk_prepare_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      return jsonResponse(
        {
          ok: false,
          error: "invalid_metadata_scope",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const retired = await deps.securityRepo.retireScarab({
      scarabId,
      retiredLeagueId,
      retiredSeasonId,
      retirementNote: parseNullableString(body.retirementNote),
      actorUserId: auth.session.user.id,
      retiredAt
    });

    if (!retired) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.retire", 404, auth.session.user.id, {
        scarabId
      });
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    await writeAudit(deps.securityRepo, context, request, "admin.scarab.retire", 200, auth.session.user.id, {
      scarabId
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scarab: retired
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && getScarabReactivateRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.reactivate", auth.status, null);
      return auth;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      body = {};
    }

    const scarabId = getScarabReactivateRouteId(url.pathname) as string;
    const reactivateLeagueId = parseNullableString(body.leagueId);
    const reactivateSeasonId = parseNullableString(body.seasonId);
    const reactivatedAt = deps.now().toISOString();
    try {
      await ensureScarabMetadataForeignKeys(deps, reactivateLeagueId, reactivateSeasonId, reactivatedAt);
    } catch (error) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.reactivate", 400, auth.session.user.id, {
        scarabId,
        reason: "metadata_fk_prepare_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      return jsonResponse(
        {
          ok: false,
          error: "invalid_metadata_scope",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const reactivated = await deps.securityRepo.reactivateScarab({
      scarabId,
      leagueId: reactivateLeagueId,
      seasonId: reactivateSeasonId,
      actorUserId: auth.session.user.id,
      reactivatedAt
    });

    if (!reactivated) {
      await writeAudit(deps.securityRepo, context, request, "admin.scarab.reactivate", 404, auth.session.user.id, {
        scarabId
      });
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    await writeAudit(deps.securityRepo, context, request, "admin.scarab.reactivate", 200, auth.session.user.id, {
      scarabId
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scarab: reactivated
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/token-drafts/latest") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const latest = await deps.securityRepo.getLatestDraftTokenSet();
    if (!latest) {
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        draft: latest
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/token-drafts/generate") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_draft.generate", auth.status, null);
      return auth;
    }

    let body: Record<string, unknown> = {};
    try {
      body = await parseJsonBody(request);
    } catch {
      body = {};
    }
    const scope = {
      leagueId: parseNullableString(body.leagueId),
      seasonId: parseNullableString(body.seasonId),
      orderBy: parseOrderBy(body.orderBy) ?? "name"
    };

    const activeInputs = await deps.securityRepo.listTokenGenerationInputs(["active"], scope);
    const retiredInputs = await deps.securityRepo.listTokenGenerationInputs(["retired"], scope);
    const excludedRetired: DraftTokenExcludedRetired[] = retiredInputs.map((entry) => ({
      scarabId: entry.scarabId,
      name: entry.name
    }));

    let entries;
    try {
      entries = generateDraftTokenEntries(activeInputs);
    } catch (error) {
      const failure = error instanceof TokenGenerationFailure ? error : null;
      const partialEntries = failure?.partialEntries ?? [];
      const problematicScarabIds = failure?.problematicScarabIds ?? [];
      const previousByScarab = await deps.securityRepo.listLatestDraftTokensByScarabIds(
        partialEntries.map((entry) => entry.scarabId)
      );
      const failedReport = buildDraftGenerationReport(partialEntries, previousByScarab, excludedRetired);
      const failedDraft = await deps.securityRepo.saveDraftTokenSet({
        id: crypto.randomUUID(),
        createdByUserId: auth.session.user.id,
        createdAt: deps.now().toISOString(),
        inputFingerprint: buildInputFingerprint(activeInputs),
        entries: partialEntries,
        report: failedReport
      });
      const covered = new Set(partialEntries.map((entry) => entry.scarabId));
      const missingCoverage = activeInputs.filter((entry) => !covered.has(entry.scarabId)).map((entry) => entry.scarabId);
      const nameById = new Map(activeInputs.map((entry) => [entry.scarabId, entry.name]));
      const problematicScarabNames = problematicScarabIds.map((id) => nameById.get(id) ?? id);
      const missingCoverageNames = missingCoverage.map((id) => nameById.get(id) ?? id);
      const message = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.token_draft.generate", 409, auth.session.user.id, {
        reason: "token_generation_failed",
        message,
        failedDraftSetId: failedDraft.id,
        failedItemCount: failedDraft.itemCount,
        problematicCount: problematicScarabIds.length,
        missingCoverageCount: missingCoverage.length,
        leagueId: scope.leagueId,
        seasonId: scope.seasonId
      });
      return jsonResponse(
        {
          ok: false,
          error: "token_generation_failed",
          requestId: context.requestId,
          failedDraft: failedDraft,
          details: {
            reason: message,
            problematicScarabIds,
            problematicScarabNames,
            missingCoverage,
            missingCoverageNames
          }
        },
        { status: 409 }
      );
    }
    const previousByScarab = await deps.securityRepo.listLatestDraftTokensByScarabIds(entries.map((entry) => entry.scarabId));
    const report = buildDraftGenerationReport(entries, previousByScarab, excludedRetired);
    const persisted = await deps.securityRepo.saveDraftTokenSet({
      id: crypto.randomUUID(),
      createdByUserId: auth.session.user.id,
      createdAt: deps.now().toISOString(),
      inputFingerprint: buildInputFingerprint(activeInputs),
      entries,
      report
    });

    await writeAudit(deps.securityRepo, context, request, "admin.token_draft.generate", 201, auth.session.user.id, {
      draftSetId: persisted.id,
      itemCount: persisted.itemCount,
      collisionCount: persisted.report.collisions.length,
      leagueId: scope.leagueId,
      seasonId: scope.seasonId
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        scope: {
          leagueId: scope.leagueId,
          seasonId: scope.seasonId
        },
        draft: persisted
      },
      { status: 201 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/token-sets/publish") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_publish", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_publish", 403, auth.session.user.id);
      return ownerOnly;
    }

    const latestDraft = await deps.securityRepo.getLatestDraftTokenSet();
    if (!latestDraft) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_publish", 400, auth.session.user.id, {
        reason: "missing_draft"
      });
      return jsonResponse(
        {
          ok: false,
          error: "missing_draft",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const activeInputs = await deps.securityRepo.listTokenGenerationInputs(["active"]);
    const activeIds = new Set(activeInputs.map((entry) => entry.scarabId));
    const entryIds = new Set(latestDraft.entries.map((entry) => entry.scarabId));
    const missingCoverage = [...activeIds].filter((id) => !entryIds.has(id)).sort();
    const hasUnresolvedCollisions = latestDraft.report.collisions.length > 0;

    const violations: PoeRegexViolation[] = [];
    for (const entry of latestDraft.entries) {
      const normalized = normalizePublishToken(entry.token);
      const violation = validateTokenAgainstPoeRegexProfile(normalized);
      if (violation) {
        violations.push(violation);
      }
    }

    if (hasUnresolvedCollisions || missingCoverage.length > 0 || violations.length > 0) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_publish", 409, auth.session.user.id, {
        draftSetId: latestDraft.id,
        collisionCount: latestDraft.report.collisions.length,
        missingCoverageCount: missingCoverage.length,
        regexViolationCount: violations.length
      });
      await sendOperationalAlert(deps.config, "publish_failure", {
        requestId: context.requestId,
        draftSetId: latestDraft.id,
        collisionCount: latestDraft.report.collisions.length,
        missingCoverageCount: missingCoverage.length,
        regexViolationCount: violations.length
      });
      return jsonResponse(
        {
          ok: false,
          error: "publish_gate_failed",
          requestId: context.requestId,
          gate: {
            hasUnresolvedCollisions,
            missingCoverage,
            regexViolations: violations
          }
        },
        { status: 409 }
      );
    }

    const nowIso = deps.now().toISOString();
    const allScarabs = await deps.securityRepo.listScarabs();
    const scarabNameById = new Map<string, string>(allScarabs.map((scarab) => [scarab.id, scarab.currentText.name]));
    const published = await deps.securityRepo.publishTokenSet({
      id: crypto.randomUUID(),
      sourceDraftSetId: latestDraft.id,
      regexProfileName: POE_REGEX_PROFILE_NAME,
      createdByUserId: auth.session.user.id,
      createdAt: nowIso,
      publishedAt: nowIso,
      entries: latestDraft.entries.map((entry) => ({
        scarabId: entry.scarabId,
        token: normalizePublishToken(entry.token)
      }))
    });
    const tokensByName = buildTokensByName(published, scarabNameById);
    await cachePublishedTokenPayload(published, tokensByName);

    await writeAudit(deps.securityRepo, context, request, "admin.token_publish", 201, auth.session.user.id, {
      tokenSetId: published.id,
      sourceDraftSetId: latestDraft.id,
      itemCount: published.entries.length
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        tokenSet: published
      },
      { status: 201 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/token-sets/import-legacy") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_import_publish", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_import_publish", 403, auth.session.user.id);
      return ownerOnly;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(request);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const tokensByNameInput = body.tokensByName;
    if (!tokensByNameInput || typeof tokensByNameInput !== "object") {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_tokens_map",
          requestId: context.requestId
        },
        { status: 400 }
      );
    }

    const activeScarabs = await deps.securityRepo.listScarabs({ statuses: ["active"] });

    const missingCoverage: string[] = [];
    const regexViolations: PoeRegexViolation[] = [];
    const entries: Array<{ scarabId: string; token: string }> = [];

    for (const scarab of activeScarabs) {
      const rawToken = (tokensByNameInput as Record<string, unknown>)[scarab.currentText.name];
      if (typeof rawToken !== "string" || !rawToken.trim()) {
        missingCoverage.push(scarab.currentText.name);
        continue;
      }
      const normalized = normalizePublishToken(rawToken);
      const violation = validateTokenAgainstPoeRegexProfile(normalized);
      if (violation) {
        regexViolations.push(violation);
        continue;
      }
      entries.push({
        scarabId: scarab.id,
        token: normalized
      });
    }

    if (missingCoverage.length > 0 || regexViolations.length > 0) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_import_publish", 409, auth.session.user.id, {
        missingCoverageCount: missingCoverage.length,
        regexViolationCount: regexViolations.length
      });
      return jsonResponse(
        {
          ok: false,
          error: "publish_gate_failed",
          requestId: context.requestId,
          gate: {
            missingCoverage,
            regexViolations
          }
        },
        { status: 409 }
      );
    }

    let sourceDraft = await deps.securityRepo.getLatestDraftTokenSet();
    if (!sourceDraft) {
      const activeInputs = await deps.securityRepo.listTokenGenerationInputs(["active"]);
      const generatedEntries = generateDraftTokenEntries(activeInputs);
      sourceDraft = await deps.securityRepo.saveDraftTokenSet({
        id: crypto.randomUUID(),
        createdByUserId: auth.session.user.id,
        createdAt: deps.now().toISOString(),
        inputFingerprint: buildInputFingerprint(activeInputs),
        entries: generatedEntries,
        report: buildDraftGenerationReport(generatedEntries, new Map(), [])
      });
    }

    const nowIso = deps.now().toISOString();
    const published = await deps.securityRepo.publishTokenSet({
      id: crypto.randomUUID(),
      sourceDraftSetId: sourceDraft.id,
      regexProfileName: POE_REGEX_PROFILE_NAME,
      createdByUserId: auth.session.user.id,
      createdAt: nowIso,
      publishedAt: nowIso,
      entries
    });
    const scarabNameById = new Map<string, string>(activeScarabs.map((scarab) => [scarab.id, scarab.currentText.name]));
    const tokensByName = buildTokensByName(published, scarabNameById);
    await cachePublishedTokenPayload(published, tokensByName);

    await writeAudit(deps.securityRepo, context, request, "admin.token_import_publish", 201, auth.session.user.id, {
      tokenSetId: published.id,
      itemCount: published.entries.length
    });
    return jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        tokenSet: published
      },
      { status: 201 }
    );
  }

  if (request.method === "POST" && getTokenSetActivateRouteId(url.pathname)) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_rollback", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_rollback", 403, auth.session.user.id);
      return ownerOnly;
    }

    const tokenSetId = getTokenSetActivateRouteId(url.pathname) as string;
    const activated = await deps.securityRepo.activatePublishedTokenSet(tokenSetId, deps.now().toISOString());
    if (!activated) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_rollback", 404, auth.session.user.id, {
        tokenSetId
      });
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }

    const allScarabs = await deps.securityRepo.listScarabs();
    const scarabNameById = new Map<string, string>(allScarabs.map((scarab) => [scarab.id, scarab.currentText.name]));
    const tokensByName = buildTokensByName(activated, scarabNameById);
    await cachePublishedTokenPayload(activated, tokensByName);
    await writeAudit(deps.securityRepo, context, request, "admin.token_rollback", 200, auth.session.user.id, {
      tokenSetId: activated.id
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        tokenSet: activated
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "DELETE" && getTokenSetRouteId(url.pathname) && getTokenSetActivateRouteId(url.pathname) === null) {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_set.delete", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.token_set.delete", 403, auth.session.user.id);
      return ownerOnly;
    }

    const tokenSetId = getTokenSetRouteId(url.pathname) as string;
    const outcome = await deps.securityRepo.deleteTokenSet(tokenSetId);
    if (outcome === "not_found") {
      await writeAudit(deps.securityRepo, context, request, "admin.token_set.delete", 404, auth.session.user.id, {
        tokenSetId
      });
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          requestId: context.requestId
        },
        { status: 404 }
      );
    }
    if (outcome === "published_blocked") {
      await writeAudit(deps.securityRepo, context, request, "admin.token_set.delete", 409, auth.session.user.id, {
        tokenSetId,
        reason: "published_blocked"
      });
      return jsonResponse(
        {
          ok: false,
          error: "published_blocked",
          requestId: context.requestId
        },
        { status: 409 }
      );
    }

    await clearCachedPublishedLatest();
    await writeAudit(deps.securityRepo, context, request, "admin.token_set.delete", 200, auth.session.user.id, {
      tokenSetId
    });
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        deletedTokenSetId: tokenSetId
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "OPTIONS" && url.pathname === "/public/token-set/latest") {
    return withPublicCorsHeaders(
      new Response(null, {
        status: 204
      })
    );
  }

  if (request.method === "GET" && url.pathname === "/public/token-set/latest") {
    const cached = await getCachedPublishedLatest();
    if (cached) {
      return withPublicCorsHeaders(withBaseHeaders(cached, context.requestId));
    }

    const latest = await deps.securityRepo.getLatestPublishedTokenSet();
    if (!latest) {
      return withPublicCorsHeaders(
        jsonResponse(
          {
            ok: false,
            error: "not_found",
            requestId: context.requestId
          },
          { status: 404 }
        )
      );
    }

    const allScarabs = await deps.securityRepo.listScarabs();
    const scarabNameById = new Map<string, string>(allScarabs.map((scarab) => [scarab.id, scarab.currentText.name]));
    const tokensByName = buildTokensByName(latest, scarabNameById);
    await cachePublishedTokenPayload(latest, tokensByName);
    return withPublicCorsHeaders(
      jsonResponse(
        {
          ok: true,
          requestId: context.requestId,
          versionId: latest.id,
          regexProfile: latest.regexProfileName,
          itemCount: latest.entries.length,
          tokens: latest.entries,
          tokensByName
        },
        { status: 200 }
      )
    );
  }

  if (request.method === "GET" && url.pathname === "/admin/token-sets") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const rawLimit = Number(url.searchParams.get("limit") ?? "30");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 30;
    const sets = await deps.securityRepo.listTokenSets(limit);
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        items: sets
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && getTokenSetActivateRouteId(url.pathname) === null) {
    const tokenSetId = getTokenSetRouteId(url.pathname);
    if (tokenSetId) {
      const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
      if (auth instanceof Response) {
        return auth;
      }
      const tokenSet = await deps.securityRepo.getTokenSetById(tokenSetId);
      if (!tokenSet) {
        return jsonResponse(
          {
            ok: false,
            error: "not_found",
            requestId: context.requestId
          },
          { status: 404 }
        );
      }
      const response = jsonResponse(
        {
          ok: true,
          requestId: context.requestId,
          tokenSet
        },
        { status: 200 }
      );
      return withBaseHeaders(response, context.requestId, responseCookieHeaders);
    }
  }

  if (request.method === "GET" && url.pathname === "/admin/audit-logs") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }

    const rawLimit = Number(url.searchParams.get("limit") ?? "40");
    const logs = await deps.securityRepo.listAuditLogs({
      limit: Number.isFinite(rawLimit) ? rawLimit : 40,
      action: parseNullableString(url.searchParams.get("action")) ?? undefined,
      pathContains: parseNullableString(url.searchParams.get("pathContains")) ?? undefined,
      actorUserId: parseNullableString(url.searchParams.get("actorUserId")) ?? undefined
    });
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        items: logs
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/ops/backups") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_list", 403, auth.session.user.id);
      return ownerOnly;
    }

    if (!deps.db) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_list", 503, auth.session.user.id, {
        reason: "missing_db_binding"
      });
      return jsonResponse(
        {
          ok: false,
          error: "backup_unavailable",
          requestId: context.requestId
        },
        { status: 503 }
      );
    }

    const rawLimit = Number(url.searchParams.get("limit") ?? "10");
    const items = await listBackupSnapshots(deps.db, rawLimit);
    const storagePrefix = `${deps.config.backupObjectPrefix}/${deps.config.appEnv}/`;
    const storageUsage = await computeBackupStorageUsage(deps.backupR2, storagePrefix);
    await writeAudit(deps.securityRepo, context, request, "admin.backup_list", 200, auth.session.user.id, {
      count: items.length,
      storageObjectCount: storageUsage?.objectCount ?? null,
      storageTotalBytes: storageUsage?.totalBytes ?? null
    });
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        backupEnabled: deps.config.backupEnabled,
        backupRetentionDays: deps.config.backupRetentionDays,
        storageUsage,
        items
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/ops/backups/run") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_run", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_run", 403, auth.session.user.id);
      return ownerOnly;
    }

    if (!deps.config.backupEnabled) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_run", 409, auth.session.user.id, {
        reason: "backup_disabled"
      });
      return jsonResponse(
        {
          ok: false,
          error: "backup_disabled",
          requestId: context.requestId
        },
        { status: 409 }
      );
    }

    const snapshot = await runBackupSnapshot(deps, "manual", auth.session.user.id);
    if (!snapshot) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_run", 503, auth.session.user.id, {
        reason: "backup_unavailable"
      });
      return jsonResponse(
        {
          ok: false,
          error: "backup_unavailable",
          requestId: context.requestId
        },
        { status: 503 }
      );
    }

    const statusCode = snapshot.status === "ok" ? 201 : 500;
    await writeAudit(deps.securityRepo, context, request, "admin.backup_run", statusCode, auth.session.user.id, {
      snapshotId: snapshot.id,
      status: snapshot.status,
      itemCount: snapshot.itemCount
    });
    const response = jsonResponse(
      {
        ok: snapshot.status === "ok",
        requestId: context.requestId,
        snapshot
      },
      { status: statusCode }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

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
