/**
 * Weekly realign of the likes' categories and tags, like the reading
 * rebalance. Haiku organizes each like on its own as it's saved, so
 * categories drift: films filed under art because there was no films
 * category yet, synonyms side by side (michelin star, michelin-starred).
 * Claude Opus 5.5 looks at the whole collection at once and returns the
 * likes whose category or tags should change; they're applied directly, and
 * the trace keeps every change (before -> after) as the undo log.
 */

import { getAnthropic } from './anthropic.js';
import { requireSql } from './db.js';
import { setSyncState } from './documents.js';
import {
  CATEGORIES_STATE,
  CATEGORY_DESCRIPTION,
  type LikeCategoryDescription,
  TAGS_DESCRIPTION,
} from './likes-enrich.js';
import { tracedCall } from './traces.js';

const MODEL = 'claude-opus-5-5';

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

/**
 * Realigns every like's category and tags; `dryRun` returns the changes
 * without applying them
 */
export async function realignLikes({ dryRun = false } = {}) {
  const sql = requireSql();
  const rows = await sql`
    SELECT id, COALESCE(NULLIF(title, ''), left(text, 120)) AS title,
      description, category, tags
    FROM likes WHERE status = 'ready'
    ORDER BY created_at`;
  const likes = rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    category: (row.category as string | null) ?? null,
    tags: row.tags as string[],
  }));
  if (likes.length === 0) return { likes: 0, categories: [], changes: [] };

  const request = {
    model: MODEL,
    max_tokens: 64000,
    output_config: {
      effort: 'medium' as const,
      format: { type: 'json_schema' as const, schema: SCHEMA },
    },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        // Numbers instead of ids keep the response short
        content: JSON.stringify(
          likes.map(({ title, description, category, tags }, n) => ({
            n,
            title,
            description,
            category,
            tags,
          })),
        ),
      },
    ],
  };

  const { categories, changes } = await tracedCall(
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
      const plan = JSON.parse(text) as {
        categories: LikeCategoryDescription[];
        changes: { n: number; category: string; tags: string[] }[];
      };
      const seen = new Set<number>();
      const changes = plan.changes.flatMap(
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
      return { categories: plan.categories, changes };
    },
  );

  if (!dryRun && changes.length > 0) {
    await sql`
      UPDATE likes SET category = r.category,
        tags = ARRAY(SELECT jsonb_array_elements_text(r.tags))
      FROM jsonb_to_recordset(${JSON.stringify(
        changes.map(({ id, after }) => ({ id, ...after })),
      )}::jsonb) AS r(id text, category text, tags jsonb)
      WHERE likes.id::text = r.id`;
  }
  if (!dryRun) await setSyncState(CATEGORIES_STATE, categories);
  return { likes: likes.length, applied: !dryRun, categories, changes };
}
