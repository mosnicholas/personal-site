/**
 * Persistent log of every LLM call, so models and prompts can be compared
 * later: the exact request, the full response, and what the app did with it.
 *
 * Stored in Postgres (Neon's free plan via the Vercel Marketplace, which sets
 * DATABASE_URL). The table is created on first use. Tracing never breaks the
 * caller: without DATABASE_URL, or if a write fails, it logs and moves on.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export type TraceKind = 'chat' | 'tagging' | 'rebalance' | 'weekly_summary';

export interface Trace {
  kind: TraceKind;
  /** What the call was about, e.g. the Readwise document id when tagging */
  subjectId?: string | null;
  model: string;
  /** The exact parameters sent to the API, enough to replay the call */
  request: unknown;
  /** The full API response */
  response?: unknown;
  /** What the app did with the response, e.g. the tags it wrote */
  result?: unknown;
  latencyMs: number;
  error?: string;
}

type Sql = NeonQueryFunction<false, false>;

let ready: Promise<Sql> | undefined;
let warnedMissingUrl = false;

function getSql(): Promise<Sql> | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  ready ??= (async () => {
    const sql = neon(url);
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
    return sql;
  })();
  return ready;
}

const toJson = (value: unknown) =>
  value === undefined ? null : JSON.stringify(value);

export async function recordTrace(trace: Trace): Promise<void> {
  try {
    const sqlPromise = getSql();
    if (!sqlPromise) {
      if (!warnedMissingUrl) {
        console.warn('DATABASE_URL is not set - LLM traces are not saved');
        warnedMissingUrl = true;
      }
      return;
    }
    const sql = await sqlPromise;
    await sql`
      INSERT INTO llm_traces
        (kind, subject_id, model, request, response, result, latency_ms, error, git_sha)
      VALUES (
        ${trace.kind},
        ${trace.subjectId ?? null},
        ${trace.model},
        ${toJson(trace.request)}::jsonb,
        ${toJson(trace.response)}::jsonb,
        ${toJson(trace.result)}::jsonb,
        ${Math.round(trace.latencyMs)},
        ${trace.error ?? null},
        ${process.env.VERCEL_GIT_COMMIT_SHA ?? null}
      )`;
  } catch (error) {
    // Retry table setup on the next call in case that's what failed
    ready = undefined;
    console.warn('Could not save LLM trace:', error);
  }
}

// Neon's free plan blocks writes past 1 GB per project and doesn't warn first
const STORAGE_LIMIT_BYTES = 1024 ** 3;
const STORAGE_WARN_RATIO = 0.8;

/**
 * One line on how full the trace database is, for the weekly email
 */
export async function describeTraceStorage(): Promise<string> {
  const sqlPromise = getSql();
  if (!sqlPromise) return 'LLM trace log is off: DATABASE_URL is not set.';
  try {
    const sql = await sqlPromise;
    const [row] = await sql`
      SELECT pg_database_size(current_database()) AS bytes,
             (SELECT count(*) FROM llm_traces) AS calls`;
    const bytes = Number(row.bytes);
    const usage = `${Math.round(bytes / 1024 ** 2)} MB of 1 GB (${Math.round(
      (bytes / STORAGE_LIMIT_BYTES) * 100,
    )}%), ${Number(row.calls).toLocaleString('en-US')} LLM calls`;
    return bytes < STORAGE_LIMIT_BYTES * STORAGE_WARN_RATIO
      ? `LLM trace log: ${usage}.`
      : `LLM trace log is nearly full: ${usage}. New traces stop saving at 1 GB; delete old chat traces or upgrade the Neon plan.`;
  } catch (error) {
    ready = undefined;
    const message = error instanceof Error ? error.message : String(error);
    return `LLM trace log: couldn't check its size (${message}).`;
  }
}

/**
 * Makes an LLM call and records it. `interpret` turns the response into what
 * the app uses; the response is recorded even when that step throws.
 */
export async function tracedCall<Response, Result>(
  trace: Pick<Trace, 'kind' | 'subjectId' | 'model' | 'request'>,
  call: () => Promise<Response>,
  interpret: (response: Response) => Result,
): Promise<Result> {
  const started = Date.now();
  let response: Response | undefined;
  try {
    response = await call();
    const result = interpret(response);
    await recordTrace({
      ...trace,
      response,
      result,
      latencyMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordTrace({
      ...trace,
      response,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
