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
    jsonResponse,
    withBaseHeaders,
    parseNullableString
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

  return null;
}
