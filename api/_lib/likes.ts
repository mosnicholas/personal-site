/**
 * The likes collection (/likes): links, notes and photos I save, in the
 * `likes` table (db.ts), with photos and pictures in Storage (pictures.ts). Haiku
 * fills in each like's title, description, category and tags in the
 * background (likes-enrich.ts), leaving alone anything I set myself.
 */

import { randomUUID } from 'node:crypto';

import type { Like, LikePatch } from '../../shared/likes.js';
import { requireSql, wordPatterns } from './db.js';
import {
  deletePictures,
  downloadPicture,
  fetchStoredPicture,
  type Picture,
  pictureType,
  publicPictureUrl,
  uploadPicture,
} from './pictures.js';

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
   * temporary URLs), which is stored as it is
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
  /** Where the picture came from, and the path it was stored at */
  imageUrl: string | null;
  imagePath: string | null;
  sources: Like['sources'];
}

type Row = Record<string, unknown>;

export function likeFromRow(row: Row): Like {
  const imagePath = row.image_path as string | null;
  return {
    id: String(row.id),
    url: (row.url as string | null) ?? null,
    text: String(row.text),
    note: String(row.note),
    list: (row.list as string | null) ?? null,
    review: String(row.review),
    // A full URL is a photo still in Blob storage, until it's moved
    // (storePictures)
    photoUrls: (row.photos as string[]).map((photo) =>
      photo.startsWith('http') ? photo : publicPictureUrl(photo),
    ),
    title: String(row.title),
    description: String(row.description),
    category: (row.category as string | null) ?? null,
    tags: row.tags as string[],
    imageUrl: (row.image_url as string | null) ?? null,
    pictureUrl: imagePath ? publicPictureUrl(imagePath) : null,
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
  const sql = requireSql();
  const rows = await sql`SELECT * FROM likes ORDER BY created_at DESC`;
  return rows.map(likeFromRow);
}

export async function getLike(id: string): Promise<Like | undefined> {
  const sql = requireSql();
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
  const sql = requireSql();
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

  const sql = requireSql();
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
 * Stores one of a like's photos and returns its path in the bucket. The
 * browser and the share sheet send JPEGs; a URL is fetched and stored as it
 * is, once its first bytes say it's an image
 */
async function savePhoto(id: string, photo: Uint8Array | URL) {
  if (photo instanceof URL) {
    if (!isHttpUrl(photo.href)) {
      throw new LikeInputError('Photos need an http:// or https:// URL');
    }
    const { picture } = await downloadPicture(photo.href, MAX_PHOTO_BYTES);
    if (!picture) throw new LikeInputError('Couldn’t read that photo');
    return uploadPicture(id, picture.data, picture.type);
  }
  const type = pictureType(photo);
  if (!type) throw new LikeInputError('Couldn’t read that photo');
  return uploadPicture(id, photo, type);
}

// The biggest photo taken from a URL
const MAX_PHOTO_BYTES = 25_000_000;

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
  const sql = requireSql();
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

/** The paths in the bucket among a like's photos and its picture */
const storedPaths = (photos: string[], imagePath: string | null) =>
  [...photos, imagePath].filter(
    (path): path is string => Boolean(path) && !path?.startsWith('http'),
  );

export async function deleteLike(id: string): Promise<boolean> {
  const sql = requireSql();
  const [row] = await sql`
    DELETE FROM likes WHERE id = ${id} RETURNING photos, image_path`;
  if (row) await deletePictures(storedPaths(row.photos, row.image_path));
  return Boolean(row);
}

/**
 * Queues a like to be organized again from scratch, with a fresh set of
 * attempts: what Haiku filled in is cleared, so it goes by my note and photo
 * as they are now
 */
export async function redoLike(id: string): Promise<Like | undefined> {
  const sql = requireSql();
  const [old] = await sql`SELECT image_path FROM likes WHERE id = ${id}`;
  const [row] = await sql`
    UPDATE likes SET title = '', description = '', category = NULL,
      tags = '{}', image_url = NULL, image_path = NULL, sources = '[]',
      status = 'pending', error = NULL, attempts = 0, claimed_at = NULL
    WHERE id = ${id}
    RETURNING *`;
  if (old?.image_path) await deletePictures([String(old.image_path)]);
  return row ? likeFromRow(row) : undefined;
}

/** Adds a photo after a like's others (see savePhoto) */
export async function addPhoto(
  id: string,
  photo: Uint8Array | URL,
): Promise<Like | undefined> {
  if (!(await getLike(id))) return undefined;
  const path = await savePhoto(id, photo);
  const sql = requireSql();
  const [row] = await sql`
    UPDATE likes SET photos = array_append(photos, ${path})
    WHERE id = ${id}
    RETURNING *`;
  return row ? likeFromRow(row) : undefined;
}

/** Removes a like's photo `n` (counting from 0) */
export async function removePhoto(
  id: string,
  n: number,
): Promise<Like | undefined> {
  const sql = requireSql();
  const [old] = await sql`SELECT photos FROM likes WHERE id = ${id}`;
  const photo = (old?.photos as string[] | undefined)?.[n];
  if (!photo) return undefined;
  const [row] = await sql`
    UPDATE likes SET photos = array_remove(photos, ${photo})
    WHERE id = ${id}
    RETURNING *`;
  await deletePictures(storedPaths([photo], null));
  return likeFromRow(row);
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
  const sql = requireSql();
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
  const sql = requireSql();
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
  const sql = requireSql();
  await sql`
    UPDATE likes SET
      title = CASE WHEN title = '' THEN ${details.title} ELSE title END,
      description = CASE WHEN description = '' THEN ${details.description}
        ELSE description END,
      category = coalesce(category, ${details.category}),
      tags = CASE WHEN tags = '{}' THEN ${details.tags}::text[] ELSE tags END,
      -- The picture and where it came from go together
      image_path = CASE WHEN image_url IS NULL THEN ${details.imagePath}
        ELSE image_path END,
      image_url = coalesce(image_url, ${details.imageUrl}),
      sources = CASE WHEN sources = '[]' THEN ${JSON.stringify(details.sources)}::jsonb
        ELSE sources END,
      status = 'ready', error = NULL, claimed_at = NULL
    WHERE id = ${id}`;
}

export async function failLike(id: string, error: string) {
  const sql = requireSql();
  await sql`UPDATE likes SET status = 'failed', error = ${error} WHERE id = ${id}`;
}

/** A like's first `limit` photos, at their large size, for a model to look at */
export async function photoBytes(
  like: Like,
  limit: number,
): Promise<Picture[]> {
  const photos = await Promise.all(
    like.photoUrls.slice(0, limit).map((url) => fetchStoredPicture(url)),
  );
  return photos.filter((photo) => photo !== undefined);
}
