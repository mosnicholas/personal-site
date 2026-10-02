/**
 * Persistent log of every LLM call, so models and prompts can be compared
 * later: the exact request, the full response, and what the app did with it.
 *
 * Stored in Postgres (see db.ts). Tracing never breaks the caller: without
 * DATABASE_URL, or if a write fails, it logs and moves on.
 */

import { getSql } from './db.js';
import { tokenUsage, type Usage } from './pricing.js';

export type TraceKind =
  | 'chat'
  | 'tagging'
  | 'document_summary'
  | 'rebalance'
  | 'tag_glossary'
  | 'tag_brief'
  | 'weekly_summary'
  | 'reading_synthesis';

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

let warnedMissingUrl = false;

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
    // Token counts and cost exactly as the API reported them, as columns
    const response = trace.response as
      { model?: string; usage?: Usage } | undefined;
    const usage = response?.usage
      ? tokenUsage(response.model ?? trace.model, response.usage)
      : undefined;
    await sql`
      INSERT INTO llm_traces (
        kind, subject_id, model, request, response, result, latency_ms,
        error, git_sha, response_model, input_tokens, output_tokens,
        cache_creation_input_tokens, cache_read_input_tokens, cost_usd
      )
      VALUES (
        ${trace.kind},
        ${trace.subjectId ?? null},
        ${trace.model},
        ${toJson(trace.request)}::jsonb,
        ${toJson(trace.response)}::jsonb,
        ${toJson(trace.result)}::jsonb,
        ${Math.round(trace.latencyMs)},
        ${trace.error ?? null},
        ${process.env.VERCEL_GIT_COMMIT_SHA ?? null},
        ${response?.model ?? null},
        ${usage?.inputTokens ?? null},
        ${usage?.outputTokens ?? null},
        ${usage?.cacheCreationInputTokens ?? null},
        ${usage?.cacheReadInputTokens ?? null},
        ${usage?.costUsd ?? null}
      )`;
  } catch (error) {
    console.warn('Could not save LLM trace:', error);
  }
}

/**
 * Tag merges applied by earlier rebalance runs, old name -> new name, as they
 * stand now. Runs are read newest first, so when a later run reversed an
 * earlier merge (a -> b, then b -> a), the later one wins and the cycle is
 * dropped.
 */
export async function loadAppliedRenames(): Promise<Map<string, string>> {
  const renames = new Map<string, string>();
  const sqlPromise = getSql();
  if (!sqlPromise) return renames;
  try {
    const sql = await sqlPromise;
    const rows = await sql`
      SELECT result->'renames' AS renames FROM llm_traces
      WHERE kind = 'rebalance' AND result ? 'renames'
      ORDER BY created_at DESC`;
    const resolve = (name: string) => {
      for (let hops = 0; renames.has(name) && hops < 20; hops += 1) {
        name = renames.get(name)!;
      }
      return name;
    };
    for (const row of rows) {
      for (const [from, into] of Object.entries(
        (row.renames ?? {}) as Record<string, string>,
      )) {
        if (!renames.has(from) && resolve(into) !== from) {
          renames.set(from, into);
        }
      }
    }
  } catch (error) {
    console.warn('Could not load earlier tag merges:', error);
  }
  return renames;
}

// Neon's free plan blocks writes past 1 GB per project and doesn't warn first
const STORAGE_LIMIT_BYTES = 1024 ** 3;
const STORAGE_WARN_RATIO = 0.8;

const count = (n: unknown, noun: string) =>
  `${Number(n).toLocaleString('en-US')} ${noun}${Number(n) === 1 ? '' : 's'}`;

/**
 * A few lines for the weekly email: how full the database is (Neon gives no
 * warning), what the LLM calls cost this week, and any calls from a model
 * missing from pricing.ts, whose cost would otherwise go uncounted
 */
export async function describeTraceLog(): Promise<string> {
  const sqlPromise = getSql();
  if (!sqlPromise) return 'LLM trace log is off: DATABASE_URL is not set.';
  try {
    const sql = await sqlPromise;
    // Neon's 1 GB counts every database in the project, not just ours
    const [row] = await sql`
      SELECT
        (SELECT sum(pg_database_size(datname)) FROM pg_database
          WHERE has_database_privilege(datname, 'CONNECT')) AS bytes,
        (SELECT count(*) FROM llm_traces) AS calls,
        (SELECT count(*) FROM llm_traces
          WHERE created_at > now() - interval '7 days') AS week_calls,
        (SELECT coalesce(sum(cost_usd), 0) FROM llm_traces
          WHERE created_at > now() - interval '7 days') AS week_usd,
        (SELECT string_agg(DISTINCT response_model, ', ') FROM llm_traces
          WHERE created_at > now() - interval '7 days'
            AND response IS NOT NULL AND cost_usd IS NULL) AS unpriced`;
    const bytes = Number(row.bytes);
    const storage = `${Math.round(bytes / 1024 ** 2)} MB of 1 GB (${Math.round(
      (bytes / STORAGE_LIMIT_BYTES) * 100,
    )}%), ${count(row.calls, 'LLM call')}`;
    const lines = [
      bytes < STORAGE_LIMIT_BYTES * STORAGE_WARN_RATIO
        ? `LLM trace log: ${storage}.`
        : `LLM trace log is nearly full: ${storage}. New traces stop saving at 1 GB; delete old chat traces or upgrade the Neon plan.`,
      `AI spend in the last 7 days: $${Number(row.week_usd).toFixed(2)} over ${count(row.week_calls, 'call')}.`,
    ];
    if (row.unpriced) {
      lines.push(
        `No price on file for ${row.unpriced as string}, so this week's spend is undercounted: add it to api/_lib/pricing.ts.`,
      );
    }
    return lines.join(' ');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `LLM trace log: couldn't check it (${message}).`;
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
