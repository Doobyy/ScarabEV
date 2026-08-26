import type { DraftTokenExcludedRetired, PoeRegexViolation } from "../security/types.js";
import type { RequestContext, RouteDeps, TokenRouteHelpers } from "./types.js";

export async function handleTokenRoutes(
  request: Request,
  url: URL,
  deps: RouteDeps,
  context: RequestContext,
  responseCookieHeaders: Headers,
  helpers: TokenRouteHelpers
): Promise<Response | null> {
  const {
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
  } = helpers;

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

  return null;

}
