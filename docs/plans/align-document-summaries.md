# Align document summaries

**Status:** not started. Drafted 2026-10-02 as follow-up work; nothing here is built yet.

## Goal

Know, with a number we trust, how good the document summaries are, and use it to choose the summarizer: keep Claude Sonnet 5.5, switch to something cheaper or open-weight, or train a small model on Sonnet's output.

"Aligned" means four things, measured separately:

1. **Faithful:** every claim in the summary is supported by the document.
2. **Complete:** it covers what matters in the document.
3. **Concise:** its length fits the document; short sources get short summaries.
4. **Useful to the reader (nimo):** it matches what nimo would want, as captured by nimo's own ratings.

Cost isn't the reason to do this. Sonnet costs about $0.026 per summary, under $1 a month at about 1.2 saves a day. The value is knowing which models are good enough, and learning how to evaluate and distill.

## What we already have

- **370 saved documents with full text** in `document_texts`. Median about 10.8k characters (about 2.7k tokens), 90th percentile 28k, longest 154k (about 38k tokens). 182 are tweets and threads, 167 articles, 13 videos (transcripts), 3 PDFs, a few emails and RSS posts.
- **A Sonnet 5.5 summary and key points for each** (`documents.summary`, `key_points`; `summary_model` is `claude-sonnet-5-5/4` once the fix below has been rolled out, and every `/2` summary and key points stay in `llm_traces`). Average 5.4k input tokens, 1.5k output tokens, $0.026 and 13 seconds per summary.
- **The earlier Haiku 4.5 summaries** in `llm_traces` (kind `document_summary`). Not a fair comparison: Haiku had a different prompt and only the first 40k characters.
- **The exact request for every call** in `llm_traces.request`, so any candidate can be run on identical inputs, and dated prices in `model_prices` to cost them.
- **A side-by-side page** (the Haiku vs Sonnet artifact). It compares length only, not quality.

### A known issue to start from

Short documents get summaries as long as the document. Measured on the 370:

| Source length | Documents | Summary length ÷ source length | Summaries over half the source |
| ------------- | --------- | ------------------------------ | ------------------------------ |
| under 3k chars | 53 | 1.02 | 53 (all) |
| 3k-10k | 122 | 0.43 | 25 |
| 10k-30k | 165 | 0.23 | 0 |
| 30k+ | 30 | 0.09 | 0 |

On short threads and changelogs, Sonnet paraphrases every point instead of compressing, even though the prompt said "a short post may need two or three sentences". The spot-checked examples were faithful, just not shorter.

**Fixed before this plan started (`SUMMARY_VERSION` `claude-sonnet-5-5/4`, 2026-10-02).** The cause was the prompt: it said the summary "stands in for the document", that the reader "may never open the original", and listed everything to keep ("arguments, claims, evidence, numbers, examples"), and Sonnet followed that literally. It also asked for key points "as many as it actually has" on top of the summary.

A first fix (`/3`) gave the model a word limit of about a tenth of the document. It was never rolled out, because the reader doesn't want length rules. Research also suggests they backfire: replacing "no longer than 300 words" with "clear and concise" made LLM summaries up to 150 words shorter ([2410.13961](https://arxiv.org/abs/2410.13961)), and models follow length targets loosely anyway ([2501.00233](https://arxiv.org/abs/2501.00233)). Anthropic's guidance is to explain why rather than add rules ([prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).

`/4` is a short prompt that says what summaries are for (recall what a piece said, decide what to read in full, tag and connect documents), asks for the main points and what supports them, "much quicker to read than the document itself", and leaves length to the model. It asks for no key points. Documents of 300 words or fewer are stored as their own summary, with no model call.

Tested on 35 documents stratified by length, before rollout (median summary as a share of the document):

| Document length | Documents | `/2` summary + key points | `/4` summary |
| --------------- | --------- | ------------------------- | ------------ |
| 151-400 words | 6 | 122% | 63% |
| 401-800 | 5 | 94% | 49% |
| 801-1,500 | 6 | 50% | 21% |
| 1,500-3,000 | 6 | 34% | 15% |
| 3,000-6,000 | 6 | 18% | 8% |
| 6,000+ | 6 | 10% | 4% |

Total output fell to 44% of `/2`. Adding the document's word count to the input (no instruction) changed nothing on short posts, so the model seems to have a floor of roughly 150-250 words; hence the 300-word cutoff (the reader chose it over 500).

`/4` wrote one dense paragraph even for long documents, and the reader wants summaries that are easy to read, so `/5` replaces "Write plain prose." with "The reader skims, so make it easy to take in: lead with the main point, and give it whatever structure fits the content, such as short paragraphs or a list."

**Quick judge check (2026-10-02, before rollout).** Claude Opus 5.5 listed each document's key points from the full text alone (12.4 per document, 44% essential), then scored each summary blind and on its own: key points covered (weighted, essential ×2, partial = half), statements the document doesn't support, and readability 1-5. 33 documents over 300 words:

| | `/2` summary + key points | `/4` | `/5` |
| - | - | - | - |
| Median words | 710 | 305 | 380 |
| Key points covered | 97% | 91% | 94% |
| Essential points missed | 0 | 0 | 0 |
| Summaries with an unsupported statement | 42% | 30% | 33% |
| Readability (1-5) | 3.8 | 2.9 | 4.9 |

`/5` vs `/4`: coverage +4 points (95% CI +2 to +6), readability +2.0 (+1.8 to +2.2). `/4` vs `/2`: coverage -6 points (-9 to -4). Most flagged statements in `/5` were small: facts from outside the document (an author's name or title) or overreach. One was a real error (it swapped which of two PRs was merged). Fable 5.1 isn't available on this API key (it needs data retention enabled on the workspace), so it judged separately through Claude Code subagents: four agents listed key points from the source files alone, then five scored the three versions with labels shuffled per document (A/B/C), each against the document and Fable's key points.

| Fable 5.1 | `/2` | `/4` | `/5` |
| - | - | - | - |
| Key points covered | 98% | 94% | 96% |
| Essential points missed | 0 | 0 | 0 |
| Summaries with an unsupported statement | 33% | 24% | 21% |
| Readability (1-5) | 3.0 | 2.4 | 4.9 |

`/5` vs `/4`: coverage +3 points (+1 to +5), readability +2.5. `/5` vs `/2`: coverage -2 (-3 to -1), readability +1.9. The judges agreed on readability (r = 0.88, within one point on 99% of summaries, same most readable version on 32 of 33 documents) and moderately on coverage (r = 0.58, since each scored against its own key points). Both caught the same real error in `/5` (which pull request was merged); `/2` had the most serious misreadings (e.g. three wrong claims about the vitamin D meta-analyses). Unlike the Opus run, Fable saw all three summaries of a document in one session, though it was told to grade each on its own.

Caveats: one judge, from the same family as the summarizer (all three candidates are Sonnet, so that bias shouldn't favor one version), coverage measured against that judge's own key points, and judges are known to favor Markdown formatting, which may inflate `/5`'s readability score. Cost $4.83. The eval should confirm this didn't cost faithfulness or coverage: compression is exactly where those trade off.

## How summaries are evaluated now

Research done 2026-10-02. Three research agents read the 2024–2026 papers and vendor docs; the key papers were checked to exist and the Anthropic terms are quoted word for word. The short version: ROUGE, BERTScore and single "rate this 1–5" judge scores are out. The field now breaks a summary, and the source, into small checkable units and has LLMs check them one at a time against the full document, with judges from more than one model family, calibrated against human labels.

### Faithfulness: is every claim supported?

- **Check each summary sentence against the whole document**, not chunks. Checking against truncated or chunked text misses evidence ([2603.23508](https://arxiv.org/abs/2603.23508), Mar 2026). Whole-source context also beat retrieval on book-length summaries ([FABLES](https://arxiv.org/abs/2404.01261), 2024). Our documents (at most ~38k tokens) fit in one call.
- **Don't over-split.** Breaking summaries into atomic claims adds noise that can cancel the gain ([Decomposition Dilemmas](https://aclanthology.org/2025.naacl-long.320), NAACL 2025). Split only compound sentences, and only when the reading is unambiguous ([Claimify](https://arxiv.org/abs/2502.10855), ACL 2025).
- **Thinking judges are better at this.** On one benchmark, turning on thinking took DeepSeek-V3.2 from 76.8 to 84.4 macro-F1. Small trained checkers are still competitive: FaithLens-8B 86.4, MiniCheck-7B 80.7 ([FaithLens](https://arxiv.org/abs/2512.20182), Dec 2025; the authors' own numbers).
- **Judges are still weak on hard and long cases.**
  - The best zero-shot judge reached 68.8% balanced accuracy on hard summarization cases. Given a few human-labeled summaries of the same article as examples, it reached 84.0% ([FaithJudge](https://arxiv.org/abs/2505.04847), 2025). Human labels used as examples were the single biggest improvement.
  - On documents up to 32k tokens, the best judges agree with humans only moderately, about 65 macro-F1 ([FACTS Grounding v2](https://arxiv.org/abs/2512.10791), Dec 2025).
  - The [LLM-AggreFact leaderboard](https://llm-aggrefact.github.io/) stopped in mid-2025, so no public benchmark compares current frontier models as faithfulness judges.
- **Where errors hide.** In long summaries, hallucinations cluster near the end ([2505.15291](https://arxiv.org/abs/2505.15291)). The middle of the source tends to get neglected, and judges are sensitive to document order ([NAACL 2025](https://aclanthology.org/2025.naacl-long.442/)). More thinking in the *summarizer* can hurt faithfulness ([2512.03503](https://arxiv.org/abs/2512.03503)).
- **Error types in common use** ([TofuEval](https://arxiv.org/abs/2402.13249) plus later work):
  - unsupported (extrinsic)
  - contradicted
  - misattributed (wrong speaker or source)
  - opinion stated as fact, or a dropped hedge
  - over-generalized: models did this in 26–73% of science summaries, and newer models did worse ([2504.00025](https://arxiv.org/abs/2504.00025))
  - reasoning or number errors
- **Citations make checking mechanical.** Claude's [Citations](https://platform.claude.com/docs/en/build-with-claude/citations) feature returns each claim with the exact character range it drew on. Catch: it can't be combined with structured outputs, which our summarizer uses.

### Coverage and length: does it keep what matters, briefly?

- **Key facts from the source are the standard unit** ([FineSurE](https://arxiv.org/abs/2407.00908), ACL 2024).
  - An LLM lists the document's key facts, then checks which ones each summary sentence covers.
  - Completeness is the share of key facts covered. Conciseness is the share of summary sentences that carry a key fact.
  - Successors weight the facts (vital or okay; essential, important or optional) and check in both directions: key facts → summary for coverage, the summary's own facts → source for faithfulness ([AutoNuggetizer](https://arxiv.org/abs/2504.15068), Apr 2025; [OmniCSEval](https://arxiv.org/abs/2606.15974), Jun 2026).
- **Quiz-based coverage tests the "stands in for the document" job.** Questions generated from the source are answered from the summary alone ([LongSumEval](https://arxiv.org/abs/2604.25130), Apr 2026; [SummQ](https://arxiv.org/abs/2509.20900), ICLR 2026).
- **Per-document checklists or rubrics** help judges agree with people ([TICK](https://arxiv.org/abs/2410.03608); [Rubrics as Rewards](https://arxiv.org/abs/2507.17746)). But optimizing against them gained completeness at the cost of faithfulness ([2605.12474](https://arxiv.org/abs/2605.12474)), and the three dimensions trade off generally ([2604.17197](https://arxiv.org/abs/2604.17197)). Report them separately; don't blend them into one score.
- **Conciseness is the hardest dimension to judge** ([UniSumEval](https://arxiv.org/abs/2409.19898)). Longer outputs tend to win head-to-head comparisons. The standard fix is a length-controlled win rate ([2404.04475](https://arxiv.org/abs/2404.04475)), or comparing models within the same length band.
- **A strong model's summaries are not ground truth.** Human-written references still beat LLM summaries on informativeness and faithfulness ([Summarization is Not Dead Yet](https://arxiv.org/abs/2606.08000), Jun 2026). A weaker judge with good references beats a stronger judge with synthetic ones ([2503.05061](https://arxiv.org/abs/2503.05061)). Scoring against Sonnet's summaries would reward imitating Sonnet.
- **Vendors lag the research.** Anthropic's [test-design docs](https://platform.claude.com/docs/en/docs/build-with-claude/develop-tests) still show ROUGE-L for summaries, but advise grading with a different model from the one that wrote the output. OpenAI's [eval guide](https://developers.openai.com/api/docs/guides/evaluation-best-practices) prefers pairwise or pass/fail, says to control for length, and wants judges checked against human labels.

### Can the judges be trusted?

- **Judges favor their own family, modestly.**
  - Across four open model families, judges preferred their own family by 3–8 points, and changing who sat on the panel flipped 18.5% of pairwise outcomes ([Who Judges Matters](https://arxiv.org/abs/2609.17857), Sep 2026).
  - Rubrics don't remove the effect ([2604.06996](https://arxiv.org/abs/2604.06996)). Judges also favor students trained on their own outputs ([preference leakage](https://arxiv.org/abs/2502.01534), ICLR 2026). That matters most for a model distilled from Sonnet.
  - About half of earlier self-preference findings disappear once judge quality is controlled for ([2601.22548](https://arxiv.org/abs/2601.22548)). Even so, hide which model wrote what ([2608.18091](https://arxiv.org/abs/2608.18091)).
- **Biases vary by judge.**
  - In one 5-judge study, Claude Sonnet 4 slightly preferred concise answers while Gemini 2.5 and Llama 3.3 preferred longer ones. Markdown formatting was the biggest bias of all ([Judging the Judges](https://arxiv.org/abs/2604.23178), Apr 2026).
  - The best mitigation found: a rubric, the judge's reasoning before its verdict, judging in both orders, and a tie when the two orders disagree. That added 7–11 points.
- **Juries of judges from different families** beat a single large judge at a fraction of the cost ([Replacing Judges with Juries](https://arxiv.org/abs/2404.18796)), and recent summarization studies use them ([2606.08000](https://arxiv.org/abs/2606.08000)). Open judge models (M-Prometheus, Selene Mini, J1, CompassJudger-2) mostly improve on short pairwise benchmarks. Large general open-weight models judge long outputs better ([2606.01629](https://arxiv.org/abs/2606.01629)).
- **Calibrate against your own labels, and report it carefully.**
  - Reporting choices alone moved one published "accuracy" from 0.551 to 0.899 on the same verdicts ([Agreement Metrics](https://arxiv.org/abs/2606.00093), May 2026). Report Cohen's kappa with how it was computed, plus the judge's true-positive and true-negative rates.
  - Single-annotator practice: pass/fail labels per failure mode, at least 60 per mode, ideally ~100 ([Hamel Husain](https://hamel.dev/blog/posts/llm-judge/)).
  - A judge's measured error rates can be used to correct its scores, with confidence intervals ([2511.21140](https://arxiv.org/abs/2511.21140)).

### Distillation, and Anthropic's terms

- **Small students get close.**
  - A summarizer distilled from Claude Opus 4.6 into Llama 3.1 8B (LoRA rank 16, about 1,200 pairs, $30 of teacher calls) came within 0.01 BERTScore of its teacher ([UVA NSDPI](https://nationalsecurity.virginia.edu/research/efficient-scientific-summarization-through-frontier-llm-distillation), Jun 2026). Its evaluation was weak, and the paper doesn't say whether Anthropic gave permission.
  - Most of a student's gain can come from the first ~10–100 examples ([2608.29884](https://arxiv.org/abs/2608.29884)).
  - Fixing the teacher's errors before training let 4–8B students beat their teacher ([2511.03005](https://arxiv.org/abs/2511.03005)).
- **Training on Claude's outputs needs Anthropic's prior permission.** The [Usage Policy](https://www.anthropic.com/legal/aup) (effective Sep 15, 2025) prohibits "Utilization of inputs and outputs to train an AI model (e.g., “model scraping” or “model distillation”) without prior authorization from Anthropic." The [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) §D.4 separately bar using the service "to train competing AI models … except as expressly approved by Anthropic." There's no personal-use exception. Using Sonnet's summaries as *eval references* is fine; *training* on them is not, without permission. The alternative is an open-weight teacher whose license allows it.

## Plan

The quick checks above are now scripts in [`scripts/eval/`](../../scripts/eval/README.md) (pick, summarize, judge through the API or Claude Code agents, report); the plan below extends them.

Run it locally as scripts in `scripts/eval/` (TypeScript, like the rest of the repo), not as Vercel functions, so nothing is bound by the 300-second limit. Results go in new `eval_*` tables in Neon, written by a separate database role that can only write those tables, so the eval can't touch the library or the trace log. All judge calls are traced like everything else.

### 0. Decisions before starting (no spend)

1. **Judges.** Claude-only, or a jury across model families (Claude plus GPT or Gemini plus a large open-weight model)? The research says a cross-family jury, because Claude judging Claude is the comparison we most need to trust. That means one more API key, in a local `.env` only, never deployed.
2. **Open-weight candidates:** hosted (one OpenRouter key, cents per run) or local on the Mac (Ollama or MLX; slower, free).
3. **Budget.** See Costs below: about $60 lean, about $250 for the full study.
4. **Distillation.** Ask Anthropic for written permission to train on Sonnet's summaries, use an open-weight teacher, or skip phase 6.

### 1. Build the eval set and label it (mostly your time: about 4–5 hours)

- **Freeze 100 documents**, stratified by length band (under 3k, 3–10k, 10–30k, 30k+ chars) and type (thread, article, video transcript, PDF). The IDs live in the repo; the texts stay in Neon. Never use these 100 for training.
- **A blind labeling page.** It shows a document next to one summary, without saying which model wrote it. You answer four pass/fail questions:
  - Is any statement wrong or unsupported? (click the sentence)
  - Is anything important missing?
  - Is the length right, too long, or too short?
  - Could this summary stand in for the document?

  Label 60 documents, about 3–4 minutes each. Re-label 15 of them a week later to measure your own consistency.
- **Include bad summaries on purpose.** A judge's recall can only be measured if there are failures to catch. Mix in the old Haiku summaries, plus about 20 Sonnet summaries with a planted error: a changed number, a misattributed quote, a dropped hedge, an over-generalization.

### 2. Build the graders and check them against your labels

Four graders, each reported separately, never blended:

1. **Faithfulness.** Each summary sentence and key point is checked against the full document. Compound sentences are split only when the reading is unambiguous. The judge (thinking on) returns a label from the error types above plus a verbatim quote as evidence. The quote is string-matched against the stored text to catch invented evidence. Reported as errors per 100 sentences, % of summaries with at least one major error, and a separate figure for long documents and for the last third of each summary.
2. **Coverage and conciseness**, FineSurE-style.
   - Key facts are extracted once per document from the full text, weighted essential, important or optional, never from Sonnet's summary.
   - Ideally a non-Claude model or the jury does the extraction. You spot-check about 30 of the lists.
   - Each summary gets weighted completeness, and conciseness as the share of its sentences that carry a key fact. Coverage is also reported by where the fact sits in the document (start, middle, end).
3. **Length**, without a judge: summary length ÷ source length, by length band. This is where the short-document problem shows up.
4. **The job the summary does.** These are cheap and objective:
   - **Tag agreement:** do tags generated from the summary match tags generated from the full text?
   - **Quiz:** answer 10 questions written from the source using only the summary.

   Both test the "stands in for the document" job directly.

**Calibrate until the graders agree with you.** Report kappa, true-positive and true-negative rates, and bootstrap confidence intervals. A reasonable bar is kappa of at least 0.6 and catching at least 80% of planted errors. Then put a handful of your labeled examples into the judge prompts, which gave the biggest improvement in FaithJudge. Iterate on the rubric until it scores like you would.

**Pairwise "which is better"** comes last, and only for finalists: both orders, ties allowed, authorship hidden, length-controlled win rate.

### 3. Claude baselines

All on the same 100 documents, measuring cost and latency from `llm_traces`:

| Candidate | Why |
| --------- | --- |
| Sonnet 5.5, current prompt (`/5`, short, purpose-led, structured to skim) | The baseline |
| Sonnet 5.5, previous prompt (`/2`, "stands in for the document") | What the simpler prompt cost or gained |
| Sonnet 5.5 at `low` effort | More summarizer thinking can hurt faithfulness, and it costs more |
| Sonnet 5.5 with Citations | Every claim traceable to the source. Needs plain-text output instead of structured outputs (incompatible) |
| Haiku 4.5, same prompt and full text | The fair rematch; half the price |
| Opus 5.5 | The ceiling: is Sonnet leaving quality on the table? |

Run 5 documents first and measure the real cost before the full run.

### 4. Open-weight models

Two or three current open models that handle ~40k-token inputs, on the same documents with the same graders. Run them hosted or locally, per decision 0.2.

### 5. Decide and ship

Switch the summarizer only if a candidate is within the judges' measured error of Sonnet on faithfulness and coverage, and better on length or cost. Shipping means changing `SUMMARY_MODEL` or the prompt and bumping `SUMMARY_VERSION`, then regenerating the library on purpose with `?redo=true` on the sync (about $6-10 at Sonnet's rate); nothing rewrites summaries automatically. Write the decision and its numbers back into this doc.

### 6. Distill a small model (only if 0.4 allows it)

- **Setup:** LoRA rank 16–32 on a 4–8B open model, trained on 100–1,000 pairs from documents outside the eval set (full text → summary). Fix the teacher's flagged errors first.
- **Where:** MLX on the Mac, or a hosted fine-tuning service.
- **Grading:** the same jury on the frozen 100. Report results with and without Claude judges, because of preference leakage.

### 7. Keep it running

- **Regression check:** run the eval before any future `SUMMARY_VERSION` bump.
- **Weekly sample:** each week, grade a few new summaries with the cheapest grader that agreed with your labels, and add a line to the weekly email.

## Costs (estimates, to be measured in step 3)

Assumptions: an average document of about 4k tokens and a summary of about 1k, with Opus 5.5 or a peer as judge (about $0.10 per summary graded, mostly the judge's output; prompt caching makes re-reading the source cheap).

| | Lean | Full |
| - | ---- | ---- |
| Test documents | 60 | 100 |
| Judges | 2 (one Claude, one non-Claude) | 3-family jury |
| Candidates | 5 | 9 |
| Graders | Faithfulness, coverage, length | All four, plus pairwise for finalists |
| Calibration rounds | ~$15 | ~$40 |
| Key-fact extraction (once) | ~$3 | ~$10 |
| Generating summaries | ~$5 | ~$15 |
| Grading | ~$35 | ~$180 |
| **Total** | **~$60** | **~$250** |

This replaces the "$1–2 per model" estimate given in chat on 2026-10-02. That figure assumed one Claude judge on 70 documents. The research says that single-judge setup isn't trustworthy enough for comparing Claude with other models.

## Done when

- [ ] The decisions in phase 0 are made
- [ ] 100 frozen documents; 60 labeled by you, 15 re-labeled
- [ ] Graders agree with your labels (kappa ≥ 0.6, ≥ 80% of planted errors caught), with confidence intervals reported
- [ ] A results table per candidate: faithfulness, coverage, conciseness, length ratio, tag agreement, quiz score, cost and latency per document
- [ ] A decision written here, and if it's a switch, `SUMMARY_VERSION` bumped
