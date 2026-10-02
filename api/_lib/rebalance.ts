/**
 * Weekly taxonomy rebalance, run by api/rebalance-tags.ts:
 * 1. Tag documents the webhook missed (untagged and recently updated)
 * 2. Ask Claude Opus 5.5 for a plan: merge duplicate tags, and tag the
 *    documents in `other`, creating new tags for themes that keep coming up
 * 3. Rewrite the tags on every affected document in bulk
 */

import { getAnthropic } from './anthropic.js';
import {
  type Article,
  articleTagNames,
  bulkUpdateTags,
  fetchArticles,
  fetchTags,
} from './readwise.js';
import { classifyDocument } from './tagging.js';
import { normalizeTag, OTHER_TAG } from './taxonomy.js';

const PLAN_MODEL = 'claude-opus-5-5';
const CLASSIFY_CONCURRENCY = 5;
// Stop the sweep early enough to leave time for planning and writing
const SWEEP_RESERVE_MS = 150_000;
// Only start planning if a slow Opus response still fits
const PLAN_RESERVE_MS = 120_000;

const SYSTEM_PROMPT = `You curate the tag taxonomy of a personal reading library in Readwise Reader. A classifier tags new documents automatically and only sees each tag's name, so names must be self-explanatory: lowercase kebab-case, specific enough to be useful, broad enough to group related reading (for example \`machine-learning\`, \`startup-fundraising\`, \`home-cooking\`).

Documents whose main subject no tag covers are tagged \`other\`. Each week you get the current tags and the documents in \`other\`, and you return:

1. merges: tags that mean the same thing or nearly so - synonyms, singular and plural, formatting variants, or a tag too narrow to stand on its own next to a broader one. List the tags to retire in \`from\` and the tag they become in \`into\`, which can be an existing tag or a clearer new name. Keep distinct concepts separate even when they're related. Never merge into or out of \`other\`. Leave out tags that are fine as they are.
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

// Saved documents only: no feed items, highlights, or notes
const isLibraryDocument = (article: Article) =>
  article.location !== 'feed' &&
  article.category !== 'highlight' &&
  article.category !== 'note' &&
  !article.parent_id;

const unique = (tags: string[]) => [...new Set(tags.filter(Boolean))];

async function planRebalance(
  taxonomy: string[],
  otherDocuments: Article[],
): Promise<RebalancePlan> {
  // Streaming keeps a long response from hitting HTTP timeouts
  const stream = getAnthropic().beta.messages.stream({
    model: PLAN_MODEL,
    max_tokens: 32000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PLAN_SCHEMA },
    },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: JSON.stringify(
          {
            tags: taxonomy,
            other_documents: otherDocuments.map((doc) => ({
              id: doc.id,
              title: doc.title,
              author: doc.author,
              site: doc.site_name,
              summary: doc.summary,
            })),
          },
          null,
          2,
        ),
      },
    ],
  });
  const message = await stream.finalMessage();

  if (
    message.stop_reason === 'refusal' ||
    message.stop_reason === 'max_tokens'
  ) {
    throw new Error(`Rebalance plan incomplete (${message.stop_reason})`);
  }

  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  return JSON.parse(text) as RebalancePlan;
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

  // What each document has in Readwise now, and the tags we start from
  const current = new Map<string, string[]>();
  const base = new Map<string, string[]>();

  // 1. Documents the webhook missed
  const since = new Date(Date.now() - sweepDays * 24 * 60 * 60 * 1000);
  const missed = (await fetchArticles({ updatedAfter: since, tag: '' })).filter(
    isLibraryDocument,
  );
  let missedDocumentsTagged = 0;
  for (
    let i = 0;
    i < missed.length && !outOfTime(SWEEP_RESERVE_MS);
    i += CLASSIFY_CONCURRENCY
  ) {
    const batch = missed.slice(i, i + CLASSIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map((doc) =>
        classifyDocument(
          {
            title: doc.title,
            author: doc.author,
            url: doc.url,
            summary: doc.summary,
          },
          taxonomy,
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
      missedDocumentsTagged += 1;
    });
  }

  // 2. The `other` bucket, including anything step 1 just put there
  const otherDocuments = new Map<string, Article>();
  for (const doc of await fetchArticles({ tag: OTHER_TAG })) {
    otherDocuments.set(doc.id, doc);
    current.set(doc.id, articleTagNames(doc));
    base.set(doc.id, articleTagNames(doc));
  }
  for (const doc of missed) {
    if (base.get(doc.id)?.includes(OTHER_TAG)) otherDocuments.set(doc.id, doc);
  }

  let plan: RebalancePlan = { merges: [], other_documents: [] };
  if (
    (taxonomy.length > 0 || otherDocuments.size > 0) &&
    !outOfTime(PLAN_RESERVE_MS)
  ) {
    plan = await planRebalance(taxonomy, [...otherDocuments.values()]);
    console.log('Rebalance plan:', JSON.stringify(plan));
  }

  // 3. Merges, as old name -> new name
  const renames = new Map<string, string>();
  for (const { from, into } of plan.merges) {
    const target = normalizeTag(into);
    if (!target || target === OTHER_TAG) continue;
    for (const name of from.map(normalizeTag)) {
      if (taxonomy.includes(name) && name !== target) renames.set(name, target);
    }
  }
  const rename = (tag: string) => {
    let name = normalizeTag(tag);
    // Follow chains (a -> b -> c), with a cap in case the plan loops
    for (let hops = 0; renames.has(name) && hops < 10; hops += 1) {
      name = renames.get(name)!;
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

  return {
    missedDocumentsTagged,
    merges: [...renames].map(([from, into]) => ({ from: [from], into })),
    otherResolved: otherDocuments.size - otherRemaining,
    otherRemaining,
    documentsUpdated: updated,
    failed,
    incomplete,
  };
}
