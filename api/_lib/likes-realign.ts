/**
 * Realign of the likes' categories and tags, like the reading rebalance.
 * Haiku organizes each like on its own as it's saved, so categories drift:
 * films filed under art because there was no films category yet, synonyms
 * side by side (michelin star, michelin-starred). Claude Opus 5.5 fixes it
 * in two modes. The weekly run is incremental: the collection is assumed to
 * be aligned, and only the likes saved (or organized again) since the last
 * look are fitted into the existing categories and tags, with tag merges
 * when they show two tags mean the same. A full pass, about monthly or on
 * demand, looks at the whole collection at once and settles the categories
 * again. Changes are applied directly, and the result keeps every change
 * (before -> after) as the undo log.
 */

import { getAnthropic } from './anthropic.js';
import { requireSql } from './db.js';
import { getSyncState, setSyncState } from './documents.js';
import {
  CATEGORIES_STATE,
  CATEGORY_DESCRIPTION,
  type LikeCategoryDescription,
  TAGS_DESCRIPTION,
} from './likes-enrich.js';
import { tracedCall } from './traces.js';

const MODEL = 'claude-opus-5-5';

/** When the last full pass ran (an ISO time in `sync_state`) */
const FULL_STATE = 'likes_realign_full';
const FULL_EVERY_DAYS = 27;

const SYSTEM_PROMPT = `You keep a personal collection of things someone likes organized: products, places, restaurants, films, books, ideas and more, each saved because they like it or want to try it. Each like has a category (${CATEGORY_DESCRIPTION.toLowerCase()}) and tags (${TAGS_DESCRIPTION.charAt(0).toLowerCase()}${TAGS_DESCRIPTION.slice(1)}). They're for browsing: a category should hold one kind of thing, and the same kind of thing should get the same category and tags.

Each like was organized on its own when it was saved, so the collection has drifted: things filed under the nearest category that existed then, categories that overlap or hold several kinds of thing, synonyms among tags. Look at all of it and first settle the categories it should have, each with a short description of what belongs in it. Then return the likes whose category or tags should change, each with its full new category and tags. Leave the rest out.`;

const SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: "The like's n" },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['n', 'category', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['categories', 'changes'],
  additionalProperties: false,
};

const INCREMENTAL_PROMPT = `You keep a personal collection of things someone likes organized: products, places, restaurants, films, books, ideas and more, each saved because they like it or want to try it. Each like has a category (${CATEGORY_DESCRIPTION.toLowerCase()}) and tags (${TAGS_DESCRIPTION.charAt(0).toLowerCase()}${TAGS_DESCRIPTION.slice(1)}). They're for browsing: a category should hold one kind of thing, and the same kind of thing should get the same category and tags.

The collection is already organized. You get its categories, each with its description and the tags in use under it (with how many likes have each), and some new likes that a smaller model just organized on their own. Fit each new like into the existing categories and reuse the existing tags where they mean the same thing. Start a new category, with a description, only when a like fits none of them. Return only the likes whose category or tags should change, each with its full new category and tags. If a new like shows that two existing tags mean the same, or that a tag on it should replace an existing synonym, merge them: the merge is applied to every like.`;

const INCREMENTAL_SCHEMA = {
  type: 'object',
  properties: {
    new_categories: SCHEMA.properties.categories,
    merges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          into: { type: 'string' },
        },
        required: ['from', 'into'],
        additionalProperties: false,
      },
    },
    changes: SCHEMA.properties.changes,
  },
  required: ['new_categories', 'merges', 'changes'],
  additionalProperties: false,
};

interface Organized {
  category: string | null;
  tags: string[];
}

export interface RealignChange {
  id: string;
  title: string;
  before: Organized;
  after: Organized;
}

const cleanTags = (tags: string[]) => [
  ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
];

const same = (a: Organized, b: Organized) =>
  a.category === b.category && a.tags.join('\n') === b.tags.join('\n');

const FULL_MS = FULL_EVERY_DAYS * 24 * 60 * 60 * 1000;

/**
 * Realigns the likes' categories and tags: the ones not looked at yet, or
 * all of them when `full` is set or the last full pass is over 27 days old.
 * `dryRun` returns the changes without applying them
 */
export async function realignLikes({
  dryRun = false,
  full: forceFull = false,
} = {}) {
  const sql = requireSql();
  const lastFull = await getSyncState<string>(FULL_STATE);
  const full =
    forceFull ||
    !lastFull ||
    Date.now() - new Date(lastFull).getTime() > FULL_MS;
  const mode = full ? ('full' as const) : ('incremental' as const);

  const rows = await sql`
    SELECT id, COALESCE(NULLIF(title, ''), left(text, 120)) AS title,
      description, category, tags, realigned_at IS NULL AS fresh
    FROM likes WHERE status = 'ready'
    ORDER BY created_at`;
  const all = rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    category: (row.category as string | null) ?? null,
    tags: row.tags as string[],
    fresh: Boolean(row.fresh),
  }));
  const likes = full ? all : all.filter((like) => like.fresh);
  if (likes.length === 0) {
    return { mode, likes: 0, categories: [], changes: [] };
  }

  // The tags in use under each category, with their counts
  const saved =
    (await getSyncState<LikeCategoryDescription[]>(CATEGORIES_STATE)) ?? [];
  const inUse = new Map<string, Map<string, number>>(
    saved.map(({ name }) => [name, new Map()]),
  );
  const tagCount = new Map<string, number>();
  for (const { category, tags } of all) {
    const counts = category
      ? (inUse.get(category) ?? inUse.set(category, new Map()).get(category)!)
      : undefined;
    for (const tag of tags) {
      counts?.set(tag, (counts.get(tag) ?? 0) + 1);
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
  }
  const described = new Map(saved.map((c) => [c.name, c.description]));

  const numbered = JSON.stringify(
    // Numbers instead of ids keep the response short
    likes.map(({ title, description, category, tags }, n) => ({
      n,
      title,
      description,
      category,
      tags,
    })),
  );
  const request = {
    model: MODEL,
    max_tokens: 64000,
    output_config: {
      effort: 'medium' as const,
      format: {
        type: 'json_schema' as const,
        schema: full ? SCHEMA : INCREMENTAL_SCHEMA,
      },
    },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: full ? SYSTEM_PROMPT : INCREMENTAL_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: full
          ? numbered
          : JSON.stringify({
              categories: [...inUse].map(([name, counts]) => ({
                name,
                description: described.get(name) ?? null,
                tags: Object.fromEntries(counts),
              })),
              new_likes: JSON.parse(numbered),
            }),
      },
    ],
  };

  const plan = await tracedCall(
    {
      kind: 'likes_realign',
      subjectId: new Date().toISOString().slice(0, 10),
      model: MODEL,
      request,
    },
    // Streaming keeps a long response from hitting HTTP timeouts
    () => getAnthropic().beta.messages.stream(request).finalMessage(),
    (response) => {
      if (response.stop_reason !== 'end_turn') {
        throw new Error(`Realign stopped early (${response.stop_reason})`);
      }
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      const raw = JSON.parse(text) as {
        categories?: LikeCategoryDescription[];
        new_categories?: LikeCategoryDescription[];
        merges?: { from: string; into: string }[];
        changes?: { n: number; category: string; tags: string[] }[];
      };
      const seen = new Set<number>();
      const changes = (raw.changes ?? []).flatMap(
        ({ n, category, tags }): RealignChange[] => {
          const like = likes[n];
          if (!like || seen.has(n) || !category.trim()) return [];
          seen.add(n);
          const before = { category: like.category, tags: like.tags };
          const after = { category: category.trim(), tags: cleanTags(tags) };
          return same(before, after)
            ? []
            : [{ id: like.id, title: like.title, before, after }];
        },
      );
      // Merges: from a tag in use, into a different one that isn't itself merged away
      const cleaned = (raw.merges ?? []).map(({ from, into }) => ({
        from: cleanTags([from])[0] ?? '',
        into: cleanTags([into])[0] ?? '',
      }));
      const froms = new Set(cleaned.map(({ from }) => from));
      const merges = cleaned.filter(
        ({ from, into }) =>
          from &&
          into &&
          from !== into &&
          tagCount.has(from) &&
          !froms.has(into),
      );
      return {
        categories: raw.categories ?? raw.new_categories ?? [],
        merges,
        changes,
      };
    },
  );

  // Apply the changes, then the merges, to every like; what differs from how
  // it started is the full undo log
  const byId = new Map(plan.changes.map((change) => [change.id, change]));
  const changed = new Map<string, RealignChange>();
  const mapped = new Map(plan.merges.map(({ from, into }) => [from, into]));
  for (const like of all) {
    const change = byId.get(like.id);
    const category = change?.after.category ?? like.category;
    const start = change?.after.tags ?? like.tags;
    // Only a merge rewrites tags, so a like it doesn't touch stays as it is
    const tags = start.some((tag) => mapped.has(tag))
      ? cleanTags(start.map((tag) => mapped.get(tag) ?? tag))
      : start;
    const before = { category: like.category, tags: like.tags };
    const after = { category, tags };
    if (!same(before, after)) {
      changed.set(like.id, { id: like.id, title: like.title, before, after });
    }
  }
  const changes = [...changed.values()];

  if (!dryRun) {
    if (changes.length > 0) {
      await sql`
        UPDATE likes SET category = r.category,
          tags = ARRAY(SELECT jsonb_array_elements_text(r.tags))
        FROM jsonb_to_recordset(${JSON.stringify(
          changes.map(({ id, after }) => ({ id, ...after })),
        )}::jsonb) AS r(id text, category text, tags jsonb)
        WHERE likes.id::text = r.id`;
    }
    if (full) {
      await setSyncState(CATEGORIES_STATE, plan.categories);
    } else if (plan.categories.length > 0) {
      const names = new Set(saved.map(({ name }) => name));
      await setSyncState(CATEGORIES_STATE, [
        ...saved,
        ...plan.categories.filter(({ name }) => !names.has(name)),
      ]);
    }
    await sql`
      UPDATE likes SET realigned_at = now()
      WHERE id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(
        likes.map(({ id }) => id),
      )}::jsonb))`;
    if (full) await setSyncState(FULL_STATE, new Date().toISOString());
  }
  return {
    mode,
    likes: likes.length,
    applied: !dryRun,
    categories: plan.categories,
    merges: plan.merges,
    changes,
  };
}
