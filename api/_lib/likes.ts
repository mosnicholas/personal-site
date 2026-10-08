/**
 * The likes collection (/likes): links, notes and photos I save, in the
 * `likes` table (db.ts), with photos in a private Vercel Blob store. Haiku
 * fills in each like's title, description, category and tags in the
 * background (likes-enrich.ts), leaving alone anything I set myself.
 */

import { createHash, randomUUID } from 'node:crypto';

import { del, get, put, putImage } from '@vercel/blob';

import type { Like, LikePatch } from '../../shared/likes.js';
import { requireSql, wordPatterns } from './db.js';

/** A save the caller got wrong, answered with a 400 */
export class LikeInputError extends Error {}

export interface NewLike {
  url?: string;
  text?: string;
  note?: string;
  list?: string;
  review?: string;
  /**
   * Set by whoever saves it (Claude often knows what it is already);
   * enrichment only fills in what's missing
   */
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  /**
   * JPEGs resized before upload (by the browser or the share sheet), or the
   * URL of an image (ChatGPT passes the photos attached in a chat as
   * temporary URLs)
   */
  photos?: (Uint8Array | URL)[];
  /** web, mcp, or import */
  source: string;
}

/** The details enrichment found for a like */
export interface LikeDetails {
  title: string;
  description: string;
  category: string;
  tags: string[];
  imageUrl: string | null;
  sources: Like['sources'];
}

type Row = Record<string, unknown>;

export function likeFromRow(row: Row): Like {
  const version = (photo: string) =>
    createHash('sha256').update(photo).digest('hex').slice(0, 8);
  return {
    id: String(row.id),
    url: (row.url as string | null) ?? null,
    text: String(row.text),
    note: String(row.note),
    list: (row.list as string | null) ?? null,
    review: String(row.review),
    photoUrls: (row.photos as string[]).map(
      (photo, n) =>
        `/api/likes?op=photo&id=${String(row.id)}&n=${n}&v=${version(photo)}`,
    ),
    title: String(row.title),
    description: String(row.description),
    category: (row.category as string | null) ?? null,
    tags: row.tags as string[],
    imageUrl: (row.image_url as string | null) ?? null,
    sources: row.sources as Like['sources'],
    status: row.status as Like['status'],
    error: (row.error as string | null) ?? null,
    source: String(row.source),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** Every like, newest first */
export async function listLikes(): Promise<Like[]> {
  const sql = await requireSql();
  const rows = await sql`SELECT * FROM likes ORDER BY created_at DESC`;
  return rows.map(likeFromRow);
}

export async function getLike(id: string): Promise<Like | undefined> {
  const sql = await requireSql();
  const [row] = await sql`SELECT * FROM likes WHERE id = ${id}`;
  return row ? likeFromRow(row) : undefined;
}

/**
 * Likes matching every word of `query` anywhere, newest first; `since` is a
 * date, and `offset` skips that many for the next page
 */
export async function searchLikes({
  query = '',
  since,
  limit = 20,
  offset = 0,
}: {
  query?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): Promise<Like[]> {
  const sql = await requireSql();
  const rows = await sql`
    SELECT * FROM likes
    WHERE (${since ?? null}::date IS NULL OR created_at >= ${since ?? null}::date)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${wordPatterns(query)}::text[]) AS pattern
        WHERE concat_ws(' ', url, text, note, list, review, title, description,
          category, array_to_string(tags, ' ')) NOT ILIKE pattern)
    ORDER BY created_at DESC, id
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(likeFromRow);
}

/** A list name as it's stored: lowercase, or null for none */
const listName = (list: string | undefined | null) =>
  list?.trim().toLowerCase() || null;

/**
 * Saves a like for enrichment to pick up. A link I've saved before returns
 * the existing like instead of a duplicate, with the list and review given
 * this time (sharing it again after I've been)
 */
export async function saveLike(like: NewLike): Promise<Like> {
  const url = like.url?.trim() || null;
  // The share sheet sends a web page as its link and as its text
  const text = like.text?.trim() === url ? '' : (like.text?.trim() ?? '');
  const list = listName(like.list);
  const review = like.review?.trim() ?? '';
  if (url && !isHttpUrl(url)) {
    throw new LikeInputError('Links need to start with http:// or https://');
  }
  const photos = like.photos ?? [];
  if (!url && !text && photos.length === 0) {
    throw new LikeInputError('Add a link, some text, or a photo');
  }

  const sql = await requireSql();
  if (url) {
    const [existing] = await sql`
      UPDATE likes SET list = coalesce(${list}, list),
        review = coalesce(nullif(${review}, ''), review)
      WHERE url = ${url}
      RETURNING *`;
    if (existing) return likeFromRow(existing);
  }
  const id = randomUUID();
  const photoUrls = await Promise.all(
    photos.map((photo) => savePhoto(id, photo)),
  );
  const [row] = await sql`
    INSERT INTO likes (id, url, text, note, list, review, photos, title,
      description, category, tags, source)
    VALUES (${id}, ${url}, ${text}, ${like.note?.trim() ?? ''}, ${list},
      ${review}, ${photoUrls}::text[], ${like.title?.trim() ?? ''},
      ${like.description?.trim() ?? ''},
      ${like.category?.trim() || null},
      ${(like.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)},
      ${like.source})
    RETURNING *`;
  return likeFromRow(row);
}

/**
 * Stores one of a like's photos as a JPEG in Blob storage and returns its
 * URL. Each photo gets a new path, so nothing serves an old one from a cache.
 * A URL is fetched and resized by Vercel Image Optimization, which needs the
 * OIDC credentials Vercel provides (so it doesn't work locally)
 */
async function savePhoto(id: string, photo: Uint8Array | URL) {
  const pathname = `likes/${id}-${randomUUID().slice(0, 8)}.jpg`;
  if (!(photo instanceof URL)) {
    const blob = await put(pathname, Buffer.from(photo), {
      access: 'private',
      contentType: 'image/jpeg',
    });
    return blob.url;
  }
  if (!isHttpUrl(photo.href)) {
    throw new LikeInputError('Photos need an http:// or https:// URL');
  }
  const blob = await putImage(pathname, photo, {
    access: 'private',
    optimizeImage: { width: 2048, quality: 85, format: 'jpeg' },
  }).catch((error: unknown) => {
    console.error('Could not save the photo:', error);
    throw new LikeInputError('Couldn’t read that photo');
  });
  return blob.url;
}

/**
 * My edits from /likes; fields left out stay as they are, and an empty list
 * takes it off its list
 */
export async function updateLike(
  id: string,
  patch: LikePatch,
): Promise<Like | undefined> {
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : null;
  const tags = Array.isArray(patch.tags)
    ? patch.tags.map(text).filter((tag): tag is string => Boolean(tag))
    : null;
  const sql = await requireSql();
  const [row] = await sql`
    UPDATE likes SET
      title = coalesce(${text(patch.title)}, title),
      note = coalesce(${text(patch.note)}, note),
      list = CASE WHEN ${typeof patch.list === 'string'}::boolean
        THEN ${listName(patch.list)} ELSE list END,
      review = coalesce(${text(patch.review)}, review),
      description = coalesce(${text(patch.description)}, description),
      category = coalesce(nullif(${text(patch.category)}, ''), category),
      tags = coalesce(${tags}::text[], tags)
    WHERE id = ${id}
    RETURNING *`;
  return row ? likeFromRow(row) : undefined;
}

export async function deleteLike(id: string): Promise<boolean> {
  const sql = await requireSql();
  const [row] = await sql`DELETE FROM likes WHERE id = ${id} RETURNING photos`;
  const photos = (row?.photos ?? []) as string[];
  if (photos.length) await del(photos);
  return Boolean(row);
}

/**
 * Queues a like to be organized again from scratch, with a fresh set of
 * attempts: what Haiku filled in is cleared, so it goes by my note and photo
 * as they are now
 */
export async function redoLike(id: string): Promise<Like | undefined> {
  const sql = await requireSql();
  const [row] = await sql`
    UPDATE likes SET title = '', description = '', category = NULL,
      tags = '{}', image_url = NULL, sources = '[]', status = 'pending',
      error = NULL, attempts = 0, claimed_at = NULL
    WHERE id = ${id}
    RETURNING *`;
  return row ? likeFromRow(row) : undefined;
}

/** Adds a photo after a like's others (see savePhoto) */
export async function addPhoto(
  id: string,
  photo: Uint8Array | URL,
): Promise<Like | undefined> {
  if (!(await getLike(id))) return undefined;
  const url = await savePhoto(id, photo);
  const sql = await requireSql();
  const [row] = await sql`
    UPDATE likes SET photos = array_append(photos, ${url})
    WHERE id = ${id}
    RETURNING *`;
  return row ? likeFromRow(row) : undefined;
}

/** Removes a like's photo `n` (counting from 0) */
export async function removePhoto(
  id: string,
  n: number,
): Promise<Like | undefined> {
  const sql = await requireSql();
  const [old] = await sql`SELECT photos FROM likes WHERE id = ${id}`;
  const url = (old?.photos as string[] | undefined)?.[n];
  if (!url) return undefined;
  const [row] = await sql`
    UPDATE likes SET photos = array_remove(photos, ${url})
    WHERE id = ${id}
    RETURNING *`;
  await del(url);
  return likeFromRow(row);
}

/** A like's photo `n` (counting from 0), streamed from Blob storage */
export async function readPhoto(
  id: string,
  n: number,
): Promise<{ stream: ReadableStream<Uint8Array>; type: string } | undefined> {
  const sql = await requireSql();
  const [row] = await sql`
    SELECT photos[${n + 1}::int] AS photo FROM likes WHERE id = ${id}`;
  if (!row?.photo) return undefined;
  const blob = await get(String(row.photo), { access: 'private' });
  return blob?.statusCode === 200
    ? { stream: blob.stream, type: blob.blob.contentType }
    : undefined;
}

export interface LikeCategory {
  name: string;
  likes: number;
  /** The latest few titles */
  examples: string[];
  /** Its most used tags */
  tags: string[];
}

/**
 * The categories in use, most used first, with what's in them, so
 * enrichment can see what each holds and reuse their tags
 */
export async function likeCategories(): Promise<LikeCategory[]> {
  const sql = await requireSql();
  const rows = await sql`
    SELECT category AS name, count(*)::int AS likes,
      (array_agg(COALESCE(NULLIF(title, ''), left(text, 80))
        ORDER BY created_at DESC))[1:3] AS examples,
      ARRAY(
        SELECT tag FROM likes inner_likes, unnest(inner_likes.tags) tag
        WHERE inner_likes.category = likes.category
        GROUP BY tag ORDER BY count(*) DESC, tag LIMIT 10
      ) AS tags
    FROM likes WHERE category IS NOT NULL
    GROUP BY category ORDER BY count(*) DESC, category`;
  return rows.map((row) => ({
    name: String(row.name),
    likes: Number(row.likes),
    examples: row.examples as string[],
    tags: row.tags as string[],
  }));
}

/**
 * Up to `limit` likes waiting for enrichment, oldest first. Claiming one
 * keeps other workers off it for 5 minutes, which is also how long a failed
 * one waits to be tried again (3 tries in all)
 */
export async function claimLikes(limit: number): Promise<Like[]> {
  const sql = await requireSql();
  const rows = await sql`
    UPDATE likes SET claimed_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM likes
      WHERE status <> 'ready' AND attempts < 3
        AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING *`;
  return rows.map(likeFromRow);
}

/**
 * Saves what enrichment found, keeping anything I set, and an image or
 * sources found before ("Organize again" clears those first)
 */
export async function finishLike(id: string, details: LikeDetails) {
  const sql = await requireSql();
  await sql`
    UPDATE likes SET
      title = CASE WHEN title = '' THEN ${details.title} ELSE title END,
      description = CASE WHEN description = '' THEN ${details.description}
        ELSE description END,
      category = coalesce(category, ${details.category}),
      tags = CASE WHEN tags = '{}' THEN ${details.tags}::text[] ELSE tags END,
      image_url = coalesce(image_url, ${details.imageUrl}),
      sources = CASE WHEN sources = '[]' THEN ${JSON.stringify(details.sources)}::jsonb
        ELSE sources END,
      status = 'ready', error = NULL, claimed_at = NULL
    WHERE id = ${id}`;
}

export async function failLike(id: string, error: string) {
  const sql = await requireSql();
  await sql`UPDATE likes SET status = 'failed', error = ${error} WHERE id = ${id}`;
}

/** The bytes of a like's first `limit` photos, for a model to look at */
export async function photoBytes(like: Like, limit: number): Promise<Buffer[]> {
  const photos = await Promise.all(
    like.photoUrls.slice(0, limit).map(async (_, n) => {
      const photo = await readPhoto(like.id, n);
      return photo
        ? Buffer.from(await new Response(photo.stream).arrayBuffer())
        : undefined;
    }),
  );
  return photos.filter((photo) => photo !== undefined);
}
