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

/** The like's photo, or its page's preview image */
export const likeImage = (like: Like) =>
  like.hasPhoto ? `/api/likes?op=photo&id=${like.id}` : like.imageUrl;

export const savedDate = (like: Like) =>
  new Date(like.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
