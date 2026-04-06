export type AdminRole = "owner" | "editor";
export type ScarabStatus = "draft" | "active" | "retired";

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

export interface ScarabMetadataInput {
  leagueId: string | null;
  seasonId: string | null;
}

export interface ScarabTextInput {
  name: string;
  description: string | null;
  modifiers: string[];
  flavorText: string | null;
}

export interface CreateScarabInput extends ScarabMetadataInput, ScarabTextInput {
  id: string;
  status: ScarabStatus;
  createdByUserId: string;
  changeNote: string | null;
  createdAt: string;
}

export interface UpdateScarabInput extends ScarabMetadataInput {
  scarabId: string;
  status: Exclude<ScarabStatus, "retired">;
  text: ScarabTextInput;
  changeNote: string | null;
  actorUserId: string;
  updatedAt: string;
}

export interface RetireScarabInput {
  scarabId: string;
  retiredLeagueId: string | null;
  retiredSeasonId: string | null;
  retirementNote: string | null;
  actorUserId: string;
  retiredAt: string;
}

export interface ReactivateScarabInput extends ScarabMetadataInput {
  scarabId: string;
  actorUserId: string;
  reactivatedAt: string;
}

export interface ScarabTextVersion {
  id: string;
  scarabId: string;
  version: number;
  name: string;
  description: string | null;
  modifiers: string[];
  flavorText: string | null;
  changeNote: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface Scarab {
  id: string;
  status: ScarabStatus;
  leagueId: string | null;
  seasonId: string | null;
  retiredLeagueId: string | null;
  retiredSeasonId: string | null;
  retirementNote: string | null;
  retiredAt: string | null;
  reactivatedAt: string | null;
  currentTextVersion: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  currentText: ScarabTextVersion;
}

export interface ScarabListOptions {
  statuses?: ScarabStatus[];
  leagueId?: string | null;
  seasonId?: string | null;
  orderBy?: "name" | "created";
}

export interface ScarabTokenInput {
  scarabId: string;
  status: ScarabStatus;
  name: string;
  description: string | null;
  modifiers: string[];
  flavorText: string | null;
}

export interface DraftTokenEntry {
  scarabId: string;
  token: string;
  candidateToken: string;
  uniquenessScore: number;
  lengthScore: number;
  stabilityScore: number;
  totalScore: number;
  candidateCount: number;
}

export interface DraftTokenCollisionGroup {
  token: string;
  scarabIds: string[];
}

export interface DraftTokenLowConfidence {
  scarabId: string;
  token: string;
  totalScore: number;
}

export interface DraftTokenChange {
  scarabId: string;
  previousToken: string;
  nextToken: string;
}

export interface DraftTokenExcludedRetired {
  scarabId: string;
  name: string;
}

export interface DraftTokenGenerationReport {
  collisions: DraftTokenCollisionGroup[];
  lowConfidence: DraftTokenLowConfidence[];
  changedTokens: DraftTokenChange[];
  excludedRetiredScarabs: DraftTokenExcludedRetired[];
}

export interface DraftTokenSet {
  id: string;
  createdByUserId: string;
  createdAt: string;
  inputFingerprint: string;
  itemCount: number;
  entries: DraftTokenEntry[];
  report: DraftTokenGenerationReport;
}

export interface PersistDraftTokenSetInput {
  id: string;
  createdByUserId: string;
  createdAt: string;
  inputFingerprint: string;
  entries: DraftTokenEntry[];
  report: DraftTokenGenerationReport;
}

export type TokenSetState = "draft" | "published" | "archived";

export interface PublishedTokenEntry {
  scarabId: string;
  token: string;
}

export interface PublishedTokenSet {
  id: string;
  state: TokenSetState;
  sourceDraftSetId: string;
  regexProfileName: string;
  createdByUserId: string;
  createdAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  entries: PublishedTokenEntry[];
}

export interface PublishTokenSetInput {
  id: string;
  sourceDraftSetId: string;
  regexProfileName: string;
  createdByUserId: string;
  createdAt: string;
  publishedAt: string;
  entries: PublishedTokenEntry[];
}

export interface PoeRegexViolation {
  token: string;
  reason: string;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  detailsJson: string | null;
  createdAt: string;
}

export interface AuditLogQueryOptions {
  limit: number;
  action?: string;
  pathContains?: string;
  actorUserId?: string;
}
