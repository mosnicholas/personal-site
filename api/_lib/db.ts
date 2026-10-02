/**
 * Postgres (Neon's free plan via the Vercel Marketplace, which sets
 * DATABASE_URL). Holds the LLM trace log, a mirror of the Readwise library
 * with each saved document's text and our summary, and the tag glossary.
 * Tables are created on first use, so there's no migration step.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

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

  // Resumable progress for long jobs, e.g. the library sync's page cursor
  await sql`
    CREATE TABLE IF NOT EXISTS sync_state (
      name text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  return sql;
}
