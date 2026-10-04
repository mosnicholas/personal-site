// Additive, idempotent schema. Isolated from Readwise's public mirror.
export const LIKES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS liked_items (
    id text PRIMARY KEY, fingerprint text NOT NULL UNIQUE, kind text NOT NULL,
    url text, original_text text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'uncategorized',
    tags text[] NOT NULL DEFAULT '{}', description text NOT NULL DEFAULT '', brand text,
    extracted_text text NOT NULL DEFAULT '', identification text NOT NULL DEFAULT 'unknown',
    status text NOT NULL DEFAULT 'pending', archive_status text NOT NULL DEFAULT 'none',
    error text, source text NOT NULL DEFAULT 'web', manual_fields text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    last_shown_at timestamptz, snoozed_until timestamptz, dismissed boolean NOT NULL DEFAULT false,
    attempts integer NOT NULL DEFAULT 0, lease_id text, lease_until timestamptz,
    available_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE liked_items ADD COLUMN IF NOT EXISTS web_lookup jsonb NOT NULL DEFAULT '{"status":"none","sources":[],"checkedAt":null}'::jsonb`,
  `CREATE INDEX IF NOT EXISTS liked_items_full_text_search ON liked_items USING gin
    (to_tsvector('simple', title || ' ' || original_text || ' ' || note || ' ' || category || ' ' || description || ' ' || extracted_text))`,
  `CREATE TABLE IF NOT EXISTS likes_imports (
    id text PRIMARY KEY, idempotency_key text UNIQUE, original_text text NOT NULL,
    status text NOT NULL DEFAULT 'pending', created integer NOT NULL DEFAULT 0,
    duplicates integer NOT NULL DEFAULT 0, error text, attempts integer NOT NULL DEFAULT 0,
    lease_id text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    parsed_items jsonb, cursor integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS likes_captures (
    id text PRIMARY KEY, item_id text NOT NULL REFERENCES liked_items(id),
    idempotency_key text UNIQUE, payload jsonb NOT NULL, import_id text REFERENCES likes_imports(id),
    created_at timestamptz NOT NULL DEFAULT now(), duplicate boolean NOT NULL DEFAULT false
  )`,
  `ALTER TABLE likes_imports ADD COLUMN IF NOT EXISTS parse_cursor integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS parse_complete boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS likes_attachments (
    id text PRIMARY KEY, item_id text REFERENCES liked_items(id), role text NOT NULL,
    filename text NOT NULL, content_type text NOT NULL, bytes integer NOT NULL,
    sha256 text NOT NULL, storage_key text NOT NULL, backend text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS likes_settings (
    id integer PRIMARY KEY CHECK(id=1), digest_enabled boolean NOT NULL DEFAULT false,
    digest_count integer NOT NULL DEFAULT 5
  )`,
  `INSERT INTO likes_settings(id) VALUES (1) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS likes_digest_runs (
    week text PRIMARY KEY, status text NOT NULL, item_ids text[] NOT NULL DEFAULT '{}',
    lease_id text, lease_until timestamptz, sent_at timestamptz, error text
  )`,
  `CREATE TABLE IF NOT EXISTS likes_oauth_clients (
    client_id text PRIMARY KEY, client_name text NOT NULL DEFAULT '',
    redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE likes_oauth_clients ADD COLUMN IF NOT EXISTS approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
    ADD COLUMN IF NOT EXISTS metadata_hash text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS likes_oauth_clients_metadata ON likes_oauth_clients(metadata_hash)`,
  `CREATE TABLE IF NOT EXISTS likes_oauth_authorization_codes (
    code_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES likes_oauth_clients(client_id) ON DELETE CASCADE,
    redirect_uri text NOT NULL, code_challenge text NOT NULL, resource text NOT NULL,
    scope text NOT NULL DEFAULT 'likes', expires_at timestamptz NOT NULL,
    consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS likes_oauth_authorization_codes_live_idx ON likes_oauth_authorization_codes(expires_at) WHERE consumed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS likes_oauth_refresh_tokens (
    token_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES likes_oauth_clients(client_id) ON DELETE CASCADE,
    resource text NOT NULL, scope text NOT NULL DEFAULT 'likes', expires_at timestamptz NOT NULL,
    consumed_at timestamptz, replaced_by_hash text, created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS likes_oauth_refresh_tokens_live_idx ON likes_oauth_refresh_tokens(expires_at) WHERE consumed_at IS NULL`,
];
