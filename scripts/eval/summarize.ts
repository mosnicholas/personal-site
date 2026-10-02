/**
 * Step 2: write a candidate's summaries for a run's documents, with the
 * exact request production sends (api/_lib/summarize.ts).
 *
 *   npm run eval:summarize -- <run> --name live
 *   npm run eval:summarize -- <run> --name shorter --prompt my-prompt.txt
 *
 * Without --prompt it uses the live system prompt; with it, that file's text
 * replaces the system prompt and nothing else changes. The summaries
 * production already has are the candidate `stored`, with no step needed.
 */

import { readFileSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';

import {
  readSummary,
  SUMMARY_MODEL,
  summaryRequest,
  SYSTEM_PROMPT,
} from '../../api/_lib/summarize.js';
import { type Doc, option, readJson, runArg, writeJson } from './lib.js';

const CONCURRENCY = 6;

const run = runArg();
const name = option('name');
if (!name || name === 'stored') {
  throw new Error(
    'Name the candidate: --name live, or --name <x> --prompt <file>',
  );
}
const promptFile = option('prompt');
const system = promptFile
  ? readFileSync(promptFile, 'utf8').trim()
  : SYSTEM_PROMPT;

const docs = readJson<Doc[]>(run, 'docs.json');
const client = new Anthropic({ maxRetries: 6 });
const summaries: Record<string, string> = {};
const usage = { input: 0, output: 0 };

const queue = [...docs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      const request = summaryRequest(
        {
          title: doc.title,
          author: doc.author,
          site: doc.site,
          category: doc.category,
        },
        doc.text,
        system,
      );
      const response = await client.messages.stream(request).finalMessage();
      summaries[doc.id] = readSummary(response).summary;
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      process.stdout.write('.');
    }
  }),
);

writeJson(run, `candidates/${name}.json`, {
  model: SUMMARY_MODEL,
  system,
  summaries,
});
console.log(
  `\nWrote ${Object.keys(summaries).length} summaries to candidates/${name}.json (${usage.input.toLocaleString()} input, ${usage.output.toLocaleString()} output tokens)`,
);
