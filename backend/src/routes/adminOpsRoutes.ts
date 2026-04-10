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
    computeBackupStorageUsage,
    runBackupSnapshot,
    getCloudflareUsageSummary,
    getMarketFailureLogs,
    runMarketManualRetry,
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
    try {
      const logs = await getMarketFailureLogs(days);
      await writeAudit(deps.securityRepo, context, request, "admin.failure_logs", 200, auth.session.user.id, {
        days,
        count: logs.count
      });
      const response = jsonResponse(
        {
          ok: true,
          requestId: context.requestId,
          days: logs.days,
          count: logs.count,
          events: logs.events
        },
        { status: 200 }
      );
      return withBaseHeaders(response, context.requestId, responseCookieHeaders);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
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

  return null;
}
