/**
 * Step 4: compare the candidates, per judge.
 *
 *   npm run eval:report -- <run>
 *
 * Reads every file in judges/ and prints, per candidate: length, key points
 * covered (essential count double, partly covered half), essential points
 * missed, how often a statement isn't supported by the document, and
 * readability; then each pair's difference on the same documents with a 95%
 * interval, and how far the judges agree.
 */

import { readdirSync } from 'node:fs';

import {
  bootstrap,
  correlation,
  countStatements,
  countWords,
  coverageScore,
  type Doc,
  essentialMissed,
  type Judged,
  loadCandidates,
  mean,
  median,
  readJson,
  runArg,
  runPath,
} from './lib.js';

const run = runArg();
const docs = readJson<Doc[]>(run, 'docs.json');
const judgeFiles = readdirSync(runPath(run, 'judges/')).filter((f) =>
  f.endsWith('.json'),
);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

const judges = judgeFiles.map((file) => ({
  name: file.slice(0, -5),
  results: readJson<Judged[]>(run, `judges/${file}`),
}));

for (const { name, results } of judges) {
  const names = Object.keys(results[0]?.grades ?? {});
  const candidates = loadCandidates(run, names);
  const keyPoints = mean(results.map((r) => r.keyPoints.length));
  console.log(
    `\n== ${name}: ${results.length} of ${docs.length} documents, ${keyPoints.toFixed(1)} key points each`,
  );

  console.table(
    Object.fromEntries(
      names.map((c) => {
        const texts = results.map((r) => candidates[c][r.id] ?? '');
        const statements = texts.reduce(
          (sum, t) => sum + countStatements(t),
          0,
        );
        const issues = results.reduce(
          (sum, r) => sum + r.grades[c].issues.length,
          0,
        );
        return [
          c,
          {
            'median words': median(texts.map(countWords)),
            'key points covered': pct(
              mean(results.map((r) => coverageScore(r.keyPoints, r.grades[c]))),
            ),
            'essential missed': results.reduce(
              (sum, r) => sum + essentialMissed(r.keyPoints, r.grades[c]),
              0,
            ),
            'summaries with an issue': pct(
              mean(results.map((r) => (r.grades[c].issues.length ? 1 : 0))),
            ),
            'statements flagged': `${issues} of ${statements} (${((100 * issues) / statements).toFixed(1)}%)`,
            'readability (1-5)': +mean(
              results.map((r) => r.grades[c].readability.score),
            ).toFixed(2),
          },
        ];
      }),
    ),
  );

  for (const [i, a] of names.entries()) {
    for (const b of names.slice(i + 1)) {
      const coverage = results.map(
        (r) =>
          coverageScore(r.keyPoints, r.grades[b]) -
          coverageScore(r.keyPoints, r.grades[a]),
      );
      const readability = results.map(
        (r) => r.grades[b].readability.score - r.grades[a].readability.score,
      );
      const [cLow, cHigh] = bootstrap(coverage);
      const [rLow, rHigh] = bootstrap(readability);
      console.log(
        `  ${b} vs ${a}: coverage ${pct(mean(coverage))} (95% CI ${pct(cLow)} to ${pct(cHigh)}), readability ${mean(readability).toFixed(2)} (${rLow.toFixed(2)} to ${rHigh.toFixed(2)})`,
      );
    }
  }
}

// Agreement between each pair of judges, over summaries both graded
for (const [i, a] of judges.entries()) {
  for (const b of judges.slice(i + 1)) {
    const pairs = a.results.flatMap((ra) => {
      const rb = b.results.find((r) => r.id === ra.id);
      if (!rb) return [];
      return Object.keys(ra.grades)
        .filter((c) => rb.grades[c])
        .map((c) => ({
          coverage: [
            coverageScore(ra.keyPoints, ra.grades[c]),
            coverageScore(rb.keyPoints, rb.grades[c]),
          ],
          readability: [
            ra.grades[c].readability.score,
            rb.grades[c].readability.score,
          ],
        }));
    });
    if (pairs.length < 3) continue;
    console.log(
      `\n${a.name} vs ${b.name} over ${pairs.length} summaries: coverage r = ${correlation(
        pairs.map((p) => p.coverage[0]),
        pairs.map((p) => p.coverage[1]),
      ).toFixed(2)}, readability r = ${correlation(
        pairs.map((p) => p.readability[0]),
        pairs.map((p) => p.readability[1]),
      ).toFixed(2)}`,
    );
  }
}
