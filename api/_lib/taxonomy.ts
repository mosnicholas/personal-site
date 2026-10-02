/**
 * The tag taxonomy: the tags in use. Readwise is the source of truth; the
 * tagger reads them from our mirror (documents.ts), which adds how many
 * documents use each tag and its glossary definition (glossary.ts).
 *
 * The save-time tagger reuses these where it can and creates new ones when
 * nothing fits; documents it can't place get `other`. The weekly rebalance
 * (api/rebalance-tags.ts) merges duplicates and sorts out `other`.
 */

import { tagsInUse } from './documents.js';
import { fetchTags } from './readwise.js';

export const OTHER_TAG = 'other';

/**
 * Canonical tag form: lowercase kebab-case, no leading `#`
 */
export function normalizeTag(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface TaxonomyTag {
  name: string;
  /** How many documents use it, when known */
  documents?: number;
  /** What it covers, from the weekly glossary */
  definition?: string | null;
}

// The taxonomy changes slowly, so warm functions can reuse it for a while
const CACHE_MS = 10 * 60_000;
let cache: { tags: TaxonomyTag[]; at: number } | undefined;

/**
 * Tags in use, most used first, excluding `other`. From the mirror, or from
 * Readwise's tag list (names only) until the mirror is filled
 */
export async function getTaxonomy(): Promise<TaxonomyTag[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const fromMirror = await tagsInUse();
    const tags: TaxonomyTag[] = fromMirror
      ? fromMirror.map((tag) => ({ ...tag, name: normalizeTag(tag.name) }))
      : (await fetchTags()).map((tag) => ({ name: normalizeTag(tag.name) }));
    const seen = new Set<string>();
    cache = {
      tags: tags.filter(({ name }) => {
        if (!name || name === OTHER_TAG || seen.has(name)) return false;
        seen.add(name);
        return true;
      }),
      at: Date.now(),
    };
  }
  return cache.tags;
}
