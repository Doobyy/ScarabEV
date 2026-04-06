import type { AuthRouteHelpers, RequestContext, RouteDeps } from "./types.js";

export async function handleAuthRoutes(
  request: Request,
  url: URL,
  deps: RouteDeps,
  context: RequestContext,
  responseCookieHeaders: Headers,
  helpers: AuthRouteHelpers
): Promise<Response | null> {
  const {
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
  } = helpers;

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

  return null;

}
