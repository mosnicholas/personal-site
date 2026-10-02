/**
 * Step 3, alternative: judge with Claude Code agents instead of the API, e.g.
 * to use Fable 5.1, which an API key without data retention can't call.
 *
 *   npm run eval:agents -- <run> prepare [--candidates stored,live] [--extractors 4] [--graders 5]
 *   (then in Claude Code: "run the agent prompts in
 *    scripts/eval/runs/<run>/agents/PROMPTS.md with Fable: extractors first, then graders")
 *   npm run eval:agents -- <run> collect [--judge claude-fable-5-1]
 *
 * `prepare` writes each document as a text file and its candidates as A, B,
 * C… in a shuffled order per document (the key stays in agents/private/), and
 * writes one prompt per agent. Extractors read documents only; graders read
 * the document, its key points and the shuffled candidates. `collect` maps
 * the letters back and writes judges/<judge>-agents.json for the report.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  candidateNames,
  type Doc,
  type Grade,
  type Judged,
  type KeyPoint,
  loadCandidates,
  option,
  readJson,
  runArg,
  runPath,
  writeJson,
} from './lib.js';
import { EXTRACT_PROMPT, SCORE_PROMPT } from './prompts.js';

const run = runArg();
const command = process.argv[3];
const dir = fileURLToPath(runPath(run, 'agents/'));
const docs = readJson<Doc[]>(run, 'docs.json');

/** Splits documents into `n` groups of about the same total length */
function groups(n: number): string[][] {
  const out = Array.from({ length: n }, () => ({
    ids: [] as string[],
    words: 0,
  }));
  for (const doc of [...docs].sort((a, b) => b.words - a.words)) {
    const lightest = out.reduce((a, b) => (a.words <= b.words ? a : b));
    lightest.ids.push(doc.id);
    lightest.words += doc.words;
  }
  return out.map((group) => group.ids).filter((ids) => ids.length > 0);
}

function prepare() {
  const names = candidateNames(run);
  const candidates = loadCandidates(run, names);
  const letters = names.map((_, i) => String.fromCharCode(65 + i));
  const mapping: Record<string, Record<string, string>> = {};
  for (const sub of ['docs', 'keypoints', 'grades']) {
    mkdirSync(`${dir}${sub}`, { recursive: true });
  }
  for (const doc of docs) {
    writeFileSync(
      `${dir}docs/${doc.id}.txt`,
      `Title: ${doc.title}\nAuthor: ${doc.author ?? 'unknown'}\nSite: ${doc.site ?? 'unknown'}\nType: ${doc.category}\n\n${doc.text}\n`,
    );
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    mapping[doc.id] = Object.fromEntries(
      letters.map((l, i) => [l, shuffled[i]]),
    );
    writeJson(
      run,
      `agents/summaries/${doc.id}.json`,
      Object.fromEntries(
        letters.map((l, i) => [l, candidates[shuffled[i]][doc.id]]),
      ),
    );
  }
  writeJson(run, 'agents/private/mapping.json', mapping);

  const labelList = letters.join(', ');
  const extract = groups(Number(option('extractors') ?? 4)).map(
    (ids, i) => `## Extractor ${i + 1}

${EXTRACT_PROMPT} Your key points become the yardstick summaries are scored against, so they must come from the document alone.

Directory: ${dir}

For each of these document IDs: ${ids.join(' ')}

1. Read \`docs/<id>.txt\` in full. Read only files in \`docs/\`; don't open \`summaries/\`, \`grades/\` or \`private/\`.
2. Write \`keypoints/<id>.json\` as exactly: {"key_points": [{"point": "...", "importance": "essential"}, ...]} ("essential" or "important").

Use the Write tool for the JSON files and change nothing else. Reply with one line per document: the id and its number of key points.`,
  );
  const grade = groups(Number(option('graders') ?? 5)).map(
    (ids, i) => `## Grader ${i + 1}

${SCORE_PROMPT}

Each document has ${names.length} summaries labelled ${labelList}, written in different ways; the labels are shuffled and tell you nothing. Grade each summary on its own against the document, not against the others.

Directory: ${dir}

For each of these document IDs: ${ids.join(' ')}

1. Read \`docs/<id>.txt\`, \`keypoints/<id>.json\` (key point 1 is the first in the list) and \`summaries/<id>.json\`. Don't open \`private/\`.
2. Write \`grades/<id>.json\` as exactly: {"A": {"coverage": [{"key_point": 1, "verdict": "full"}, ...], "issues": [{"quote": "...", "problem": "unsupported", "explanation": "..."}], "readability": {"score": 4, "reason": "..."}}, ...} with one coverage entry per key point ("full", "partial" or "missing"), issues quoted word for word from the summary ("unsupported", "contradicted", "misattributed" or "overstated"; an empty list is fine), and readability 1-5.

Use the Write tool for the JSON files and change nothing else. Reply with one line per document: the id and each label's readability and number of issues.`,
  );
  writeFileSync(
    `${dir}PROMPTS.md`,
    `# Agent prompts for run "${run}"\n\nRun every extractor first (they can run in parallel), then every grader. Use the same model for all of them.\n\n${[...extract, ...grade].join('\n\n')}\n`,
  );
  console.log(
    `Prepared ${docs.length} documents and ${names.length} candidates (${names.join(', ')}) in scripts/eval/runs/${run}/agents/. Prompts: agents/PROMPTS.md (${extract.length} extractors, ${grade.length} graders)`,
  );
}

function collect() {
  const judge = option('judge') ?? 'claude-fable-5-1';
  const mapping = readJson<Record<string, Record<string, string>>>(
    run,
    'agents/private/mapping.json',
  );
  const judged: Judged[] = [];
  const missing: string[] = [];
  for (const doc of docs) {
    const keyFile = `${dir}keypoints/${doc.id}.json`;
    const gradeFile = `${dir}grades/${doc.id}.json`;
    if (!existsSync(keyFile) || !existsSync(gradeFile)) {
      missing.push(doc.id);
      continue;
    }
    const { key_points: keyPoints } = JSON.parse(
      readFileSync(keyFile, 'utf8'),
    ) as { key_points: KeyPoint[] };
    const byLetter = JSON.parse(readFileSync(gradeFile, 'utf8')) as Record<
      string,
      Grade
    >;
    const grades = Object.fromEntries(
      Object.entries(mapping[doc.id]).map(([letter, name]) => [
        name,
        byLetter[letter],
      ]),
    );
    judged.push({ id: doc.id, keyPoints, grades });
  }
  writeJson(run, `judges/${judge}-agents.json`, judged);
  console.log(
    `Collected ${judged.length} of ${docs.length} documents into judges/${judge}-agents.json${missing.length ? `; missing: ${missing.join(' ')}` : ''}`,
  );
}

if (command === 'prepare') prepare();
else if (command === 'collect') collect();
else throw new Error('Say `prepare` or `collect` after the run name');
