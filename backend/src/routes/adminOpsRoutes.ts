import type { OpsRouteHelpers, RequestContext, RouteDeps } from "./types.js";

export async function handleOpsRoutes(
  request: Request,
  url: URL,
  deps: RouteDeps,
  context: RequestContext,
  responseCookieHeaders: Headers,
  helpers: OpsRouteHelpers
): Promise<Response | null> {
  const {
    authenticateRequest,
    writeAudit,
    requireRoleOrResponse,
    listBackupSnapshots,
    getLatestBackupCoverage,
    getMarketBackupSmokeStatus,
    runMarketBackupSmokeTest,
    computeBackupStorageUsage,
    runBackupSnapshot,
    restoreBackupSnapshot,
    getCloudflareUsageSummary,
    getMarketFailureLogs,
    getBackupFailureLogs,
    runMarketManualRetry,
    getMarketBulkNameMap,
    setMarketBulkNameMap,
    getMarketBulkMismatchLog,
    clearMarketBulkMismatchLog,
    jsonResponse,
    withBaseHeaders,
    parseNullableString,
    parseJsonBody
  } = helpers;

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
    const items = await listBackupSnapshots(deps.db, deps.backupR2, rawLimit);
    const latestCoverage = await getLatestBackupCoverage(deps.db, deps.backupR2);
    let backupSmokeStatus: {
      ok: boolean;
      testedAt: string | null;
      sourceKey: string | null;
      bytes: number;
      elapsedMs: number;
      error: string | null;
    } | null = null;
    let backupSmokeStatusError: string | null = null;
    try {
      backupSmokeStatus = await getMarketBackupSmokeStatus(deps.config);
    } catch (error) {
      backupSmokeStatusError = error instanceof Error ? error.message : String(error);
    }
    const storagePrefix = `${deps.config.backupObjectPrefix}/${deps.config.appEnv}/`;
    const storageUsage = await computeBackupStorageUsage(deps.backupR2, storagePrefix);
    await writeAudit(deps.securityRepo, context, request, "admin.backup_list", 200, auth.session.user.id, {
      count: items.length,
      latestCoverageSnapshotId: latestCoverage?.snapshotId ?? null,
      latestCoverageMissingScopes: latestCoverage?.missingScopes?.length ?? null,
      backupSmokeStatusOk: backupSmokeStatus?.ok ?? null,
      backupSmokeStatusAt: backupSmokeStatus?.testedAt ?? null,
      backupSmokeStatusError,
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
        latestCoverage,
        backupSmokeStatus,
        backupSmokeStatusError,
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
    let smokeResult: {
      ok: boolean;
      testedAt: string | null;
      sourceKey: string | null;
      bytes: number;
      elapsedMs: number;
      error: string | null;
    } | null = null;
    let smokeError: string | null = null;
    if (snapshot.status === "ok") {
      try {
        smokeResult = await runMarketBackupSmokeTest(deps.config);
      } catch (error) {
        smokeError = error instanceof Error ? error.message : String(error);
      }
    }
    await writeAudit(deps.securityRepo, context, request, "admin.backup_run", statusCode, auth.session.user.id, {
      snapshotId: snapshot.id,
      status: snapshot.status,
      itemCount: snapshot.itemCount,
      smokeOk: smokeResult?.ok ?? null,
      smokeAt: smokeResult?.testedAt ?? null,
      smokeError
    });
    const response = jsonResponse(
      {
        ok: snapshot.status === "ok",
        requestId: context.requestId,
        snapshot,
        backupSmokeStatus: smokeResult,
        backupSmokeStatusError: smokeError
      },
      { status: statusCode }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/ops/backups/restore") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_restore", auth.status, null);
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_restore", 403, auth.session.user.id);
      return ownerOnly;
    }
    if (!deps.db) {
      await writeAudit(deps.securityRepo, context, request, "admin.backup_restore", 503, auth.session.user.id, {
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

    let snapshotId = "";
    let scopes: string[] = [];
    try {
      const body = await parseJsonBody(request);
      snapshotId = String(body.snapshotId || "").trim();
      scopes = Array.isArray(body.scopes) ? body.scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean) : [];
    } catch (_error) {
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "invalid_body",
            requestId: context.requestId
          },
          { status: 400 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
    if (!snapshotId) {
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "missing_snapshot_id",
            requestId: context.requestId
          },
          { status: 400 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }

    try {
      const result = await restoreBackupSnapshot(deps, snapshotId, scopes);
      await writeAudit(deps.securityRepo, context, request, "admin.backup_restore", 200, auth.session.user.id, {
        snapshotId,
        restoredKeys: result.restoredKeys,
        skippedKeys: result.skippedKeys,
        scopes: result.scopes
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: true,
            requestId: context.requestId,
            restore: result
          },
          { status: 200 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.backup_restore", 503, auth.session.user.id, {
        snapshotId,
        scopes,
        errorDetail: detail
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "backup_restore_failed",
            errorDetail: detail,
            requestId: context.requestId
          },
          { status: 503 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
  }

  if (request.method === "GET" && url.pathname === "/admin/ops/cloudflare-usage") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.cloudflare_usage", 403, auth.session.user.id);
      return ownerOnly;
    }

    let usage = null;
    const storagePrefix = `${deps.config.backupObjectPrefix}/${deps.config.appEnv}/`;
    const r2Storage = await computeBackupStorageUsage(deps.backupR2, storagePrefix);
    let usageError: string | null = null;
    if (!deps.config.cloudflareApiToken || !deps.config.cloudflareAccountId) {
      const missing: string[] = [];
      if (!deps.config.cloudflareApiToken) missing.push("CLOUDFLARE_API_TOKEN");
      if (!deps.config.cloudflareAccountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
      usageError = `missing_env:${missing.join(",")}`;
    }
    try {
      if (!usageError) {
        usage = await getCloudflareUsageSummary(deps.config);
      }
    } catch (error) {
      usageError = error instanceof Error ? error.message : String(error);
    }
    if (!usage) {
      await writeAudit(deps.securityRepo, context, request, "admin.cloudflare_usage", 503, auth.session.user.id, {
        reason: "cloudflare_usage_unavailable",
        errorDetail: usageError
      });
      const response = jsonResponse(
        {
          ok: false,
          error: "cloudflare_usage_unavailable",
          errorDetail: usageError,
          requestId: context.requestId
        },
        { status: 503 }
      );
      return withBaseHeaders(response, context.requestId, responseCookieHeaders);
    }

    await writeAudit(deps.securityRepo, context, request, "admin.cloudflare_usage", 200, auth.session.user.id, {
      workersRequestsUsed: usage.metrics.workersRequests.used,
      kvWriteUsed: usage.metrics.kvWrite.used,
      kvReadUsed: usage.metrics.kvRead.used,
      r2ObjectCount: r2Storage?.objectCount ?? null,
      r2TotalBytes: r2Storage?.totalBytes ?? null
    });

    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        usage,
        r2Storage
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/ops/failure-logs") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.failure_logs", 403, auth.session.user.id);
      return ownerOnly;
    }

    const daysRaw = Number(url.searchParams.get("days") ?? "30");
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, Math.floor(daysRaw))) : 30;
    let marketEvents: Array<{
      date: string;
      at: string | null;
      source: string;
      code: string;
      message: string;
      severity: string;
      context: Record<string, unknown>;
    }> = [];
    let backupEvents: Array<{
      date: string;
      at: string | null;
      source: string;
      code: string;
      message: string;
      severity: string;
      context: Record<string, unknown>;
    }> = [];
    let marketError: string | null = null;
    let backupError: string | null = null;

    try {
      const market = await getMarketFailureLogs(days);
      marketEvents = market.events;
    } catch (error) {
      marketError = error instanceof Error ? error.message : String(error);
    }

    try {
      if (!deps.db) throw new Error("missing_db_binding");
      const backup = await getBackupFailureLogs(deps.db, days);
      backupEvents = backup.events;
    } catch (error) {
      backupError = error instanceof Error ? error.message : String(error);
    }

    const events = [...marketEvents, ...backupEvents].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    const sourceStatus = {
      marketWorker: marketError ? "unavailable" : "ok",
      backendBackup: backupError ? "unavailable" : "ok"
    };

    if (marketError && backupError) {
      const detail = `market:${marketError} | backup:${backupError}`;
      await writeAudit(deps.securityRepo, context, request, "admin.failure_logs", 503, auth.session.user.id, {
        reason: "failure_log_unavailable",
        errorDetail: detail
      });
      const response = jsonResponse(
        {
          ok: false,
          error: "failure_log_unavailable",
          errorDetail: detail,
          requestId: context.requestId
        },
        { status: 503 }
      );
      return withBaseHeaders(response, context.requestId, responseCookieHeaders);
    }

    await writeAudit(deps.securityRepo, context, request, "admin.failure_logs", 200, auth.session.user.id, {
      days,
      count: events.length,
      sourceStatus,
      marketError,
      backupError
    });
    const response = jsonResponse(
      {
        ok: true,
        requestId: context.requestId,
        days,
        count: events.length,
        sourceStatus,
        partial: !!(marketError || backupError),
        sourceErrors: {
          marketWorker: marketError,
          backendBackup: backupError
        },
        events
      },
      { status: 200 }
    );
    return withBaseHeaders(response, context.requestId, responseCookieHeaders);
  }

  if (request.method === "POST" && url.pathname === "/admin/ops/retry") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.manual_retry", 403, auth.session.user.id);
      return ownerOnly;
    }

    let action = "";
    try {
      const body = await parseJsonBody(request);
      action = String(body.action || "").trim().toLowerCase();
    } catch (_error) {
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "invalid_body",
            requestId: context.requestId
          },
          { status: 400 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }

    if (!action) {
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "missing_action",
            requestId: context.requestId
          },
          { status: 400 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }

    try {
      const result = await runMarketManualRetry(action);
      await writeAudit(deps.securityRepo, context, request, "admin.manual_retry", 200, auth.session.user.id, {
        action: result.action,
        elapsedMs: result.elapsedMs
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: true,
            requestId: context.requestId,
            action: result.action,
            elapsedMs: result.elapsedMs
          },
          { status: 200 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.manual_retry", 503, auth.session.user.id, {
        action,
        errorDetail: detail
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "manual_retry_unavailable",
            errorDetail: detail,
            requestId: context.requestId
          },
          { status: 503 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
  }

  if (request.method === "GET" && url.pathname === "/admin/ops/bulk-name-map") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_name_map_get", 403, auth.session.user.id);
      return ownerOnly;
    }
    try {
      const result = await getMarketBulkNameMap(deps.config);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_name_map_get", 200, auth.session.user.id, {
        keyCount: Object.keys(result.map || {}).length,
        updatedAt: result.updatedAt
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: true,
            requestId: context.requestId,
            map: result.map,
            updatedAt: result.updatedAt
          },
          { status: 200 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_name_map_get", 503, auth.session.user.id, {
        errorDetail: detail
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "bulk_name_map_unavailable",
            errorDetail: detail,
            requestId: context.requestId
          },
          { status: 503 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/admin/ops/bulk-name-map") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_name_map_set", 403, auth.session.user.id);
      return ownerOnly;
    }
    let mapBody: Record<string, unknown> = {};
    try {
      const body = await parseJsonBody(request);
      mapBody = body && typeof body.map === "object" && body.map !== null
        ? body.map as Record<string, unknown>
        : {};
    } catch (_error) {
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "invalid_body",
            requestId: context.requestId
          },
          { status: 400 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
    try {
      const result = await setMarketBulkNameMap(deps.config, mapBody);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_name_map_set", 200, auth.session.user.id, {
        keyCount: Object.keys(result.map || {}).length,
        updatedAt: result.updatedAt
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: true,
            requestId: context.requestId,
            map: result.map,
            updatedAt: result.updatedAt
          },
          { status: 200 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_name_map_set", 503, auth.session.user.id, {
        errorDetail: detail
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "bulk_name_map_update_failed",
            errorDetail: detail,
            requestId: context.requestId
          },
          { status: 503 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
  }

  if (request.method === "GET" && url.pathname === "/admin/ops/bulk-mismatch-log") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_mismatch_get", 403, auth.session.user.id);
      return ownerOnly;
    }
    try {
      const result = await getMarketBulkMismatchLog(deps.config);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_mismatch_get", 200, auth.session.user.id, {
        count: result.count
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: true,
            requestId: context.requestId,
            count: result.count,
            rows: result.rows
          },
          { status: 200 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_mismatch_get", 503, auth.session.user.id, {
        errorDetail: detail
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "bulk_mismatch_unavailable",
            errorDetail: detail,
            requestId: context.requestId
          },
          { status: 503 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
  }

  if (request.method === "DELETE" && url.pathname === "/admin/ops/bulk-mismatch-log") {
    const auth = await authenticateRequest(request, deps, context, responseCookieHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const ownerOnly = requireRoleOrResponse(auth, "owner", context.requestId);
    if (ownerOnly) {
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_mismatch_clear", 403, auth.session.user.id);
      return ownerOnly;
    }
    try {
      await clearMarketBulkMismatchLog(deps.config);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_mismatch_clear", 200, auth.session.user.id);
      return withBaseHeaders(
        jsonResponse(
          {
            ok: true,
            requestId: context.requestId
          },
          { status: 200 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await writeAudit(deps.securityRepo, context, request, "admin.bulk_mismatch_clear", 503, auth.session.user.id, {
        errorDetail: detail
      });
      return withBaseHeaders(
        jsonResponse(
          {
            ok: false,
            error: "bulk_mismatch_clear_failed",
            errorDetail: detail,
            requestId: context.requestId
          },
          { status: 503 }
        ),
        context.requestId,
        responseCookieHeaders
      );
    }
  }

  return null;
}
