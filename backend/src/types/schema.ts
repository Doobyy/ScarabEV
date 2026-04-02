export interface DbScaffold {
  admin_users: {
    id: string;
    username: string;
    role: "owner" | "editor";
    is_active: 0 | 1;
    created_at: string;
    updated_at: string;
  };
  auth_sessions: {
    id: string;
    user_id: string;
    csrf_token: string;
    expires_at: string;
    last_rotated_at: string;
    last_seen_at: string;
    revoked_at: string | null;
  };
  rate_limits: {
    scope: string;
    subject: string;
    window_start: number;
    count: number;
    updated_at: string;
  };
  audit_logs: {
    id: string;
    actor_user_id: string | null;
    action: string;
    method: string;
    path: string;
    status_code: number;
    request_id: string;
    created_at: string;
  };
  scarabs: {
    id: string;
    created_at: string;
    updated_at: string;
  };
  scarab_text_versions: {
    id: string;
    scarab_id: string;
    version: number;
    created_at: string;
  };
}

export type TableName = keyof DbScaffold;
