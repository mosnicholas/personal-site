/**
 * Moves what the likes keep outside the database into Storage: each like's
 * picture (hotlinked from where it was found until now) and its photos (in
 * Vercel Blob until now). Run from `?op=store-pictures` in api/likes.ts until
 * `remaining` is 0. Once every photo has moved, the Blob store and this
 * file's use of @vercel/blob can go.
 */

import { get } from '@vercel/blob';

import { requireSql } from './db.js';
import {
  deletePictures,
  downloadPicture,
  pictureType,
  uploadPicture,
} from './pictures.js';

// Pictures from the web under this are icons and spacers (as in enrichment);
// the biggest allowed is Supabase's limit for resizing a picture
const MIN_PICTURE_BYTES = 3_000;
const MAX_PICTURE_BYTES = 20_000_000;

// Stop starting likes at this point, so the function (300s) can finish
const BUDGET_MS = 240_000;
const AT_ONCE = 6;

export interface StoreResult {
  /** Pictures and photos now in Storage */
  stored: number;
  /** Pictures whose source answered 404 or 410, so image_url was cleared */
  dead: number;
  /** Too small to be a picture: left as they are, not counted in remaining */
  skipped: number;
  /** Tried and left for the next run */
  failed: number;
  /** Likes still to do, the failed ones included */
  remaining: number;
  /** Bytes uploaded */
  bytes: number;
}

/** A photo in Blob storage, read one last time */
async function readBlob(url: string): Promise<Buffer | undefined> {
  const blob = await get(url, { access: 'private' });
  return blob?.statusCode === 200
    ? Buffer.from(await new Response(blob.stream).arrayBuffer())
    : undefined;
}

/**
 * Stores the pictures and photos of likes that don't have theirs in Storage,
 * until none are left or the time budget is used
 */
export async function storePictures(
  budgetMs = BUDGET_MS,
): Promise<StoreResult> {
  const sql = requireSql();
  const likes = await sql`
    SELECT id, image_url, image_path, photos FROM likes
    WHERE (image_url IS NOT NULL AND image_path IS NULL)
      OR EXISTS (SELECT 1 FROM unnest(photos) photo WHERE photo LIKE 'http%')
    ORDER BY created_at DESC`;
  const result: StoreResult = {
    stored: 0,
    dead: 0,
    skipped: 0,
    failed: 0,
    remaining: likes.length,
    bytes: 0,
  };
  const stopAt = Date.now() + budgetMs;

  async function storeLike(like: (typeof likes)[number]) {
    let done = true;
    const id = String(like.id);

    const photos = [...(like.photos as string[])];
    for (const [n, photo] of photos.entries()) {
      if (!photo.startsWith('http')) continue;
      try {
        const data = await readBlob(photo);
        const type = data && pictureType(data);
        if (!data || !type) throw new Error('not an image');
        photos[n] = await uploadPicture(id, data, type);
        result.stored += 1;
        result.bytes += data.length;
        await sql`UPDATE likes SET photos = ${photos}::text[] WHERE id = ${id}`;
      } catch (error) {
        console.error(`Could not move a photo of like ${id}:`, error);
        result.failed += 1;
        done = false;
      }
    }

    const imageUrl = like.image_url as string | null;
    if (imageUrl && !like.image_path) {
      const { picture, dead } = await downloadPicture(
        imageUrl,
        MAX_PICTURE_BYTES,
      );
      if (dead) {
        await sql`UPDATE likes SET image_url = NULL
          WHERE id = ${id} AND image_url = ${imageUrl}`;
        result.dead += 1;
      } else if (picture && picture.data.length < MIN_PICTURE_BYTES) {
        result.skipped += 1;
      } else if (!picture) {
        result.failed += 1;
        done = false;
      } else {
        try {
          const path = await uploadPicture(id, picture.data, picture.type);
          // A like organized again meanwhile has another picture coming
          const saved = await sql`
            UPDATE likes SET image_path = ${path}
            WHERE id = ${id} AND image_url = ${imageUrl}
              AND image_path IS NULL
            RETURNING id`;
          if (saved.length === 0) await deletePictures([path]);
          else {
            result.stored += 1;
            result.bytes += picture.data.length;
          }
        } catch (error) {
          console.error(`Could not store the picture of like ${id}:`, error);
          result.failed += 1;
          done = false;
        }
      }
    }
    if (done) result.remaining -= 1;
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (next < likes.length && Date.now() < stopAt) {
        await storeLike(likes[next++]);
      }
    }),
  );
  return result;
}
