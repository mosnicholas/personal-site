/**
 * The likes MCP server, at /api/likes/mcp: lets Claude save links and notes,
 * import pasted notes, and search the collection. Three tools need very
 * little of the protocol, so this is a minimal stateless Streamable HTTP
 * server (JSON-RPC over POST, JSON responses, no sessions or streams) rather
 * than the SDK and its ~100 dependencies.
 */

import type { Like } from '../../shared/likes.js';
import { importNotes, processLikesLater } from './likes-enrich.js';
import { LikeInputError, saveLike, searchLikes } from './likes.js';

const TOOLS = [
  {
    name: 'save_like',
    description:
      'Save something I like: a link, a note, or both. For a photo I share, save a note describing what it shows. Its title, description, category and tags are filled in within a minute.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The link, if there is one' },
        text: { type: 'string', description: 'What it is' },
        note: { type: 'string', description: 'Why I like it, if I said' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'import_likes',
    description:
      'Import pasted notes (old lists, bookmarks, a notes app export): they are split into separate likes and saved.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_likes',
    description:
      'Search my likes. Every word must appear somewhere in a like; no query lists the newest.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', description: 'Default 20' },
      },
      additionalProperties: false,
    },
  },
];

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** What Claude sees of a like */
const brief = (like: Like, site: string) => ({
  id: like.id,
  title: like.title,
  url: like.url,
  text: like.text,
  note: like.note,
  description: like.description,
  category: like.category,
  tags: like.tags,
  status: like.status,
  saved: like.createdAt.slice(0, 10),
  link: `${site}/likes?item=${like.id}`,
});

async function callTool(
  name: unknown,
  args: Record<string, unknown>,
  site: string,
): Promise<unknown> {
  switch (name) {
    case 'save_like': {
      const like = await saveLike({
        url: str(args.url),
        text: str(args.text),
        note: str(args.note),
        source: 'mcp',
      });
      processLikesLater();
      return brief(like, site);
    }
    case 'import_likes': {
      const likes = await importNotes(str(args.text) ?? '');
      processLikesLater();
      return {
        saved: likes.length,
        likes: likes.map((like) => brief(like, site)),
      };
    }
    case 'search_likes': {
      const limit = Number(args.limit) || 20;
      const likes = await searchLikes(str(args.query) ?? '', limit);
      return likes.map((like) => brief(like, site));
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${String(name)}`);
  }
}

async function answer(
  method: unknown,
  params: Record<string, unknown>,
  site: string,
) {
  switch (method) {
    case 'initialize':
      return {
        // Tools work the same in every version, so take the client's
        protocolVersion: params.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'nimo-likes', version: '1.0.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      try {
        const result = await callTool(
          params.name,
          (params.arguments ?? {}) as Record<string, unknown>,
          site,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        if (error instanceof RpcError) throw error;
        if (!(error instanceof LikeInputError)) {
          console.error('Likes MCP tool failed:', error);
        }
        return {
          content: [
            {
              type: 'text',
              text:
                error instanceof LikeInputError
                  ? error.message
                  : 'Something went wrong saving or searching likes',
            },
          ],
          isError: true,
        };
      }
    default:
      throw new RpcError(-32601, `Unknown method: ${String(method)}`);
  }
}

export async function handleMcp(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }
  const message = (await request.json().catch(() => undefined)) as
    | {
        id?: string | number;
        method?: unknown;
        params?: Record<string, unknown>;
      }
    | undefined;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      },
      { status: 400 },
    );
  }
  // Notifications (no id) need no answer
  if (message.id === undefined) return new Response(null, { status: 202 });

  try {
    const result = await answer(
      message.method,
      message.params ?? {},
      new URL(request.url).origin,
    );
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    const code = error instanceof RpcError ? error.code : -32603;
    if (!(error instanceof RpcError)) console.error('Likes MCP failed:', error);
    return Response.json({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code,
        message: error instanceof RpcError ? error.message : 'Internal error',
      },
    });
  }
}
