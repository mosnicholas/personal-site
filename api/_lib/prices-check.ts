/**
 * Daily price check, run by api/update-prices.ts. Reads the model price
 * table and the web search price on Anthropic's pricing page, compares them
 * with the latest prices in `model_prices`, and records each new model or
 * changed price with today as the date it took effect. Then fills in the
 * cost of any call that had no price when it was made.
 *
 * No LLM: a strict parser that refuses to guess. If the page layout changes,
 * nothing is written and the check fails with the reason; a row it can't
 * read, or whose prices don't look like Anthropic's (output above input,
 * cache reads below it), is left out and reported.
 */

import { type Sql } from './db.js';
import {
  clearPriceCache,
  loadPrices,
  type Price,
  priceAt,
  type TokenPrice,
  tokenUsage,
  type Usage,
} from './pricing.js';

/** The pricing page as Markdown */
export const PRICING_URL =
  'https://platform.claude.com/docs/en/about-claude/pricing.md';

// The price table's columns, in order, after the model name
const COLUMNS: [keyof TokenPrice, string][] = [
  ['input', 'base input tokens'],
  ['cacheWrite5m', '5m cache writes'],
  ['cacheWrite1h', '1h cache writes'],
  ['cacheRead', 'cache hits and refreshes'],
  ['output', 'output tokens'],
];

export interface ListedPrices {
  prices: Map<string, Price>;
  /** Rows that couldn't be read or don't look like real prices */
  rejected: { row: string; reason: string }[];
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

// Drops footnote markers and Markdown links, keeping the link text
const plain = (cell: string) =>
  cell
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

/** Why a price doesn't look like one of Anthropic's, if it doesn't */
function implausible(price: TokenPrice): string | undefined {
  if (Object.values(price).some((value) => !(value > 0))) {
    return 'a price is zero';
  }
  if (price.output <= price.input) return 'output is not above input';
  if (price.cacheRead >= price.input) return 'cache reads are not below input';
  if (
    price.cacheWrite5m < price.input ||
    price.cacheWrite1h < price.cacheWrite5m
  ) {
    return 'cache writes are below input';
  }
  return undefined;
}

// "(for prompts up to 100,000 tokens)": a model priced by prompt length has
// a row for each length
const PROMPT_LENGTH = /\(for prompts (up to|over) ([\d,]+) tokens\)/i;

/**
 * The model price table from the pricing page's Markdown, keyed by API
 * model ID ("Claude Opus 5.5" -> claude-opus-5-5). A model priced by prompt
 * length gets the short-prompt prices, with the long-prompt ones as
 * `longPrompt`
 */
export function parsePricingPage(markdown: string): ListedPrices {
  const lines = markdown.split('\n');
  const heading = lines.findIndex((line) =>
    /^##\s+Model pricing\s*$/i.test(line.trim()),
  );
  if (heading < 0) throw new Error('No "Model pricing" section on the page');
  const start = lines.findIndex(
    (line, i) => i > heading && line.trim().startsWith('|'),
  );
  if (start < 0) throw new Error('No table under "Model pricing"');

  const header = cells(lines[start]).map((cell) => plain(cell).toLowerCase());
  const expected = ['model', ...COLUMNS.map(([, name]) => name)];
  if (header.join(' | ') !== expected.join(' | ')) {
    throw new Error(`The price table's columns changed: ${header.join(' | ')}`);
  }

  const prices = new Map<string, Price>();
  const longPrompts = new Map<string, Price['longPrompt']>();
  const rejected: ListedPrices['rejected'] = [];
  // Skip the header and its |---| line
  for (
    let i = start + 2;
    i < lines.length && lines[i].trim().startsWith('|');
    i += 1
  ) {
    const row = cells(lines[i]);
    const length = plain(row[0]).match(PROMPT_LENGTH);
    // "Claude Mythos 5.1 (limited availability)" -> "Claude Mythos 5.1"
    const name = plain(row[0]).replace(/\s*\(.*\)\s*$/, '');
    const reject = (reason: string) => rejected.push({ row: name, reason });

    if (row.length !== expected.length) {
      reject(`${row.length} columns instead of ${expected.length}`);
      continue;
    }
    if (!/^Claude [A-Za-z]+ \d+(\.\d+)?$/.test(name)) {
      reject('not a model name this check knows how to turn into an ID');
      continue;
    }
    const price = {} as Price;
    const unreadable = COLUMNS.find(([key], j) => {
      const match = plain(row[j + 1]).match(/^\$(\d+(?:\.\d+)?) \/ MTok$/);
      if (match) price[key] = Number(match[1]);
      return !match;
    });
    if (unreadable) {
      reject(`can't read "${row[COLUMNS.indexOf(unreadable) + 1]}"`);
      continue;
    }
    const problem = implausible(price);
    if (problem) {
      reject(problem);
      continue;
    }
    const model = name.toLowerCase().replace(/[ .]/g, '-');
    if (length?.[1].toLowerCase() === 'over') {
      longPrompts.set(model, {
        ...price,
        above: Number(length[2].replace(/,/g, '')),
      });
    } else prices.set(model, price);
  }
  for (const [model, longPrompt] of longPrompts) {
    const price = prices.get(model);
    if (price) price.longPrompt = longPrompt;
    else rejected.push({ row: model, reason: 'long-prompt prices only' });
  }

  if (prices.size === 0) throw new Error('No readable rows in the price table');
  const webSearch = parseWebSearchPrice(markdown);
  for (const price of prices.values()) price.webSearch = webSearch;
  return { prices, rejected };
}

/**
 * The web search price, USD per 1,000 searches. The page states it in prose
 * ("$10 per 1,000 searches"), the same for every model
 */
export function parseWebSearchPrice(markdown: string): number {
  const listed = new Set(
    [...markdown.matchAll(/\$(\d+(?:\.\d+)?) per 1,000 searches/g)].map(
      ([, price]) => Number(price),
    ),
  );
  if (listed.size !== 1) {
    throw new Error(
      listed.size === 0
        ? 'No web search price on the page'
        : `The page lists different web search prices: ${[...listed].join(', ')}`,
    );
  }
  return [...listed][0];
}

/** The last check's outcome, in sync_state; the weekly email warns from it */
export const PRICE_CHECK_STATE = 'price_check';

export interface PriceCheckState {
  checkedAt: string;
  ok: boolean;
  error?: string;
  /** When the current run of failures started */
  failingSince?: string;
  rejected?: ListedPrices['rejected'];
}

export interface PriceCheckReport {
  listed: number;
  added: { model: string; price: Price }[];
  changed: { model: string; before: Price; after: Price }[];
  rejected: ListedPrices['rejected'];
  /** Models with prices on file that the page no longer lists */
  unlisted: string[];
  /** Earlier calls that now have a cost */
  costsFilled: number;
}

const sameRates = (a: TokenPrice, b: TokenPrice) =>
  COLUMNS.every(([key]) => Math.abs(a[key] - b[key]) < 1e-9);

const samePrice = (a: Price, b: Price) =>
  sameRates(a, b) &&
  Math.abs(a.webSearch - b.webSearch) < 1e-9 &&
  (a.longPrompt && b.longPrompt
    ? a.longPrompt.above === b.longPrompt.above &&
      sameRates(a.longPrompt, b.longPrompt)
    : !a.longPrompt && !b.longPrompt);

export async function checkPrices(
  sql: Sql,
  today = new Date().toISOString().slice(0, 10),
): Promise<PriceCheckReport> {
  const response = await fetch(PRICING_URL, {
    headers: { Accept: 'text/markdown' },
  });
  if (!response.ok) {
    throw new Error(`The pricing page answered ${response.status}`);
  }
  const { prices: listed, rejected } = parsePricingPage(await response.text());

  // The latest prices on file, per model
  const latest = new Map<string, Price>();
  const onFile = await loadPrices(sql);
  for (const row of [...onFile].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  )) {
    latest.set(row.model, row);
  }

  // Models are rarely delisted (retired ones stay, marked retired), so most
  // of ours missing means the table was cut short
  const unlisted = [...latest.keys()].filter((model) => !listed.has(model));
  if (unlisted.length > latest.size / 2) {
    throw new Error(
      `The price table lists ${listed.size} models and leaves out ${unlisted.length} of the ${latest.size} on file; it looks cut short`,
    );
  }

  const added: PriceCheckReport['added'] = [];
  const changed: PriceCheckReport['changed'] = [];
  for (const [model, price] of listed) {
    const before = latest.get(model);
    if (!before) added.push({ model, price });
    else if (!samePrice(before, price)) {
      const { input, output, cacheWrite5m, cacheWrite1h, cacheRead } = before;
      const { webSearch, longPrompt } = before;
      changed.push({
        model,
        before: {
          input,
          output,
          cacheWrite5m,
          cacheWrite1h,
          cacheRead,
          webSearch,
          longPrompt,
        },
        after: price,
      });
    }
  }

  const rows = [
    ...added,
    ...changed.map(({ model, after }) => ({ model, price: after })),
  ].map(({ model, price }) => ({
    model,
    effective_from: today,
    input: price.input,
    output: price.output,
    cache_write_5m: price.cacheWrite5m,
    cache_write_1h: price.cacheWrite1h,
    cache_read: price.cacheRead,
    web_search: price.webSearch,
    long_prompt: price.longPrompt ?? null,
    source: PRICING_URL,
  }));
  if (rows.length > 0) {
    await sql`
      INSERT INTO model_prices (model, effective_from, input, output,
        cache_write_5m, cache_write_1h, cache_read, web_search, long_prompt,
        source)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS r(model text, effective_from date, input numeric, output numeric,
          cache_write_5m numeric, cache_write_1h numeric, cache_read numeric,
          web_search numeric, long_prompt jsonb, source text)
      ON CONFLICT (model, effective_from) DO UPDATE SET
        input = excluded.input,
        output = excluded.output,
        cache_write_5m = excluded.cache_write_5m,
        cache_write_1h = excluded.cache_write_1h,
        cache_read = excluded.cache_read,
        web_search = excluded.web_search,
        long_prompt = excluded.long_prompt,
        source = excluded.source,
        recorded_at = now()`;
    clearPriceCache();
  }

  return {
    listed: listed.size,
    added,
    changed,
    rejected,
    unlisted: unlisted.sort(),
    costsFilled: await fillMissingCosts(sql),
  };
}

/**
 * Prices calls saved without a cost (a model with no price yet), each at the
 * rate in effect when it was made
 */
async function fillMissingCosts(sql: Sql): Promise<number> {
  const rows = await sql`
    SELECT id, created_at, response_model, response->'usage' AS usage
    FROM llm_traces
    WHERE cost_usd IS NULL AND response_model IS NOT NULL
      AND response ? 'usage'`;
  if (rows.length === 0) return 0;

  const prices = await loadPrices(sql);
  const updates = rows.flatMap((row) => {
    const price = priceAt(
      prices,
      row.response_model as string,
      new Date(row.created_at as string | Date),
    );
    const { costUsd } = tokenUsage(row.usage as Usage, price);
    return costUsd === undefined
      ? []
      : [{ id: String(row.id), cost_usd: costUsd }];
  });
  for (let i = 0; i < updates.length; i += 500) {
    await sql`
      UPDATE llm_traces t SET cost_usd = r.cost_usd
      FROM jsonb_to_recordset(${JSON.stringify(updates.slice(i, i + 500))}::jsonb)
        AS r(id bigint, cost_usd numeric)
      WHERE t.id = r.id`;
  }
  return updates.length;
}
