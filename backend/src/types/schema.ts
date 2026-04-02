export interface DbScaffold {
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
