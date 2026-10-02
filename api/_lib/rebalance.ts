/**
 * Weekly taxonomy rebalance, run by api/rebalance-tags.ts:
 * 1. Tag documents the webhook missed (untagged and recently updated)
 * 2. Ask Claude Opus 5.5 for a plan: merge duplicate or overlapping tags
 *    (the save-time tagger creates new ones), and tag the documents in `other`
 * 3. Rewrite the tags on every affected document in bulk
 *
 * A backfill (a big `sweepDays`) can take several runs: each one tags what it
 * can in its time budget, and planning waits until nothing is left untagged.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import {
  type Article,
  articlePages,
  articleTagNames,
  bulkUpdateTags,
  fetchArticles,
  fetchTags,
  type Location,
} from './readwise.js';
import { ourSummaries, setDocumentTags, tagsInUse } from './documents.js';
import { classifyDocument } from './tagging.js';
import { getTaxonomy, normalizeTag, OTHER_TAG } from './taxonomy.js';
import { loadAppliedRenames, recordTrace } from './traces.js';

const PLAN_MODEL = 'claude-opus-5-5';
const CLASSIFY_CONCURRENCY = 5;
// Library first, so a backfill tags what was saved before the RSS feed, which
// can hold thousands of items
const SWEEP_LOCATIONS: Location[] = [
  'new',
  'later',
  'shortlist',
  'archive',
  'feed',
];
// Stop the sweep early enough to leave time to load `other` and write
const SWEEP_RESERVE_MS = 60_000;
// Only start planning if a slow Opus response still fits
const PLAN_RESERVE_MS = 120_000;

const SYSTEM_PROMPT = `You curate the tag taxonomy of a personal reading library in Readwise Reader. A tagger labels documents as they're saved: it reuses existing tags when they fit and creates new ones otherwise, so each week brings new tags, and some duplicate or overlap existing ones. Tag names must be self-explanatory: lowercase kebab-case, specific enough to be useful, broad enough to group related reading (for example \`machine-learning\`, \`startup-fundraising\`, \`home-cooking\`).

Documents the tagger couldn't place are tagged \`other\`. Each week you get the current tags (with how many documents use each), the documents in \`other\`, and \`earlier_merges\`, which maps tags retired in earlier weeks to the tag that replaced them. Build on those: don't bring a retired name back, and don't merge a replacement back into a tag it replaced. You return:

1. merges: tags that mean the same thing or nearly so - synonyms, singular and plural, formatting variants, or a tag too narrow to stand on its own next to a broader one. List the tags to retire in \`from\` and the tag they become in \`into\`, which can be an existing tag or a clearer new name. Keep distinct concepts separate even when they're related. A tag only one or two documents use is usually too narrow: merge it into the existing tag that covers it, unless it names a distinct topic this reader is likely to save more about. Never merge into or out of \`other\`. Leave out tags that are fine as they are.
2. other_documents: tags for each document in \`other\`, using tag names as they'll be after your merges. Use existing tags where they fit. Create a new tag when it would apply to at least two of these documents or clearly names a lasting interest of this reader. If nothing fits yet, return an empty list for that document; it stays in \`other\` until similar documents arrive.`;

// Structured outputs guarantee the plan comes back in this shape
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    merges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'array', items: { type: 'string' } },
          into: { type: 'string' },
        },
        required: ['from', 'into'],
        additionalProperties: false,
      },
    },
    other_documents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['merges', 'other_documents'],
  additionalProperties: false,
};

interface RebalancePlan {
  merges: { from: string[]; into: string }[];
  other_documents: { id: string; tags: string[] }[];
}

export interface RebalanceReport {
  missedDocumentsTagged: number;
  merges: { from: string[]; into: string }[];
  otherResolved: number;
  otherRemaining: number;
  documentsUpdated: number;
  failed: string[];
  /** Ran out of time; the next run picks up the rest */
  incomplete: boolean;
}

// Documents only: no highlights or notes
const isTaggableDocument = (article: Article) =>
  article.category !== 'highlight' &&
  article.category !== 'note' &&
  !article.parent_id;

const unique = (tags: string[]) => [...new Set(tags.filter(Boolean))];

interface PlanCall {
  plan: RebalancePlan;
  request: unknown;
  response: Anthropic.Beta.Messages.BetaMessage;
  latencyMs: number;
}

const today = () => new Date().toISOString().split('T')[0];

async function planRebalance(
  taxonomy: string[],
  otherDocuments: Article[],
  earlierRenames: Map<string, string>,
): Promise<PlanCall> {
  // Document counts help pick which of two duplicates to keep
  const counts = new Map(
    (await tagsInUse())?.map((tag) => [tag.name, tag.documents]) ?? [],
  );
  const summaries = await ourSummaries(otherDocuments.map((doc) => doc.id));
  const request = {
    model: PLAN_MODEL,
    max_tokens: 32000,
    output_config: {
      effort: 'medium' as const,
      format: { type: 'json_schema' as const, schema: PLAN_SCHEMA },
    },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify(
          {
            tags: taxonomy.map((name) => ({
              name,
              documents: counts.get(name),
            })),
            earlier_merges: Object.fromEntries(earlierRenames),
            other_documents: otherDocuments.map((doc) => ({
              id: doc.id,
              title: doc.title,
              author: doc.author,
              site: doc.site_name,
              summary: summaries.get(doc.id)?.summary ?? doc.summary,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };

  const started = Date.now();
  let response: Anthropic.Beta.Messages.BetaMessage | undefined;
  try {
    // Streaming keeps a long response from hitting HTTP timeouts
    response = await getAnthropic()
      .beta.messages.stream(request)
      .finalMessage();
    if (
      response.stop_reason === 'refusal' ||
      response.stop_reason === 'max_tokens'
    ) {
      throw new Error(`Rebalance plan incomplete (${response.stop_reason})`);
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const plan = JSON.parse(text) as RebalancePlan;
    return { plan, request, response, latencyMs: Date.now() - started };
  } catch (error) {
    await recordTrace({
      kind: 'rebalance',
      subjectId: today(),
      model: PLAN_MODEL,
      request,
      response,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function rebalanceTags({
  sweepDays,
  deadline,
}: {
  sweepDays: number;
  /** Stop starting new work after this timestamp (ms) */
  deadline: number;
}): Promise<RebalanceReport> {
  let incomplete = false;
  const outOfTime = (reserveMs = 0) => {
    const out = Date.now() > deadline - reserveMs;
    if (out) incomplete = true;
    return out;
  };

  const readwiseTags = await fetchTags();
  const taxonomy = unique(
    readwiseTags.map((tag) => normalizeTag(tag.name)),
  ).filter((tag) => tag !== OTHER_TAG);

  // Merges applied by earlier runs, old name -> new name. Without them a plan
  // can undo last week's (`ux-design` -> `user-experience` after the reverse)
  const earlierRenames = await loadAppliedRenames();
  const settle = (tag: string) => {
    let name = tag;
    for (let hops = 0; earlierRenames.has(name) && hops < 10; hops += 1) {
      name = earlierRenames.get(name)!;
    }
    return name;
  };

  // What each document has in Readwise now, the tags we start from, and its
  // title for the trace
  const current = new Map<string, string[]>();
  const base = new Map<string, string[]>();
  const titles = new Map<string, string>();

  // 1. Documents the webhook missed, a page at a time so a big backfill gets
  // further each run instead of spending its budget listing
  const since = new Date(Date.now() - sweepDays * 24 * 60 * 60 * 1000);
  const missed: Article[] = [];
  const taggerTaxonomy = await getTaxonomy();
  sweep: for (const location of SWEEP_LOCATIONS) {
    for await (const page of articlePages({
      updatedAfter: since,
      location,
      tag: '',
    })) {
      const docs = page.filter(isTaggableDocument);
      for (let i = 0; i < docs.length; i += CLASSIFY_CONCURRENCY) {
        if (outOfTime(SWEEP_RESERVE_MS)) break sweep;
        const batch = docs.slice(i, i + CLASSIFY_CONCURRENCY);
        const summaries = await ourSummaries(batch.map((doc) => doc.id));
        const results = await Promise.all(
          batch.map((doc) =>
            classifyDocument(
              doc.id,
              {
                title: doc.title,
                author: doc.author,
                url: doc.url,
                summary: summaries.get(doc.id)?.summary ?? doc.summary,
                keyPoints: summaries.get(doc.id)?.keyPoints,
              },
              taggerTaxonomy,
            ).catch((error) => {
              console.warn(`Could not classify ${doc.id}:`, error);
              return undefined;
            }),
          ),
        );
        batch.forEach((doc, j) => {
          const tags = results[j];
          if (!tags) return;
          current.set(doc.id, []);
          base.set(doc.id, tags);
          titles.set(doc.id, doc.title);
          missed.push(doc);
        });
      }
      if (outOfTime(SWEEP_RESERVE_MS)) break sweep;
    }
  }
  // Mid-backfill, skip planning: the next run plans once everything is tagged
  const sweepFinished = !incomplete;

  // 2. The `other` bucket, including anything step 1 just put there
  const otherDocuments = new Map<string, Article>();
  for (const doc of await fetchArticles({ tag: OTHER_TAG })) {
    otherDocuments.set(doc.id, doc);
    current.set(doc.id, articleTagNames(doc));
    base.set(doc.id, articleTagNames(doc));
    titles.set(doc.id, doc.title);
  }
  for (const doc of missed) {
    if (base.get(doc.id)?.includes(OTHER_TAG)) otherDocuments.set(doc.id, doc);
  }

  let planCall: PlanCall | undefined;
  if (
    sweepFinished &&
    (taxonomy.length > 0 || otherDocuments.size > 0) &&
    !outOfTime(PLAN_RESERVE_MS)
  ) {
    planCall = await planRebalance(
      unique(taxonomy.map(settle)),
      [...otherDocuments.values()],
      earlierRenames,
    );
    console.log('Rebalance plan:', JSON.stringify(planCall.plan));
  }
  const plan = planCall?.plan ?? { merges: [], other_documents: [] };

  // 3. Merges, as old name -> new name. A retired tag that came back (the
  // tagger can recreate one) goes straight to its replacement
  const renames = new Map<string, string>();
  for (const name of taxonomy) {
    if (settle(name) !== name) renames.set(name, settle(name));
  }
  for (const { from, into } of plan.merges) {
    // Never target a retired name, so a plan can't reverse an earlier merge
    const target = settle(normalizeTag(into));
    if (!target || target === OTHER_TAG) continue;
    for (const name of from.map(normalizeTag)) {
      if (taxonomy.includes(name) && name !== target && !renames.has(name)) {
        renames.set(name, target);
      }
    }
  }
  const rename = (tag: string) => {
    let name = normalizeTag(tag);
    // Follow chains (a -> b -> c), with a cap in case the plan loops
    for (let hops = 0; hops < 10; hops += 1) {
      const next = renames.get(name) ?? earlierRenames.get(name);
      if (!next) break;
      name = next;
    }
    return name;
  };

  // Load every document carrying a tag that's merging away or isn't in
  // canonical form (e.g. `#AI` from older tagging)
  const tagsToRewrite = readwiseTags.filter((tag) => {
    const name = normalizeTag(tag.name);
    return name !== tag.name || renames.has(name);
  });
  for (const tag of tagsToRewrite) {
    if (outOfTime()) break;
    for (const doc of await fetchArticles({ tag: tag.key })) {
      current.set(doc.id, articleTagNames(doc));
      base.set(doc.id, articleTagNames(doc));
      titles.set(doc.id, doc.title);
    }
  }

  // 4. Final tags per document
  const assignments = new Map(
    plan.other_documents
      .filter(({ id, tags }) => otherDocuments.has(id) && tags.length > 0)
      .map(({ id, tags }) => [id, tags]),
  );
  const updates: { id: string; tags: string[] }[] = [];
  let otherRemaining = 0;
  for (const [id, tags] of base) {
    let next = unique(tags.map(rename));
    const assigned = assignments.get(id);
    if (assigned) {
      next = unique([
        ...next.filter((tag) => tag !== OTHER_TAG),
        ...assigned.map(rename).filter((tag) => tag !== OTHER_TAG),
      ]);
    }
    if (next.length === 0) next = [OTHER_TAG];
    if (otherDocuments.has(id) && next.includes(OTHER_TAG)) otherRemaining += 1;

    const before = [...(current.get(id) ?? [])].sort().join(',');
    if (before !== [...next].sort().join(',')) updates.push({ id, tags: next });
  }

  const { updated, failed } = await bulkUpdateTags(updates);
  // Keep the mirror in step with what Readwise accepted
  const failedIds = new Set(failed.map((entry) => entry.split(':')[0]));
  await setDocumentTags(updates.filter(({ id }) => !failedIds.has(id))).catch(
    (error: unknown) =>
      console.warn('Could not update tags in the mirror:', error),
  );

  // Keep the plan and every change it caused (before -> after), so a run can
  // be audited or undone, and plans compared across models
  if (planCall) {
    await recordTrace({
      kind: 'rebalance',
      subjectId: today(),
      model: PLAN_MODEL,
      request: planCall.request,
      response: planCall.response,
      result: {
        plan,
        renames: Object.fromEntries(renames),
        changes: updates.map(({ id, tags }) => ({
          id,
          title: titles.get(id) ?? null,
          before: current.get(id) ?? [],
          after: tags,
        })),
        failed,
      },
      latencyMs: planCall.latencyMs,
    });
  }

  return {
    missedDocumentsTagged: missed.length,
    merges: [...renames].map(([from, into]) => ({ from: [from], into })),
    otherResolved: otherDocuments.size - otherRemaining,
    otherRemaining,
    documentsUpdated: updated,
    failed,
    incomplete,
  };
}
