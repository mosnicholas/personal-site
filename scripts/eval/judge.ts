/**
 * Step 3: have a Claude model judge every candidate through the API.
 *
 *   npm run eval:judge -- <run> [--model claude-opus-5-5] [--candidates stored,live]
 *
 * For each document the judge first lists key points from the document
 * alone, then grades each candidate in its own call, without being told
 * which candidate it is: key points covered, statements the document doesn't
 * support, and readability. Writes judges/<model>.json and picks up where a
 * stopped run left off. To judge with a model the API key can't use (e.g.
 * Fable 5.1 without data retention), use agents.ts instead.
 */

import { existsSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';

import { loadPrices, priceAt, tokenUsage } from '../../api/_lib/pricing.js';
import {
  candidateNames,
  type Doc,
  type Grade,
  type Judged,
  type KeyPoint,
  loadCandidates,
  option,
  readJson,
  readonlySql,
  runArg,
  runPath,
  writeJson,
} from './lib.js';
import {
  EXTRACT_PROMPT,
  GRADE_SCHEMA,
  KEY_POINTS_SCHEMA,
  SCORE_PROMPT,
} from './prompts.js';

const CONCURRENCY = 6;

const run = runArg();
const model = option('model') ?? 'claude-opus-5-5';
const names = candidateNames(run);
const docs = readJson<Doc[]>(run, 'docs.json');
const candidates = loadCandidates(run, names);
const outFile = `judges/${model}.json`;
const judged: Judged[] = existsSync(runPath(run, outFile))
  ? readJson<Judged[]>(run, outFile)
  : [];

const client = new Anthropic({ maxRetries: 6 });
const prices = await loadPrices(readonlySql()).catch(() => []);
let costUsd = 0;
let unpriced = false;

async function ask<T>(
  system: string,
  content: string | Anthropic.TextBlockParam[],
  schema: Record<string, unknown>,
): Promise<T> {
  const response = await client.messages
    .stream({
      model,
      max_tokens: 32000,
      system,
      messages: [{ role: 'user', content }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema },
      },
    })
    .finalMessage();
  const cost = tokenUsage(
    response.usage,
    priceAt(prices, response.model, new Date()),
  ).costUsd;
  if (cost === undefined) unpriced = true;
  costUsd += cost ?? 0;
  if (response.stop_reason !== 'end_turn') {
    throw new Error(`Judge stopped early (${response.stop_reason})`);
  }
  return JSON.parse(
    response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join(''),
  ) as T;
}

async function judgeDocument(doc: Doc): Promise<Judged> {
  const source = JSON.stringify({
    title: doc.title,
    author: doc.author,
    site: doc.site,
    text: doc.text,
  });
  const { key_points: keyPoints } = await ask<{ key_points: KeyPoint[] }>(
    EXTRACT_PROMPT,
    source,
    KEY_POINTS_SCHEMA,
  );
  // The document and key points are the same for every candidate, so cache them
  const shared: Anthropic.TextBlockParam = {
    type: 'text',
    text: `Document:\n${source}\n\nKey points:\n${keyPoints.map((k, i) => `${i + 1}. ${k.point}`).join('\n')}`,
    cache_control: { type: 'ephemeral' },
  };
  const grades: Record<string, Grade> = {};
  for (const name of names) {
    grades[name] = await ask<Grade>(
      SCORE_PROMPT,
      [shared, { type: 'text', text: `Summary:\n${candidates[name][doc.id]}` }],
      GRADE_SCHEMA,
    );
  }
  return { id: doc.id, keyPoints, grades };
}

const done = new Set(
  judged.filter((j) => names.every((name) => j.grades[name])).map((j) => j.id),
);
const queue = docs.filter((doc) => !done.has(doc.id));
let failed = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      try {
        const result = await judgeDocument(doc);
        const at = judged.findIndex((j) => j.id === doc.id);
        if (at >= 0) judged[at] = result;
        else judged.push(result);
        writeJson(run, outFile, judged);
        process.stdout.write('.');
      } catch (error) {
        failed += 1;
        console.warn(`\nCould not judge ${doc.id}:`, error);
      }
    }
  }),
);

console.log(
  `\n${model} judged ${judged.length} of ${docs.length} documents (${failed} failed) for ${names.join(', ')}. Cost this run: $${costUsd.toFixed(2)}${unpriced ? ' (some calls had no price on file)' : ''}. Next: npm run eval:report -- ${run}`,
);
