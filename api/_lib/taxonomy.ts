/**
 * The tag taxonomy: the tags the classifier may apply to new documents.
 *
 * Readwise is the source of truth - the taxonomy is the set of tags in use.
 * New documents only ever get existing tags. When none fit, or the main
 * subject isn't covered, the document also gets `other`; the weekly
 * rebalance (api/rebalance-tags.ts) merges tags and turns recurring themes in
 * `other` into new tags.
 */

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

// The taxonomy changes weekly, so warm functions can reuse it for a while
// instead of spending Readwise's 20/min budget on every webhook
const CACHE_MS = 10 * 60_000;
let cache: { names: string[]; at: number } | undefined;

/**
 * Normalized tag names, excluding `other`
 */
export async function getTaxonomy(): Promise<string[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const names = (await fetchTags()).map((tag) => normalizeTag(tag.name));
    cache = {
      names: [...new Set(names)].filter((name) => name && name !== OTHER_TAG),
      at: Date.now(),
    };
  }
  return cache.names;
}
