/**
 * Shared helpers for the summary eval (see README.md): run folders, the
 * read-only database, word and statement counts, and the scoring math.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';

// Never let an eval script write to the production trace log
delete process.env.SUPABASE_DATABASE_URL;

/** Everything a run produces lives here; gitignored, since it holds full texts */
export const runPath = (run: string, file = '') =>
  new URL(`./runs/${run}/${file}`, import.meta.url);

export function readJson<T>(run: string, file: string): T {
  return JSON.parse(readFileSync(runPath(run, file), 'utf8')) as T;
}

export function writeJson(run: string, file: string, value: unknown): void {
  mkdirSync(new URL('.', runPath(run, file)), { recursive: true });
  writeFileSync(runPath(run, file), `${JSON.stringify(value, null, 2)}\n`);
}

/** The run name: the first argument, which every script takes */
export function runArg(): string {
  const run = process.argv[2];
  if (!run || run.startsWith('-')) {
    throw new Error(
      'Give a run name first, e.g. `npm run eval:pick -- oct-prompt`',
    );
  }
  return run;
}

/** `--name value` from the command line */
export function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

/**
 * The read-only database login from .env.local (READONLY_DATABASE_URL). The
 * password is re-encoded, since characters like / break URL parsing
 */
export function readonlySql() {
  const url = process.env.READONLY_DATABASE_URL;
  if (!url) throw new Error('READONLY_DATABASE_URL is not set in .env.local');
  const match = url.match(/^(postgres(?:ql)?:\/\/[^:]+:)(.*)(@[^@/]+\/.*)$/);
  if (!match) throw new Error('READONLY_DATABASE_URL is not a Postgres URL');
  const [, head, password, tail] = match;
  const encoded = /%[0-9a-f]{2}/i.test(password)
    ? password
    : encodeURIComponent(password);
  return postgres(`${head}${encoded}${tail}`, { prepare: false });
}

export const countWords = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;

/** Sentences and bullet points of at least three words */
export const countStatements = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) =>
      line.replace(/^\s*[-*]\s+/, '').split(/(?<=[.!?])\s+(?=[A-Z0-9*"(])/),
    )
    .filter((part) => countWords(part.replace(/\*\*/g, '')) >= 3).length;

export interface Doc {
  id: string;
  title: string;
  author: string | null;
  site: string | null;
  category: string;
  words: number;
  text: string;
  /** What production has now, and which prompt version wrote it */
  stored: { summary: string; keyPoints: string[]; model: string | null };
}

export interface KeyPoint {
  point: string;
  importance: 'essential' | 'important';
}

export interface Grade {
  coverage: { key_point: number; verdict: 'full' | 'partial' | 'missing' }[];
  issues: {
    quote: string;
    problem: 'unsupported' | 'contradicted' | 'misattributed' | 'overstated';
    explanation: string;
  }[];
  readability: { score: number; reason: string };
}

/** One judge's verdicts on one document: its key points and a grade per candidate */
export interface Judged {
  id: string;
  keyPoints: KeyPoint[];
  grades: Record<string, Grade>;
}

/**
 * Share of key points covered: essential points count double, partly
 * covered ones half
 */
export function coverageScore(keyPoints: KeyPoint[], grade: Grade): number {
  const weight = (i: number) =>
    keyPoints[i - 1]?.importance === 'essential' ? 2 : 1;
  const credit = { full: 1, partial: 0.5, missing: 0 };
  const total = keyPoints.reduce((sum, _, i) => sum + weight(i + 1), 0);
  const got = grade.coverage
    .filter((c) => c.key_point >= 1 && c.key_point <= keyPoints.length)
    .reduce((sum, c) => sum + weight(c.key_point) * credit[c.verdict], 0);
  return total ? got / total : 0;
}

export const essentialMissed = (keyPoints: KeyPoint[], grade: Grade) =>
  grade.coverage.filter(
    (c) =>
      keyPoints[c.key_point - 1]?.importance === 'essential' &&
      c.verdict === 'missing',
  ).length;

export const mean = (xs: number[]) =>
  xs.reduce((sum, x) => sum + x, 0) / xs.length;

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** 95% interval for the mean, by resampling documents */
export function bootstrap(xs: number[], rounds = 4000): [number, number] {
  const means = Array.from({ length: rounds }, () =>
    mean(xs.map(() => xs[Math.floor(Math.random() * xs.length)])),
  ).sort((a, b) => a - b);
  return [means[Math.floor(rounds * 0.025)], means[Math.floor(rounds * 0.975)]];
}

export function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const cov = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const vx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  const vy = ys.reduce((sum, y) => sum + (y - my) ** 2, 0);
  return cov / Math.sqrt(vx * vy);
}

/** A candidate's text as the judges see it: summary, plus key points if any */
export const candidateText = (summary: string, keyPoints: string[] = []) =>
  keyPoints.length
    ? `${summary}\n\nKey points:\n${keyPoints.map((p) => `- ${p}`).join('\n')}`
    : summary;

/**
 * Each candidate's text per document: `stored` is what production has now,
 * the others are files written by summarize.ts
 */
export function loadCandidates(
  run: string,
  names: string[],
): Record<string, Record<string, string>> {
  const docs = readJson<Doc[]>(run, 'docs.json');
  return Object.fromEntries(
    names.map((name) => [
      name,
      name === 'stored'
        ? Object.fromEntries(
            docs.map((doc) => [
              doc.id,
              candidateText(doc.stored.summary, doc.stored.keyPoints),
            ]),
          )
        : readJson<{ summaries: Record<string, string> }>(
            run,
            `candidates/${name}.json`,
          ).summaries,
    ]),
  );
}

/** `--candidates a,b`, or `stored` plus every candidate file in the run */
export function candidateNames(run: string): string[] {
  const given = option('candidates');
  if (given) return given.split(',').map((name) => name.trim());
  let files: string[] = [];
  try {
    files = readdirSync(runPath(run, 'candidates/'));
  } catch {
    // No candidates written yet
  }
  return [
    'stored',
    ...files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
  ];
}
