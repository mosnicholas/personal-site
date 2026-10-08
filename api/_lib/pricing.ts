/**
 * What an LLM call cost, from the token usage the API reports. Stored with
 * each trace, so spend can be added up per job, document, or model.
 *
 * Prices live in the `model_prices` table, one row per model per price
 * change, each with the date it took effect, so a call is always priced at
 * the rate that applied when it was made. The daily price check
 * (prices-check.ts) keeps the table in line with Anthropic's pricing page.
 */

import type { Sql } from './db.js';

/** USD per million tokens */
export interface TokenPrice {
  input: number;
  output: number;
  /** Cache writes with the default 5-minute lifetime */
  cacheWrite5m: number;
  /** Cache writes with the 1-hour lifetime */
  cacheWrite1h: number;
  cacheRead: number;
}

/** USD per million tokens, and per 1,000 web searches */
export interface Price extends TokenPrice {
  /** Web searches, per 1,000 */
  webSearch: number;
  /**
   * Higher token prices for prompts of more than `above` tokens (input,
   * cache writes and cache reads together), e.g. Haiku 5.5 over 100,000
   */
  longPrompt?: TokenPrice & { above: number };
}

export interface PriceRow extends Price {
  /** API model ID without a date suffix, e.g. claude-haiku-4-5 */
  model: string;
  /** First day (UTC, YYYY-MM-DD) these prices apply */
  effectiveFrom: string;
}

/**
 * The prices the table starts with: the models this site used when prices
 * moved into the database, from
 * https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-02.
 * The price check adds every other listed model on its first run.
 */
export const SEED_PRICES: PriceRow[] = [
  {
    model: 'claude-opus-5-5',
    effectiveFrom: '2026-10-02',
    input: 4,
    output: 20,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
    webSearch: 10,
  },
  {
    model: 'claude-sonnet-5-5',
    effectiveFrom: '2026-10-02',
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.2,
    webSearch: 10,
  },
  {
    model: 'claude-haiku-4-5',
    effectiveFrom: '2026-10-02',
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
    webSearch: 10,
  },
];

/**
 * The model a price row is keyed by: dated IDs (claude-haiku-4-5-20251001)
 * share their alias's price. Exact matches only, since one ID can prefix
 * another (claude-opus-5 and claude-opus-5-5)
 */
export const priceKey = (model: string) => model.replace(/-\d{8}$/, '');

const utcDate = (at: Date) => at.toISOString().slice(0, 10);

/**
 * The price for `model` at time `at`: the latest row that had taken effect
 * by then. Calls from before the model's first row use that row, since
 * prices are only recorded from when they were first seen
 */
export function priceAt(
  prices: PriceRow[],
  model: string,
  at: Date,
): Price | undefined {
  const day = utcDate(at);
  const rows = prices
    .filter((row) => row.model === priceKey(model))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return rows.findLast((row) => row.effectiveFrom <= day) ?? rows[0];
}

// Prices change rarely, so warm functions reuse them for a while
const CACHE_MS = 10 * 60_000;
let cache: { rows: PriceRow[]; at: number } | undefined;

export async function loadPrices(sql: Sql): Promise<PriceRow[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await sql`
      SELECT model, effective_from::text AS effective_from, input, output,
        cache_write_5m, cache_write_1h, cache_read, web_search, long_prompt
      FROM model_prices`;
    cache = {
      rows: rows.map((row) => ({
        model: row.model as string,
        effectiveFrom: row.effective_from as string,
        input: Number(row.input),
        output: Number(row.output),
        cacheWrite5m: Number(row.cache_write_5m),
        cacheWrite1h: Number(row.cache_write_1h),
        cacheRead: Number(row.cache_read),
        webSearch: Number(row.web_search),
        longPrompt:
          (row.long_prompt as Price['longPrompt'] | null) ?? undefined,
      })),
      at: Date.now(),
    };
  }
  return cache.rows;
}

/** Drops the cached prices, after the price check changes them */
export function clearPriceCache(): void {
  cache = undefined;
}

/** The `usage` object on an Anthropic message */
export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Undefined without a price for the model */
  costUsd: number | undefined;
}

/**
 * Token counts and cost for a response, priced with `price` (from priceAt,
 * for the model that answered, which can differ from the one asked for when
 * a fallback ran). Input, cache writes, cache reads, output, and web
 * searches each have their own rate, and a long prompt can have higher
 * token rates. Standard rates only: this site
 * doesn't use batch, fast mode, or US-only inference, which change them.
 */
export function tokenUsage(usage: Usage, price: Price | undefined): TokenUsage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
  // Without a breakdown, every cache write is the default 5-minute kind
  const writes1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const writes5m = cacheCreationInputTokens - writes1h;
  const promptTokens =
    inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  const rates =
    price?.longPrompt && promptTokens > price.longPrompt.above
      ? price.longPrompt
      : price;

  const costUsd =
    price && rates
      ? (inputTokens * rates.input +
          writes5m * rates.cacheWrite5m +
          writes1h * rates.cacheWrite1h +
          cacheReadInputTokens * rates.cacheRead +
          outputTokens * rates.output) /
          1_000_000 +
        ((usage.server_tool_use?.web_search_requests ?? 0) * price.webSearch) /
          1_000
      : undefined;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costUsd,
  };
}
