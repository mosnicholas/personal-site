/**
 * Step 1: pick documents for a run, spread across length bands, with their
 * full text and the summary production has for them now.
 *
 *   npm run eval:pick -- <run> [--per-band 7] [--seed <text>]
 *
 * The same run name (or seed) picks the same documents, so a later prompt
 * change can be compared on identical inputs.
 */

import { VERBATIM_MAX_WORDS } from '../../api/_lib/summarize.js';
import { type Doc, option, readonlySql, runArg, writeJson } from './lib.js';

// Documents at or under VERBATIM_MAX_WORDS are stored as their own summary,
// so there's nothing to judge
const BANDS: [number, number][] = [
  [VERBATIM_MAX_WORDS + 1, 800],
  [801, 1500],
  [1501, 3000],
  [3001, 6000],
  [6001, Infinity],
];

const run = runArg();
const perBand = Number(option('per-band') ?? 7);
const seed = option('seed') ?? run;
const sql = readonlySql();

const sizes = await sql`
  SELECT id, array_length(regexp_split_to_array(trim(text), '\\s+'), 1) AS words
  FROM document_texts
  ORDER BY md5(id || ${seed})`;
const picked = BANDS.flatMap(([low, high]) =>
  sizes
    .filter((row) => row.words >= low && row.words <= high)
    .slice(0, perBand)
    .map((row) => row.id as string),
);

const rows = await sql`
  SELECT d.id, d.title, d.author, d.site_name, d.category, d.summary,
    d.key_points, d.summary_model, t.text
  FROM documents d JOIN document_texts t USING (id)
  WHERE d.id = ANY(${picked})`;
const docs: Doc[] = rows
  .map((row) => ({
    id: row.id as string,
    title: row.title as string,
    author: row.author as string | null,
    site: row.site_name as string | null,
    category: row.category as string,
    words: sizes.find((size) => size.id === row.id)?.words as number,
    text: row.text as string,
    stored: {
      summary: (row.summary as string | null) ?? '',
      keyPoints: (row.key_points as string[] | null) ?? [],
      model: row.summary_model as string | null,
    },
  }))
  .sort((a, b) => a.words - b.words);

writeJson(run, 'docs.json', docs);
const versions = [...new Set(docs.map((doc) => doc.stored.model))].join(', ');
console.log(
  `Picked ${docs.length} documents (${perBand} per length band) into scripts/eval/runs/${run}/docs.json. Stored summaries are from: ${versions}`,
);
