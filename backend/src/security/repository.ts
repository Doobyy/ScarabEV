import type {
  AdminUser,
  AuditLogQueryOptions,
  AuditLogRecord,
  AuditLogInput,
  CreateScarabInput,
  DraftTokenSet,
  NewSession,
  PersistDraftTokenSetInput,
  PublishTokenSetInput,
  PublishedTokenSet,
  RateLimitResult,
  ReactivateScarabInput,
  RetireScarabInput,
  Scarab,
  ScarabListOptions,
  ScarabStatus,
  ScarabTextVersion,
  ScarabTokenInput,
  SessionWithUser,
  UpdateScarabInput
} from "./types.js";

export interface SecurityRepository {
  findAdminUserByUsername(username: string): Promise<AdminUser | null>;
  findAdminUserById(userId: string): Promise<AdminUser | null>;
  updateAdminUserPassword(
    userId: string,
    passwordHash: string,
    passwordSalt: string,
    passwordIterations: number
  ): Promise<void>;
  findSessionById(sessionId: string): Promise<SessionWithUser | null>;
  createSession(session: NewSession): Promise<void>;
  touchSession(sessionId: string, expiresAt: string, lastSeenAt: string): Promise<void>;
  revokeSession(sessionId: string, revokedAt: string): Promise<void>;
  rotateSession(oldSessionId: string, newSession: NewSession, revokedAt: string): Promise<void>;
  consumeRateLimit(scope: string, subject: string, windowSeconds: number, now: Date): Promise<RateLimitResult>;
  writeAuditLog(log: AuditLogInput): Promise<void>;
  createScarab(input: CreateScarabInput): Promise<Scarab>;
  listScarabs(options?: ScarabListOptions): Promise<Scarab[]>;
  findScarabById(scarabId: string): Promise<Scarab | null>;
  listScarabTextVersions(scarabId: string): Promise<ScarabTextVersion[]>;
  updateScarab(input: UpdateScarabInput): Promise<Scarab | null>;
  deleteScarab(scarabId: string): Promise<boolean>;
  retireScarab(input: RetireScarabInput): Promise<Scarab | null>;
  reactivateScarab(input: ReactivateScarabInput): Promise<Scarab | null>;
  listTokenGenerationInputs(
    statuses?: ScarabStatus[],
    scope?: { leagueId?: string | null; seasonId?: string | null; orderBy?: "name" | "created" }
  ): Promise<ScarabTokenInput[]>;
  saveDraftTokenSet(input: PersistDraftTokenSetInput): Promise<DraftTokenSet>;
  getLatestDraftTokenSet(): Promise<DraftTokenSet | null>;
  listLatestDraftTokensByScarabIds(scarabIds: string[]): Promise<Map<string, string>>;
  publishTokenSet(input: PublishTokenSetInput): Promise<PublishedTokenSet>;
  getLatestPublishedTokenSet(): Promise<PublishedTokenSet | null>;
  getTokenSetById(tokenSetId: string): Promise<PublishedTokenSet | null>;
  activatePublishedTokenSet(tokenSetId: string, activatedAt: string): Promise<PublishedTokenSet | null>;
  deleteTokenSet(tokenSetId: string): Promise<"deleted" | "not_found" | "published_blocked">;
  listTokenSets(limit: number): Promise<PublishedTokenSet[]>;
  listAuditLogs(options: AuditLogQueryOptions): Promise<AuditLogRecord[]>;
}

interface DbAdminUserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  role: "owner" | "editor";
  is_active: number;
}

interface DbSessionRow {
  session_id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
  last_rotated_at: string;
  user_username: string;
  user_role: "owner" | "editor";
  user_is_active: number;
}

interface DbRateLimitRow {
  count: number;
}

interface DbScarabRow {
  id: string;
  status: ScarabStatus;
  league_id: string | null;
  season_id: string | null;
  retired_league_id: string | null;
  retired_season_id: string | null;
  retirement_note: string | null;
  retired_at: string | null;
  reactivated_at: string | null;
  current_text_version: number;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
  text_id: string;
  text_version: number;
  text_name: string;
  text_description: string | null;
  text_modifiers_json: string;
  text_flavor_text: string | null;
  text_change_note: string | null;
  text_created_by_user_id: string;
  text_created_at: string;
}

interface DbScarabTextVersionRow {
  id: string;
  scarab_id: string;
  version: number;
  name: string;
  description: string | null;
  modifiers_json: string;
  flavor_text: string | null;
  change_note: string | null;
  created_by_user_id: string;
  created_at: string;
}

interface DbDraftTokenSetRow {
  id: string;
  input_fingerprint: string;
  item_count: number;
  created_by_user_id: string;
  created_at: string;
}

interface DbDraftTokenEntryRow {
  scarab_id: string;
  token: string;
  candidate_token: string;
  uniqueness_score: number;
  length_score: number;
  stability_score: number;
  total_score: number;
  candidate_count: number;
}

interface DbDraftTokenReportRow {
  collisions_json: string;
  low_confidence_json: string;
  changed_tokens_json: string;
  excluded_retired_json: string;
}

interface DbTokenSetRow {
  id: string;
  state: "draft" | "published" | "archived";
  source_draft_set_id: string;
  regex_profile_name: string;
  created_by_user_id: string;
  created_at: string;
  published_at: string | null;
  archived_at: string | null;
}

interface DbTokenSetEntryRow {
  scarab_id: string;
  token: string;
}

interface DbAuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  method: string;
  path: string;
  status_code: number;
  request_id: string;
  ip_address: string | null;
  user_agent: string | null;
  details_json: string | null;
  created_at: string;
}

function parseJsonArray<T>(input: string): T[] {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseModifiers(modifiersJson: string): string[] {
  try {
    const parsed = JSON.parse(modifiersJson);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function toScarabTextVersion(row: DbScarabTextVersionRow): ScarabTextVersion {
  return {
    id: row.id,
    scarabId: row.scarab_id,
    version: row.version,
    name: row.name,
    description: row.description,
    modifiers: parseModifiers(row.modifiers_json),
    flavorText: row.flavor_text,
    changeNote: row.change_note,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at
  };
}

function toScarab(row: DbScarabRow): Scarab {
  return {
    id: row.id,
    status: row.status,
    leagueId: row.league_id,
    seasonId: row.season_id,
    retiredLeagueId: row.retired_league_id,
    retiredSeasonId: row.retired_season_id,
    retirementNote: row.retirement_note,
    retiredAt: row.retired_at,
    reactivatedAt: row.reactivated_at,
    currentTextVersion: row.current_text_version,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentText: {
      id: row.text_id,
      scarabId: row.id,
      version: row.text_version,
      name: row.text_name,
      description: row.text_description,
      modifiers: parseModifiers(row.text_modifiers_json),
      flavorText: row.text_flavor_text,
      changeNote: row.text_change_note,
      createdByUserId: row.text_created_by_user_id,
      createdAt: row.text_created_at
    }
  };
}

function serializeModifiers(modifiers: string[]): string {
  return JSON.stringify(modifiers);
}

function stringArrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

export class D1SecurityRepository implements SecurityRepository {
  constructor(private readonly db: D1Database) {}

  private async getPublishedTokenSetById(tokenSetId: string): Promise<PublishedTokenSet | null> {
    const setRow = await this.db
      .prepare(
        `
        SELECT
          id,
          state,
          source_draft_set_id,
          regex_profile_name,
          created_by_user_id,
          created_at,
          published_at,
          archived_at
        FROM token_sets
        WHERE id = ?1
        LIMIT 1
      `
      )
      .bind(tokenSetId)
      .first<DbTokenSetRow>();
    if (!setRow) {
      return null;
    }

    const entryRows = await this.db
      .prepare(
        `
        SELECT scarab_id, token
        FROM token_set_entries
        WHERE token_set_id = ?1
        ORDER BY scarab_id ASC
      `
      )
      .bind(tokenSetId)
      .all<DbTokenSetEntryRow>();

    return {
      id: setRow.id,
      state: setRow.state,
      sourceDraftSetId: setRow.source_draft_set_id,
      regexProfileName: setRow.regex_profile_name,
      createdByUserId: setRow.created_by_user_id,
      createdAt: setRow.created_at,
      publishedAt: setRow.published_at,
      archivedAt: setRow.archived_at,
      entries: entryRows.results.map((row) => ({
        scarabId: row.scarab_id,
        token: row.token
      }))
    };
  }

  private async getDraftTokenSetById(draftSetId: string): Promise<DraftTokenSet | null> {
    const setRow = await this.db
      .prepare(
        `
        SELECT id, input_fingerprint, item_count, created_by_user_id, created_at
        FROM draft_token_sets
        WHERE id = ?1
        LIMIT 1
      `
      )
      .bind(draftSetId)
      .first<DbDraftTokenSetRow>();
    if (!setRow) {
      return null;
    }

    const entryRows = await this.db
      .prepare(
        `
        SELECT
          scarab_id,
          token,
          candidate_token,
          uniqueness_score,
          length_score,
          stability_score,
          total_score,
          candidate_count
        FROM draft_token_entries
        WHERE draft_set_id = ?1
        ORDER BY scarab_id ASC
      `
      )
      .bind(draftSetId)
      .all<DbDraftTokenEntryRow>();

    const reportRow = await this.db
      .prepare(
        `
        SELECT collisions_json, low_confidence_json, changed_tokens_json, excluded_retired_json
        FROM draft_token_reports
        WHERE draft_set_id = ?1
        LIMIT 1
      `
      )
      .bind(draftSetId)
      .first<DbDraftTokenReportRow>();

    return {
      id: setRow.id,
      createdByUserId: setRow.created_by_user_id,
      createdAt: setRow.created_at,
      inputFingerprint: setRow.input_fingerprint,
      itemCount: setRow.item_count,
      entries: entryRows.results.map((row) => ({
        scarabId: row.scarab_id,
        token: row.token,
        candidateToken: row.candidate_token,
        uniquenessScore: row.uniqueness_score,
        lengthScore: row.length_score,
        stabilityScore: row.stability_score,
        totalScore: row.total_score,
        candidateCount: row.candidate_count
      })),
      report: {
        collisions: parseJsonArray(reportRow?.collisions_json ?? "[]"),
        lowConfidence: parseJsonArray(reportRow?.low_confidence_json ?? "[]"),
        changedTokens: parseJsonArray(reportRow?.changed_tokens_json ?? "[]"),
        excludedRetiredScarabs: parseJsonArray(reportRow?.excluded_retired_json ?? "[]")
      }
    };
  }

  private async findDbScarabById(scarabId: string): Promise<DbScarabRow | null> {
    return await this.db
      .prepare(
        `
        SELECT
          s.id,
          s.status,
          s.league_id,
          s.season_id,
          s.retired_league_id,
          s.retired_season_id,
          s.retirement_note,
          s.retired_at,
          s.reactivated_at,
          s.current_text_version,
          s.created_by_user_id,
          s.updated_by_user_id,
          s.created_at,
          s.updated_at,
          tv.id AS text_id,
          tv.version AS text_version,
          tv.name AS text_name,
          tv.description AS text_description,
          tv.modifiers_json AS text_modifiers_json,
          tv.flavor_text AS text_flavor_text,
          tv.change_note AS text_change_note,
          tv.created_by_user_id AS text_created_by_user_id,
          tv.created_at AS text_created_at
        FROM scarabs s
        INNER JOIN scarab_text_versions tv
          ON tv.scarab_id = s.id
         AND tv.version = s.current_text_version
        WHERE s.id = ?1
        LIMIT 1
      `
      )
      .bind(scarabId)
      .first<DbScarabRow>();
  }

  async findAdminUserByUsername(username: string): Promise<AdminUser | null> {
    const row = await this.db
      .prepare(
        `
        SELECT
          id,
          username,
          password_hash,
          password_salt,
          password_iterations,
          role,
          is_active
        FROM admin_users
        WHERE username = ?1
        LIMIT 1
      `
      )
      .bind(username)
      .first<DbAdminUserRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      passwordIterations: row.password_iterations,
      role: row.role,
      isActive: row.is_active === 1
    };
  }

  async findAdminUserById(userId: string): Promise<AdminUser | null> {
    const row = await this.db
      .prepare(
        `
        SELECT
          id,
          username,
          password_hash,
          password_salt,
          password_iterations,
          role,
          is_active
        FROM admin_users
        WHERE id = ?1
        LIMIT 1
      `
      )
      .bind(userId)
      .first<DbAdminUserRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      passwordIterations: row.password_iterations,
      role: row.role,
      isActive: row.is_active === 1
    };
  }

  async updateAdminUserPassword(
    userId: string,
    passwordHash: string,
    passwordSalt: string,
    passwordIterations: number
  ): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE admin_users
        SET password_hash = ?2,
            password_salt = ?3,
            password_iterations = ?4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1
      `
      )
      .bind(userId, passwordHash, passwordSalt, passwordIterations)
      .run();
  }

  async findSessionById(sessionId: string): Promise<SessionWithUser | null> {
    const row = await this.db
      .prepare(
        `
        SELECT
          s.id AS session_id,
          s.user_id AS user_id,
          s.csrf_token AS csrf_token,
          s.expires_at AS expires_at,
          s.last_rotated_at AS last_rotated_at,
          u.username AS user_username,
          u.role AS user_role,
          u.is_active AS user_is_active
        FROM auth_sessions s
        INNER JOIN admin_users u ON u.id = s.user_id
        WHERE s.id = ?1
          AND s.revoked_at IS NULL
        LIMIT 1
      `
      )
      .bind(sessionId)
      .first<DbSessionRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.session_id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
      lastRotatedAt: row.last_rotated_at,
      user: {
        id: row.user_id,
        username: row.user_username,
        role: row.user_role,
        isActive: row.user_is_active === 1
      }
    };
  }

  async createSession(session: NewSession): Promise<void> {
    await this.db
      .prepare(
        `
        INSERT INTO auth_sessions (
          id,
          user_id,
          csrf_token,
          expires_at,
          last_rotated_at,
          last_seen_at,
          ip_address,
          user_agent
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      `
      )
      .bind(
        session.id,
        session.userId,
        session.csrfToken,
        session.expiresAt,
        session.lastRotatedAt,
        session.lastSeenAt,
        session.ipAddress,
        session.userAgent
      )
      .run();
  }

  async touchSession(sessionId: string, expiresAt: string, lastSeenAt: string): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE auth_sessions
        SET expires_at = ?2,
            last_seen_at = ?3
        WHERE id = ?1
          AND revoked_at IS NULL
      `
      )
      .bind(sessionId, expiresAt, lastSeenAt)
      .run();
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE auth_sessions
        SET revoked_at = ?2
        WHERE id = ?1
          AND revoked_at IS NULL
      `
      )
      .bind(sessionId, revokedAt)
      .run();
  }

  async rotateSession(oldSessionId: string, newSession: NewSession, revokedAt: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `
          UPDATE auth_sessions
          SET revoked_at = ?2
          WHERE id = ?1
            AND revoked_at IS NULL
        `
        )
        .bind(oldSessionId, revokedAt),
      this.db
        .prepare(
          `
          INSERT INTO auth_sessions (
            id,
            user_id,
            csrf_token,
            expires_at,
            last_rotated_at,
            last_seen_at,
            ip_address,
            user_agent
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `
        )
        .bind(
          newSession.id,
          newSession.userId,
          newSession.csrfToken,
          newSession.expiresAt,
          newSession.lastRotatedAt,
          newSession.lastSeenAt,
          newSession.ipAddress,
          newSession.userAgent
        )
    ]);
  }

  async consumeRateLimit(scope: string, subject: string, windowSeconds: number, now: Date): Promise<RateLimitResult> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const windowStart = nowSeconds - (nowSeconds % windowSeconds);
    const retryAfterSeconds = windowSeconds - (nowSeconds - windowStart);

    await this.db
      .prepare(
        `
        INSERT INTO rate_limits (scope, subject, window_start, count, updated_at)
        VALUES (?1, ?2, ?3, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(scope, subject, window_start)
        DO UPDATE SET
          count = count + 1,
          updated_at = CURRENT_TIMESTAMP
      `
      )
      .bind(scope, subject, windowStart)
      .run();

    const row = await this.db
      .prepare(
        `
        SELECT count
        FROM rate_limits
        WHERE scope = ?1
          AND subject = ?2
          AND window_start = ?3
        LIMIT 1
      `
      )
      .bind(scope, subject, windowStart)
      .first<DbRateLimitRow>();

    return {
      count: row?.count ?? 0,
      retryAfterSeconds
    };
  }

  async writeAuditLog(log: AuditLogInput): Promise<void> {
    await this.db
      .prepare(
        `
        INSERT INTO audit_logs (
          id,
          actor_user_id,
          action,
          method,
          path,
          status_code,
          request_id,
          ip_address,
          user_agent,
          details_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      `
      )
      .bind(
        log.id,
        log.actorUserId,
        log.action,
        log.method,
        log.path,
        log.statusCode,
        log.requestId,
        log.ipAddress,
        log.userAgent,
        log.detailsJson
      )
      .run();
  }

  async createScarab(input: CreateScarabInput): Promise<Scarab> {
    const textVersionId = crypto.randomUUID();
    const modifiersJson = serializeModifiers(input.modifiers);

    await this.db.batch([
      this.db
        .prepare(
          `
          INSERT INTO scarabs (
            id,
            status,
            league_id,
            season_id,
            current_text_version,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8)
        `
        )
        .bind(
          input.id,
          input.status,
          input.leagueId,
          input.seasonId,
          input.createdByUserId,
          input.createdByUserId,
          input.createdAt,
          input.createdAt
        ),
      this.db
        .prepare(
          `
          INSERT INTO scarab_text_versions (
            id,
            scarab_id,
            version,
            name,
            description,
            modifiers_json,
            flavor_text,
            change_note,
            created_by_user_id,
            created_at
          ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        `
        )
        .bind(
          textVersionId,
          input.id,
          input.name,
          input.description,
          modifiersJson,
          input.flavorText,
          input.changeNote,
          input.createdByUserId,
          input.createdAt
        )
    ]);

    const created = await this.findDbScarabById(input.id);
    if (!created) {
      throw new Error("failed_to_create_scarab");
    }
    return toScarab(created);
  }

  async listScarabs(options?: ScarabListOptions): Promise<Scarab[]> {
    const statuses = options?.statuses?.length ? options.statuses : null;
    const hasLeagueFilter = options?.leagueId !== undefined;
    const hasSeasonFilter = options?.seasonId !== undefined;
    let query = `
      SELECT
        s.id,
        s.status,
        s.league_id,
        s.season_id,
        s.retired_league_id,
        s.retired_season_id,
        s.retirement_note,
        s.retired_at,
        s.reactivated_at,
        s.current_text_version,
        s.created_by_user_id,
        s.updated_by_user_id,
        s.created_at,
        s.updated_at,
        tv.id AS text_id,
        tv.version AS text_version,
        tv.name AS text_name,
        tv.description AS text_description,
        tv.modifiers_json AS text_modifiers_json,
        tv.flavor_text AS text_flavor_text,
        tv.change_note AS text_change_note,
        tv.created_by_user_id AS text_created_by_user_id,
        tv.created_at AS text_created_at
      FROM scarabs s
      INNER JOIN scarab_text_versions tv
        ON tv.scarab_id = s.id
       AND tv.version = s.current_text_version
    `;
    const bindings: unknown[] = [];
    const conditions: string[] = [];
    if (statuses) {
      const placeholders = statuses.map((_, index) => `?${bindings.length + index + 1}`).join(", ");
      conditions.push(`s.status IN (${placeholders})`);
      bindings.push(...statuses);
    }
    if (hasLeagueFilter) {
      if (options?.leagueId === null) {
        conditions.push("s.league_id IS NULL");
      } else {
        conditions.push(`s.league_id = ?${bindings.length + 1}`);
        bindings.push(options?.leagueId);
      }
    }
    if (hasSeasonFilter) {
      if (options?.seasonId === null) {
        conditions.push("s.season_id IS NULL");
      } else {
        conditions.push(`s.season_id = ?${bindings.length + 1}`);
        bindings.push(options?.seasonId);
      }
    }
    if (conditions.length) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    if (options?.orderBy === "created") {
      query += " ORDER BY s.created_at ASC, s.id ASC";
    } else {
      query += " ORDER BY LOWER(tv.name) ASC, s.id ASC";
    }

    const prepared = this.db.prepare(query).bind(...bindings);
    const rows = await prepared.all<DbScarabRow>();
    return rows.results.map((row) => toScarab(row));
  }

  async findScarabById(scarabId: string): Promise<Scarab | null> {
    const row = await this.findDbScarabById(scarabId);
    return row ? toScarab(row) : null;
  }

  async listScarabTextVersions(scarabId: string): Promise<ScarabTextVersion[]> {
    const rows = await this.db
      .prepare(
        `
        SELECT
          id,
          scarab_id,
          version,
          name,
          description,
          modifiers_json,
          flavor_text,
          change_note,
          created_by_user_id,
          created_at
        FROM scarab_text_versions
        WHERE scarab_id = ?1
        ORDER BY version DESC, id ASC
      `
      )
      .bind(scarabId)
      .all<DbScarabTextVersionRow>();

    return rows.results.map((row) => toScarabTextVersion(row));
  }

  async updateScarab(input: UpdateScarabInput): Promise<Scarab | null> {
    const existing = await this.findDbScarabById(input.scarabId);
    if (!existing || existing.status === "retired") {
      return null;
    }

    const existingModifiers = parseModifiers(existing.text_modifiers_json);
    const textChanged =
      existing.text_name !== input.text.name ||
      existing.text_description !== input.text.description ||
      existing.text_flavor_text !== input.text.flavorText ||
      !stringArrayEquals(existingModifiers, input.text.modifiers);
    const metadataChanged =
      existing.status !== input.status || existing.league_id !== input.leagueId || existing.season_id !== input.seasonId;

    if (!textChanged && !metadataChanged) {
      return toScarab(existing);
    }

    if (textChanged) {
      const nextVersion = existing.current_text_version + 1;
      const nextVersionId = crypto.randomUUID();
      const modifiersJson = serializeModifiers(input.text.modifiers);

      await this.db.batch([
        this.db
          .prepare(
            `
            INSERT INTO scarab_text_versions (
              id,
              scarab_id,
              version,
              name,
              description,
              modifiers_json,
              flavor_text,
              change_note,
              created_by_user_id,
              created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
          `
          )
          .bind(
            nextVersionId,
            input.scarabId,
            nextVersion,
            input.text.name,
            input.text.description,
            modifiersJson,
            input.text.flavorText,
            input.changeNote,
            input.actorUserId,
            input.updatedAt
          ),
        this.db
          .prepare(
            `
            UPDATE scarabs
            SET status = ?2,
                league_id = ?3,
                season_id = ?4,
                current_text_version = ?5,
                updated_by_user_id = ?6,
                updated_at = ?7
            WHERE id = ?1
              AND status IN ('draft', 'active')
          `
          )
          .bind(
            input.scarabId,
            input.status,
            input.leagueId,
            input.seasonId,
            nextVersion,
            input.actorUserId,
            input.updatedAt
          )
      ]);
    } else {
      await this.db
        .prepare(
          `
          UPDATE scarabs
          SET status = ?2,
              league_id = ?3,
              season_id = ?4,
              updated_by_user_id = ?5,
              updated_at = ?6
          WHERE id = ?1
            AND status IN ('draft', 'active')
        `
        )
        .bind(input.scarabId, input.status, input.leagueId, input.seasonId, input.actorUserId, input.updatedAt)
        .run();
    }

    return await this.findScarabById(input.scarabId);
  }

  async deleteScarab(scarabId: string): Promise<boolean> {
    const existing = await this.findDbScarabById(scarabId);
    if (!existing) {
      return false;
    }

    await this.db.batch([
      this.db.prepare("DELETE FROM token_set_entries WHERE scarab_id = ?1").bind(scarabId),
      this.db.prepare("DELETE FROM draft_token_entries WHERE scarab_id = ?1").bind(scarabId),
      this.db.prepare("DELETE FROM scarab_text_versions WHERE scarab_id = ?1").bind(scarabId),
      this.db.prepare("DELETE FROM scarabs WHERE id = ?1").bind(scarabId)
    ]);

    return true;
  }

  async retireScarab(input: RetireScarabInput): Promise<Scarab | null> {
    const existing = await this.findDbScarabById(input.scarabId);
    if (!existing) {
      return null;
    }

    await this.db
      .prepare(
        `
        UPDATE scarabs
        SET status = 'retired',
            retired_league_id = ?2,
            retired_season_id = ?3,
            retirement_note = ?4,
            retired_at = ?5,
            updated_by_user_id = ?6,
            updated_at = ?5
        WHERE id = ?1
      `
      )
      .bind(
        input.scarabId,
        input.retiredLeagueId,
        input.retiredSeasonId,
        input.retirementNote,
        input.retiredAt,
        input.actorUserId
      )
      .run();

    return await this.findScarabById(input.scarabId);
  }

  async reactivateScarab(input: ReactivateScarabInput): Promise<Scarab | null> {
    const existing = await this.findDbScarabById(input.scarabId);
    if (!existing) {
      return null;
    }

    await this.db
      .prepare(
        `
        UPDATE scarabs
        SET status = 'active',
            league_id = ?2,
            season_id = ?3,
            reactivated_at = ?4,
            updated_by_user_id = ?5,
            updated_at = ?4
        WHERE id = ?1
      `
      )
      .bind(input.scarabId, input.leagueId, input.seasonId, input.reactivatedAt, input.actorUserId)
      .run();

    return await this.findScarabById(input.scarabId);
  }

  async listTokenGenerationInputs(
    statuses: ScarabStatus[] = ["active"],
    scope?: { leagueId?: string | null; seasonId?: string | null; orderBy?: "name" | "created" }
  ): Promise<ScarabTokenInput[]> {
    const queryStatuses = statuses.length ? statuses : ["active"];
    const bindings: unknown[] = [];
    const statusPlaceholders = queryStatuses.map((_, index) => `?${index + 1}`).join(", ");
    bindings.push(...queryStatuses);
    const conditions = [`s.status IN (${statusPlaceholders})`];
    if (scope?.leagueId !== undefined) {
      if (scope.leagueId === null) {
        conditions.push("s.league_id IS NULL");
      } else {
        conditions.push(`s.league_id = ?${bindings.length + 1}`);
        bindings.push(scope.leagueId);
      }
    }
    if (scope?.seasonId !== undefined) {
      if (scope.seasonId === null) {
        conditions.push("s.season_id IS NULL");
      } else {
        conditions.push(`s.season_id = ?${bindings.length + 1}`);
        bindings.push(scope.seasonId);
      }
    }
    const orderByClause =
      scope?.orderBy === "created" ? "ORDER BY s.created_at ASC, s.id ASC" : "ORDER BY LOWER(tv.name) ASC, s.id ASC";
    const query = `
      SELECT
        s.id AS scarab_id,
        s.status AS status,
        tv.name AS name,
        tv.description AS description,
        tv.modifiers_json AS modifiers_json,
        tv.flavor_text AS flavor_text
      FROM scarabs s
      INNER JOIN scarab_text_versions tv
        ON tv.scarab_id = s.id
       AND tv.version = s.current_text_version
      WHERE ${conditions.join(" AND ")}
      ${orderByClause}
    `;

    type Row = {
      scarab_id: string;
      status: ScarabStatus;
      name: string;
      description: string | null;
      modifiers_json: string;
      flavor_text: string | null;
    };

    const rows = await this.db.prepare(query).bind(...bindings).all<Row>();
    return rows.results.map((row) => ({
      scarabId: row.scarab_id,
      status: row.status,
      name: row.name,
      description: row.description,
      modifiers: parseModifiers(row.modifiers_json),
      flavorText: row.flavor_text
    }));
  }

  async saveDraftTokenSet(input: PersistDraftTokenSetInput): Promise<DraftTokenSet> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `
          INSERT INTO draft_token_sets (
            id,
            input_fingerprint,
            item_count,
            created_by_user_id,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5)
        `
        )
        .bind(input.id, input.inputFingerprint, input.entries.length, input.createdByUserId, input.createdAt),
      this.db
        .prepare(
          `
          INSERT INTO draft_token_reports (
            draft_set_id,
            collisions_json,
            low_confidence_json,
            changed_tokens_json,
            excluded_retired_json,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `
        )
        .bind(
          input.id,
          JSON.stringify(input.report.collisions),
          JSON.stringify(input.report.lowConfidence),
          JSON.stringify(input.report.changedTokens),
          JSON.stringify(input.report.excludedRetiredScarabs),
          input.createdAt
        )
    ];

    for (const entry of input.entries) {
      statements.push(
        this.db
          .prepare(
            `
            INSERT INTO draft_token_entries (
              id,
              draft_set_id,
              scarab_id,
              token,
              candidate_token,
              uniqueness_score,
              length_score,
              stability_score,
              total_score,
              candidate_count,
              created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
          `
          )
          .bind(
            crypto.randomUUID(),
            input.id,
            entry.scarabId,
            entry.token,
            entry.candidateToken,
            entry.uniquenessScore,
            entry.lengthScore,
            entry.stabilityScore,
            entry.totalScore,
            entry.candidateCount,
            input.createdAt
          )
      );
    }

    await this.db.batch(statements);
    const persisted = await this.getDraftTokenSetById(input.id);
    if (!persisted) {
      throw new Error("failed_to_persist_draft_token_set");
    }
    return persisted;
  }

  async getLatestDraftTokenSet(): Promise<DraftTokenSet | null> {
    const latest = await this.db
      .prepare(
        `
        SELECT id
        FROM draft_token_sets
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
      )
      .first<{ id: string }>();
    if (!latest) {
      return null;
    }
    return await this.getDraftTokenSetById(latest.id);
  }

  async listLatestDraftTokensByScarabIds(scarabIds: string[]): Promise<Map<string, string>> {
    const latest = await this.db
      .prepare(
        `
        SELECT id
        FROM draft_token_sets
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
      )
      .first<{ id: string }>();
    if (!latest || scarabIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .prepare(
        `
        SELECT scarab_id, token
        FROM draft_token_entries
        WHERE draft_set_id = ?1
      `
      )
      .bind(latest.id)
      .all<{ scarab_id: string; token: string }>();
    const mapped = new Map<string, string>();
    const wanted = new Set(scarabIds);
    for (const row of rows.results) {
      if (!wanted.has(row.scarab_id)) {
        continue;
      }
      mapped.set(row.scarab_id, row.token);
    }
    return mapped;
  }

  async publishTokenSet(input: PublishTokenSetInput): Promise<PublishedTokenSet> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `
          UPDATE token_sets
          SET state = 'archived',
              archived_at = ?1
          WHERE state = 'published'
        `
        )
        .bind(input.publishedAt),
      this.db
        .prepare(
          `
          INSERT INTO token_sets (
            id,
            state,
            source_draft_set_id,
            regex_profile_name,
            created_by_user_id,
            created_at,
            published_at,
            archived_at
          ) VALUES (?1, 'published', ?2, ?3, ?4, ?5, ?6, NULL)
        `
        )
        .bind(
          input.id,
          input.sourceDraftSetId,
          input.regexProfileName,
          input.createdByUserId,
          input.createdAt,
          input.publishedAt
        )
    ];

    for (const entry of input.entries) {
      statements.push(
        this.db
          .prepare(
            `
            INSERT INTO token_set_entries (
              id,
              token_set_id,
              scarab_id,
              token,
              created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5)
          `
          )
          .bind(crypto.randomUUID(), input.id, entry.scarabId, entry.token, input.createdAt)
      );
    }

    await this.db.batch(statements);
    const published = await this.getPublishedTokenSetById(input.id);
    if (!published) {
      throw new Error("failed_to_publish_token_set");
    }
    return published;
  }

  async getLatestPublishedTokenSet(): Promise<PublishedTokenSet | null> {
    const latest = await this.db
      .prepare(
        `
        SELECT id
        FROM token_sets
        WHERE state = 'published'
        ORDER BY published_at DESC, id DESC
        LIMIT 1
      `
      )
      .first<{ id: string }>();
    if (!latest) {
      return null;
    }
    return await this.getPublishedTokenSetById(latest.id);
  }

  async getTokenSetById(tokenSetId: string): Promise<PublishedTokenSet | null> {
    return await this.getPublishedTokenSetById(tokenSetId);
  }

  async activatePublishedTokenSet(tokenSetId: string, activatedAt: string): Promise<PublishedTokenSet | null> {
    const target = await this.getPublishedTokenSetById(tokenSetId);
    if (!target) {
      return null;
    }

    await this.db.batch([
      this.db
        .prepare(
          `
          UPDATE token_sets
          SET state = 'archived',
              archived_at = ?1
          WHERE state = 'published'
        `
        )
        .bind(activatedAt),
      this.db
        .prepare(
          `
          UPDATE token_sets
          SET state = 'published',
              published_at = ?2,
              archived_at = NULL
          WHERE id = ?1
        `
        )
        .bind(tokenSetId, activatedAt)
    ]);

    return await this.getPublishedTokenSetById(tokenSetId);
  }

  async deleteTokenSet(tokenSetId: string): Promise<"deleted" | "not_found" | "published_blocked"> {
    const existing = await this.db
      .prepare(
        `
        SELECT id, state
        FROM token_sets
        WHERE id = ?1
        LIMIT 1
      `
      )
      .bind(tokenSetId)
      .first<{ id: string; state: "draft" | "published" | "archived" }>();
    if (!existing) {
      return "not_found";
    }
    if (existing.state === "published") {
      return "published_blocked";
    }

    await this.db.batch([
      this.db.prepare("DELETE FROM token_set_entries WHERE token_set_id = ?1").bind(tokenSetId),
      this.db.prepare("DELETE FROM token_sets WHERE id = ?1").bind(tokenSetId)
    ]);
    return "deleted";
  }

  async listTokenSets(limit: number): Promise<PublishedTokenSet[]> {
    const clamped = Math.max(1, Math.min(limit, 100));
    const rows = await this.db
      .prepare(
        `
        SELECT id
        FROM token_sets
        ORDER BY created_at DESC, id DESC
        LIMIT ?1
      `
      )
      .bind(clamped)
      .all<{ id: string }>();

    const sets: PublishedTokenSet[] = [];
    for (const row of rows.results) {
      const tokenSet = await this.getPublishedTokenSetById(row.id);
      if (tokenSet) {
        sets.push(tokenSet);
      }
    }
    return sets;
  }

  async listAuditLogs(options: AuditLogQueryOptions): Promise<AuditLogRecord[]> {
    const clamped = Math.max(1, Math.min(options.limit, 200));
    const clauses: string[] = [];
    const binds: unknown[] = [];
    let index = 1;

    if (options.action) {
      clauses.push(`a.action = ?${index}`);
      binds.push(options.action);
      index += 1;
    }
    if (options.pathContains) {
      clauses.push(`a.path LIKE ?${index}`);
      binds.push(`%${options.pathContains}%`);
      index += 1;
    }
    if (options.actorUserId) {
      clauses.push(`a.actor_user_id = ?${index}`);
      binds.push(options.actorUserId);
      index += 1;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const query = `
      SELECT
        a.id,
        a.actor_user_id,
        u.username AS actor_username,
        a.action,
        a.method,
        a.path,
        a.status_code,
        a.request_id,
        a.ip_address,
        a.user_agent,
        a.details_json,
        a.created_at
      FROM audit_logs a
      LEFT JOIN admin_users u ON u.id = a.actor_user_id
      ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?${index}
    `;
    binds.push(clamped);

    const rows = await this.db.prepare(query).bind(...binds).all<DbAuditLogRow>();
    return rows.results.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorUsername: row.actor_username,
      action: row.action,
      method: row.method,
      path: row.path,
      statusCode: row.status_code,
      requestId: row.request_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      detailsJson: row.details_json,
      createdAt: row.created_at
    }));
  }
}
