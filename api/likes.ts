import type { LikePatch } from '../shared/likes.js';
import { rejectUnauthorizedCron } from './_lib/auth.js';
import { isOwner, login, logout, ownerKeyIsSet } from './_lib/owner-auth.js';
import { sendLikesDigest } from './_lib/likes-digest.js';
import {
  importNotes,
  processLikes,
  processLikesLater,
} from './_lib/likes-enrich.js';
import {
  deleteLike,
  LikeInputError,
  listLikes,
  readPhoto,
  redoLike,
  replacePhoto,
  saveLike,
  updateLike,
} from './_lib/likes.js';
import { loggedCron } from './_lib/traces.js';

/**
 * The likes collection (/likes); Claude and ChatGPT reach it through the MCP
 * server instead (api/mcp.ts). Everything except signing in and the crons is
 * for the owner only (_lib/owner-auth.ts).
 *
 * - GET: every like, newest first; `?op=photo&id=` a like's photo
 * - POST: save a like, JSON `{ url, text, note }`, or a form that adds a `photo`
 * - POST `?op=import` `{ text }`: split pasted notes into likes
 * - PATCH `?id=` (a LikePatch), DELETE `?id=`
 * - POST `?op=redo&id=`: organize a like again, from my note and photo
 * - POST `?op=photo&id=` (a form with `photo`): add or replace its photo
 * - POST `?op=login` `{ key }`, POST `?op=logout`
 * - Crons: `?op=process` (daily) enriches likes left waiting; `?op=digest`
 *   (monthly) emails a few old ones
 */

async function handle(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const op = params.get('op') ?? '';
  const id = params.get('id') ?? '';
  const { method } = request;

  if (op === 'process' || op === 'digest') {
    return loggedCron(`likes-${op}`, {
      fetch: async () =>
        rejectUnauthorizedCron(request) ??
        Response.json(
          op === 'process'
            ? { processed: await processLikes() }
            : await sendLikesDigest(),
        ),
    }).fetch(request);
  }

  if (!ownerKeyIsSet()) {
    return Response.json(
      { error: 'PERSONAL_SITE_OWNER_KEY is not set' },
      { status: 503 },
    );
  }
  if (op === 'login') {
    return login(((await request.json()) as { key?: unknown }).key);
  }
  if (op === 'logout') return logout();
  if (!isOwner(request)) {
    return Response.json({ error: 'Sign in first' }, { status: 401 });
  }

  switch (op) {
    case 'photo': {
      if (method === 'POST') {
        const photo = (await request.formData()).get('photo');
        if (!(photo instanceof File)) {
          throw new LikeInputError('Choose a photo');
        }
        const like = await replacePhoto(
          id,
          new Uint8Array(await photo.arrayBuffer()),
        );
        return like
          ? Response.json({ like })
          : Response.json({ error: 'Not found' }, { status: 404 });
      }
      // The URL changes with the photo (`v`), so browsers can keep it
      const photo = await readPhoto(id);
      return photo
        ? new Response(photo.stream, {
            headers: {
              'Content-Type': photo.type,
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          })
        : Response.json({ error: 'No photo' }, { status: 404 });
    }
    case 'import': {
      const { text } = (await request.json()) as { text?: unknown };
      const likes = await importNotes(typeof text === 'string' ? text : '');
      processLikesLater();
      return Response.json({ likes });
    }
    case 'redo': {
      const like = await redoLike(id);
      processLikesLater();
      return like
        ? Response.json({ like })
        : Response.json({ error: 'Not found' }, { status: 404 });
    }
  }

  if (method === 'GET') {
    return Response.json(
      { likes: await listLikes() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (method === 'POST') {
    const form = request.headers
      .get('content-type')
      ?.startsWith('multipart/form-data')
      ? await request.formData()
      : undefined;
    const fields = (
      form
        ? Object.fromEntries(
            [...form].filter(([, value]) => typeof value === 'string'),
          )
        : await request.json()
    ) as Record<string, string | undefined>;
    const photo = form?.get('photo');
    const like = await saveLike({
      url: fields.url,
      text: fields.text,
      note: fields.note,
      photo:
        photo instanceof File
          ? new Uint8Array(await photo.arrayBuffer())
          : undefined,
      source: 'web',
    });
    processLikesLater();
    return Response.json({ like }, { status: 201 });
  }
  if (method === 'PATCH') {
    const like = await updateLike(id, (await request.json()) as LikePatch);
    return like
      ? Response.json({ like })
      : Response.json({ error: 'Not found' }, { status: 404 });
  }
  if (method === 'DELETE') {
    return (await deleteLike(id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (error) {
      if (error instanceof LikeInputError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      console.error('Likes request failed:', error);
      return Response.json({ error: 'Something went wrong' }, { status: 500 });
    }
  },
};
