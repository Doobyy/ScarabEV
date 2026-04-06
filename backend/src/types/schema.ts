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
    status: "draft" | "active" | "retired";
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
  };
  scarab_text_versions: {
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
  };
  leagues: {
    id: string;
    code: string;
    name: string;
    starts_at: string | null;
    ends_at: string | null;
    is_active: 0 | 1;
    created_at: string;
    updated_at: string;
  };
  seasons: {
    id: string;
    league_id: string;
    code: string;
    name: string;
    starts_at: string | null;
    ends_at: string | null;
    created_at: string;
    updated_at: string;
  };
  draft_token_sets: {
    id: string;
    input_fingerprint: string;
    item_count: number;
    created_by_user_id: string;
    created_at: string;
  };
  draft_token_entries: {
    id: string;
    draft_set_id: string;
    scarab_id: string;
    token: string;
    candidate_token: string;
    uniqueness_score: number;
    length_score: number;
    stability_score: number;
    total_score: number;
    candidate_count: number;
    created_at: string;
  };
  draft_token_reports: {
    draft_set_id: string;
    collisions_json: string;
    low_confidence_json: string;
    changed_tokens_json: string;
    excluded_retired_json: string;
    created_at: string;
  };
  token_sets: {
    id: string;
    state: "draft" | "published" | "archived";
    source_draft_set_id: string;
    regex_profile_name: string;
    created_by_user_id: string;
    created_at: string;
    published_at: string | null;
    archived_at: string | null;
  };
  token_set_entries: {
    id: string;
    token_set_id: string;
    scarab_id: string;
    token: string;
    created_at: string;
  };
}

export type TableName = keyof DbScaffold;
