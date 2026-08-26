import type { RuntimeConfig } from "../config/env.js";
import type { SecurityRepository } from "../security/repository.js";
import type {
  AdminRole,
  DraftTokenEntry,
  DraftTokenExcludedRetired,
  DraftTokenGenerationReport,
  NewSession,
  PoeRegexViolation,
  PublishedTokenSet,
  ScarabListOptions,
  ScarabStatus,
  ScarabTextInput,
  ScarabTokenInput,
  SessionWithUser
} from "../security/types.js";
import type { TokenGenerationFailure } from "../tokens/generator.js";

export interface RequestContext {
  requestId: string;
  startedAt: number;
}

export interface AuthContext {
  session: SessionWithUser;
}

export interface RouteDeps {
  config: RuntimeConfig;
  securityRepo: SecurityRepository;
  db?: D1Database;
  backupR2?: R2Bucket;
  now: () => Date;
}

interface BaseRouteHelpers {
  authenticateRequest: (
    request: Request,
    deps: RouteDeps,
    context: RequestContext,
    responseCookieHeaders: Headers
  ) => Promise<AuthContext | Response>;
  writeAudit: (
    repo: SecurityRepository,
    context: RequestContext,
    request: Request,
    action: string,
    statusCode: number,
    actorUserId: string | null,
    details?: Record<string, unknown> | null
  ) => Promise<void>;
  jsonResponse: (payload: Record<string, unknown>, init?: ResponseInit) => Response;
  withBaseHeaders: (response: Response, requestId: string, responseHeaders?: Headers) => Response;
  parseJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  parseNullableString: (value: unknown) => string | null;
  requireRoleOrResponse: (auth: AuthContext, role: AdminRole, requestId: string) => Response | null;
}

export interface AuthRouteHelpers extends BaseRouteHelpers {
  enforceRateLimit: (
    repo: SecurityRepository,
    scope: string,
    subject: string,
    windowSeconds: number,
    limit: number,
    now: Date,
    requestId: string
  ) => Promise<Response | null>;
  getClientIp: (request: Request) => string | null;
  verifyPassword: (password: string, salt: string, iterations: number, expectedHash: string) => Promise<boolean>;
  sendOperationalAlert: (config: RuntimeConfig, eventType: OperationalAlertType, payload: Record<string, unknown>) => Promise<void>;
  buildNewSession: (userId: string, request: Request, now: Date, config: RuntimeConfig) => Promise<NewSession>;
  appendSetCookie: (headers: Headers, cookieValue: string) => void;
  createSessionCookie: (config: RuntimeConfig, sessionId: string) => string;
  createCsrfCookie: (config: RuntimeConfig, csrfToken: string) => string;
  clearCookie: (config: RuntimeConfig, name: string, httpOnly: boolean) => string;
  hashPassword: (value: string) => Promise<{ hash: string; salt: string; iterations: number }>;
}

export interface ScarabRouteHelpers extends BaseRouteHelpers {
  parseStatusesFromQuery: (url: URL) => ScarabStatus[] | undefined;
  parseOrderBy: (value: unknown) => "name" | "created" | undefined;
  parseScopedStringFromQuery: (url: URL, key: string) => string | undefined;
  parseScarabTextInput: (body: Record<string, unknown>) => ScarabTextInput | null;
  parseStatus: (value: unknown) => ScarabStatus | null;
  ensureScarabMetadataForeignKeys: (
    deps: RouteDeps,
    leagueId: string | null,
    seasonId: string | null,
    nowIso: string
  ) => Promise<void>;
  getScarabVersionsRouteId: (pathname: string) => string | null;
  getScarabRouteId: (pathname: string) => string | null;
  getScarabRetireRouteId: (pathname: string) => string | null;
  getScarabReactivateRouteId: (pathname: string) => string | null;
  normalizePublishToken: (token: string) => string;
  validateTokenAgainstPoeRegexProfile: (token: string) => PoeRegexViolation | null;
  POE_REGEX_PROFILE_NAME: string;
  withPublicCorsHeaders: (response: Response) => Response;
}

export interface TokenRouteHelpers extends BaseRouteHelpers {
  parseStatusesFromQuery: (url: URL) => ScarabStatus[] | undefined;
  parseOrderBy: (value: unknown) => "name" | "created" | undefined;
  parseScopedStringFromQuery: (url: URL, key: string) => string | undefined;
  normalizePublishToken: (token: string) => string;
  validateTokenAgainstPoeRegexProfile: (token: string) => PoeRegexViolation | null;
  POE_REGEX_PROFILE_NAME: string;
  buildTokensByName: (publishedSet: PublishedTokenSet, scarabNameById: Map<string, string>) => Record<string, string>;
  cachePublishedTokenPayload: (publishedSet: PublishedTokenSet, tokensByName: Record<string, string>) => Promise<void>;
  buildInputFingerprint: (activeInputs: ScarabTokenInput[]) => string;
  generateDraftTokenEntries: (activeInputs: ScarabTokenInput[]) => DraftTokenEntry[];
  buildDraftGenerationReport: (
    entries: DraftTokenEntry[],
    previousByScarab: Map<string, string>,
    excludedRetired: DraftTokenExcludedRetired[]
  ) => DraftTokenGenerationReport;
  TokenGenerationFailure: typeof TokenGenerationFailure;
  getTokenSetActivateRouteId: (pathname: string) => string | null;
  getTokenSetRouteId: (pathname: string) => string | null;
  clearCachedPublishedLatest: () => Promise<void>;
  getCachedPublishedLatest: () => Promise<Response | null>;
  withPublicCorsHeaders: (response: Response) => Response;
  sendOperationalAlert: (config: RuntimeConfig, eventType: OperationalAlertType, payload: Record<string, unknown>) => Promise<void>;
}

export interface OpsRouteHelpers extends BaseRouteHelpers {
  runStagingRefreshFromProduction: (
    deps: RouteDeps,
    initiatedByUserId: string
  ) => Promise<{
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
  }>;
  listBackupSnapshots: (db: D1Database, backupR2: R2Bucket | undefined, limit: number) => Promise<unknown[]>;
  getLatestBackupHealth: (
    db: D1Database
  ) => Promise<{
    id: string;
    triggerType: "manual" | "scheduled";
    status: "ok" | "failed";
    itemCount: number;
    errorMessage: string | null;
    createdAt: string;
  } | null>;
  getLatestBackupCoverage: (
    db: D1Database,
    backupR2: R2Bucket | undefined
  ) => Promise<{
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
  } | null>;
  getMarketBackupSmokeStatus: (
    config: RuntimeConfig
  ) => Promise<{
    ok: boolean;
    testedAt: string | null;
    sourceKey: string | null;
    bytes: number;
    elapsedMs: number;
    error: string | null;
  }>;
  runMarketBackupSmokeTest: (
    config: RuntimeConfig
  ) => Promise<{
    ok: boolean;
    testedAt: string | null;
    sourceKey: string | null;
    bytes: number;
    elapsedMs: number;
    error: string | null;
  }>;
  computeBackupStorageUsage: (
    bucket: R2Bucket | undefined,
    prefix: string
  ) => Promise<{ prefix: string; objectCount: number; totalBytes: number; truncated: boolean } | null>;
  runBackupSnapshot: (
    deps: RouteDeps,
    triggerType: "manual" | "scheduled",
    initiatedByUserId: string | null
  ) => Promise<{ id: string; status: "ok" | "failed"; itemCount: number } | null>;
  restoreBackupSnapshot: (
    deps: RouteDeps,
    snapshotId: string,
    scopes: readonly string[]
  ) => Promise<{
    snapshotId: string;
    restoredKeys: number;
    skippedKeys: number;
    scopes: string[];
    source: "inline" | "external";
  }>;
  getCloudflareUsageSummary: (
    config: RuntimeConfig
  ) => Promise<{
    periodStart: string;
    periodEnd: string;
    metrics: {
      workersRequests: { used: number; limit: number; remaining: number; percent: number };
      kvRead: { used: number; limit: number; remaining: number; percent: number };
      kvWrite: { used: number; limit: number; remaining: number; percent: number };
      kvDelete: { used: number; limit: number; remaining: number; percent: number };
      kvList: { used: number; limit: number; remaining: number; percent: number };
    };
  } | null>;
  getMarketFailureLogs: (
    days: number
  ) => Promise<{
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
  }>;
  getBackupFailureLogs: (
    db: D1Database,
    days: number
  ) => Promise<{
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
  }>;
  runMarketManualRetry: (
    action: string
  ) => Promise<{
    action: string;
    elapsedMs: number;
  }>;
  getMarketBulkNameMap: (
    config: RuntimeConfig
  ) => Promise<{
    map: Record<string, string>;
    updatedAt: string | null;
  }>;
  setMarketBulkNameMap: (
    config: RuntimeConfig,
    map: Record<string, unknown>
  ) => Promise<{
    map: Record<string, string>;
    updatedAt: string | null;
  }>;
  getMarketBulkMismatchLog: (
    config: RuntimeConfig
  ) => Promise<{
    rows: Array<{ rawName: string; qty: number | null; source: string; timestamp: string }>;
    count: number;
  }>;
  clearMarketBulkMismatchLog: (
    config: RuntimeConfig
  ) => Promise<void>;
}

export type OperationalAlertType = "auth_failure" | "publish_failure" | "api_error";

export type { ScarabListOptions };
