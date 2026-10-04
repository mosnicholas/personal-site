import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

import type { LikeInput } from '../../shared/likes.js';
import { rejectUnauthorizedLikes } from './likes-auth.js';
import { kickLikes, processLikes, retryImport } from './likes-jobs.js';
import {
  getImport,
  getLike,
  getSettings,
  LikesError,
  listLikes,
  retryLike,
  saveLike,
  savePhotoLike,
  startImport,
  updateLike,
} from './likes-store.js';

const MAX_BATCH = 100;
const MAX_BASE64_BYTES = 2_800_000;

const likeInputSchema = z.object({
  kind: z.enum(['link', 'note', 'photo']).optional(),
  url: z.string().max(4096).optional(),
  text: z.string().max(30_000).optional(),
  title: z.string().max(500).optional(),
  note: z.string().max(10_000).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  source: z.string().max(80).optional(),
});

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
      'photo_base64 must be valid base64 no larger than 2.8 MB; use upload for larger photos',
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
        'Use import_notes for pasted unstructured notes, preserving the original text. Use stable idempotency keys when retrying saves or batches. Captures queue enrichment; call process_pending_likes and get_import to continue/check progress. Report failed or partial archives accurately. Photos require actual bytes or an uploaded attachment ID.',
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
        return result(saved);
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
      description: 'Save up to 100 private Likes as a structured batch.',
      inputSchema: {
        inputs: z.array(likeInputSchema).min(1).max(MAX_BATCH),
        idempotency_key: z.string().max(200).optional(),
      },
    },
    async ({ inputs, idempotency_key }) => {
      const saved = [];
      for (let index = 0; index < inputs.length; index += 1) {
        try {
          saved.push(
            await saveLike(
              { ...inputs[index]!, source: inputs[index]?.source ?? 'mcp' },
              idempotency_key ? `${idempotency_key}:${index}` : undefined,
            ),
          );
        } catch (caught) {
          return error(
            `Batch stopped at item ${index + 1}: ${safeError(caught, 'could not save like')}`,
          );
        }
      }
      kickLikes();
      return result({ items: saved });
    },
  );

  server.registerTool(
    'import_notes',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Queue raw long-form notes for private backfill. The text is preserved as the import source.',
      inputSchema: {
        text: z.string().min(1).max(100_000),
        idempotency_key: z.string().max(200).optional(),
      },
    },
    async ({ text, idempotency_key }) => {
      try {
        const batch = await startImport(text, idempotency_key);
        kickLikes();
        return result(batch);
      } catch (caught) {
        return error(safeError(caught, 'Could not start import'));
      }
    },
  );

  server.registerTool(
    'get_import',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      description: 'Get the current status of a raw note import.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        const batch = await getImport(id);
        return batch ? result(batch) : error('Import not found');
      } catch (caught) {
        return error(safeError(caught, 'Could not get import'));
      }
    },
  );

  server.registerTool(
    'retry_import',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description: 'Retry a failed or pending raw note import.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        await retryImport(id);
        kickLikes();
        return result({ id, queued: true });
      } catch (caught) {
        return error(safeError(caught, 'Could not retry import'));
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
      description: 'Get one private Like by stable ID.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        const item = await getLike(id);
        return item ? result(item) : error('Like not found');
      } catch (caught) {
        return error(safeError(caught, 'Could not get Like'));
      }
    },
  );

  server.registerTool(
    'update_like',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      description: 'Edit safe owner fields on one private Like.',
      inputSchema: {
        id: z.string().uuid(),
        patch: z.object({
          title: z.string().max(500).optional(),
          note: z.string().max(10_000).optional(),
          category: z.string().max(80).optional(),
          tags: z.array(z.string().max(80)).max(20).optional(),
          snoozedUntil: z.string().datetime().nullable().optional(),
          dismissed: z.boolean().optional(),
        }),
      },
    },
    async ({ id, patch }) => {
      try {
        const item = await updateLike(id, patch);
        return item ? result(item) : error('Like not found');
      } catch (caught) {
        return error(safeError(caught, 'Could not update Like'));
      }
    },
  );

  server.registerTool(
    'retry_like',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description: 'Retry processing one private Like.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        const item = await retryLike(id);
        kickLikes();
        return item ? result(item) : error('Like not found');
      } catch (caught) {
        return error(safeError(caught, 'Could not retry Like'));
      }
    },
  );

  server.registerTool(
    'process_pending_likes',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description: 'Process a bounded number of pending Likes now.',
      inputSchema: { limit: z.number().int().min(1).max(25).optional() },
    },
    async ({ limit }) => {
      try {
        return result(await processLikes({ limit }));
      } catch (caught) {
        return error(safeError(caught, 'Could not process pending Likes'));
      }
    },
  );

  server.registerTool(
    'get_profile',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      description: 'Get the private Likes owner profile and preferences.',
      inputSchema: {},
    },
    async () => {
      try {
        const settings = await getSettings();
        return result({
          owner: 'Nicholas Moschopoulos',
          private: true,
          settings,
          capabilities: ['capture', 'imports', 'private attachments'],
        });
      } catch (caught) {
        return error(safeError(caught, 'Could not get profile'));
      }
    },
  );
  return server;
}

/** Handles one fully stateless Streamable HTTP MCP request. */
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
      `Bearer resource_metadata="${originMetadataUrl()}"`,
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

function originMetadataUrl(): string {
  const origin = process.env.LIKES_ORIGIN ?? 'https://nimo.fyi';
  return `${new URL(origin).origin}/.well-known/oauth-protected-resource`;
}
