/**
 * The site's MCP server, at /api/mcp, for Claude and ChatGPT: save likes,
 * and search and read both likes and the reading saved to Readwise Reader.
 * New sources plug in as more tools, or as more kinds of results from these.
 *
 * Tools need very little of the protocol, so this is a minimal stateless
 * Streamable HTTP server (JSON-RPC over POST, JSON responses, no sessions or
 * streams) rather than the SDK and its ~100 dependencies.
 */

import type { Like } from '../../shared/likes.js';
import { getSavedDocument, searchDocuments } from './documents.js';
import {
  CATEGORY_DESCRIPTION,
  processLikesLater,
  TAGS_DESCRIPTION,
} from './likes-enrich.js';
import {
  getLike,
  LikeInputError,
  photoBytes,
  redoLike,
  replacePhoto,
  saveLike,
  searchLikes,
  updateLike,
} from './likes.js';
import { logEvent } from './traces.js';

const INSTRUCTIONS = `This is nimo's (Nicholas Moschopoulos's) own data. Likes are things he saved because he likes them: products, places, links, ideas, often with a note on why. Reading is what he saved to Readwise Reader, each with a summary and usually the full text. Search to find things, then get one for all of it.`;

// About 25k tokens; the rest of a long document is left out
const MAX_TEXT_CHARS = 100_000;

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: object;
  _meta?: object;
  run: (args: Record<string, unknown>, site: string) => Promise<Content[]>;
}

/** A mistake in the call, told to the model so it can fix it */
class ToolError extends Error {}

/** A protocol error, answered as a JSON-RPC error */
class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

const asJson = (value: unknown): Content[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
];

/** What the model sees of a like */
const likeResult = (like: Like, site: string) => ({
  id: like.id,
  title: like.title,
  url: like.url,
  text: like.text,
  note: like.note,
  description: like.description,
  category: like.category,
  tags: like.tags,
  hasPhoto: Boolean(like.photoUrl),
  status: like.status,
  saved: like.createdAt.slice(0, 10),
  link: `${site}/likes?item=${like.id}`,
});

// ChatGPT passes photos attached in the chat to parameters listed in
// _meta["openai/fileParams"], as objects of this shape
const PHOTO_PARAMETER = {
  type: 'object',
  description:
    'A photo of it: in ChatGPT, the image attached in the chat. Elsewhere, a public image URL as download_url (file_id can be empty)',
  properties: {
    download_url: { type: 'string' },
    file_id: { type: 'string' },
    mime_type: { type: 'string' },
    file_name: { type: 'string' },
  },
  required: ['download_url', 'file_id'],
};

const photoUrl = (photo: unknown) => {
  const url = str(
    (photo as { download_url?: unknown } | undefined)?.download_url,
  );
  return url ? new URL(url) : undefined;
};

const TOOLS: Tool[] = [
  {
    name: 'save',
    description:
      'Save something nimo likes: a link, a note, a photo, or a mix. Give it a title, description, category and tags if you know what it is; whatever you leave out is filled in within a minute by a quick lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The link, if there is one' },
        text: { type: 'string', description: 'What it is' },
        note: { type: 'string', description: 'Why he likes it, if he said' },
        photo: PHOTO_PARAMETER,
        title: {
          type: 'string',
          description:
            'What it is, specific enough to recognize: brand and model for a product',
        },
        description: { type: 'string', description: 'A sentence or two' },
        category: {
          type: 'string',
          description: `${CATEGORY_DESCRIPTION}. Search likes to see the ones in use`,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: TAGS_DESCRIPTION,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    _meta: { 'openai/fileParams': ['photo'] },
    async run(args, site) {
      const like = await saveLike({
        url: str(args.url),
        text: str(args.text),
        note: str(args.note),
        photo: photoUrl(args.photo),
        title: str(args.title),
        description: str(args.description),
        category: str(args.category),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        source: 'mcp',
      });
      processLikesLater();
      return asJson(likeResult(like, site));
    },
  },
  {
    name: 'update',
    description:
      'Change a like: its note, title, description, category, tags or photo. Set reorganize to have its details written again from the note and photo, for instance after he says which version of something he means.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        note: { type: 'string', description: 'Replaces the note' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        photo: PHOTO_PARAMETER,
        reorganize: {
          type: 'boolean',
          description:
            'Write the title, description, category and tags again, keeping any set in this call',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    _meta: { 'openai/fileParams': ['photo'] },
    async run(args, site) {
      const id = str(args.id) ?? '';
      if (!(await getLike(id))) throw new ToolError(`No like has the id ${id}`);
      const photo = photoUrl(args.photo);
      if (photo) await replacePhoto(id, photo);
      // Cleared first, so what this call sets survives the rewrite
      if (args.reorganize === true) await redoLike(id);
      const like = await updateLike(id, {
        note: str(args.note),
        title: str(args.title),
        description: str(args.description),
        category: str(args.category),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      });
      if (args.reorganize === true) processLikesLater();
      return asJson(likeResult(like!, site));
    },
  },
  {
    name: 'search',
    description:
      'Search nimo’s likes and the reading he saved to Readwise Reader. Every word of the query must appear somewhere (title, notes, tags, summary); leave it out to list the newest.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        source: {
          type: 'string',
          enum: ['likes', 'reading'],
          description: 'Search only one; both by default',
        },
        since: {
          type: 'string',
          description: 'Only what was saved on or after this date, YYYY-MM-DD',
        },
        limit: {
          type: 'integer',
          description: 'Most results from each source, 20 by default',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, site) {
      const since = str(args.since);
      if (since && !/^\d{4}-\d{2}-\d{2}/.test(since)) {
        throw new ToolError('since should be a date like 2026-10-01');
      }
      const search = {
        query: str(args.query),
        since: since?.slice(0, 10),
        limit: Math.min(Math.max(Number(args.limit) || 20, 1), 100),
      };
      const [likes, reading] = await Promise.all([
        args.source === 'reading' ? undefined : searchLikes(search),
        args.source === 'likes' ? undefined : searchDocuments(search),
      ]);
      return asJson({
        likes: likes?.map((like) => likeResult(like, site)),
        reading,
      });
    },
  },
  {
    name: 'get',
    description:
      'Get one like or saved article by its id, in full: a like with its photo, or an article with its summary and text.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, site) {
      const id = str(args.id) ?? '';
      const like = await getLike(id);
      if (like) {
        const photo = like.photoUrl ? await photoBytes(like.id) : undefined;
        return [
          ...asJson({ source: 'likes', ...likeResult(like, site) }),
          ...(photo
            ? [
                {
                  type: 'image' as const,
                  data: photo.toString('base64'),
                  mimeType: 'image/jpeg',
                },
              ]
            : []),
        ];
      }
      const document = await getSavedDocument(id);
      if (document) {
        const { text, ...rest } = document;
        return asJson({
          source: 'reading',
          ...rest,
          text: text?.slice(0, MAX_TEXT_CHARS) ?? null,
          ...(text && text.length > MAX_TEXT_CHARS
            ? { textCut: `first ${MAX_TEXT_CHARS} of ${text.length} chars` }
            : {}),
        });
      }
      throw new ToolError(`Nothing saved has the id ${id}`);
    },
  },
];

/**
 * What a tool returned, in brief for the log: counts of results and the ids
 * and titles of single items, not their text
 */
function inBrief(content: Content[]) {
  return content.map((block) => {
    if (block.type === 'image') return { image: block.mimeType };
    try {
      const value = JSON.parse(block.text) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key, field]) =>
              Array.isArray(field) ||
              ['id', 'source', 'title', 'status'].includes(key),
          )
          .map(([key, field]) => [
            key,
            Array.isArray(field) ? field.length : field,
          ]),
      );
    } catch {
      return { text: block.text.slice(0, 300) };
    }
  });
}

async function callTool(
  name: unknown,
  args: Record<string, unknown>,
  site: string,
  client: string | null,
) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(name)}`);
  const started = Date.now();
  // Each call is logged: which app, what it asked, what came back
  const log = (result: unknown, error?: string) =>
    logEvent({
      kind: 'mcp_call',
      subjectId: tool.name,
      detail: { client, args, result, ms: Date.now() - started },
      error,
    });
  try {
    const content = await tool.run(args, site);
    await log(inBrief(content));
    return { content };
  } catch (error) {
    const told = error instanceof ToolError || error instanceof LikeInputError;
    if (!told) console.error(`MCP tool ${tool.name} failed:`, error);
    await log(
      undefined,
      error instanceof Error ? error.message : String(error),
    );
    return {
      content: [
        {
          type: 'text',
          text: told ? error.message : `Something went wrong in ${tool.name}`,
        },
      ],
      isError: true,
    };
  }
}

async function answer(
  method: unknown,
  params: Record<string, unknown>,
  site: string,
  client: string | null,
) {
  switch (method) {
    case 'initialize':
      return {
        // Tools work the same in every version, so take the client's
        protocolVersion: params.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'nimo', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: TOOLS.map(
          ({ name, description, inputSchema, annotations, _meta }) => ({
            name,
            description,
            inputSchema,
            annotations,
            _meta,
          }),
        ),
      };
    case 'tools/call':
      return callTool(
        params.name,
        (params.arguments ?? {}) as Record<string, unknown>,
        site,
        client,
      );
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
      // Which app is calling, e.g. Claude Code or ChatGPT
      request.headers.get('user-agent'),
    );
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    if (!(error instanceof RpcError)) console.error('MCP failed:', error);
    return Response.json({
      jsonrpc: '2.0',
      id: message.id,
      error:
        error instanceof RpcError
          ? { code: error.code, message: error.message }
          : { code: -32603, message: 'Internal error' },
    });
  }
}
