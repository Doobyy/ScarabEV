export type AdminRole = "owner" | "editor";

export interface AdminUser {
  id: string;
  username: string;
  role: AdminRole;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  isActive: boolean;
}

export interface SessionWithUser {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
  lastRotatedAt: string;
  user: Pick<AdminUser, "id" | "username" | "role" | "isActive">;
}

export interface NewSession {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
  lastRotatedAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RateLimitResult {
  count: number;
  retryAfterSeconds: number;
}

export interface AuditLogInput {
  id: string;
  actorUserId: string | null;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  detailsJson: string | null;
}
