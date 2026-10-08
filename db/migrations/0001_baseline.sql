-- The schema as it was on Neon when the site moved to Supabase (Oct 2026),
-- after the 12 migrations that used to run from api/_lib/db.ts.
--
-- Row level security is on with no policies, so Supabase's Data API (anon
-- and authenticated keys) can't read or write anything; the site connects as
-- the postgres role, which owns the tables and bypasses it.

-- LLM calls (api/_lib/traces.ts), with token usage and cost
CREATE TABLE llm_traces (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  subject_id text,
  model text NOT NULL,
  request jsonb NOT NULL,
  response jsonb,
  result jsonb,
  latency_ms integer NOT NULL,
  error text,
  git_sha text,
  response_model text,
  input_tokens integer,
  output_tokens integer,
  cache_creation_input_tokens integer,
  cache_read_input_tokens integer,
  cost_usd numeric(12, 6)
);
CREATE INDEX llm_traces_kind_subject ON llm_traces (kind, subject_id, created_at);

-- The Readwise library mirror. Readwise fields are overwritten by every sync;
-- `summary` and `key_points` are ours (written from the full text) and
-- survive syncs
CREATE TABLE documents (
  id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  author text,
  url text,
  source_url text,
  site_name text,
  category text,
  location text,
  saved_at timestamptz,
  updated_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  reading_progress real NOT NULL DEFAULT 0,
  word_count integer,
  readwise_summary text,
  tags text[] NOT NULL DEFAULT '{}',
  summary text,
  key_points jsonb,
  summary_model text,
  summarized_at timestamptz,
  summary_attempts integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_tags ON documents USING gin (tags);
CREATE INDEX documents_saved_at ON documents (saved_at);

-- Each saved document's full text, apart from `documents` so metadata
-- queries stay light (and the texts can move to blob storage later)
CREATE TABLE document_texts (
  id text PRIMARY KEY,
  text text NOT NULL,
  chars integer NOT NULL,
  truncated boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- The tag glossary: definitions and clusters (Opus), public briefs (Sonnet)
CREATE TABLE tags (
  name text PRIMARY KEY,
  definition text,
  cluster text,
  brief text,
  brief_documents integer,
  defined_at timestamptz,
  briefed_at timestamptz
);

-- Dated model prices (api/_lib/pricing.ts); web_search is USD per 1,000
CREATE TABLE model_prices (
  model text NOT NULL,
  effective_from date NOT NULL,
  input numeric NOT NULL,
  output numeric NOT NULL,
  cache_write_5m numeric NOT NULL,
  cache_write_1h numeric NOT NULL,
  cache_read numeric NOT NULL,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  web_search numeric NOT NULL DEFAULT 10,
  long_prompt jsonb,
  PRIMARY KEY (model, effective_from)
);

-- What happens outside LLM calls: crons, emails, MCP calls, Readwise saves
-- and webhook deliveries
CREATE TABLE event_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  subject_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  error text
);

-- Resumable progress for long jobs and small bits of state, e.g. the library
-- sync's page cursor
CREATE TABLE sync_state (
  name text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The likes collection (/likes)
CREATE TABLE likes (
  id text PRIMARY KEY,
  url text,
  text text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  image_url text,
  sources jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  source text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz,
  list text,
  review text NOT NULL DEFAULT '',
  photos text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE llm_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
