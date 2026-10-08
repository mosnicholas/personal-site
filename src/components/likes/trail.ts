import type { Like } from '../../../shared/likes';

/** Where I am on the shelf: a category (or all of them), then tags, each narrowing the last */
export interface Trail {
  category: string | null;
  tags: string[];
}

export const inTrail = (like: Like, trail: Trail) =>
  (!trail.category || like.category === trail.category) &&
  trail.tags.every((tag) => like.tags.includes(tag));

/**
 * ?category=&tag=&tag= keeps a spot on the shelf bookmarkable, and ?item= the
 * like open in Wander (links from the monthly email and Claude use it too)
 */
export const trailFromUrl = (): Trail => {
  const params = new URLSearchParams(window.location.search);
  return { category: params.get('category'), tags: params.getAll('tag') };
};

export const itemFromUrl = () =>
  new URLSearchParams(window.location.search).get('item');

export const trailUrl = (trail: Trail, item?: string) => {
  const params = new URLSearchParams();
  if (trail.category) params.set('category', trail.category);
  for (const tag of trail.tags) params.append('tag', tag);
  if (item) params.set('item', item);
  const query = params.toString();
  return query ? `/likes?${query}` : '/likes';
};

export const pick = <T>(items: T[]) =>
  items[Math.floor(Math.random() * items.length)];
