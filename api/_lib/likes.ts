/**
 * The likes collection (/likes): links, notes and photos I save, in the
 * `likes` table (db.ts), with photos in a private Vercel Blob store. Haiku
 * fills in each like's title, description, category and tags in the
 * background (likes-enrich.ts), leaving alone anything I set myself.
 */

import { randomUUID } from 'node:crypto';

import { del, get, put } from '@vercel/blob';

import type { Like, LikePatch } from '../../shared/likes.js';
import { requireSql } from './db.js';

/** A save the caller got wrong, answered with a 400 */
export class LikeInputError extends Error {}

export interface NewLike {
  url?: string;
  text?: string;
  note?: string;
  /** Set by me (or Claude, saving over MCP); enrichment keeps them */
  title?: string;
  category?: string;
  /** A JPEG, resized in the browser before upload */
  photo?: Uint8Array;
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
  return {
    id: String(row.id),
    url: (row.url as string | null) ?? null,
    text: String(row.text),
    note: String(row.note),
    hasPhoto: Boolean(row.photo),
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

/** Likes matching every word of `query` anywhere, newest first */
export async function searchLikes(query: string, limit = 20): Promise<Like[]> {
  const patterns = query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`);
  const sql = await requireSql();
  const rows = await sql`
    SELECT * FROM likes
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(${patterns}::text[]) AS pattern
      WHERE concat_ws(' ', url, text, note, title, description, category,
        array_to_string(tags, ' ')) NOT ILIKE pattern)
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows.map(likeFromRow);
}

/**
 * Saves a like for enrichment to pick up. A link I've saved before returns
 * the existing like instead of a duplicate
 */
export async function saveLike(like: NewLike): Promise<Like> {
  const url = like.url?.trim() || null;
  const text = like.text?.trim() ?? '';
  if (url && !isHttpUrl(url)) {
    throw new LikeInputError('Links need to start with http:// or https://');
  }
  if (!url && !text && !like.photo) {
    throw new LikeInputError('Add a link, some text, or a photo');
  }

  const sql = await requireSql();
  if (url) {
    const [existing] = await sql`SELECT * FROM likes WHERE url = ${url}`;
    if (existing) return likeFromRow(existing);
  }
  const id = randomUUID();
  const photo = like.photo
    ? (
        await put(`likes/${id}.jpg`, Buffer.from(like.photo), {
          access: 'private',
          contentType: 'image/jpeg',
        })
      ).url
    : null;
  const [row] = await sql`
    INSERT INTO likes (id, url, text, note, photo, title, category, source)
    VALUES (${id}, ${url}, ${text}, ${like.note?.trim() ?? ''}, ${photo},
      ${like.title?.trim() ?? ''}, ${like.category?.trim() || null},
      ${like.source})
    RETURNING *`;
  return likeFromRow(row);
}

/** My edits from /likes; fields left out stay as they are */
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
      description = coalesce(${text(patch.description)}, description),
      category = coalesce(nullif(${text(patch.category)}, ''), category),
      tags = coalesce(${tags}::text[], tags)
    WHERE id = ${id}
    RETURNING *`;
  return row ? likeFromRow(row) : undefined;
}

export async function deleteLike(id: string): Promise<boolean> {
  const sql = await requireSql();
  const [row] = await sql`DELETE FROM likes WHERE id = ${id} RETURNING photo`;
  if (row?.photo) await del(String(row.photo));
  return Boolean(row);
}

/** Queues a like for enrichment again, with a fresh set of attempts */
export async function retryLike(id: string): Promise<Like | undefined> {
  const sql = await requireSql();
  const [row] = await sql`
    UPDATE likes SET status = 'pending', error = NULL, attempts = 0,
      claimed_at = NULL
    WHERE id = ${id}
    RETURNING *`;
  return row ? likeFromRow(row) : undefined;
}

/** A like's photo, streamed from Blob storage */
export async function readPhoto(
  id: string,
): Promise<{ stream: ReadableStream<Uint8Array>; type: string } | undefined> {
  const sql = await requireSql();
  const [row] = await sql`SELECT photo FROM likes WHERE id = ${id}`;
  if (!row?.photo) return undefined;
  const blob = await get(String(row.photo), { access: 'private' });
  return blob?.statusCode === 200
    ? { stream: blob.stream, type: blob.blob.contentType }
    : undefined;
}

/** The categories in use, most used first, for enrichment to reuse */
export async function likeCategories(): Promise<string[]> {
  const sql = await requireSql();
  const rows = await sql`
    SELECT category FROM likes WHERE category IS NOT NULL
    GROUP BY category ORDER BY count(*) DESC`;
  return rows.map((row) => String(row.category));
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

/** Saves what enrichment found, keeping anything I set */
export async function finishLike(id: string, details: LikeDetails) {
  const sql = await requireSql();
  await sql`
    UPDATE likes SET
      title = CASE WHEN title = '' THEN ${details.title} ELSE title END,
      description = CASE WHEN description = '' THEN ${details.description}
        ELSE description END,
      category = coalesce(category, ${details.category}),
      tags = CASE WHEN tags = '{}' THEN ${details.tags}::text[] ELSE tags END,
      image_url = ${details.imageUrl},
      sources = ${JSON.stringify(details.sources)}::jsonb,
      status = 'ready', error = NULL, claimed_at = NULL
    WHERE id = ${id}`;
}

export async function failLike(id: string, error: string) {
  const sql = await requireSql();
  await sql`UPDATE likes SET status = 'failed', error = ${error} WHERE id = ${id}`;
}

/** The photo's bytes, for Haiku to look at */
export async function photoBytes(id: string): Promise<Buffer | undefined> {
  const photo = await readPhoto(id);
  return photo
    ? Buffer.from(await new Response(photo.stream).arrayBuffer())
    : undefined;
}
