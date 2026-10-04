import { createHash } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

import type { LikeInput, LikedItem } from '../../shared/likes.js';
import { rejectUnauthorizedLikes } from './likes-auth.js';
import { kickLikes } from './likes-jobs.js';
import { likesOrigin, likesRequestOrigin } from './likes-origin.js';
import {
  getImport,
  getLike,
  LikesError,
  listLikes,
  likeInputSchema,
  saveLike,
  savePhotoLike,
  startImport,
} from './likes-store.js';

const MAX_BATCH = 100;
const MAX_BASE64_BYTES = 2_800_000;
function feedback(item: LikedItem) {
  const message =
    item.status === 'failed'
      ? 'Saved, but enhancement failed. Your original is retained; retry from the item page.'
      : item.status === 'pending' || item.status === 'processing'
        ? item.error
          ? 'Saved. Enhancement could not finish yet; an automatic retry is queued.'
          : 'Saved. Enhancement is still in progress.'
        : item.kind === 'photo' && item.identification === 'unknown'
          ? 'Organized, but the photo could not be identified.'
          : 'Enhanced. Review the generated details; photo identification is a suggestion.';
  return {
    status: item.status,
    message,
    review_url: `${likesOrigin()}/likes?item=${encodeURIComponent(item.id)}`,
  };
}
function result(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(value && typeof value === 'object' && !Array.isArray(value)
      ? { structuredContent: value as Record<string, unknown> }
      : {}),
  };
}
function error(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
function safeError(caught: unknown, fallback: string): string {
  return caught instanceof LikesError ? caught.message : fallback;
}
function attachmentFromBase64(value: string): Uint8Array | undefined {
  const raw = value.startsWith('data:')
    ? value.slice(value.indexOf(',') + 1)
    : value;
  if (
    !raw ||
    raw.length > Math.ceil((MAX_BASE64_BYTES * 4) / 3) + 8 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)
  )
    return undefined;
  const bytes = Buffer.from(raw, 'base64');
  return bytes.length > 0 && bytes.length <= MAX_BASE64_BYTES
    ? bytes
    : undefined;
}
function batchKey(key: string, index: number): string {
  return `mcp-batch:${createHash('sha256').update(key).digest('hex')}:${index}`;
}
async function saveOne(
  input: LikeInput,
  idempotencyKey?: string,
  photo?: { base64: string; filename?: string; contentType?: string },
) {
  if (!photo)
    return saveLike(
      { ...input, source: input.source ?? 'mcp' },
      idempotencyKey,
    );
  const data = attachmentFromBase64(photo.base64);
  if (!data)
    throw new LikesError(
      'photo_base64 must be valid base64 no larger than 2.8 MB',
    );
  return savePhotoLike(
    input,
    {
      data,
      filename: photo.filename?.slice(0, 255) || 'photo',
      contentType:
        photo.contentType?.slice(0, 120) || 'application/octet-stream',
    },
    idempotencyKey,
  );
}

export function createLikesMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'nimo-likes', version: '1.0.0' },
    {
      instructions:
        'Use save_like for one capture, save_likes for structured batches or pasted notes, search_likes to find captures, and get_like to retrieve an item or import status. Saves and imports continue automatically. Immediately confirm that the original was saved, then use get_like to check enhancement before claiming it finished. If it is still pending, say it is organizing and share review_url; do not poll indefinitely. When ready, show the title/category/tags and note that photo identification is a suggestion. If enhancement fails, explain that the original is retained and share the review link for correction or retry. There is no automatic push notification back into this chat.',
    },
  );
  server.registerTool(
    'save_like',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Save one private link, note, or photo. Base64 photos are capped at 2.8 MB.',
      inputSchema: {
        input: likeInputSchema,
        idempotency_key: z.string().max(200).optional(),
        photo_base64: z.string().optional(),
        photo_filename: z.string().max(255).optional(),
        photo_content_type: z.string().max(120).optional(),
      },
    },
    async ({
      input,
      idempotency_key,
      photo_base64,
      photo_filename,
      photo_content_type,
    }) => {
      try {
        const saved = await saveOne(
          input,
          idempotency_key,
          photo_base64
            ? {
                base64: photo_base64,
                filename: photo_filename,
                contentType: photo_content_type,
              }
            : undefined,
        );
        if (!saved.duplicate) kickLikes();
        return result({ ...saved, ...feedback(saved.item) });
      } catch (caught) {
        return error(safeError(caught, 'Could not save like'));
      }
    },
  );
  server.registerTool(
    'save_likes',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Save up to 100 structured Likes, or queue pasted raw notes for durable backfill.',
      inputSchema: {
        inputs: z.union([
          z.array(likeInputSchema).min(1).max(MAX_BATCH),
          z.string().min(1).max(100_000),
        ]),
        idempotency_key: z.string().max(200).optional(),
      },
    },
    async ({ inputs, idempotency_key }) => {
      try {
        if (typeof inputs === 'string') {
          const batch = await startImport(inputs, idempotency_key);
          kickLikes();
          return result({
            kind: 'import',
            import: batch,
            status: batch.status,
          });
        }
        const saved: unknown[] = [];
        for (let index = 0; index < inputs.length; index += 1) {
          try {
            const capture = await saveLike(
              { ...inputs[index]!, source: inputs[index]?.source ?? 'mcp' },
              idempotency_key ? batchKey(idempotency_key, index) : undefined,
            );
            saved.push({ ...capture, ...feedback(capture.item) });
          } catch (caught) {
            kickLikes();
            return result({
              items: saved,
              failedAt: index,
              error: safeError(caught, 'Could not save like'),
            });
          }
        }
        kickLikes();
        return result({ items: saved });
      } catch (caught) {
        return error(safeError(caught, 'Could not save Likes'));
      }
    },
  );
  server.registerTool(
    'search_likes',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      description: 'Search the private Likes library.',
      inputSchema: {
        q: z.string().max(500).optional(),
        category: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(10_000).optional(),
      },
    },
    async (query) => {
      try {
        return result(await listLikes(query));
      } catch (caught) {
        return error(safeError(caught, 'Could not search Likes'));
      }
    },
  );
  server.registerTool(
    'get_like',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      description:
        'Get one private Like by ID, or the truthful status of a raw-notes import batch ID.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        const item = await getLike(id);
        if (item) return result({ kind: 'like', item, ...feedback(item) });
        const batch = await getImport(id);
        if (batch)
          return result({
            kind: 'import',
            import: batch,
            status: batch.status,
          });
        return error('Like or import not found');
      } catch (caught) {
        return error(safeError(caught, 'Could not get Like'));
      }
    },
  );
  return server;
}
export async function handleLikesMcpRequest(
  request: Request,
): Promise<Response> {
  const unauthorized = await rejectUnauthorizedLikes(request);
  if (unauthorized) {
    const response = new Response(unauthorized.body, {
      status: unauthorized.status,
      statusText: unauthorized.statusText,
      headers: new Headers(unauthorized.headers),
    });
    response.headers.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${originMetadataUrl(request)}"`,
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const server = createLikesMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 4 * 1024 * 1024,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (caught) {
    console.error('Likes MCP request failed', caught);
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    await transport.close();
    await server.close();
  }
}
function originMetadataUrl(request: Request): string {
  return `${likesRequestOrigin(request)}/.well-known/oauth-protected-resource`;
}
