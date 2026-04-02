import { loadConfig, type Env, type RuntimeConfig } from "./config/env.js";
import { captureError, logInfo, logWarn } from "./observability/logger.js";
import { serializeCookie, parseCookieHeader } from "./security/cookies.js";
import { generateToken, hashPassword, verifyPassword } from "./security/crypto.js";
import { D1SecurityRepository, type SecurityRepository } from "./security/repository.js";
import { hasRequiredRole } from "./security/roles.js";
import { getClientIp, isMutationMethod, isSessionExpired, shouldRotateSession } from "./security/session.js";
import type { AdminRole, AuditLogInput, NewSession, SessionWithUser } from "./security/types.js";

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
  now: () => Date;
}

interface RouteDeps {
  config: RuntimeConfig;
  securityRepo: SecurityRepository;
  now: () => Date;
}

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
    }
  };
}

export default createWorker();
