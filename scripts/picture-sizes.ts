/**
 * Stores each likes picture and photo in Storage at the sizes in
 * PICTURE_SIZES (shared/likes.ts) when it isn't yet: new ones get theirs on
 * upload, so this is for pictures stored before, or a size added later.
 * Sizes already there are left as they are. Run with
 * `npm run pictures:sizes`; it reads .env.local.
 */

import postgres from 'postgres';

import { publicPictureUrl, storePictureSizes } from '../api/_lib/pictures.js';

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error('SUPABASE_DATABASE_URL is not set in .env.local');

const sql = postgres(url, { max: 1, prepare: false });
const AT_ONCE = 6;

try {
  const rows = await sql`SELECT photos, image_path FROM likes`;
  const paths = rows.flatMap((row) =>
    [...(row.photos as string[]), row.image_path as string | null].filter(
      (path): path is string => Boolean(path) && !path?.startsWith('http'),
    ),
  );
  console.log(`${paths.length} stored pictures`);

  let next = 0;
  let written = 0;
  const failed: string[] = [];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (next < paths.length) {
        const path = paths[next++];
        try {
          const response = await fetch(publicPictureUrl(path));
          if (!response.ok) throw new Error(`original: ${response.status}`);
          const data = new Uint8Array(await response.arrayBuffer());
          const stored = await storePictureSizes(path, data);
          written += stored;
        } catch (error) {
          failed.push(`${path}: ${(error as Error).message}`);
        }
      }
    }),
  );
  console.log(`${written} sizes stored, ${failed.length} pictures failed`);
  for (const line of failed) console.log(`  ${line}`);
  if (failed.length > 0) process.exitCode = 1;
} finally {
  await sql.end();
}
