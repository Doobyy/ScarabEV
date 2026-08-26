import type { RequestContext, RouteDeps, ScarabListOptions, ScarabRouteHelpers } from "./types.js";

export async function handleScarabRoutes(
  request: Request,
  url: URL,
  deps: RouteDeps,
  context: RequestContext,
  responseCookieHeaders: Headers,
  helpers: ScarabRouteHelpers
): Promise<Response | null> {
  const {
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
    withPublicCorsHeaders,
    cachePublicScarabMetadata,
    getCachedPublicScarabMetadata,
    clearCachedPublicScarabMetadata,
  } = helpers;

  if (request.method === "OPTIONS" && url.pathname === "/public/scarabs/metadata") {
    return withPublicCorsHeaders(new Response(null, { status: 204 }));
  }

  if (request.method === "GET" && url.pathname === "/public/scarabs/metadata") {
    const cached = await getCachedPublicScarabMetadata();

    if (cached) {
      const payload = (await cached.json()) as {
        ok: boolean;
        itemCount: number;
        items: Array<{
          id: string;
          name: string;
          groupName: string | null;
          description: string | null;
          modifiers: string[];
          flavorText: string | null;
        }>;
      };

      return withPublicCorsHeaders(
        jsonResponse(
          {
            ...payload,
            requestId: context.requestId
          },
          { status: 200 }
        )
      );
    }

    const scarabs = await deps.securityRepo.listScarabs({
      statuses: ["active"],
      orderBy: "name"
    });

    const items = scarabs.map((scarab) => ({
      id: scarab.id,
      name: scarab.currentText.name,
      groupName: scarab.groupName,
      description: scarab.currentText.description,
      modifiers: scarab.currentText.modifiers || [],
      flavorText: scarab.currentText.flavorText
    }));

    const payload = {
      itemCount: items.length,
      items
    };

    await cachePublicScarabMetadata(payload);

    return withPublicCorsHeaders(
      jsonResponse(
        {
          ok: true,
          requestId: context.requestId,
          ...payload
        },
        { status: 200 }
      )
    );
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
    const groupName = parseNullableString(body.groupName);
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
        groupName,
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

    await clearCachedPublicScarabMetadata();

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
    const groupName = parseNullableString(body.groupName);
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
      groupName,
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

    await clearCachedPublicScarabMetadata();

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

    await clearCachedPublicScarabMetadata();

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

    await clearCachedPublicScarabMetadata();

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
      groupName: null,
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

    await clearCachedPublicScarabMetadata();

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

  return null;

}
