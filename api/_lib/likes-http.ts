import { rejectUnauthorizedCron } from './auth.js';
import {
  cookieHeader,
  loginLikes,
  logoutLikes,
  rejectUnauthorizedLikes,
} from './likes-auth.js';
import { sendLikesDigest } from './likes-digest.js';
import { exportLikes } from './likes-export.js';
import { kickLikes, processLikes, retryImport } from './likes-jobs.js';
import {
  getImport,
  getLike,
  getSettings,
  listLikes,
  LikesError,
  readAttachment,
  retryLike,
  saveAttachment,
  saveLike,
  startImport,
  updateLike,
  updateSettings,
} from './likes-store.js';
import type { LikeInput } from '../../shared/likes.js';
import {
  readBoundedBytes,
  readBoundedText,
  RequestSizeError,
} from './likes-request.js';

async function body(
  request: Request,
  maxBytes = 500000,
): Promise<Record<string, unknown>> {
  if (!request.body) throw new LikesError('Provide a request body');
  try {
    const parsed: unknown = JSON.parse(
      await readBoundedText(request, maxBytes),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestSizeError)
      throw new LikesError(error.message, 413);
    if (error instanceof LikesError) throw error;
    throw new LikesError('Provide a valid JSON object');
  }
}
async function uploadForm(request: Request): Promise<FormData> {
  const bytes = await readBoundedBytes(request, 4 * 1024 * 1024);
  return new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
    body: bytes,
  })
    .formData()
    .catch(() => {
      throw new LikesError('Provide a multipart upload');
    });
}
export async function handleLikesRequest(request: Request): Promise<Response> {
  const response = await dispatch(request).catch((error) => {
    if (error instanceof RequestSizeError)
      return Response.json({ error: error.message }, { status: 413 });
    if (error instanceof LikesError)
      return Response.json({ error: error.message }, { status: error.status });
    console.warn(
      'Private collection request failed:',
      error instanceof Error ? error.name : 'unknown',
    );
    return Response.json(
      {
        error:
          'The collection is unavailable. Your existing saves are unchanged.',
      },
      { status: 500 },
    );
  });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
async function dispatch(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const op = params.get('op') ?? '';
  const id = params.get('id') ?? '';
  const method = request.method;
  if (op === 'login' && method === 'POST')
    return loginLikes(request, (await body(request, 4000)).key);
  if (op === 'cron' || op === 'digest') {
    if (method !== 'GET') throw new LikesError('Method not allowed', 405);
    const rejected = rejectUnauthorizedCron(request);
    if (rejected) return rejected;
    return Response.json(
      op === 'cron'
        ? await processLikes({ limit: 20 })
        : await sendLikesDigest({ dryRun: params.get('dry_run') === 'true' }),
    );
  }
  const rejected = rejectUnauthorizedLikes(request);
  if (rejected) return rejected;
  if (op === 'logout' && method === 'POST') return logoutLikes();
  if (op === 'session' && method === 'GET')
    return Response.json({ authenticated: true });
  if (op === 'asset' && method === 'GET') {
    const { attachment, data } = await readAttachment(id);
    return new Response(Buffer.from(data), {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Disposition': `${attachment.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${attachment.filename}"`,
        'Content-Security-Policy':
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  }
  if (op === 'screenshot' && method === 'POST') {
    const form = await uploadForm(request);
    const file = form.get('file');
    if (
      !(file instanceof File) ||
      file.type !== 'image/png' ||
      file.size > 4 * 1024 * 1024
    )
      throw new LikesError('Provide a PNG screenshot under 4 MB');
    const item = await getLike(id);
    if (!item) throw new LikesError('Item not found', 404);
    const data = new Uint8Array(await file.arrayBuffer());
    const { validateUpload } = await import('./likes-store.js');
    await validateUpload(file.type, data);
    return Response.json(
      {
        attachment: await saveAttachment({
          itemId: id,
          role: 'screenshot',
          filename: 'screenshot.png',
          contentType: 'image/png',
          data,
        }),
      },
      { status: 201 },
    );
  }
  if (op === 'upload' && method === 'POST') {
    const form = await uploadForm(request);
    const content = form.get('file');
    if (!(content instanceof File))
      throw new LikesError('Choose a file to upload');
    const attachment = await saveAttachment({
      role: 'original',
      filename: content.name,
      contentType: content.type || 'application/octet-stream',
      data: new Uint8Array(await content.arrayBuffer()),
    });
    return Response.json({ attachment }, { status: 201 });
  }
  if (op === 'import') {
    if (method === 'GET') {
      const batch = await getImport(id);
      if (!batch) throw new LikesError('Import not found', 404);
      return Response.json(batch);
    }
    if (method === 'POST') {
      const p = await body(request);
      const batch = await startImport(
        p.text as string,
        p.idempotencyKey as string | undefined,
      );
      kickLikes();
      return Response.json(batch, { status: 202 });
    }
  }
  if (op === 'retry-import' && method === 'POST') {
    await retryImport(id);
    kickLikes();
    return Response.json(await getImport(id));
  }
  if (op === 'process' && method === 'POST')
    return Response.json(await processLikes({ limit: 5, budgetMs: 200000 }));
  if (op === 'retry' && method === 'POST') {
    const item = await retryLike(id);
    kickLikes();
    return Response.json({ item });
  }
  if (op === 'export' && method === 'GET')
    return exportLikes({
      q: params.get('q') ?? '',
      category: params.get('category') ?? '',
    });
  if (op === 'settings') {
    if (method === 'GET')
      return Response.json({ settings: await getSettings() });
    if (method === 'PATCH')
      return Response.json({
        settings: await updateSettings(await body(request)),
      });
  }
  if (!op) {
    if (method === 'GET') {
      if (id) {
        const item = await getLike(id);
        if (!item) throw new LikesError('Item not found', 404);
        return Response.json({ item });
      }
      const collection = await listLikes({
        q: params.get('q') ?? '',
        category: params.get('category') ?? '',
        limit: Number(params.get('limit') ?? 50),
        offset: Number(params.get('offset') ?? 0),
      });
      return Response.json({ ...collection, settings: await getSettings() });
    }
    if (method === 'POST') {
      const p = await body(request);
      const saved = await saveLike(
        p.input as LikeInput,
        p.idempotencyKey as string | undefined,
      );
      kickLikes();
      return Response.json(saved, { status: saved.duplicate ? 200 : 201 });
    }
    if (method === 'PATCH' && id)
      return Response.json({ item: await updateLike(id, await body(request)) });
  }
  // Invalid/missing credentials never return a successful empty collection.
  if (op === 'logout')
    return Response.json(
      { success: true },
      { headers: { 'Set-Cookie': cookieHeader('') } },
    );
  throw new LikesError('Method or operation not supported', 405);
}
