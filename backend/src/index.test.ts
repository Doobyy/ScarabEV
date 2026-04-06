import assert from "node:assert/strict";
import { createWorker } from "./index.js";
import type { Env, RuntimeConfig } from "./config/env.js";
import type { SecurityRepository } from "./security/repository.js";
import type {
  AdminUser,
  AuditLogRecord,
  AuditLogInput,
  AuditLogQueryOptions,
  CreateScarabInput,
  DraftTokenSet,
  NewSession,
  PublishTokenSetInput,
  PublishedTokenSet,
  PersistDraftTokenSetInput,
  Scarab,
  ScarabListOptions,
  ScarabStatus,
  ScarabTextVersion,
  ScarabTokenInput,
  SessionWithUser,
  UpdateScarabInput
} from "./security/types.js";
import { hashPassword, verifyPassword } from "./security/crypto.js";
import { getPoeRegexProfileConstructs } from "./tokens/poeRegexProfile.js";

class InMemorySecurityRepository implements SecurityRepository {
  usersByUsername = new Map<string, AdminUser>();
  usersById = new Map<string, AdminUser>();
  sessions = new Map<string, SessionWithUser>();
  auditLogs: AuditLogInput[] = [];
  rateLimits = new Map<string, number>();
  scarabs = new Map<string, Scarab>();
  scarabVersions = new Map<string, ScarabTextVersion[]>();
  draftTokenSets: DraftTokenSet[] = [];
  tokenSets: PublishedTokenSet[] = [];

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

  async createScarab(input: CreateScarabInput): Promise<Scarab> {
    const currentText: ScarabTextVersion = {
      id: crypto.randomUUID(),
      scarabId: input.id,
      version: 1,
      name: input.name,
      description: input.description,
      modifiers: [...input.modifiers],
      flavorText: input.flavorText,
      changeNote: input.changeNote,
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt
    };
    const scarab: Scarab = {
      id: input.id,
      status: input.status,
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      retiredLeagueId: null,
      retiredSeasonId: null,
      retirementNote: null,
      retiredAt: null,
      reactivatedAt: null,
      currentTextVersion: 1,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      currentText
    };

    this.scarabs.set(input.id, scarab);
    this.scarabVersions.set(input.id, [currentText]);
    return scarab;
  }

  async listScarabs(options?: ScarabListOptions): Promise<Scarab[]> {
    const statuses = options?.statuses;
    const hasLeagueFilter = options?.leagueId !== undefined;
    const hasSeasonFilter = options?.seasonId !== undefined;
    const filtered = Array.from(this.scarabs.values()).filter((scarab) =>
      (statuses?.length ? statuses.includes(scarab.status) : true) &&
      (!hasLeagueFilter || scarab.leagueId === options?.leagueId) &&
      (!hasSeasonFilter || scarab.seasonId === options?.seasonId)
    );
    return filtered.sort((a, b) => {
      if (options?.orderBy === "created") {
        const createdSort = a.createdAt.localeCompare(b.createdAt);
        if (createdSort !== 0) {
          return createdSort;
        }
        return a.id.localeCompare(b.id);
      }
      const nameSort = a.currentText.name.toLowerCase().localeCompare(b.currentText.name.toLowerCase());
      if (nameSort !== 0) {
        return nameSort;
      }
      return a.id.localeCompare(b.id);
    });
  }

  async findScarabById(scarabId: string): Promise<Scarab | null> {
    return this.scarabs.get(scarabId) ?? null;
  }

  async listScarabTextVersions(scarabId: string): Promise<ScarabTextVersion[]> {
    return [...(this.scarabVersions.get(scarabId) ?? [])].sort((a, b) => b.version - a.version);
  }

  async updateScarab(input: UpdateScarabInput): Promise<Scarab | null> {
    const existing = this.scarabs.get(input.scarabId);
    if (!existing || existing.status === "retired") {
      return null;
    }

    const textChanged =
      existing.currentText.name !== input.text.name ||
      existing.currentText.description !== input.text.description ||
      existing.currentText.flavorText !== input.text.flavorText ||
      existing.currentText.modifiers.length !== input.text.modifiers.length ||
      existing.currentText.modifiers.some((modifier, index) => modifier !== input.text.modifiers[index]);
    const metadataChanged =
      existing.status !== input.status || existing.leagueId !== input.leagueId || existing.seasonId !== input.seasonId;

    if (!textChanged && !metadataChanged) {
      return existing;
    }

    let nextText = existing.currentText;
    let nextVersion = existing.currentTextVersion;
    if (textChanged) {
      nextVersion = existing.currentTextVersion + 1;
      nextText = {
        id: crypto.randomUUID(),
        scarabId: input.scarabId,
        version: nextVersion,
        name: input.text.name,
        description: input.text.description,
        modifiers: [...input.text.modifiers],
        flavorText: input.text.flavorText,
        changeNote: input.changeNote,
        createdByUserId: input.actorUserId,
        createdAt: input.updatedAt
      };
      const versions = this.scarabVersions.get(input.scarabId) ?? [];
      versions.push(nextText);
      this.scarabVersions.set(input.scarabId, versions);
    }

    const updated: Scarab = {
      ...existing,
      status: input.status,
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      currentTextVersion: nextVersion,
      updatedByUserId: input.actorUserId,
      updatedAt: input.updatedAt,
      currentText: nextText
    };
    this.scarabs.set(updated.id, updated);
    return updated;
  }

  async deleteScarab(scarabId: string): Promise<boolean> {
    const existing = this.scarabs.get(scarabId);
    if (!existing) {
      return false;
    }
    this.scarabs.delete(scarabId);
    this.scarabVersions.delete(scarabId);
    this.draftTokenSets = this.draftTokenSets.map((set) => ({
      ...set,
      entries: set.entries.filter((entry) => entry.scarabId !== scarabId)
    }));
    this.tokenSets = this.tokenSets.map((set) => ({
      ...set,
      entries: set.entries.filter((entry) => entry.scarabId !== scarabId)
    }));
    return true;
  }

  async retireScarab(input: {
    scarabId: string;
    retiredLeagueId: string | null;
    retiredSeasonId: string | null;
    retirementNote: string | null;
    actorUserId: string;
    retiredAt: string;
  }): Promise<Scarab | null> {
    const existing = this.scarabs.get(input.scarabId);
    if (!existing) {
      return null;
    }

    const retired: Scarab = {
      ...existing,
      status: "retired",
      retiredLeagueId: input.retiredLeagueId,
      retiredSeasonId: input.retiredSeasonId,
      retirementNote: input.retirementNote,
      retiredAt: input.retiredAt,
      updatedByUserId: input.actorUserId,
      updatedAt: input.retiredAt
    };
    this.scarabs.set(retired.id, retired);
    return retired;
  }

  async reactivateScarab(input: {
    scarabId: string;
    leagueId: string | null;
    seasonId: string | null;
    actorUserId: string;
    reactivatedAt: string;
  }): Promise<Scarab | null> {
    const existing = this.scarabs.get(input.scarabId);
    if (!existing) {
      return null;
    }

    const reactivated: Scarab = {
      ...existing,
      status: "active",
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      reactivatedAt: input.reactivatedAt,
      updatedByUserId: input.actorUserId,
      updatedAt: input.reactivatedAt
    };
    this.scarabs.set(reactivated.id, reactivated);
    return reactivated;
  }

  async listTokenGenerationInputs(
    statuses: ScarabStatus[] = ["active"],
    scope?: { leagueId?: string | null; seasonId?: string | null; orderBy?: "name" | "created" }
  ): Promise<ScarabTokenInput[]> {
    const hasLeagueFilter = scope?.leagueId !== undefined;
    const hasSeasonFilter = scope?.seasonId !== undefined;
    return Array.from(this.scarabs.values())
      .filter(
        (scarab) =>
          statuses.includes(scarab.status) &&
          (!hasLeagueFilter || scarab.leagueId === scope?.leagueId) &&
          (!hasSeasonFilter || scarab.seasonId === scope?.seasonId)
      )
      .sort((a, b) => {
        if (scope?.orderBy === "created") {
          const createdSort = a.createdAt.localeCompare(b.createdAt);
          if (createdSort !== 0) {
            return createdSort;
          }
          return a.id.localeCompare(b.id);
        }
        const nameSort = a.currentText.name.toLowerCase().localeCompare(b.currentText.name.toLowerCase());
        if (nameSort !== 0) {
          return nameSort;
        }
        return a.id.localeCompare(b.id);
      })
      .map((scarab) => ({
        scarabId: scarab.id,
        status: scarab.status,
        name: scarab.currentText.name,
        description: scarab.currentText.description,
        modifiers: scarab.currentText.modifiers,
        flavorText: scarab.currentText.flavorText
      }));
  }

  async saveDraftTokenSet(input: PersistDraftTokenSetInput): Promise<DraftTokenSet> {
    const persisted: DraftTokenSet = {
      id: input.id,
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt,
      inputFingerprint: input.inputFingerprint,
      itemCount: input.entries.length,
      entries: input.entries.map((entry) => ({ ...entry })),
      report: {
        collisions: input.report.collisions.map((entry) => ({ ...entry, scarabIds: [...entry.scarabIds] })),
        lowConfidence: input.report.lowConfidence.map((entry) => ({ ...entry })),
        changedTokens: input.report.changedTokens.map((entry) => ({ ...entry })),
        excludedRetiredScarabs: input.report.excludedRetiredScarabs.map((entry) => ({ ...entry }))
      }
    };
    this.draftTokenSets.push(persisted);
    return persisted;
  }

  async getLatestDraftTokenSet(): Promise<DraftTokenSet | null> {
    return this.draftTokenSets.length > 0 ? this.draftTokenSets[this.draftTokenSets.length - 1] : null;
  }

  async listLatestDraftTokensByScarabIds(scarabIds: string[]): Promise<Map<string, string>> {
    const latest = await this.getLatestDraftTokenSet();
    if (!latest) {
      return new Map();
    }
    const ids = new Set(scarabIds);
    const mapped = new Map<string, string>();
    for (const entry of latest.entries) {
      if (ids.has(entry.scarabId)) {
        mapped.set(entry.scarabId, entry.token);
      }
    }
    return mapped;
  }

  async publishTokenSet(input: PublishTokenSetInput): Promise<PublishedTokenSet> {
    this.tokenSets = this.tokenSets.map((set) =>
      set.state === "published" ? { ...set, state: "archived", archivedAt: input.publishedAt } : set
    );
    const published: PublishedTokenSet = {
      id: input.id,
      state: "published",
      sourceDraftSetId: input.sourceDraftSetId,
      regexProfileName: input.regexProfileName,
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt,
      publishedAt: input.publishedAt,
      archivedAt: null,
      entries: input.entries.map((entry) => ({ ...entry }))
    };
    this.tokenSets.push(published);
    return published;
  }

  async getLatestPublishedTokenSet(): Promise<PublishedTokenSet | null> {
    const published = this.tokenSets.filter((set) => set.state === "published");
    if (published.length === 0) {
      return null;
    }
    return published[published.length - 1];
  }

  async getTokenSetById(tokenSetId: string): Promise<PublishedTokenSet | null> {
    return this.tokenSets.find((set) => set.id === tokenSetId) ?? null;
  }

  async activatePublishedTokenSet(tokenSetId: string, activatedAt: string): Promise<PublishedTokenSet | null> {
    const target = this.tokenSets.find((set) => set.id === tokenSetId);
    if (!target) {
      return null;
    }

    this.tokenSets = this.tokenSets.map((set) => {
      if (set.state === "published") {
        return { ...set, state: "archived", archivedAt: activatedAt };
      }
      if (set.id === tokenSetId) {
        return { ...set, state: "published", publishedAt: activatedAt, archivedAt: null };
      }
      return set;
    });

    return this.tokenSets.find((set) => set.id === tokenSetId) ?? null;
  }

  async deleteTokenSet(tokenSetId: string): Promise<"deleted" | "not_found" | "published_blocked"> {
    const idx = this.tokenSets.findIndex((set) => set.id === tokenSetId);
    if (idx === -1) {
      return "not_found";
    }
    if (this.tokenSets[idx].state === "published") {
      return "published_blocked";
    }
    this.tokenSets.splice(idx, 1);
    return "deleted";
  }

  async listTokenSets(limit: number): Promise<PublishedTokenSet[]> {
    return [...this.tokenSets].slice(-Math.max(1, Math.min(limit, 100))).reverse();
  }

  async listAuditLogs(options: AuditLogQueryOptions): Promise<AuditLogRecord[]> {
    const filtered = this.auditLogs
      .filter((row) => (options.action ? row.action === options.action : true))
      .filter((row) => (options.pathContains ? row.path.includes(options.pathContains) : true))
      .filter((row) => (options.actorUserId ? row.actorUserId === options.actorUserId : true))
      .slice(0, Math.max(1, Math.min(options.limit, 200)));
    return filtered.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorUsername: row.actorUserId
        ? this.usersById.get(row.actorUserId)?.username ?? null
        : null,
      action: row.action,
      method: row.method,
      path: row.path,
      statusCode: row.statusCode,
      requestId: row.requestId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      detailsJson: row.detailsJson,
      createdAt: "2026-04-02T12:00:00.000Z"
    }));
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
    adminRateLimitPerUser: 100,
    backupEnabled: false,
    backupRetentionDays: 14,
    backupRequireExternal: false,
    backupObjectPrefix: "snapshots"
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

function addOwnerSession(repo: InMemorySecurityRepository, userId = "user-owner", username = "owner1"): void {
  const owner: AdminUser = {
    id: userId,
    username,
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
}

function authHeaders(): HeadersInit {
  return {
    cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner",
    "x-csrf-token": "csrf-owner"
  };
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
  addOwnerSession(repo);

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

async function testScarabLifecycleCrudAndTokenScope(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const createResponse = await worker.fetch!(
    new Request("https://example.com/admin/scarabs", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Abyssal Relic",
        description: "Adds monsters",
        modifiers: ["extra packs", "rare monsters"],
        flavorText: "Depths call",
        leagueId: "league-necro",
        seasonId: "season-01",
        changeNote: "initial create"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(createResponse.status, 201);
  const createdPayload = (await createResponse.json()) as { scarab: Scarab };
  const scarabId = createdPayload.scarab.id;

  const updateResponse = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabId}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Abyssal Relic Prime",
        description: "Adds more monsters",
        modifiers: ["extra packs", "rare monsters", "tormented"],
        flavorText: "Depths roar",
        leagueId: "league-necro",
        seasonId: "season-01",
        changeNote: "balance pass"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(updateResponse.status, 200);
  const updatedPayload = (await updateResponse.json()) as { scarab: Scarab };
  assert.equal(updatedPayload.scarab.currentTextVersion, 2);

  const noChangeUpdateResponse = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabId}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Abyssal Relic Prime",
        description: "Adds more monsters",
        modifiers: ["extra packs", "rare monsters", "tormented"],
        flavorText: "Depths roar",
        leagueId: "league-necro",
        seasonId: "season-01",
        changeNote: "no-op save"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(noChangeUpdateResponse.status, 200);
  const noChangePayload = (await noChangeUpdateResponse.json()) as { scarab: Scarab };
  assert.equal(noChangePayload.scarab.currentTextVersion, 2);

  const versionsResponse = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabId}/versions`, {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(versionsResponse.status, 200);
  const versionsPayload = (await versionsResponse.json()) as { versions: ScarabTextVersion[] };
  assert.equal(versionsPayload.versions.length, 2);

  const retireResponse = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabId}/retire`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        retiredLeagueId: "league-necro",
        retiredSeasonId: "season-01",
        retirementNote: "legacy now"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(retireResponse.status, 200);

  const tokenInputsAfterRetire = await worker.fetch!(
    new Request("https://example.com/admin/scarabs/token-inputs", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(tokenInputsAfterRetire.status, 200);
  const tokenPayloadAfterRetire = (await tokenInputsAfterRetire.json()) as {
    items: Array<{ scarabId: string }>;
  };
  assert.equal(tokenPayloadAfterRetire.items.some((entry) => entry.scarabId === scarabId), false);

  const versionsAfterRetire = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabId}/versions`, {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(versionsAfterRetire.status, 200);
  const retiredVersionsPayload = (await versionsAfterRetire.json()) as {
    scarab: { status: ScarabStatus };
    versions: ScarabTextVersion[];
  };
  assert.equal(retiredVersionsPayload.scarab.status, "retired");
  assert.equal(retiredVersionsPayload.versions.length, 2);

  const reactivateResponse = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabId}/reactivate`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        leagueId: "league-necro",
        seasonId: "season-02"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(reactivateResponse.status, 200);

  const tokenInputsAfterReactivate = await worker.fetch!(
    new Request("https://example.com/admin/scarabs/token-inputs", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(tokenInputsAfterReactivate.status, 200);
  const tokenPayloadAfterReactivate = (await tokenInputsAfterReactivate.json()) as {
    items: Array<{ scarabId: string }>;
  };
  assert.equal(tokenPayloadAfterReactivate.items.some((entry) => entry.scarabId === scarabId), true);

  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.scarab.create" && entry.statusCode === 201), true);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.scarab.update" && entry.statusCode === 200), true);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.scarab.retire" && entry.statusCode === 200), true);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.scarab.reactivate" && entry.statusCode === 200), true);
}

async function testActiveListIsDeterministic(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const payloads = [
    { name: "Zenith Scarab", status: "active" },
    { name: "alpha scarab", status: "active" },
    { name: "Alpha Scarab", status: "active" }
  ];

  for (const payload of payloads) {
    const response = await worker.fetch!(
      new Request("https://example.com/admin/scarabs", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...payload,
          modifiers: []
        })
      }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
      env,
      executionContext
    );
    assert.equal(response.status, 201);
  }

  const firstListResponse = await worker.fetch!(
    new Request("https://example.com/admin/scarabs?status=active", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  const secondListResponse = await worker.fetch!(
    new Request("https://example.com/admin/scarabs?status=active", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(firstListResponse.status, 200);
  assert.equal(secondListResponse.status, 200);

  const firstPayload = (await firstListResponse.json()) as { items: Array<{ id: string; currentText: { name: string } }> };
  const secondPayload = (await secondListResponse.json()) as {
    items: Array<{ id: string; currentText: { name: string } }>;
  };
  assert.deepEqual(
    firstPayload.items.map((entry) => entry.id),
    secondPayload.items.map((entry) => entry.id)
  );
}

async function testScopedListAndScopedDraftGeneration(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const create = async (name: string, seasonId: string | null): Promise<void> => {
    const response = await worker.fetch!(
      new Request("https://example.com/admin/scarabs", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          status: "active",
          name,
          description: null,
          modifiers: ["contains test packs"],
          flavorText: null,
          leagueId: null,
          seasonId
        })
      }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
      env,
      executionContext
    );
    assert.equal(response.status, 201);
  };

  await create("Scoped Scarab A", "custom-v1");
  await create("Baseline Scarab B", null);

  const scopedListResponse = await worker.fetch!(
    new Request("https://example.com/admin/scarabs?status=active&seasonId=custom-v1", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(scopedListResponse.status, 200);
  const scopedListPayload = (await scopedListResponse.json()) as { items: Scarab[] };
  assert.equal(scopedListPayload.items.length, 1);
  assert.equal(scopedListPayload.items[0]?.currentText.name, "Scoped Scarab A");

  const scopedDraftResponse = await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        seasonId: "custom-v1"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(scopedDraftResponse.status, 201);
  const scopedDraftPayload = (await scopedDraftResponse.json()) as {
    scope: { seasonId: string | null };
    draft: DraftTokenSet;
  };
  assert.equal(scopedDraftPayload.scope.seasonId, "custom-v1");
  assert.equal(scopedDraftPayload.draft.itemCount, 1);
  assert.equal(scopedDraftPayload.draft.entries.length, 1);
}

async function testDraftTokenGenerationIsDeterministicAndRetiredExcluded(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const createPayloads = [
    { name: "Ritual Scarab", status: "active", modifiers: ["ritual reward"] },
    { name: "Ritual Scarab of Echoes", status: "active", modifiers: ["ritual echo reward"] },
    { name: "Relic Scarab", status: "retired", modifiers: ["legacy relic"] }
  ];

  const createdIds: string[] = [];
  for (const payload of createPayloads) {
    const response = await worker.fetch!(
      new Request("https://example.com/admin/scarabs", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
      env,
      executionContext
    );
    assert.equal(response.status, 201);
    const created = (await response.json()) as { scarab: Scarab };
    createdIds.push(created.scarab.id);
  }

  const firstGenerate = await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(firstGenerate.status, 201);
  const firstDraftPayload = (await firstGenerate.json()) as { draft: DraftTokenSet };
  assert.equal(firstDraftPayload.draft.entries.length, 2);
  assert.equal(
    firstDraftPayload.draft.entries.some((entry) => entry.scarabId === createdIds[2]),
    false
  );
  assert.equal(firstDraftPayload.draft.report.excludedRetiredScarabs.some((entry) => entry.scarabId === createdIds[2]), true);
  assert.equal(firstDraftPayload.draft.report.collisions.length, 0);

  const secondGenerate = await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(secondGenerate.status, 201);
  const secondDraftPayload = (await secondGenerate.json()) as { draft: DraftTokenSet };
  assert.deepEqual(
    firstDraftPayload.draft.entries.map((entry) => ({ scarabId: entry.scarabId, token: entry.token })),
    secondDraftPayload.draft.entries.map((entry) => ({ scarabId: entry.scarabId, token: entry.token }))
  );
  assert.equal(secondDraftPayload.draft.report.changedTokens.length, 0);

  const updateResponse = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${createdIds[0]}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Abyss Ritual Scarab",
        modifiers: ["abyss ritual combo"],
        description: "updated to force token change"
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(updateResponse.status, 200);

  const thirdGenerate = await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(thirdGenerate.status, 201);
  const thirdDraftPayload = (await thirdGenerate.json()) as { draft: DraftTokenSet };
  assert.equal(thirdDraftPayload.draft.report.changedTokens.length > 0, true);
  assert.equal(repo.draftTokenSets.length, 3);

  const latestResponse = await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/latest", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(latestResponse.status, 200);
  const latestPayload = (await latestResponse.json()) as { draft: DraftTokenSet };
  assert.equal(latestPayload.draft.id, thirdDraftPayload.draft.id);
  assert.equal(
    repo.auditLogs.some((entry) => entry.action === "admin.token_draft.generate" && entry.statusCode === 201),
    true
  );
}

async function testTokenPublishGatePublicEndpointAndRollback(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const createA = await worker.fetch!(
    new Request("https://example.com/admin/scarabs", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Publish Alpha Ritual",
        modifiers: ["alpha reward"]
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  const scarabA = ((await createA.json()) as { scarab: Scarab }).scarab.id;

  const createB = await worker.fetch!(
    new Request("https://example.com/admin/scarabs", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Publish Beta Echo",
        modifiers: ["beta reward"]
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  await createB.json();

  const genInitial = await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(genInitial.status, 201);

  const publish1 = await worker.fetch!(
    new Request("https://example.com/admin/token-sets/publish", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(publish1.status, 201);
  const publish1Payload = (await publish1.json()) as { tokenSet: PublishedTokenSet };
  assert.equal(publish1Payload.tokenSet.entries.some((entry) => entry.scarabId === scarabA), true);

  const publicLatest1 = await worker.fetch!(
    new Request("https://example.com/public/token-set/latest") as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(publicLatest1.status, 200);
  const publicPayload1 = (await publicLatest1.json()) as { versionId: string };
  assert.equal(publicPayload1.versionId, publish1Payload.tokenSet.id);

  const updateA = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${scarabA}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Citadel Publish Ritual",
        modifiers: ["citadel reward"]
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(updateA.status, 200);

  await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  const publish2 = await worker.fetch!(
    new Request("https://example.com/admin/token-sets/publish", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(publish2.status, 201);
  const publish2Payload = (await publish2.json()) as { tokenSet: PublishedTokenSet };
  assert.equal(publish2Payload.tokenSet.id === publish1Payload.tokenSet.id, false);

  const rollback = await worker.fetch!(
    new Request(`https://example.com/admin/token-sets/${publish1Payload.tokenSet.id}/activate`, {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(rollback.status, 200);

  const publicLatestAfterRollback = await worker.fetch!(
    new Request("https://example.com/public/token-set/latest") as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(publicLatestAfterRollback.status, 200);
  const publicPayloadAfterRollback = (await publicLatestAfterRollback.json()) as { versionId: string };
  assert.equal(publicPayloadAfterRollback.versionId, publish1Payload.tokenSet.id);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.token_publish" && entry.statusCode === 201), true);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.token_rollback" && entry.statusCode === 200), true);
}

async function testPoeRegexProfileAllowsConfirmedOperators(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const create = await worker.fetch!(
    new Request("https://example.com/admin/scarabs", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Profile Syntax Scarab",
        modifiers: ["profile syntax check"]
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(create.status, 201);
  const scarabName = ((await create.json()) as { scarab: Scarab }).scarab.currentText.name;

  const constructs = getPoeRegexProfileConstructs();
  assert.equal(constructs.some((entry) => entry.id === "alternation"), true);
  assert.equal(constructs.some((entry) => entry.id === "lookahead_positive"), true);

  const allowedToken = "ts:.+(?=(\\S*r){1})|r-r";
  const importAllowed = await worker.fetch!(
    new Request("https://example.com/admin/token-sets/import-legacy", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        tokensByName: {
          [scarabName]: allowedToken
        }
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(importAllowed.status, 201);

  const unsupportedToken = "foo\\sbar";
  const importBlocked = await worker.fetch!(
    new Request("https://example.com/admin/token-sets/import-legacy", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        tokensByName: {
          [scarabName]: unsupportedToken
        }
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(importBlocked.status, 409);
  const blockedPayload = (await importBlocked.json()) as {
    gate?: { regexViolations?: Array<{ reason?: string }> };
  };
  assert.equal(blockedPayload.gate?.regexViolations?.some((entry) => entry.reason === "contains_unsupported_escape_sequence"), true);
}

async function testHostedAdminUiAndAuditEndpoint(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const uiResponse = await worker.fetch!(
    new Request("https://example.com/admin/ui") as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(uiResponse.status, 200);
  const html = await uiResponse.text();
  assert.equal(html.includes("ScarabEV Admin Plane"), true);
  assert.equal(uiResponse.headers.get("content-type")?.includes("text/html"), true);

  await worker.fetch!(
    new Request("https://example.com/admin/token-drafts/generate", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );

  const auditResponse = await worker.fetch!(
    new Request("https://example.com/admin/audit-logs?limit=5&pathContains=%2Fadmin%2Ftoken-drafts", {
      headers: {
        cookie: "scarabev_session=session-owner; scarabev_csrf=csrf-owner"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(auditResponse.status, 200);
  const auditPayload = (await auditResponse.json()) as { items: AuditLogRecord[] };
  assert.equal(Array.isArray(auditPayload.items), true);
}

async function testEditorCannotPublishOrRollback(): Promise<void> {
  const { repo, worker } = makeFixture();
  const editor: AdminUser = {
    id: "user-editor-block6",
    username: "editor-block6",
    role: "editor",
    passwordHash: "unused",
    passwordSalt: "unused",
    passwordIterations: 1,
    isActive: true
  };
  addUser(repo, editor);
  repo.sessions.set("session-editor-block6", {
    id: "session-editor-block6",
    userId: editor.id,
    csrfToken: "csrf-editor-block6",
    expiresAt: "2099-01-01T00:00:00.000Z",
    lastRotatedAt: "2098-12-31T23:00:00.000Z",
    user: {
      id: editor.id,
      username: editor.username,
      role: editor.role,
      isActive: true
    }
  });

  const publishAttempt = await worker.fetch!(
    new Request("https://example.com/admin/token-sets/publish", {
      method: "POST",
      headers: {
        cookie: "scarabev_session=session-editor-block6; scarabev_csrf=csrf-editor-block6",
        "x-csrf-token": "csrf-editor-block6"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(publishAttempt.status, 403);

  const rollbackAttempt = await worker.fetch!(
    new Request("https://example.com/admin/token-sets/nonexistent/activate", {
      method: "POST",
      headers: {
        cookie: "scarabev_session=session-editor-block6; scarabev_csrf=csrf-editor-block6",
        "x-csrf-token": "csrf-editor-block6"
      }
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(rollbackAttempt.status, 403);
}

async function testBackupRunBlockedWhenDisabled(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const backupAttempt = await worker.fetch!(
    new Request("https://example.com/admin/ops/backups/run", {
      method: "POST",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(backupAttempt.status, 409);
  assert.equal(repo.auditLogs.some((entry) => entry.action === "admin.backup_run" && entry.statusCode === 409), true);
}

async function testOwnerCanDeleteScarab(): Promise<void> {
  const { repo, worker } = makeFixture();
  addOwnerSession(repo);

  const create = await worker.fetch!(
    new Request("https://example.com/admin/scarabs", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "active",
        name: "Delete Me Scarab",
        modifiers: ["delete me"]
      })
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(create.status, 201);
  const createdId = ((await create.json()) as { scarab: Scarab }).scarab.id;

  const del = await worker.fetch!(
    new Request(`https://example.com/admin/scarabs/${createdId}`, {
      method: "DELETE",
      headers: authHeaders()
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    executionContext
  );
  assert.equal(del.status, 200);
  const find = await repo.findScarabById(createdId);
  assert.equal(find, null);
}

async function run(): Promise<void> {
  await testBlocksUnauthorizedAdminRequests();
  await testOwnerRoleEnforcementAndAuditLogging();
  await testRejectsInvalidCsrfOnMutation();
  await testRejectsExpiredSessions();
  await testOwnerCanChangePasswordAndOldPasswordStopsWorking();
  await testScarabLifecycleCrudAndTokenScope();
  await testActiveListIsDeterministic();
  await testScopedListAndScopedDraftGeneration();
  await testDraftTokenGenerationIsDeterministicAndRetiredExcluded();
  await testTokenPublishGatePublicEndpointAndRollback();
  await testPoeRegexProfileAllowsConfirmedOperators();
  await testHostedAdminUiAndAuditEndpoint();
  await testEditorCannotPublishOrRollback();
  await testBackupRunBlockedWhenDisabled();
  await testOwnerCanDeleteScarab();
  console.log("Block 8 checks passed (14 assertion groups).");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
