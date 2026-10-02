/**
 * What an LLM call cost, from the token usage the API reports. Stored with
 * each trace, so spend can be added up per job, document, or model.
 */

/** USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (October 2026) */
interface Price {
  input: number;
  output: number;
  /** Cache writes with the default 5-minute lifetime */
  cacheWrite5m: number;
  /** Cache writes with the 1-hour lifetime */
  cacheWrite1h: number;
  cacheRead: number;
}

// Matched by prefix, so dated IDs (claude-haiku-4-5-20251001) price too
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': {
    input: 4,
    output: 20,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.2,
  },
  'claude-haiku-4-5': {
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
};

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
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Undefined for a model missing from PRICES */
  costUsd: number | undefined;
}

/**
 * Token counts and cost for a response from `model` (the model that
 * answered, which can differ from the one asked for when a fallback ran).
 * Input, cache writes, cache reads, and output each have their own rate.
 */
export function tokenUsage(model: string, usage: Usage): TokenUsage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
  // Without a breakdown, every cache write is the default 5-minute kind
  const writes1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const writes5m = cacheCreationInputTokens - writes1h;

  const price = Object.entries(PRICES).find(([prefix]) =>
    model.startsWith(prefix),
  )?.[1];
  const costUsd = price
    ? (inputTokens * price.input +
        writes5m * price.cacheWrite5m +
        writes1h * price.cacheWrite1h +
        cacheReadInputTokens * price.cacheRead +
        outputTokens * price.output) /
      1_000_000
    : undefined;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costUsd,
  };
}
