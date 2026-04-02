import type { AuditLogInput, NewSession, RateLimitResult, SessionWithUser, AdminUser } from "./types.js";

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

export class D1SecurityRepository implements SecurityRepository {
  constructor(private readonly db: D1Database) {}

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
}
