/**
 * Pictures for the likes collection, in a public Supabase Storage bucket
 * (`likes`): each one is stored at its original size and, resized here with
 * sharp, at the sizes /likes shows (PICTURE_SIZES in shared/likes.ts).
 * Supabase's image transformations did the resizing until they went over the
 * plan's 100 pictures a month. Paths are `{likeId}/{random}.{ext}`, the
 * sizes `{likeId}/{random}/{size}`, and never reused, since the CDN keeps a
 * path's file for a year. Plain fetch against the Storage REST API.
 */

import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import {
  PICTURE_SIZES,
  sizedPicture,
  type PictureSize,
} from '../../shared/likes.js';

const BUCKET = 'likes';

// Some sites turn away requests that don't look like a browser
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export type PictureType =
  'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface Picture {
  type: PictureType;
  data: Buffer;
}

const EXTENSIONS: Record<PictureType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * The image type a file is, from its first bytes: some servers send PNGs as
 * image/jpeg or JPEGs as image/jpg, and the Anthropic API rejects a request
 * whose stated type is wrong
 */
export function pictureType(data: Uint8Array): PictureType | undefined {
  const starts = (bytes: number[], at = 0) =>
    bytes.every((byte, i) => data[at + i] === byte);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return undefined;
}

function storage() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are not set');
  }
  return {
    base: base.replace(/\/$/, ''),
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  };
}

/** Where a stored picture's original is served from */
export function publicPictureUrl(path: string): string {
  return `${storage().base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Where a stored picture is kept at `size` (see sizedPicture) */
const sizePath = (path: string, size: PictureSize) =>
  `${path.replace(/\.\w+$/, '')}/${size}`;

/**
 * Stores a file in the bucket. False if the path is taken, when `existing`
 * is fine
 */
async function putFile(
  path: string,
  data: Uint8Array,
  type: string,
  existing = false,
): Promise<boolean> {
  const { base, headers } = storage();
  const response = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': type,
      'cache-control': 'max-age=31536000',
    },
    body: data,
  });
  if (response.ok) return true;
  const text = await response.text();
  if (existing && /already exists|Duplicate/i.test(text)) return false;
  throw new Error(`Could not store a picture (${response.status}): ${text}`);
}

/**
 * A picture at each of PICTURE_SIZES: at most that wide and twice as tall,
 * never enlarged, turned the way the camera held it (EXIF orientation).
 * JPEG, or PNG when it has see-through parts; not WebP, which Outlook on
 * Windows doesn't show in the monthly email. Animated GIFs keep their first
 * frame
 */
export async function resizePicture(
  data: Uint8Array,
): Promise<{ size: PictureSize; type: PictureType; data: Buffer }[]> {
  const image = sharp(data).rotate();
  const { isOpaque } = await image.clone().stats();
  return Promise.all(
    (Object.keys(PICTURE_SIZES) as PictureSize[]).map(async (size) => {
      const width = PICTURE_SIZES[size];
      const resized = image.clone().resize({
        width,
        height: width * 2,
        fit: 'inside',
        withoutEnlargement: true,
      });
      return isOpaque
        ? {
            size,
            type: 'image/jpeg' as const,
            data: await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
          }
        : {
            size,
            type: 'image/png' as const,
            data: await resized.png().toBuffer(),
          };
    }),
  );
}

/**
 * Stores a picture's sizes; those already there are left as they are.
 * Returns how many were written
 */
export async function storePictureSizes(
  path: string,
  data: Uint8Array,
): Promise<number> {
  const sizes = await resizePicture(data);
  const written = await Promise.all(
    sizes.map((sized) =>
      putFile(sizePath(path, sized.size), sized.data, sized.type, true),
    ),
  );
  return written.filter(Boolean).length;
}

/**
 * Stores a picture for a like, at its original size and each of
 * PICTURE_SIZES, and returns its path in the bucket. Sizes go first, so a
 * picture that can't be read isn't stored at all
 */
export async function uploadPicture(
  likeId: string,
  data: Uint8Array,
  type: PictureType,
): Promise<string> {
  const path = `${likeId}/${randomUUID()}.${EXTENSIONS[type]}`;
  await storePictureSizes(path, data);
  await putFile(path, data, type);
  return path;
}

/**
 * Removes stored pictures, with their sizes; a path that isn't there is
 * fine
 */
export async function deletePictures(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { base, headers } = storage();
  const response = await fetch(`${base}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefixes: paths.flatMap((path) => [
        path,
        ...(Object.keys(PICTURE_SIZES) as PictureSize[]).map((size) =>
          sizePath(path, size),
        ),
      ]),
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not delete pictures (${response.status})`);
  }
}

/**
 * A stored picture, from its public URL, at its large size for a model to
 * look at. Undefined if it isn't there
 */
export async function fetchStoredPicture(
  url: string,
): Promise<Picture | undefined> {
  try {
    const response = await fetch(sizedPicture(url, 'large'), {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return undefined;
    const data = Buffer.from(await response.arrayBuffer());
    const type = pictureType(data);
    return type ? { type, data } : undefined;
  } catch {
    return undefined;
  }
}

export interface Download {
  picture?: Picture;
  /** The server says it's gone (404 or 410) */
  dead?: boolean;
}

/**
 * An image from the web, if it loads, is a kind Claude reads, and is at most
 * `maxBytes`. The type comes from the file's first bytes
 */
export async function downloadPicture(
  url: string,
  maxBytes: number,
): Promise<Download> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { dead: response.status === 404 || response.status === 410 };
    }
    const data = Buffer.from(await response.arrayBuffer());
    const type = pictureType(data);
    return type && data.length <= maxBytes ? { picture: { type, data } } : {};
  } catch {
    return {};
  }
}
