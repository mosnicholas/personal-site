/** Local-only API server for verification without touching production systems. */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import likes from '../api/likes.js';

if (process.env.VERCEL || process.env.NODE_ENV === 'production')
  throw new Error('This server is local development only');
const port = Number(process.env.LIKES_DEV_PORT ?? 3001);
process.env.PERSONAL_SITE_ORIGIN ||=
  process.env.LIKES_ORIGIN || `http://localhost:${port}`;
process.env.LIKES_LOCAL_DATABASE ??= '/tmp/nimo-likes-dev-db';
process.env.LIKES_LOCAL_STORAGE ??= '/tmp/nimo-likes-dev-files';
process.env.PERSONAL_SITE_OWNER_KEY ||=
  process.env.LIKES_API_KEY || 'local-development-key-32-characters-only';
if (process.env.LIKES_DEV_MOCK_AI === '1') {
  process.env.ANTHROPIC_API_KEY = 'local-mocked-ai';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (!url.includes('api.anthropic.com')) return realFetch(input, init);
    const payload = JSON.parse(String(init?.body));
    if (payload.tools?.length)
      return Response.json({
        id: 'mock-search',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        content: [
          {
            type: 'server_tool_use',
            id: 'mock-search-tool',
            name: 'web_search',
            input: { query: 'CEDAR perfume' },
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'mock-search-tool',
            content: [],
          },
          { type: 'text', text: 'No clear web match found.', citations: [] },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 10,
          server_tool_use: { web_search_requests: 1 },
        },
      });
    const importing = String(payload.system).includes('Split');
    const source = importing ? String(payload.messages[0].content) : '';
    const value = importing
      ? {
          complete: true,
          items: source
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((excerpt) => ({
              excerpt,
              title: excerpt.split('\n')[0].slice(0, 100),
              category: 'fragrance',
              tags: ['test'],
            })),
        }
      : {
          category: 'fragrance',
          tags: ['woody'],
          title: 'Cedar perfume',
          description: 'A saved item',
          extractedText: 'CEDAR',
          identification: 'suggested',
          lookupStatus: 'no-match',
          sourceIndexes: [],
        };
    return Response.json({
      id: 'mock-message',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(value) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  };
}
const server = createServer(async (request, response) => {
  try {
    const origin = process.env.PERSONAL_SITE_ORIGIN!;
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/.well-known/oauth-protected-resource')
      url.searchParams.set('op', 'oauth-resource');
    if (url.pathname === '/.well-known/oauth-authorization-server')
      url.searchParams.set('op', 'oauth-server');
    if (/\/oauth\/(authorize|token|register)$/.test(url.pathname))
      url.searchParams.set('op', `oauth-${url.pathname.split('/').at(-1)}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (value)
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const body = ['GET', 'HEAD'].includes(request.method ?? 'GET')
      ? undefined
      : (Readable.toWeb(request) as ReadableStream);
    const input = new Request(url, {
      method: request.method,
      headers,
      body,
      ...(body ? { duplex: 'half' } : {}),
    });
    const output = await likes.fetch(input);
    response.writeHead(output.status, Object.fromEntries(output.headers));
    if (output.body)
      for await (const chunk of Readable.fromWeb(
        output.body as import('node:stream/web').ReadableStream,
      ))
        response.write(chunk);
    response.end();
  } catch {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Local server error' }));
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Likes verification API listening on http://127.0.0.1:${port}`),
);
