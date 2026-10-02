# Summary eval

Checks a change to the document summaries (prompt or model) on real documents before it rolls out to the library, by having a strong model judge the summaries against their sources. Background and results so far: [docs/plans/align-document-summaries.md](../../docs/plans/align-document-summaries.md).

## What it measures

For each document, the judge first lists the document's **key points from the full text alone**, marking each *essential* (a summary that misses it fails the reader) or *important*. Then it grades every candidate summary **separately and without being told which one it is**:

- **Key points covered:** each key point fully, partly or not at all. Reported as a weighted share: essential points count double, partly covered ones count half.
- **Unsupported statements:** anything the document doesn't support or contradicts, quoted, typed as *unsupported*, *contradicted*, *misattributed* or *overstated*. Reported per summary and per statement (sentences and bullets).
- **Readability:** 1 (a wall of text, poorly ordered) to 5 (main point first, clearly organized, easy to scan).

The report compares candidates on the same documents, with 95% intervals from resampling documents, and shows how far two judges agree.

## Running it

Needs `.env.local` with `READONLY_DATABASE_URL` (the read-only Postgres login) and `ANTHROPIC_API_KEY`. Nothing is written to the production database.

```bash
# 1. Pick documents: 7 per length band over 300 words (35), with their text and stored summary
npm run eval:pick -- oct-prompt

# 2. Write candidate summaries with the exact production request
npm run eval:summarize -- oct-prompt --name live                       # the prompt in api/_lib/summarize.ts
npm run eval:summarize -- oct-prompt --name terse --prompt terse.txt   # same request, another system prompt
# `stored` (what production has now) is always a candidate

# 3a. Judge through the API (Opus 5.5 by default, about $0.20 per document for three candidates)
npm run eval:judge -- oct-prompt [--model claude-opus-5-5] [--candidates stored,live]

# 3b. Or judge with Claude Code agents, e.g. Fable 5.1, which needs data retention on the API key's workspace
npm run eval:agents -- oct-prompt prepare
#     then in Claude Code: "run the agent prompts in scripts/eval/runs/oct-prompt/agents/PROMPTS.md with Fable"
npm run eval:agents -- oct-prompt collect --judge claude-fable-5-1

# 4. Compare
npm run eval:report -- oct-prompt
```

Each step writes to `scripts/eval/runs/<run>/`, which is gitignored: it holds full texts of the library, and this repo is public. The same run name picks the same documents, so a later change can be compared on identical inputs. `eval:judge` resumes where it stopped.

For agents, `prepare` labels the candidates A, B, C… in a shuffled order per document and keeps the key in `agents/private/`. Extractor agents read only the documents; grader agents read the document, its key points and the shuffled summaries.

## Reading the results

- Judge differences smaller than the interval are noise. 35 documents tell length and readability apart easily; small coverage differences need more.
- Coverage is measured against the judge's own key points, so two judges' coverage numbers differ more than their rankings do.
- Judges tend to rate formatted text (bold, bullets) as more readable.
- A Claude judge grading Claude summaries is fine for comparing Claude prompts, but less so for comparing Claude with other model families. For that, add a judge from another family (see the plan).
- Flagged statements need reading: many are true facts the document doesn't state (an author's job title), or a dropped "might"; a few are real misreadings.
