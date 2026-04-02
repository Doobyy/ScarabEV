import assert from "node:assert/strict";
import { createWorker } from "./index.js";
import type { Env, RuntimeConfig } from "./config/env.js";
import type { SecurityRepository } from "./security/repository.js";
import type { AdminUser, AuditLogInput, NewSession, SessionWithUser } from "./security/types.js";
import { hashPassword, verifyPassword } from "./security/crypto.js";

class InMemorySecurityRepository implements SecurityRepository {
  usersByUsername = new Map<string, AdminUser>();
  usersById = new Map<string, AdminUser>();
  sessions = new Map<string, SessionWithUser>();
  auditLogs: AuditLogInput[] = [];
  rateLimits = new Map<string, number>();

  async findAdminUserByUsername(username: string): Promise<AdminUser | null> {
    return this.usersByUsername.get(username) ?? null;
  }

  async findAdminUserById(userId: string): Promise<AdminUser | null> {
    return this.usersById.get(userId) ?? null;
  }

  async updateAdminUserPassword(
    userId: string,
    passwordHash: string,
    passwordSalt: string,
    passwordIterations: number
  ): Promise<void> {
    const user = this.usersById.get(userId);
    if (!user) {
      return;
    }

    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.passwordIterations = passwordIterations;
    this.usersById.set(user.id, user);
    this.usersByUsername.set(user.username, user);
  }

  async findSessionById(sessionId: string): Promise<SessionWithUser | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async createSession(session: NewSession): Promise<void> {
    const user = Array.from(this.usersByUsername.values()).find((entry) => entry.id === session.userId);
    if (!user) {
      throw new Error("unknown user");
    }

    this.sessions.set(session.id, {
      id: session.id,
      userId: session.userId,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      lastRotatedAt: session.lastRotatedAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        isActive: user.isActive
      }
    });
  }

  async touchSession(sessionId: string, expiresAt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.expiresAt = expiresAt;
    this.sessions.set(sessionId, session);
  }

  async revokeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async rotateSession(oldSessionId: string, newSession: NewSession): Promise<void> {
    this.sessions.delete(oldSessionId);
    await this.createSession(newSession);
  }

  async consumeRateLimit(scope: string, subject: string): Promise<{ count: number; retryAfterSeconds: number }> {
    const key = `${scope}:${subject}`;
    const nextCount = (this.rateLimits.get(key) ?? 0) + 1;
    this.rateLimits.set(key, nextCount);
    return {
      count: nextCount,
      retryAfterSeconds: 60
    };
  }

  async writeAuditLog(log: AuditLogInput): Promise<void> {
    this.auditLogs.push(log);
  }
}

function buildConfig(): RuntimeConfig {
  return {
    appName: "scarabev-backend",
    appEnv: "dev",
    logLevel: "error",
    observabilitySampleRate: 1,
    errorSinkDsn: undefined,
    sessionCookieName: "scarabev_session",
    csrfCookieName: "scarabev_csrf",
    sessionTtlSeconds: 3600,
    sessionRotationSeconds: 600,
    authRateLimitWindowSeconds: 300,
    authRateLimitPerIp: 100,
    authRateLimitPerUser: 100,
    adminRateLimitWindowSeconds: 60,
    adminRateLimitPerIp: 100,
    adminRateLimitPerUser: 100
  };
}

const env: Env = {
  APP_NAME: "scarabev-backend",
  APP_ENV: "dev",
  LOG_LEVEL: "debug",
  OBS_SAMPLE_RATE: "1"
};

const executionContext = {} as ExecutionContext;

function makeFixture(): { repo: InMemorySecurityRepository; worker: ReturnType<typeof createWorker> } {
  const repo = new InMemorySecurityRepository();
  const now = new Date("2026-04-02T12:00:00.000Z");
  const worker = createWorker(() => ({
    config: buildConfig(),
    securityRepo: repo,
    now: () => now
  }));
  return { repo, worker };
}

function addUser(repo: InMemorySecurityRepository, user: AdminUser): void {
  repo.usersByUsername.set(user.username, user);
  repo.usersById.set(user.id, user);
}

async function testBlocksUnauthorizedAdminRequests(): Promise<void> {
  const { worker } = makeFixture();
  const response = await worker.fetch!(
    new Request("https://example.com/admin/healthz") as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );

  assert.equal(response.status, 401);
}

async function testOwnerRoleEnforcementAndAuditLogging(): Promise<void> {
  const { repo, worker } = makeFixture();

  const editor: AdminUser = {
    id: "user-editor",
    username: "editor1",
    role: "editor",
    passwordHash: "unused",
    passwordSalt: "unused",
    passwordIterations: 1,
    isActive: true
  };
  addUser(repo, editor);

  repo.sessions.set("session-editor", {
    id: "session-editor",
    userId: editor.id,
    csrfToken: "csrf-editor",
    expiresAt: "2099-01-01T00:00:00.000Z",
    lastRotatedAt: "2098-12-31T23:00:00.000Z",
    user: {
      id: editor.id,
      username: editor.username,
      role: editor.role,
      isActive: true
    }
  });

  const response = await worker.fetch!(
    new Request("https://example.com/admin/owner/ping", {
      method: "POST",
      headers: {
        cookie: "scarabev_session=session-editor; scarabev_csrf=csrf-editor",
        "x-csrf-token": "csrf-editor"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );

  assert.equal(response.status, 403);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.owner_ping" && entry.statusCode === 403), true);
}

async function testRejectsInvalidCsrfOnMutation(): Promise<void> {
  const { repo, worker } = makeFixture();
  const owner: AdminUser = {
    id: "user-owner",
    username: "owner1",
    role: "owner",
    passwordHash: "unused",
    passwordSalt: "unused",
    passwordIterations: 1,
    isActive: true
  };
  addUser(repo, owner);
  repo.sessions.set("session-owner", {
    id: "session-owner",
    userId: owner.id,
    csrfToken: "csrf-owner",
    expiresAt: "2099-01-01T00:00:00.000Z",
    lastRotatedAt: "2098-12-31T23:00:00.000Z",
    user: {
      id: owner.id,
      username: owner.username,
      role: owner.role,
      isActive: true
    }
  });

  const response = await worker.fetch!(
    new Request("https://example.com/admin/owner/ping", {
      method: "POST",
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=wrong",
        "x-csrf-token": "wrong"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );

  assert.equal(response.status, 403);
  const payload = (await response.json()) as { error: string };
  assert.equal(payload.error, "csrf_invalid");
}

async function testRejectsExpiredSessions(): Promise<void> {
  const { repo, worker } = makeFixture();
  const owner: AdminUser = {
    id: "user-owner",
    username: "owner1",
    role: "owner",
    passwordHash: "unused",
    passwordSalt: "unused",
    passwordIterations: 1,
    isActive: true
  };
  addUser(repo, owner);
  repo.sessions.set("expired-session", {
    id: "expired-session",
    userId: owner.id,
    csrfToken: "csrf-owner",
    expiresAt: "2026-04-02T11:00:00.000Z",
    lastRotatedAt: "2026-04-02T10:00:00.000Z",
    user: {
      id: owner.id,
      username: owner.username,
      role: owner.role,
      isActive: true
    }
  });

  const response = await worker.fetch!(
    new Request("https://example.com/admin/auth/session", {
      headers: {
        cookie: "scarabev_session=expired-session; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );

  assert.equal(response.status, 401);
  const payload = (await response.json()) as { error: string };
  assert.equal(payload.error, "session_expired");
}

async function testOwnerCanChangePasswordAndOldPasswordStopsWorking(): Promise<void> {
  const { repo, worker } = makeFixture();
  const initialPassword = "ThisIsTheOldPassword123!";
  const newPassword = "ThisIsTheNewPassword456!";
  const initial = await hashPassword(initialPassword);
  const owner: AdminUser = {
    id: "user-owner-change",
    username: "owner-change",
    role: "owner",
    passwordHash: initial.hash,
    passwordSalt: initial.salt,
    passwordIterations: initial.iterations,
    isActive: true
  };
  addUser(repo, owner);
  repo.sessions.set("session-owner-change", {
    id: "session-owner-change",
    userId: owner.id,
    csrfToken: "csrf-owner-change",
    expiresAt: "2099-01-01T00:00:00.000Z",
    lastRotatedAt: "2098-12-31T23:00:00.000Z",
    user: {
      id: owner.id,
      username: owner.username,
      role: owner.role,
      isActive: true
    }
  });

  const response = await worker.fetch!(
    new Request("https://example.com/admin/owner/change-password", {
      method: "POST",
      headers: {
        cookie: "scarabev_session=session-owner-change; scarabev_csrf=csrf-owner-change",
        "x-csrf-token": "csrf-owner-change",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );

  assert.equal(response.status, 200);
  assert.equal(repo.sessions.has("session-owner-change"), false);
  const updatedOwner = await repo.findAdminUserById(owner.id);
  assert.ok(updatedOwner);
  const oldPasswordStillValid = await verifyPassword(
    initialPassword,
    updatedOwner.passwordSalt,
    updatedOwner.passwordIterations,
    updatedOwner.passwordHash
  );
  const newPasswordValid = await verifyPassword(
    newPassword,
    updatedOwner.passwordSalt,
    updatedOwner.passwordIterations,
    updatedOwner.passwordHash
  );
  assert.equal(oldPasswordStillValid, false);
  assert.equal(newPasswordValid, true);
}

async function run(): Promise<void> {
  await testBlocksUnauthorizedAdminRequests();
  await testOwnerRoleEnforcementAndAuditLogging();
  await testRejectsInvalidCsrfOnMutation();
  await testRejectsExpiredSessions();
  await testOwnerCanChangePasswordAndOldPasswordStopsWorking();
  console.log("Block 2 security checks passed (5 assertion groups).");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
