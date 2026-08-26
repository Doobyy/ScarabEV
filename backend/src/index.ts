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
import type { AuthContext, RequestContext, RouteDeps } from "./routes/types.js";
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

interface RuntimeDeps {
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
      "cache-control": "public, max-age=31536000, immutable"
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
  bytes: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface BackupSnapshotAttempt {
  createdAt: string;
  status: "ok" | "failed";
  errorMessage: string | null;
}

interface BackupStorageUsageSummary {
  prefix: string;
  objectCount: number;
  totalBytes: number;
  truncated: boolean;
}

interface UsageMetricSummary {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
}

interface CloudflareUsageSummary {
  periodStart: string;
  periodEnd: string;
  metrics: {
    workersRequests: UsageMetricSummary;
    kvRead: UsageMetricSummary;
    kvWrite: UsageMetricSummary;
    kvDelete: UsageMetricSummary;
    kvList: UsageMetricSummary;
  };
}

interface CloudflareUsageGraphqlResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: Array<{
          sum?: { requests?: number | null };
        }>;
        kvOperationsAdaptiveGroups?: Array<{
          dimensions?: { actionType?: string | null };
          sum?: { requests?: number | null };
        }>;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

interface MarketFailureLogsResponse {
  ok?: boolean;
  days?: number;
  count?: number;
  events?: Array<{
    date?: string;
    at?: string | null;
    source?: string;
    code?: string;
    message?: string;
    severity?: string;
    context?: Record<string, unknown>;
  }>;
}

interface MarketManualRetryResponse {
  ok?: boolean;
  action?: string;
  elapsedMs?: number;
  error?: string;
}

interface MarketBulkNameMapResponse {
  ok?: boolean;
  map?: Record<string, string>;
  updatedAt?: string | null;
  error?: string;
}

interface MarketBulkMismatchLogResponse {
  ok?: boolean;
  count?: number;
  rows?: Array<{
    rawName?: string;
    qty?: number | null;
    source?: string;
    timestamp?: string;
  }>;
  error?: string;
}

interface MarketBackupCoverageResponse {
  generatedAt?: string;
  totalKeys?: number;
  capped?: boolean;
  maxKeys?: number;
  scopes?: Array<{
    scope?: string;
    keyCount?: number;
    sampleKeys?: string[];
  }>;
}

interface MarketBackupExportResponse {
  ok?: boolean;
  mode?: "summary" | "full";
  scopes?: string[];
  coverage?: MarketBackupCoverageResponse;
  dataByKey?: Record<string, string>;
}

interface MarketBackupImportResponse {
  ok?: boolean;
  dryRun?: boolean;
  scopes?: string[];
  restoredKeys?: number;
  skippedKeys?: number;
}

interface MarketBackupSmokeStatusResponse {
  ok?: boolean;
  status?: {
    ok?: boolean;
    testedAt?: string;
    sourceKey?: string | null;
    bytes?: number;
    elapsedMs?: number;
    error?: string | null;
  } | null;
}

interface MarketBackupSmokeTestResponse {
  ok?: boolean;
  status?: {
    ok?: boolean;
    testedAt?: string;
    sourceKey?: string | null;
    bytes?: number;
    elapsedMs?: number;
    error?: string | null;
  } | null;
}

interface BackupCoverageSummary {
  snapshotId: string;
  createdAt: string;
  source: "inline" | "external" | "unavailable";
  hasMarketWorkerBackup: boolean;
  totalMarketKeys: number;
  missingScopes: string[];
  validationOk: boolean;
  validationErrors: string[];
  scopes: Array<{
    scope: string;
    keyCount: number;
  }>;
  capped: boolean;
}

const MARKET_BACKUP_SCOPES = [
  "price-history",
  "price-history-backup",
  "ev-history",
  "atlas-ev-history",
  "snapshot-state",
  "failure-logs"
] as const;
const MARKET_BACKUP_REQUIRED_SCOPES = [
  "price-history",
  "price-history-backup",
  "ev-history",
  "atlas-ev-history",
  "snapshot-state"
] as const;
const BACKUP_INLINE_PAYLOAD_MAX_BYTES = 900_000;
const BACKUP_CADENCE_MS = 24 * 60 * 60 * 1000;
const BACKUP_CATCHUP_GRACE_MS = 2 * 60 * 60 * 1000;
const BACKUP_CATCHUP_PROBE_INTERVAL_MS = 5 * 60 * 1000;
const MARKET_WORKER_REQUEST_TIMEOUT_MS = 65_000;
const MARKET_WORKER_MANUAL_RETRY_TIMEOUT_MS = 12_000;
const STAGING_REFRESH_D1_TABLES = [
  "leagues",
  "seasons",
  "scarabs",
  "scarab_text_versions",
  "draft_token_sets",
  "draft_token_entries",
  "draft_token_reports",
  "token_sets",
  "token_set_entries"
] as const;
let backupCatchupProbeAt = 0;
let backupCatchupInFlight: Promise<void> | null = null;

interface CloudflareApiEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareD1QueryResult {
  results?: Array<Record<string, unknown>>;
  success?: boolean;
  error?: string;
}

interface StagingRefreshResult {
  startedAt: string;
  finishedAt: string;
  preBackup: {
    attempted: boolean;
    snapshotId: string | null;
    status: "ok" | "failed" | "skipped";
    reason: string | null;
  };
  d1: {
    copiedTables: number;
    copiedRows: number;
    tableCounts: Record<string, number>;
  };
  kv: {
    copiedKeys: number;
    deletedKeys: number;
    sourceKeys: number;
    targetKeysBefore: number;
  };
  postRefresh: {
    cacheAll: { ok: boolean; elapsedMs: number | null; error: string | null };
    snapshotRun: { ok: boolean; elapsedMs: number | null; error: string | null };
  };
  source: {
    d1DatabaseLabel: string | null;
    kvNamespaceLabel: string | null;
  };
  destination: {
    d1DatabaseLabel: string | null;
    kvNamespaceLabel: string | null;
  };
}

function getMarketWorkerAdminHeaders(config: RuntimeConfig): Record<string, string> {
  const token = String(config.marketWorkerAdminToken || "").trim();
  if (!token) {
    throw new Error("market_worker_admin_token_missing");
  }
  return {
    accept: "application/json",
    "x-admin-token": token
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timeout = Math.max(500, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : MARKET_WORKER_REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => {
    try {
      ctl.abort();
    } catch {
      // no-op
    }
  }, timeout);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("request_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildMarketWorkerUrl(config: RuntimeConfig, params: Record<string, string>): string {
  const base = String(config.marketWorkerUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("market_worker_url_missing");
  return `${base}?${new URLSearchParams(params).toString()}`;
}

function assertStagingRefreshConfig(config: RuntimeConfig): {
  accountId: string;
  sourceD1Id: string;
  sourceKvNamespaceId: string;
  targetKvNamespaceId: string;
} {
  if (config.appEnv !== "staging") {
    throw new Error(`staging_refresh_forbidden_env:${config.appEnv}`);
  }
  if (!config.cloudflareApiToken || !config.cloudflareAccountId) {
    throw new Error("staging_refresh_missing_cloudflare_api_env");
  }
  const sourceD1Id = String(config.stagingRefreshSourceD1Id || "").trim();
  const sourceKvNamespaceId = String(config.stagingRefreshSourceKvNamespaceId || "").trim();
  const targetKvNamespaceId = String(config.stagingRefreshTargetKvNamespaceId || "").trim();
  if (!sourceD1Id || !sourceKvNamespaceId || !targetKvNamespaceId) {
    throw new Error("staging_refresh_missing_source_or_target_ids");
  }
  if (sourceKvNamespaceId === targetKvNamespaceId) {
    throw new Error("staging_refresh_invalid_kv_pair_same_namespace");
  }

  const sourceD1Label = String(config.stagingRefreshSourceD1Label || "").toLowerCase();
  const sourceKvLabel = String(config.stagingRefreshSourceKvNamespaceLabel || "").toLowerCase();
  const targetKvLabel = String(config.stagingRefreshTargetKvNamespaceLabel || "").toLowerCase();
  if (sourceD1Label && !/(prod|production)/.test(sourceD1Label)) {
    throw new Error("staging_refresh_source_d1_label_must_indicate_production");
  }
  if (sourceKvLabel && !/(prod|production)/.test(sourceKvLabel)) {
    throw new Error("staging_refresh_source_kv_label_must_indicate_production");
  }
  if (targetKvLabel && !/staging/.test(targetKvLabel)) {
    throw new Error("staging_refresh_target_kv_label_must_indicate_staging");
  }

  return {
    accountId: String(config.cloudflareAccountId || "").trim(),
    sourceD1Id,
    sourceKvNamespaceId,
    targetKvNamespaceId
  };
}

async function cloudflareApiRequest<T>(
  config: RuntimeConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const envelope = await cloudflareApiRequestEnvelope<T>(config, path, init);
  return envelope.result as T;
}

async function cloudflareApiRequestEnvelope<T>(
  config: RuntimeConfig,
  path: string,
  init: RequestInit = {}
): Promise<CloudflareApiEnvelope<T>> {
  const accountId = String(config.cloudflareAccountId || "").trim();
  const apiToken = String(config.cloudflareApiToken || "").trim();
  if (!accountId || !apiToken) {
    throw new Error("cloudflare_api_missing_credentials");
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${apiToken}`);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers
  });
  const payloadText = await response.text().catch(() => "");
  let payload: CloudflareApiEnvelope<T> | null = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) as CloudflareApiEnvelope<T> : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg = payload?.errors?.[0]?.message || payloadText.slice(0, 220) || `http_${response.status}`;
    throw new Error(`cloudflare_api_request_failed:${response.status}:${msg}`);
  }
  if (!payload || payload.success !== true) {
    const msg = payload?.errors?.[0]?.message || payloadText.slice(0, 220) || "invalid_response";
    throw new Error(`cloudflare_api_invalid_response:${msg}`);
  }
  return payload as CloudflareApiEnvelope<T>;
}

function quoteSqlIdentifier(name: string): string {
  const trimmed = String(name || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`invalid_sql_identifier:${trimmed}`);
  }
  return `"${trimmed.replace(/"/g, "\"\"")}"`;
}

async function cloudflareD1Query(
  config: RuntimeConfig,
  databaseId: string,
  sql: string,
  params: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  const result = await cloudflareApiRequest<CloudflareD1QueryResult[]>(
    config,
    `/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        sql,
        params
      })
    }
  );
  const first = Array.isArray(result) ? result[0] : null;
  if (!first) return [];
  if (first.success === false || first.error) {
    throw new Error(`cloudflare_d1_query_failed:${String(first.error || "unknown")}`);
  }
  return Array.isArray(first.results) ? first.results : [];
}

async function cloudflareKvListKeys(config: RuntimeConfig, namespaceId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (cursor) query.set("cursor", cursor);
    const envelope = await cloudflareApiRequestEnvelope<Array<{ name?: string }>>(
      config,
      `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/keys?${query.toString()}`,
      { method: "GET" }
    );
    const rows = Array.isArray(envelope?.result) ? envelope.result : [];
    for (const row of rows) {
      const name = String(row?.name || "");
      if (name) keys.push(name);
    }
    const nextCursor = String((envelope as { result_info?: { cursor?: string } })?.result_info?.cursor || "").trim();
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return keys;
}

async function cloudflareKvGetValue(config: RuntimeConfig, namespaceId: string, key: string): Promise<string> {
  const accountId = String(config.cloudflareAccountId || "").trim();
  const apiToken = String(config.cloudflareApiToken || "").trim();
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiToken}`
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`cloudflare_kv_get_failed:${response.status}:${detail.slice(0, 160)}`);
  }
  return await response.text();
}

async function cloudflareKvBulkGetValues(
  config: RuntimeConfig,
  namespaceId: string,
  keys: string[]
): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const payload = await cloudflareApiRequest<{ values?: Record<string, unknown> }>(
    config,
    `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/bulk/get`,
    {
      method: "POST",
      body: JSON.stringify({
        keys
      })
    }
  );
  const valuesRaw = payload && typeof payload === "object" && payload.values && typeof payload.values === "object"
    ? payload.values
    : {};
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(valuesRaw)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string") values[key] = raw;
    else values[key] = JSON.stringify(raw);
  }
  return values;
}

async function cloudflareKvBulkPutValues(
  config: RuntimeConfig,
  namespaceId: string,
  entries: Array<{ key: string; value: string }>
): Promise<void> {
  if (!entries.length) return;
  await cloudflareApiRequest<unknown>(
    config,
    `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/bulk`,
    {
      method: "PUT",
      body: JSON.stringify(entries)
    }
  );
}

async function cloudflareKvBulkDeleteValues(
  config: RuntimeConfig,
  namespaceId: string,
  keys: string[]
): Promise<void> {
  if (!keys.length) return;
  await cloudflareApiRequest<unknown>(
    config,
    `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/bulk/delete`,
    {
      method: "POST",
      body: JSON.stringify(keys)
    }
  );
}

async function cloudflareKvPutValue(
  config: RuntimeConfig,
  namespaceId: string,
  key: string,
  value: string
): Promise<void> {
  const accountId = String(config.cloudflareAccountId || "").trim();
  const apiToken = String(config.cloudflareApiToken || "").trim();
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "text/plain; charset=utf-8"
    },
    body: value
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`cloudflare_kv_put_failed:${response.status}:${detail.slice(0, 160)}`);
  }
}

async function cloudflareKvDeleteValue(config: RuntimeConfig, namespaceId: string, key: string): Promise<void> {
  await cloudflareApiRequest<unknown>(
    config,
    `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`,
    { method: "DELETE" }
  );
}

async function cloneStagingD1FromProduction(config: RuntimeConfig, db: D1Database): Promise<{
  copiedTables: number;
  copiedRows: number;
  tableCounts: Record<string, number>;
}> {
  const { sourceD1Id } = assertStagingRefreshConfig(config);
  const tableCounts: Record<string, number> = {};
  let copiedRows = 0;

  await db.exec("PRAGMA foreign_keys = OFF;");
  try {
    for (const tableName of [...STAGING_REFRESH_D1_TABLES].reverse()) {
      const tableSql = quoteSqlIdentifier(tableName);
      await db.exec(`DELETE FROM ${tableSql};`);
    }

    for (const tableName of STAGING_REFRESH_D1_TABLES) {
      const tableSql = quoteSqlIdentifier(tableName);
      const columnRows = await cloudflareD1Query(
        config,
        sourceD1Id,
        `PRAGMA table_info(${tableSql});`
      );
      const columns = columnRows
        .map((row) => String(row.name || "").trim())
        .filter((name) => !!name);
      if (columns.length === 0) {
        throw new Error(`staging_refresh_missing_table_schema:${tableName}`);
      }
      const rows = await cloudflareD1Query(config, sourceD1Id, `SELECT * FROM ${tableSql};`);
      tableCounts[tableName] = rows.length;
      copiedRows += rows.length;
      if (!rows.length) continue;

      const quotedColumns = columns.map((col) => quoteSqlIdentifier(col)).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const insertSql = `INSERT INTO ${tableSql} (${quotedColumns}) VALUES (${placeholders})`;
      const statements = rows.map((row) => {
        const values = columns.map((col) => (row as Record<string, unknown>)[col] ?? null);
        return db.prepare(insertSql).bind(...values);
      });
      for (let i = 0; i < statements.length; i += 50) {
        await db.batch(statements.slice(i, i + 50));
      }
    }
  } finally {
    await db.exec("PRAGMA foreign_keys = ON;");
  }

  return {
    copiedTables: STAGING_REFRESH_D1_TABLES.length,
    copiedRows,
    tableCounts
  };
}

async function cloneStagingKvFromProduction(config: RuntimeConfig): Promise<{
  copiedKeys: number;
  deletedKeys: number;
  sourceKeys: number;
  targetKeysBefore: number;
}> {
  const { sourceKvNamespaceId, targetKvNamespaceId } = assertStagingRefreshConfig(config);
  const sourceKeys = await cloudflareKvListKeys(config, sourceKvNamespaceId);
  const targetKeysBefore = await cloudflareKvListKeys(config, targetKvNamespaceId);
  const sourceSet = new Set(sourceKeys);
  let copiedKeys = 0;
  let deletedKeys = 0;

  for (let i = 0; i < sourceKeys.length; i += 100) {
    const chunk = sourceKeys.slice(i, i + 100);
    const bulkValues = await cloudflareKvBulkGetValues(config, sourceKvNamespaceId, chunk);
    const entries = Object.entries(bulkValues).map(([key, value]) => ({ key, value }));
    if (entries.length > 0) {
      await cloudflareKvBulkPutValues(config, targetKvNamespaceId, entries);
      copiedKeys += entries.length;
    }
  }
  const staleKeys = targetKeysBefore.filter((key) => !sourceSet.has(key));
  for (let i = 0; i < staleKeys.length; i += 10_000) {
    const chunk = staleKeys.slice(i, i + 10_000);
    await cloudflareKvBulkDeleteValues(config, targetKvNamespaceId, chunk);
    deletedKeys += chunk.length;
  }

  return {
    copiedKeys,
    deletedKeys,
    sourceKeys: sourceKeys.length,
    targetKeysBefore: targetKeysBefore.length
  };
}

async function runStagingRefreshFromProduction(
  deps: RouteDeps,
  initiatedByUserId: string
): Promise<StagingRefreshResult> {
  if (!deps.db) {
    throw new Error("staging_refresh_missing_db_binding");
  }
  assertStagingRefreshConfig(deps.config);
  const startedAt = deps.now().toISOString();
  const preBackup = {
    attempted: false,
    snapshotId: null as string | null,
    status: "skipped" as "ok" | "failed" | "skipped",
    reason: null as string | null
  };

  if (deps.config.backupEnabled) {
    preBackup.attempted = true;
    const snapshot = await runBackupSnapshot(deps, "manual", initiatedByUserId);
    if (!snapshot) {
      preBackup.status = "failed";
      preBackup.reason = "backup_unavailable";
    } else {
      preBackup.snapshotId = snapshot.id;
      preBackup.status = snapshot.status === "ok" ? "ok" : "failed";
      preBackup.reason = snapshot.errorMessage || null;
    }
  } else {
    preBackup.reason = "backup_disabled";
  }

  const d1 = await cloneStagingD1FromProduction(deps.config, deps.db);
  const kv = await cloneStagingKvFromProduction(deps.config);

  const cacheAll = { ok: false, elapsedMs: null as number | null, error: null as string | null };
  const snapshotRun = { ok: false, elapsedMs: null as number | null, error: null as string | null };
  try {
    const result = await runMarketManualRetry("cache-all", deps.config);
    cacheAll.ok = true;
    cacheAll.elapsedMs = result.elapsedMs;
  } catch (error) {
    cacheAll.error = error instanceof Error ? error.message : String(error);
  }
  try {
    const result = await runMarketManualRetry("snapshot-run", deps.config);
    snapshotRun.ok = true;
    snapshotRun.elapsedMs = result.elapsedMs;
  } catch (error) {
    snapshotRun.error = error instanceof Error ? error.message : String(error);
  }

  return {
    startedAt,
    finishedAt: deps.now().toISOString(),
    preBackup,
    d1,
    kv,
    postRefresh: {
      cacheAll,
      snapshotRun
    },
    source: {
      d1DatabaseLabel: deps.config.stagingRefreshSourceD1Label || null,
      kvNamespaceLabel: deps.config.stagingRefreshSourceKvNamespaceLabel || null
    },
    destination: {
      d1DatabaseLabel: deps.config.d1ResourceLabel || null,
      kvNamespaceLabel: deps.config.stagingRefreshTargetKvNamespaceLabel || null
    }
  };
}

async function getLatestBackupHealth(
  db: D1Database
): Promise<{
  id: string;
  triggerType: "manual" | "scheduled";
  status: "ok" | "failed";
  itemCount: number;
  errorMessage: string | null;
  createdAt: string;
} | null> {
  const row = await db
    .prepare(
      `
      SELECT id, trigger_type, status, item_count, error_message, created_at
      FROM backup_snapshots
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .first<{
      id: string;
      trigger_type: "manual" | "scheduled";
      status: "ok" | "failed";
      item_count: number;
      error_message: string | null;
      created_at: string;
    }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    itemCount: row.item_count,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

async function listBackupSnapshots(
  db: D1Database,
  backupR2: R2Bucket | undefined,
  limit = 10
): Promise<BackupSnapshotSummary[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 10;
  const rows = await db
    .prepare(
      `
      SELECT id, trigger_type, initiated_by_user_id, status, item_count, error_message, created_at
           , external_key, LENGTH(COALESCE(payload_json, '')) AS payload_bytes
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
      payload_bytes: number | null;
      error_message: string | null;
      created_at: string;
    }>();
  const results = rows.results.map((row) => ({
    id: row.id,
    triggerType: row.trigger_type,
    initiatedByUserId: row.initiated_by_user_id,
    status: row.status,
    itemCount: row.item_count,
    externalKey: typeof row.external_key === "string" ? row.external_key : null,
    bytes: Math.max(0, Number(row.payload_bytes) || 0),
    errorMessage: row.error_message,
    createdAt: row.created_at
  }));
  if (!backupR2) {
    return results;
  }
  await Promise.all(
    results.map(async (row) => {
      if (!row.externalKey) return;
      try {
        const object = await backupR2.head(row.externalKey);
        if (object && Number.isFinite(object.size)) {
          row.bytes = Math.max(0, Number(object.size) || 0);
        }
      } catch {
        // Keep inline byte estimate when object head is unavailable.
      }
    })
  );
  return results;
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

function buildUsageMetric(usedRaw: number, limit: number): UsageMetricSummary {
  const used = Math.max(0, Math.floor(Number.isFinite(usedRaw) ? usedRaw : 0));
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return {
    used,
    limit,
    remaining,
    percent
  };
}

async function getCloudflareUsageSummary(config: RuntimeConfig): Promise<CloudflareUsageSummary | null> {
  if (!config.cloudflareApiToken || !config.cloudflareAccountId) {
    return null;
  }

  const periodStart = new Date();
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date();

  const startDate = periodStart.toISOString().slice(0, 10);
  const endDate = periodEnd.toISOString().slice(0, 10);
  const startDateTime = periodStart.toISOString();
  const endDateTime = periodEnd.toISOString();
  const accountTagRaw = String(config.cloudflareAccountId);
  const accountTag = accountTagRaw
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/"/g, "")
    .trim();
  if (!/^[a-f0-9]{32}$/i.test(accountTag)) {
    throw new Error("cloudflare_usage_invalid_account_id_format");
  }
  const accountTagLiteral = JSON.stringify(accountTag);
  const query = `
    {
      viewer {
        accounts(filter: { accountTag: ${accountTagLiteral} }) {
          workersInvocationsAdaptive(
            limit: 10000
            filter: { datetime_geq: "${startDateTime}", datetime_leq: "${endDateTime}" }
          ) {
            sum {
              requests
            }
          }
          kvOperationsAdaptiveGroups(
            limit: 10000
            filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
          ) {
            dimensions {
              actionType
            }
            sum {
              requests
            }
          }
        }
      }
    }
  `;

  const graphqlResponse = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.cloudflareApiToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query
    })
  });

  if (!graphqlResponse.ok) {
    let bodySnippet = "";
    try {
      const body = await graphqlResponse.text();
      bodySnippet = body.slice(0, 240).replace(/\s+/g, " ").trim();
    } catch {
      bodySnippet = "";
    }
    throw new Error(
      `cloudflare_usage_request_failed:${graphqlResponse.status}${bodySnippet ? `:${bodySnippet}` : ""}`
    );
  }

  const payload = (await graphqlResponse.json()) as CloudflareUsageGraphqlResponse;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors[0]?.message || "unknown_graphql_error";
    throw new Error(`cloudflare_usage_graphql_error:${message}`);
  }

  const account = payload.data?.viewer?.accounts?.[0];
  if (!account) {
    throw new Error("cloudflare_usage_missing_account_data");
  }

  const workersRequestsUsed = (account.workersInvocationsAdaptive || []).reduce((acc, row) => {
    return acc + Math.max(0, Number(row?.sum?.requests) || 0);
  }, 0);

  let kvReadUsed = 0;
  let kvWriteUsed = 0;
  let kvDeleteUsed = 0;
  let kvListUsed = 0;
  for (const row of account.kvOperationsAdaptiveGroups || []) {
    const action = String(row?.dimensions?.actionType || "").toLowerCase();
    const requests = Math.max(0, Number(row?.sum?.requests) || 0);
    if (action === "read") kvReadUsed += requests;
    else if (action === "write") kvWriteUsed += requests;
    else if (action === "delete") kvDeleteUsed += requests;
    else if (action === "list") kvListUsed += requests;
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    metrics: {
      workersRequests: buildUsageMetric(workersRequestsUsed, 100000),
      kvRead: buildUsageMetric(kvReadUsed, 100000),
      kvWrite: buildUsageMetric(kvWriteUsed, 1000),
      kvDelete: buildUsageMetric(kvDeleteUsed, 1000),
      kvList: buildUsageMetric(kvListUsed, 1000)
    }
  };
}

async function getMarketFailureLogs(daysRaw: number, config: RuntimeConfig): Promise<{
  days: number;
  count: number;
  events: Array<{
    date: string;
    at: string | null;
    source: string;
    code: string;
    message: string;
    severity: string;
    context: Record<string, unknown>;
  }>;
}> {
  const days = Math.max(1, Math.min(30, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));
  const url = buildMarketWorkerUrl(config, {
    type: "FailureLogs",
    days: String(days)
  });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "GET", headers }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_failure_logs_request_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketFailureLogsResponse;
  if (!payload || payload.ok !== true || !Array.isArray(payload.events)) {
    throw new Error("market_failure_logs_invalid_payload");
  }
  const events = payload.events.map((event) => ({
    date: String(event?.date || ""),
    at: event?.at ? String(event.at) : null,
    source: String(event?.source || "market-worker"),
    code: String(event?.code || "unknown_error"),
    message: String(event?.message || ""),
    severity: String(event?.severity || "error"),
    context: event?.context && typeof event.context === "object" ? event.context : {}
  }));
  return {
    days: Math.max(1, Math.min(30, Number(payload.days) || days)),
    count: Math.max(0, Number(payload.count) || events.length),
    events
  };
}

async function getBackupFailureLogs(db: D1Database, daysRaw: number): Promise<{
  days: number;
  count: number;
  events: Array<{
    date: string;
    at: string | null;
    source: string;
    code: string;
    message: string;
    severity: string;
    context: Record<string, unknown>;
  }>;
}> {
  const days = Math.max(1, Math.min(30, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(
      `
      SELECT id, trigger_type, initiated_by_user_id, item_count, error_message, created_at, status, payload_json, external_key
      FROM backup_snapshots
      WHERE created_at >= ?1
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    `
    )
    .bind(cutoffIso)
    .all<{
      id: string;
      trigger_type: string;
      initiated_by_user_id: string | null;
      item_count: number | null;
      error_message: string | null;
      created_at: string;
      status: string;
      payload_json: string | null;
      external_key: string | null;
    }>();

  const events: Array<{
    date: string;
    at: string | null;
    source: string;
    code: string;
    message: string;
    severity: string;
    context: Record<string, unknown>;
  }> = [];
  const coverageBySnapshot = new Map<string, {
    totalKeys: number;
    missingScopes: string[];
    hasMarketWorkerBackup: boolean;
    validationOk: boolean;
    validationErrors: string[];
    coverageMissing: boolean;
  }>();
  let newestGoodCoverageAt: string | null = null;

  for (const row of rows.results) {
    const status = String(row.status || "").toLowerCase();
    if (status !== "ok") continue;
    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(String(row.payload_json || "{}"));
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
    } catch {
      payload = null;
    }
    const marketBackup = payload?.marketWorkerBackup && typeof payload.marketWorkerBackup === "object"
      ? payload.marketWorkerBackup as {
        coverage?: {
          totalKeys?: number;
          scopes?: Array<{ scope?: string; keyCount?: number }>;
        };
      }
      : null;
    const coverage = marketBackup?.coverage && typeof marketBackup.coverage === "object" ? marketBackup.coverage : null;
    const scopeRows = Array.isArray(coverage?.scopes) ? coverage.scopes : [];
    const keyedScopes = new Set(
      scopeRows
        .map((entry) => ({
          scope: String(entry?.scope || ""),
          keyCount: Math.max(0, Number(entry?.keyCount) || 0)
        }))
        .filter((entry) => entry.scope.length > 0 && entry.keyCount > 0)
        .map((entry) => entry.scope)
    );
    const missingScopes = MARKET_BACKUP_REQUIRED_SCOPES.filter((scope) => !keyedScopes.has(scope));
    const totalKeys = Math.max(0, Number(coverage?.totalKeys) || 0);
    const validation = payload?.marketWorkerBackupValidation && typeof payload.marketWorkerBackupValidation === "object"
      ? payload.marketWorkerBackupValidation as { ok?: boolean; errors?: string[] }
      : null;
    const validationErrors = Array.isArray(validation?.errors) ? validation.errors.map((entry) => String(entry || "")).filter(Boolean) : [];
    const validationOk = validation?.ok !== false;
    const coverageMissing = !marketBackup || totalKeys <= 0 || missingScopes.length > 0 || !validationOk;
    coverageBySnapshot.set(row.id, {
      totalKeys,
      missingScopes,
      hasMarketWorkerBackup: !!marketBackup,
      validationOk,
      validationErrors,
      coverageMissing
    });
    if (!coverageMissing) {
      const createdAt = String(row.created_at || "");
      if (createdAt && (!newestGoodCoverageAt || createdAt > newestGoodCoverageAt)) {
        newestGoodCoverageAt = createdAt;
      }
    }
  }

  for (const row of rows.results) {
    const baseContext = {
      snapshotId: row.id,
      triggerType: String(row.trigger_type || "unknown"),
      initiatedByUserId: row.initiated_by_user_id,
      itemCount: Number(row.item_count) || 0,
      externalKey: row.external_key ? String(row.external_key) : null
    };
    const status = String(row.status || "").toLowerCase();
    if (status === "failed") {
      events.push({
        date: String(row.created_at || "").slice(0, 10),
        at: row.created_at ? String(row.created_at) : null,
        source: "backend-backup",
        code: "backup_snapshot_failed",
        message: String(row.error_message || "Backup snapshot failed."),
        severity: "error",
        context: baseContext
      });
      continue;
    }
    if (status !== "ok") {
      continue;
    }

    const coverageInfo = coverageBySnapshot.get(row.id);
    const totalKeys = Math.max(0, Number(coverageInfo?.totalKeys) || 0);
    const missingScopes = Array.isArray(coverageInfo?.missingScopes) ? coverageInfo!.missingScopes : [];
    const validationErrors = Array.isArray(coverageInfo?.validationErrors) ? coverageInfo!.validationErrors : [];
    const hasMarketWorkerBackup = !!coverageInfo?.hasMarketWorkerBackup;
    const validationOk = coverageInfo?.validationOk !== false;
    const coverageMissing = !!coverageInfo?.coverageMissing;
    const createdAt = String(row.created_at || "");
    const legacyCoverageNoise = !!(coverageMissing && newestGoodCoverageAt && createdAt && createdAt < newestGoodCoverageAt);
    if (coverageMissing && !legacyCoverageNoise) {
      events.push({
        date: String(row.created_at || "").slice(0, 10),
        at: row.created_at ? String(row.created_at) : null,
        source: "backend-backup",
        code: "backup_snapshot_coverage_missing",
        message: "Backup snapshot completed but market-worker coverage is incomplete.",
        severity: "warn",
        context: {
          ...baseContext,
          totalKeys,
          missingScopes,
          hasMarketWorkerBackup,
          validationOk,
          validationErrors
        }
      });
    }
  }
  return {
    days,
    count: events.length,
    events
  };
}

async function runMarketManualRetry(actionRaw: string, config: RuntimeConfig): Promise<{
  action: string;
  elapsedMs: number;
}> {
  const action = String(actionRaw || "").trim().toLowerCase();
  const allowed = new Set([
    "snapshot-retry",
    "snapshot-run",
    "cache-current-league",
    "cache-current-market",
    "cache-standard-market",
    "cache-all",
    "clear-failure-logs",
    "price-history-backfill-enable-once",
    "price-history-backfill-disable"
  ]);
  if (!allowed.has(action)) throw new Error(`manual_retry_invalid_action:${action}`);
  const url = buildMarketWorkerUrl(config, {
    type: "ManualRetry",
    action
  });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "GET", headers }, MARKET_WORKER_MANUAL_RETRY_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`manual_retry_request_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketManualRetryResponse;
  if (!payload || payload.ok !== true) {
    throw new Error(`manual_retry_failed:${String(payload?.error || "unknown_error")}`);
  }
  return {
    action: String(payload.action || action),
    elapsedMs: Math.max(0, Number(payload.elapsedMs) || 0)
  };
}

async function getMarketBulkNameMap(config: RuntimeConfig): Promise<{
  map: Record<string, string>;
  updatedAt: string | null;
}> {
  const url = buildMarketWorkerUrl(config, { type: "BulkNameMap" });
  const res = await fetchWithTimeout(url, { method: "GET" }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_bulk_name_map_get_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketBulkNameMapResponse;
  if (!payload || payload.ok !== true) {
    throw new Error(`market_bulk_name_map_get_invalid:${String(payload?.error || "unknown_error")}`);
  }
  const mapRaw = payload.map && typeof payload.map === "object" ? payload.map : {};
  const map: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(mapRaw)) {
    const key = String(rawKey || "").trim().toLowerCase();
    const value = String(rawValue || "").trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  return {
    map,
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : null
  };
}

async function setMarketBulkNameMap(
  config: RuntimeConfig,
  mapInput: Record<string, unknown>
): Promise<{
  map: Record<string, string>;
  updatedAt: string | null;
}> {
  const map: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(mapInput || {})) {
    const key = String(rawKey || "").trim().toLowerCase();
    const value = String(rawValue || "").trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  const url = buildMarketWorkerUrl(config, { type: "BulkNameMap" });
  const headers = {
    ...getMarketWorkerAdminHeaders(config),
    "content-type": "application/json"
  };
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ map })
  }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  const text = await res.text().catch(() => "");
  let payload: MarketBulkNameMapResponse | null = null;
  try {
    payload = JSON.parse(text) as MarketBulkNameMapResponse;
  } catch {
    payload = null;
  }
  if (!res.ok || !payload || payload.ok !== true) {
    throw new Error(`market_bulk_name_map_set_failed:${res.status}:${text.slice(0, 160)}`);
  }
  const returnedRaw = payload.map && typeof payload.map === "object" ? payload.map : {};
  const returned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(returnedRaw)) {
    const key = String(rawKey || "").trim().toLowerCase();
    const value = String(rawValue || "").trim();
    if (!key || !value) continue;
    returned[key] = value;
  }
  return {
    map: returned,
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : null
  };
}

async function getMarketBulkMismatchLog(config: RuntimeConfig): Promise<{
  rows: Array<{ rawName: string; qty: number | null; source: string; timestamp: string }>;
  count: number;
}> {
  const url = buildMarketWorkerUrl(config, { type: "BulkMismatchLog" });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "GET", headers }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_bulk_mismatch_get_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketBulkMismatchLogResponse;
  if (!payload || payload.ok !== true || !Array.isArray(payload.rows)) {
    throw new Error(`market_bulk_mismatch_get_invalid:${String(payload?.error || "unknown_error")}`);
  }
  const rows = payload.rows.map((row) => ({
    rawName: String(row?.rawName || "").trim(),
    qty: Number.isFinite(Number(row?.qty)) ? Math.max(0, Number(row?.qty) || 0) : null,
    source: String(row?.source || "unknown").trim() || "unknown",
    timestamp: String(row?.timestamp || "")
  })).filter((row) => row.rawName.length > 0);
  return {
    rows,
    count: Math.max(0, Number(payload.count) || rows.length)
  };
}

async function clearMarketBulkMismatchLog(config: RuntimeConfig): Promise<void> {
  const url = buildMarketWorkerUrl(config, { type: "BulkMismatchLog" });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "DELETE", headers }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_bulk_mismatch_clear_failed:${res.status}:${body.slice(0, 160)}`);
  }
}

function validateMarketBackupData(
  exportPayload: {
    coverage: {
      totalKeys: number;
      scopes: Array<{ scope: string; keyCount: number; sampleKeys: string[] }>;
    };
    dataByKey: Record<string, string>;
  }
): {
  ok: boolean;
  errors: string[];
  missingRequiredScopes: string[];
} {
  const scopeRows = Array.isArray(exportPayload.coverage?.scopes) ? exportPayload.coverage.scopes : [];
  const keyedScopes = new Set(
    scopeRows
      .map((entry) => ({
        scope: String(entry?.scope || ""),
        keyCount: Math.max(0, Number(entry?.keyCount) || 0)
      }))
      .filter((entry) => entry.scope.length > 0 && entry.keyCount > 0)
      .map((entry) => entry.scope)
  );
  const missingRequiredScopes = MARKET_BACKUP_REQUIRED_SCOPES.filter((scope) => !keyedScopes.has(scope));
  const errors: string[] = [];
  if (missingRequiredScopes.length > 0) {
    errors.push(`missing_required_scopes:${missingRequiredScopes.join(",")}`);
  }
  if (!exportPayload.coverage || Math.max(0, Number(exportPayload.coverage.totalKeys) || 0) <= 0) {
    errors.push("total_keys_zero");
  }
  const dataByKey = exportPayload.dataByKey && typeof exportPayload.dataByKey === "object" ? exportPayload.dataByKey : {};
  const parseJson = (value: unknown): unknown | null => {
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return null;
    }
  };
  const entries = Object.entries(dataByKey);
  for (const [key, raw] of entries) {
    const parsed = parseJson(raw);
    if (parsed === null) {
      errors.push(`invalid_json:${key}`);
      continue;
    }
    if (key.startsWith("ev-history-") || key.startsWith("atlas-ev-history-")) {
      if (!Array.isArray(parsed) || parsed.length === 0) {
        errors.push(`invalid_series:${key}`);
      }
    } else if (key.startsWith("price-history-") || key.startsWith("price-history-backup-")) {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed as Record<string, unknown>).length === 0) {
        errors.push(`invalid_price_map:${key}`);
      }
    } else if (key.startsWith(`${"market-cache-v2"}:snapshot-`)) {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push(`invalid_snapshot_state:${key}`);
      }
    }
    if (errors.length >= 20) break;
  }
  return {
    ok: errors.length === 0,
    errors,
    missingRequiredScopes
  };
}

async function getMarketBackupSmokeStatus(config: RuntimeConfig): Promise<{
  ok: boolean;
  testedAt: string | null;
  sourceKey: string | null;
  bytes: number;
  elapsedMs: number;
  error: string | null;
}> {
  const url = buildMarketWorkerUrl(config, { type: "BackupSmokeStatus" });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "GET", headers }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_backup_smoke_status_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketBackupSmokeStatusResponse;
  const status = payload?.status || null;
  return {
    ok: !!status?.ok,
    testedAt: status?.testedAt ? String(status.testedAt) : null,
    sourceKey: status?.sourceKey ? String(status.sourceKey) : null,
    bytes: Math.max(0, Number(status?.bytes) || 0),
    elapsedMs: Math.max(0, Number(status?.elapsedMs) || 0),
    error: status?.error ? String(status.error) : null
  };
}

async function runMarketBackupSmokeTest(config: RuntimeConfig): Promise<{
  ok: boolean;
  testedAt: string | null;
  sourceKey: string | null;
  bytes: number;
  elapsedMs: number;
  error: string | null;
}> {
  const url = buildMarketWorkerUrl(config, { type: "BackupSmokeTest" });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "GET", headers }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  const text = await res.text().catch(() => "");
  let payload: MarketBackupSmokeTestResponse | null = null;
  try {
    payload = JSON.parse(text) as MarketBackupSmokeTestResponse;
  } catch {
    payload = null;
  }
  const status = payload?.status || null;
  if (!res.ok && !status) {
    throw new Error(`market_backup_smoke_test_failed:${res.status}:${text.slice(0, 160)}`);
  }
  return {
    ok: !!status?.ok && !!res.ok,
    testedAt: status?.testedAt ? String(status.testedAt) : null,
    sourceKey: status?.sourceKey ? String(status.sourceKey) : null,
    bytes: Math.max(0, Number(status?.bytes) || 0),
    elapsedMs: Math.max(0, Number(status?.elapsedMs) || 0),
    error: status?.error ? String(status.error) : (!res.ok ? `http_${res.status}` : null)
  };
}

async function getMarketBackupExport(
  config: RuntimeConfig,
  mode: "summary" | "full",
  scopes: readonly string[] = MARKET_BACKUP_SCOPES
): Promise<{
  scopes: string[];
  coverage: {
    generatedAt: string;
    totalKeys: number;
    capped: boolean;
    maxKeys: number;
    scopes: Array<{ scope: string; keyCount: number; sampleKeys: string[] }>;
  };
  dataByKey: Record<string, string>;
}> {
  const requestedScopes = [...new Set(scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean))];
  const url = buildMarketWorkerUrl(config, {
    type: "BackupExport",
    mode,
    scopes: requestedScopes.join(",")
  });
  const headers = getMarketWorkerAdminHeaders(config);
  const res = await fetchWithTimeout(url, { method: "GET", headers }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_backup_export_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketBackupExportResponse;
  if (!payload || payload.ok !== true || !payload.coverage) {
    throw new Error("market_backup_export_invalid_payload");
  }
  const scopeRows = Array.isArray(payload.coverage.scopes) ? payload.coverage.scopes : [];
  const normalizedScopes = scopeRows.map((entry) => ({
    scope: String(entry?.scope || ""),
    keyCount: Math.max(0, Number(entry?.keyCount) || 0),
    sampleKeys: Array.isArray(entry?.sampleKeys) ? entry.sampleKeys.map((s) => String(s || "")).filter(Boolean).slice(0, 5) : []
  }));
  return {
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map((scope) => String(scope || "")).filter(Boolean) : requestedScopes,
    coverage: {
      generatedAt: String(payload.coverage.generatedAt || new Date().toISOString()),
      totalKeys: Math.max(0, Number(payload.coverage.totalKeys) || 0),
      capped: !!payload.coverage.capped,
      maxKeys: Math.max(1, Number(payload.coverage.maxKeys) || 1),
      scopes: normalizedScopes
    },
    dataByKey: payload.dataByKey && typeof payload.dataByKey === "object" ? payload.dataByKey : {}
  };
}

async function runMarketBackupImport(
  config: RuntimeConfig,
  dataByKey: Record<string, string>,
  scopes: readonly string[]
): Promise<{ restoredKeys: number; skippedKeys: number; scopes: string[] }> {
  const selectedScopes = [...new Set(scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean))];
  const headers = {
    ...getMarketWorkerAdminHeaders(config),
    "content-type": "application/json"
  };
  const res = await fetchWithTimeout(buildMarketWorkerUrl(config, { type: "BackupImport" }), {
    method: "POST",
    headers,
    body: JSON.stringify({
      scopes: selectedScopes,
      dataByKey
    })
  }, MARKET_WORKER_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`market_backup_import_failed:${res.status}:${body.slice(0, 160)}`);
  }
  const payload = (await res.json()) as MarketBackupImportResponse;
  if (!payload || payload.ok !== true) {
    throw new Error("market_backup_import_invalid_payload");
  }
  return {
    restoredKeys: Math.max(0, Number(payload.restoredKeys) || 0),
    skippedKeys: Math.max(0, Number(payload.skippedKeys) || 0),
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map((scope) => String(scope || "")).filter(Boolean) : selectedScopes
  };
}

function buildBackupCoverageSummary(
  snapshotId: string,
  createdAt: string,
  payload: Record<string, unknown> | null,
  source: "inline" | "external" | "unavailable"
): BackupCoverageSummary {
  const backup = payload?.marketWorkerBackup && typeof payload.marketWorkerBackup === "object"
    ? payload.marketWorkerBackup as {
      coverage?: {
        totalKeys?: number;
        capped?: boolean;
        scopes?: Array<{ scope?: string; keyCount?: number }>;
      };
    }
    : null;
  const coverage = backup?.coverage && typeof backup.coverage === "object" ? backup.coverage : null;
  const scopeRows = Array.isArray(coverage?.scopes) ? coverage.scopes : [];
  const normalizedScopes = scopeRows
    .map((entry) => ({
      scope: String(entry?.scope || ""),
      keyCount: Math.max(0, Number(entry?.keyCount) || 0)
    }))
    .filter((entry) => entry.scope.length > 0);
  const presentSet = new Set(normalizedScopes.filter((entry) => entry.keyCount > 0).map((entry) => entry.scope));
  const missingScopes = MARKET_BACKUP_REQUIRED_SCOPES.filter((scope) => !presentSet.has(scope));
  const validation = payload?.marketWorkerBackupValidation && typeof payload.marketWorkerBackupValidation === "object"
    ? payload.marketWorkerBackupValidation as { ok?: boolean; errors?: string[] }
    : null;
  const validationOk = !!backup && validation?.ok !== false;
  const validationErrors = Array.isArray(validation?.errors)
    ? validation.errors.map((entry) => String(entry || "")).filter(Boolean)
    : [];
  return {
    snapshotId,
    createdAt,
    source,
    hasMarketWorkerBackup: !!backup,
    totalMarketKeys: Math.max(0, Number(coverage?.totalKeys) || normalizedScopes.reduce((sum, entry) => sum + entry.keyCount, 0)),
    missingScopes,
    validationOk,
    validationErrors,
    scopes: normalizedScopes,
    capped: !!coverage?.capped
  };
}

async function loadBackupPayload(
  db: D1Database,
  backupR2: R2Bucket | undefined,
  snapshotId: string
): Promise<{ payload: Record<string, unknown>; source: "inline" | "external" }> {
  const row = await db
    .prepare(
      `
      SELECT id, status, payload_json, external_key
      FROM backup_snapshots
      WHERE id = ?1
      LIMIT 1
    `
    )
    .bind(snapshotId)
    .first<{
      id: string;
      status: string;
      payload_json: string | null;
      external_key: string | null;
    }>();
  if (!row) {
    throw new Error("snapshot_not_found");
  }
  if (String(row.status || "").toLowerCase() !== "ok") {
    throw new Error("snapshot_not_restorable");
  }

  if (row.external_key) {
    if (!backupR2) throw new Error("backup_external_storage_unavailable");
    const object = await backupR2.get(row.external_key);
    if (!object) throw new Error("backup_external_object_not_found");
    const text = await object.text();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") throw new Error("backup_external_payload_invalid");
    return {
      payload: parsed,
      source: "external"
    };
  }

  const inlineRaw = String(row.payload_json || "{}");
  const parsed = JSON.parse(inlineRaw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") throw new Error("backup_inline_payload_invalid");
  return {
    payload: parsed,
    source: "inline"
  };
}

async function getLatestBackupCoverage(
  db: D1Database,
  backupR2: R2Bucket | undefined
): Promise<BackupCoverageSummary | null> {
  const latest = await db
    .prepare(
      `
      SELECT id, created_at
      FROM backup_snapshots
      WHERE status = 'ok'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .first<{ id: string; created_at: string }>();
  if (!latest) return null;
  try {
    const loaded = await loadBackupPayload(db, backupR2, latest.id);
    return buildBackupCoverageSummary(latest.id, latest.created_at, loaded.payload, loaded.source);
  } catch (_error) {
    return buildBackupCoverageSummary(latest.id, latest.created_at, null, "unavailable");
  }
}

async function restoreBackupSnapshot(
  deps: RouteDeps,
  snapshotId: string,
  scopes: readonly string[]
): Promise<{
  snapshotId: string;
  restoredKeys: number;
  skippedKeys: number;
  scopes: string[];
  source: "inline" | "external";
}> {
  if (!deps.db) {
    throw new Error("backup_unavailable");
  }
  const requestedScopes = [...new Set(scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean))];
  const safeScopes = requestedScopes.length
    ? requestedScopes.filter((scope) => (MARKET_BACKUP_SCOPES as readonly string[]).includes(scope))
    : [...MARKET_BACKUP_SCOPES];
  if (!safeScopes.length) throw new Error("restore_invalid_scopes");

  const loaded = await loadBackupPayload(deps.db, deps.backupR2, snapshotId);
  const marketBackup = loaded.payload.marketWorkerBackup && typeof loaded.payload.marketWorkerBackup === "object"
    ? loaded.payload.marketWorkerBackup as { dataByKey?: Record<string, string> }
    : null;
  const dataByKey = marketBackup?.dataByKey && typeof marketBackup.dataByKey === "object"
    ? marketBackup.dataByKey
    : {};
  if (!Object.keys(dataByKey).length) {
    throw new Error("restore_market_backup_missing_data");
  }
  const restored = await runMarketBackupImport(deps.config, dataByKey, safeScopes);
  return {
    snapshotId,
    restoredKeys: restored.restoredKeys,
    skippedKeys: restored.skippedKeys,
    scopes: restored.scopes,
    source: loaded.source
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

async function pruneOldBackupSnapshots(db: D1Database, cutoffIso: string): Promise<void> {
  await db
    .prepare(
      `
      DELETE FROM backup_snapshots
      WHERE created_at < ?1
    `
    )
    .bind(cutoffIso)
    .run();
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
    const [payloadRows, marketBackup] = await Promise.all([
      collectBackupRows(deps.db),
      getMarketBackupExport(deps.config, "full", MARKET_BACKUP_SCOPES)
    ]);
    const backupValidation = validateMarketBackupData(marketBackup);
    if (!backupValidation.ok) {
      throw new Error(`market_backup_validation_failed:${backupValidation.errors.join("|").slice(0, 700)}`);
    }
    const d1ItemCount = Object.values(payloadRows).reduce((acc, rows) => acc + rows.length, 0);
    const marketItemCount = Math.max(0, Number(marketBackup.coverage.totalKeys) || 0);
    const totalItems = d1ItemCount + marketItemCount;
    const payload = {
      schemaVersion: "block9_v1",
      capturedAt: nowIso,
      environment: deps.config.appEnv,
      summary: {
        d1ItemCount,
        marketItemCount
      },
      rows: payloadRows,
      marketWorkerBackup: {
        scopes: marketBackup.scopes,
        coverage: marketBackup.coverage,
        dataByKey: marketBackup.dataByKey
      },
      marketWorkerBackupValidation: {
        ok: backupValidation.ok,
        errors: backupValidation.errors,
        missingRequiredScopes: backupValidation.missingRequiredScopes
      }
    };
    const payloadText = JSON.stringify(payload);

    let externalKey: string | null = null;
    if (deps.backupR2) {
      const compactTs = nowIso.replace(/[-:.TZ]/g, "").slice(0, 14);
      externalKey = `${deps.config.backupObjectPrefix}/${deps.config.appEnv}/${compactTs}_${snapshotId}.json`;
      await deps.backupR2.put(externalKey, payloadText, {
        httpMetadata: {
          contentType: "application/json"
        }
      });
    } else if (deps.config.backupRequireExternal) {
      throw new Error("backup_external_required_but_not_configured");
    }

    if (payloadText.length > BACKUP_INLINE_PAYLOAD_MAX_BYTES && !externalKey) {
      throw new Error("backup_payload_too_large_without_external");
    }
    const inlinePayload = payloadText.length <= BACKUP_INLINE_PAYLOAD_MAX_BYTES
      ? payloadText
      : JSON.stringify({
        schemaVersion: "block9_v1",
        capturedAt: nowIso,
        environment: deps.config.appEnv,
        summary: {
          d1ItemCount,
          marketItemCount
        },
        marketWorkerBackup: {
          scopes: marketBackup.scopes,
          coverage: marketBackup.coverage,
          dataByKey: {}
        },
        marketWorkerBackupValidation: {
          ok: backupValidation.ok,
          errors: backupValidation.errors,
          missingRequiredScopes: backupValidation.missingRequiredScopes
        },
        externalized: true,
        note: "Full backup payload stored in external object."
      });

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
      .bind(snapshotId, triggerType, initiatedByUserId, totalItems, externalKey, inlinePayload, nowIso)
      .run();

    const cutoffIso = new Date(deps.now().getTime() - deps.config.backupRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    await pruneOldBackupSnapshots(deps.db, cutoffIso);

    return {
      id: snapshotId,
      triggerType,
      initiatedByUserId,
      status: "ok",
      itemCount: totalItems,
      externalKey,
      bytes: payloadText.length,
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
    const cutoffIso = new Date(deps.now().getTime() - deps.config.backupRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      await pruneOldBackupSnapshots(deps.db, cutoffIso);
    } catch {
      // Best-effort cleanup; preserve original failure result.
    }

    return {
      id: snapshotId,
      triggerType,
      initiatedByUserId,
      status: "failed",
      itemCount: 0,
      externalKey: null,
      bytes: 0,
      errorMessage: err.message,
      createdAt: nowIso
    };
  }
}

async function getLatestSuccessfulBackupCreatedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `
      SELECT created_at
      FROM backup_snapshots
      WHERE status = 'ok'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .first<{ created_at: string | null }>();
  if (!row || typeof row.created_at !== "string" || !row.created_at) return null;
  return row.created_at;
}

async function getLatestBackupAttempt(db: D1Database): Promise<BackupSnapshotAttempt | null> {
  const row = await db
    .prepare(
      `
      SELECT created_at, status, error_message
      FROM backup_snapshots
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .first<{ created_at: string | null; status: string | null; error_message: string | null }>();
  if (!row || typeof row.created_at !== "string" || !row.created_at) return null;
  return {
    createdAt: row.created_at,
    status: String(row.status || "").toLowerCase() === "failed" ? "failed" : "ok",
    errorMessage: row.error_message ? String(row.error_message) : null
  };
}

function isNonRetryableBackupFailure(errorMessage: string | null): boolean {
  const message = String(errorMessage || "").trim().toLowerCase();
  if (!message) return false;
  return message.includes("market_worker_admin_token_missing")
    || message.includes("backup_external_required_but_not_configured");
}

function isBackupCatchupDue(
  latestOkCreatedAt: string | null,
  latestAttempt: BackupSnapshotAttempt | null,
  now: Date
): boolean {
  const cadenceWindowMs = BACKUP_CADENCE_MS + BACKUP_CATCHUP_GRACE_MS;
  if (
    latestAttempt
    && latestAttempt.status === "failed"
    && isNonRetryableBackupFailure(latestAttempt.errorMessage)
  ) {
    const latestAttemptMs = Date.parse(latestAttempt.createdAt);
    if (Number.isFinite(latestAttemptMs) && (now.getTime() - latestAttemptMs) < cadenceWindowMs) {
      return false;
    }
  }
  if (!latestOkCreatedAt) return true;
  const latestMs = Date.parse(latestOkCreatedAt);
  if (!Number.isFinite(latestMs)) return true;
  return now.getTime() - latestMs >= cadenceWindowMs;
}

async function runScheduledBackupFlow(runtimeDeps: RuntimeDeps, source: "cron" | "catchup"): Promise<void> {
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
      reason: "backup_unavailable",
      source
    });
    return;
  }

  if (snapshot.status === "ok") {
    try {
      const smoke = await runMarketBackupSmokeTest(runtimeDeps.config);
      if (!smoke.ok) {
        logWarn(runtimeDeps.config, "backup.smoke_failed", {
          snapshotId: snapshot.id,
          testedAt: smoke.testedAt,
          error: smoke.error,
          source
        });
      } else {
        logInfo(runtimeDeps.config, "backup.smoke_passed", {
          snapshotId: snapshot.id,
          testedAt: smoke.testedAt,
          elapsedMs: smoke.elapsedMs,
          source
        });
      }
    } catch (error) {
      logWarn(runtimeDeps.config, "backup.smoke_unavailable", {
        snapshotId: snapshot.id,
        error: error instanceof Error ? error.message : String(error),
        source
      });
    }
    logInfo(runtimeDeps.config, "backup.completed", {
      snapshotId: snapshot.id,
      itemCount: snapshot.itemCount,
      source
    });
    return;
  }

  logWarn(runtimeDeps.config, "backup.failed", {
    snapshotId: snapshot.id,
    errorMessage: snapshot.errorMessage,
    source
  });
}

async function maybeStartBackupCatchup(runtimeDeps: RuntimeDeps, ctx?: ExecutionContext): Promise<void> {
  if (!runtimeDeps.config.backupEnabled || !runtimeDeps.config.backupCronEnabled || !runtimeDeps.db) {
    return;
  }
  const now = runtimeDeps.now();
  if (now.getTime() - backupCatchupProbeAt < BACKUP_CATCHUP_PROBE_INTERVAL_MS) {
    return;
  }
  backupCatchupProbeAt = now.getTime();
  if (backupCatchupInFlight) {
    return;
  }

  backupCatchupInFlight = (async () => {
    try {
      const latestOkCreatedAt = await getLatestSuccessfulBackupCreatedAt(runtimeDeps.db as D1Database);
      const latestAttempt = await getLatestBackupAttempt(runtimeDeps.db as D1Database);
      if (!isBackupCatchupDue(latestOkCreatedAt, latestAttempt, runtimeDeps.now())) {
        return;
      }
      logWarn(runtimeDeps.config, "backup.catchup_due", {
        latestOkCreatedAt,
        latestAttemptAt: latestAttempt?.createdAt || null,
        latestAttemptStatus: latestAttempt?.status || null,
        latestAttemptError: latestAttempt?.errorMessage || null,
        targetCadenceMs: BACKUP_CADENCE_MS,
        graceMs: BACKUP_CATCHUP_GRACE_MS
      });
      await runScheduledBackupFlow(runtimeDeps, "catchup");
    } catch (error) {
      logWarn(runtimeDeps.config, "backup.catchup_error", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      backupCatchupInFlight = null;
    }
  })();

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(backupCatchupInFlight);
    return;
  }
  await backupCatchupInFlight;
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
    hashPassword,
    parseNullableString
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
    POE_REGEX_PROFILE_NAME,
    withPublicCorsHeaders
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
    runStagingRefreshFromProduction,
    listBackupSnapshots: (db: D1Database, backupR2: R2Bucket | undefined, limit: number) => listBackupSnapshots(db, backupR2, limit),
    getLatestBackupHealth: (db: D1Database) => getLatestBackupHealth(db),
    getLatestBackupCoverage,
    getMarketBackupSmokeStatus: (config: RuntimeConfig) => getMarketBackupSmokeStatus(config),
    runMarketBackupSmokeTest: (config: RuntimeConfig) => runMarketBackupSmokeTest(config),
    computeBackupStorageUsage,
    runBackupSnapshot,
    restoreBackupSnapshot,
    getCloudflareUsageSummary,
    getMarketFailureLogs: (days: number) => getMarketFailureLogs(days, deps.config),
    getBackupFailureLogs: (db: D1Database, days: number) => getBackupFailureLogs(db, days),
    runMarketManualRetry: (action: string) => runMarketManualRetry(action, deps.config),
    getMarketBulkNameMap: (config: RuntimeConfig) => getMarketBulkNameMap(config),
    setMarketBulkNameMap: (config: RuntimeConfig, map: Record<string, unknown>) => setMarketBulkNameMap(config, map),
    getMarketBulkMismatchLog: (config: RuntimeConfig) => getMarketBulkMismatchLog(config),
    clearMarketBulkMismatchLog: (config: RuntimeConfig) => clearMarketBulkMismatchLog(config),
    jsonResponse,
    withBaseHeaders,
    parseNullableString,
    parseJsonBody
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
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const reqCtx = createContext();
      const runtimeDeps = depsFactory(env);

      await maybeStartBackupCatchup(runtimeDeps, ctx);

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
      if (!runtimeDeps.config.backupEnabled || !runtimeDeps.config.backupCronEnabled) {
        return;
      }
      await runScheduledBackupFlow(runtimeDeps, "cron");
    }
  };
}

export default createWorker();
