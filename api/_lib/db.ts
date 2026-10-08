/**
 * Postgres (Neon's free plan via the Vercel Marketplace, which sets
 * DATABASE_URL). Holds the LLM trace log and model prices, a mirror of the
 * Readwise library with each saved document's text and our summary, the tag
 * glossary, the likes collection (/likes), and a log of Readwise saves and
 * webhook deliveries.
 * Tables are created on first use; MIGRATIONS (below) change existing ones,
 * once each.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

import { priceAt, SEED_PRICES, tokenUsage, type Usage } from './pricing.js';

export type Sql = NeonQueryFunction<false, false>;

let ready: Promise<Sql> | undefined;

/**
 * The shared client once the schema exists, or undefined without DATABASE_URL
 */
export function getSql(): Promise<Sql> | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  ready ??= createSchema(neon(url)).catch((error: unknown) => {
    // Try again on the next call
    ready = undefined;
    throw error;
  });
  return ready;
}

/**
 * ILIKE patterns for each word of a search, so a row matches when every word
 * appears somewhere in it
 */
export const wordPatterns = (query: string) =>
  query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`);

/**
 * Like getSql, for callers that can't work without the database
 */
export async function requireSql(): Promise<Sql> {
  const sql = getSql();
  if (!sql) throw new Error('DATABASE_URL is not set');
  return sql;
}

async function createSchema(sql: Sql): Promise<Sql> {
  await sql`
    CREATE TABLE IF NOT EXISTS llm_traces (
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
      git_sha text
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS llm_traces_kind_subject
    ON llm_traces (kind, subject_id, created_at)`;

  // Readwise fields are overwritten by every sync; `summary` and `key_points`
  // are ours (written from the full text) and survive syncs
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
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
    )`;
  await sql`CREATE INDEX IF NOT EXISTS documents_tags ON documents USING gin (tags)`;
  await sql`CREATE INDEX IF NOT EXISTS documents_saved_at ON documents (saved_at)`;

  // Full text of saved documents, kept apart so queries on `documents` stay
  // light; used for summaries and the emails, and to redo summaries without
  // asking Readwise again
  await sql`
    CREATE TABLE IF NOT EXISTS document_texts (
      id text PRIMARY KEY,
      text text NOT NULL,
      chars integer NOT NULL,
      truncated boolean NOT NULL DEFAULT false,
      fetched_at timestamptz NOT NULL DEFAULT now()
    )`;

  // The glossary: a definition and cluster per tag (Opus, weekly), and a brief
  // on what the documents under it say (Sonnet, when the tag has grown)
  await sql`
    CREATE TABLE IF NOT EXISTS tags (
      name text PRIMARY KEY,
      definition text,
      cluster text,
      brief text,
      brief_documents integer,
      defined_at timestamptz,
      briefed_at timestamptz
    )`;

  // Things I like (/likes): links, notes and photos I save, with a title,
  // description, category and tags that Haiku fills in unless I set them
  // (likes.ts). `photo` was a private Vercel Blob URL, now `photos`
  // (migration 7); `claimed_at` keeps two workers off the same like
  await sql`
    CREATE TABLE IF NOT EXISTS likes (
      id text PRIMARY KEY,
      url text,
      text text NOT NULL DEFAULT '',
      note text NOT NULL DEFAULT '',
      photo text,
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
      emailed_at timestamptz
    )`;

  // What happened outside LLM calls, to check later: saves to Readwise and
  // every webhook delivery Readwise sends back (traces.ts, logEvent)
  await sql`
    CREATE TABLE IF NOT EXISTS event_log (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL,
      subject_id text,
      detail jsonb NOT NULL DEFAULT '{}',
      error text
    )`;

  // Resumable progress for long jobs, e.g. the library sync's page cursor
  await sql`
    CREATE TABLE IF NOT EXISTS sync_state (
      name text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  await migrate(sql);
  return sql;
}

// Changes to existing tables, each run once, in order. The applied version
// is kept in sync_state; reruns are harmless if two instances race
const MIGRATIONS: ((sql: Sql) => Promise<void>)[] = [
  // 1. Token usage and cost as columns on llm_traces (they were only inside
  // `response`), filled in for existing rows
  async (sql) => {
    await sql`
      ALTER TABLE llm_traces
        ADD COLUMN IF NOT EXISTS response_model text,
        ADD COLUMN IF NOT EXISTS input_tokens integer,
        ADD COLUMN IF NOT EXISTS output_tokens integer,
        ADD COLUMN IF NOT EXISTS cache_creation_input_tokens integer,
        ADD COLUMN IF NOT EXISTS cache_read_input_tokens integer,
        ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6)`;
    const rows = await sql`
      SELECT id, response->>'model' AS model, response->'usage' AS usage
      FROM llm_traces
      WHERE response ? 'usage' AND input_tokens IS NULL`;
    const updates = rows.map((row) => {
      const usage = tokenUsage(
        row.usage as Usage,
        priceAt(SEED_PRICES, (row.model as string | null) ?? '', new Date()),
      );
      return {
        id: String(row.id),
        response_model: row.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_creation_input_tokens: usage.cacheCreationInputTokens,
        cache_read_input_tokens: usage.cacheReadInputTokens,
        cost_usd: usage.costUsd ?? null,
      };
    });
    for (let i = 0; i < updates.length; i += 500) {
      await sql`
        UPDATE llm_traces t SET
          response_model = r.response_model,
          input_tokens = r.input_tokens,
          output_tokens = r.output_tokens,
          cache_creation_input_tokens = r.cache_creation_input_tokens,
          cache_read_input_tokens = r.cache_read_input_tokens,
          cost_usd = r.cost_usd
        FROM jsonb_to_recordset(${JSON.stringify(updates.slice(i, i + 500))}::jsonb)
          AS r(id bigint, response_model text, input_tokens integer,
            output_tokens integer, cache_creation_input_tokens integer,
            cache_read_input_tokens integer, cost_usd numeric)
        WHERE t.id = r.id`;
    }
  },

  // 2. Prices by date, so each call is priced at the rate in effect when it
  // was made; the daily price check (prices-check.ts) adds rows as they change
  async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS model_prices (
        model text NOT NULL,
        effective_from date NOT NULL,
        input numeric NOT NULL,
        output numeric NOT NULL,
        cache_write_5m numeric NOT NULL,
        cache_write_1h numeric NOT NULL,
        cache_read numeric NOT NULL,
        source text NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (model, effective_from)
      )`;
    await sql`
      INSERT INTO model_prices (model, effective_from, input, output,
        cache_write_5m, cache_write_1h, cache_read, source)
      SELECT model, effective_from, input, output, cache_write_5m,
        cache_write_1h, cache_read, 'pricing.ts seed'
      FROM jsonb_to_recordset(${JSON.stringify(
        SEED_PRICES.map((price) => ({
          model: price.model,
          effective_from: price.effectiveFrom,
          input: price.input,
          output: price.output,
          cache_write_5m: price.cacheWrite5m,
          cache_write_1h: price.cacheWrite1h,
          cache_read: price.cacheRead,
        })),
      )}::jsonb) AS r(model text, effective_from date, input numeric,
        output numeric, cache_write_5m numeric, cache_write_1h numeric,
        cache_read numeric)
      ON CONFLICT DO NOTHING`;
  },

  // 3. The web search price (USD per 1,000 searches) next to each model's
  // token prices, so calls that search the web are priced from the table
  // too. It was $10 for every model when this was added; the default also
  // covers rows written by code from before this column
  async (sql) => {
    await sql`
      ALTER TABLE model_prices
        ADD COLUMN IF NOT EXISTS web_search numeric NOT NULL DEFAULT 10`;
  },

  // 4. Likes backfilled over MCP skipped Haiku because Claude filled in
  // every field, with filler descriptions ("Uyuni Bolivia. Saved under
  // Places to travel to."), so they got no sources or picture. Their
  // descriptions and tags are cleared for Haiku to write (titles and
  // categories stay; where they were saved from is in their text), and
  // they and any other like without a picture are queued again
  async (sql) => {
    await sql`
      UPDATE likes SET description = '', tags = '{}'
      WHERE source = 'mcp' AND description LIKE '%Saved under%'`;
    await sql`
      UPDATE likes SET status = 'pending', attempts = 0, error = NULL,
        claimed_at = NULL
      WHERE description = '' OR (image_url IS NULL AND photo IS NULL)`;
  },

  // 5. The 27 likes still without a picture after that (mostly clothing
  // brands, whose stores block servers or whose preview image is a logo or
  // missing) are queued again, now that photos on source pages count too
  async (sql) => {
    await sql`
      UPDATE likes SET status = 'pending', attempts = 0, error = NULL,
        claimed_at = NULL
      WHERE image_url IS NULL AND photo IS NULL`;
  },

  // 6. Where I stand with a like (`list`: "want to try", "been", or my own
  // words) and what I thought of it (`review`). Backfilled likes say in their
  // text which of my old lists they came from: those from the lists of places,
  // restaurants and events to try, and of favorite restaurants and best shows,
  // get theirs; the rest stay unset
  async (sql) => {
    await sql`
      ALTER TABLE likes
        ADD COLUMN IF NOT EXISTS list text,
        ADD COLUMN IF NOT EXISTS review text NOT NULL DEFAULT ''`;
    await sql`
      UPDATE likes SET list = 'want to try'
      WHERE list IS NULL AND split_part(text, chr(10), 1) IN (
        'Original section: Places to travel to',
        'Original section: Restaurant to try',
        'Original section: Events to travel for')`;
    await sql`
      UPDATE likes SET list = 'been'
      WHERE list IS NULL AND split_part(text, chr(10), 1) IN (
        'Original section: Favorite restaurants',
        'Original section: Best live shows')`;
  },

  // 7. More than one photo per like: `photos` (private Vercel Blob URLs, the
  // first one the cover) takes over from `photo`
  async (sql) => {
    await sql`
      ALTER TABLE likes ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}'`;
    await sql`
      UPDATE likes SET photos = ARRAY[photo]
      WHERE photo IS NOT NULL AND photos = '{}'`;
    await sql`ALTER TABLE likes DROP COLUMN photo`;
  },
];

async function migrate(sql: Sql): Promise<void> {
  const [row] = await sql`SELECT value FROM sync_state WHERE name = 'schema'`;
  const applied = Number(
    (row?.value as { version?: number } | undefined)?.version ?? 0,
  );
  for (let version = applied + 1; version <= MIGRATIONS.length; version += 1) {
    await MIGRATIONS[version - 1](sql);
    await sql`
      INSERT INTO sync_state (name, value, updated_at)
      VALUES ('schema', ${JSON.stringify({ version })}::jsonb, now())
      ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`;
  }
}
