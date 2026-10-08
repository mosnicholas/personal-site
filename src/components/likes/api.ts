import type { Like } from '../../../shared/likes';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls /api/likes, throwing the API's error message when it fails */
export async function api<T = unknown>(
  query = '',
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/likes${query}`, init);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? 'Something went wrong');
  }
  return body as T;
}

/** A JSON request body for `api` */
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';

/** The like's first photo, or its page's preview image */
export const likeImage = (like: Like) => like.photoUrls[0] ?? like.imageUrl;

export const savedDate = (like: Like) =>
  new Date(like.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * Photos go up as JPEGs at most 2048px on the long side: small enough for
 * Vercel's 4.5 MB request limit, and plenty for Haiku to read
 */
export async function resizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Couldn’t read that photo')),
      'image/jpeg',
      0.85,
    ),
  );
}

/**
 * Adds photos to a like after its others, one request each: several at once
 * could go over Vercel's 4.5 MB limit
 */
export async function addPhotos(id: string, files: File[]) {
  for (const file of files) {
    const body = new FormData();
    body.set('photo', await resizePhoto(file), 'photo.jpg');
    await api(`?op=photo&id=${id}`, { method: 'POST', body });
  }
}
