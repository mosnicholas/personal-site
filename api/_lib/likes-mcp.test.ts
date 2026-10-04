import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createLikesMcpServer, handleLikesMcpRequest } from './likes-mcp.js';

process.env.LIKES_API_KEY = 'test-owner-key-that-is-at-least-32-characters';
process.env.LIKES_ORIGIN = 'https://likes.test.example';
process.env.LIKES_LOCAL_DATABASE ??= join(
  tmpdir(),
  `likes-mcp-${randomUUID()}`,
);
process.env.LIKES_LOCAL_STORAGE ??= join(
  tmpdir(),
  `likes-mcp-assets-${randomUUID()}`,
);

test('MCP tools are private and are discoverable by an SDK client after authorization', async () => {
  const unauthorized = await handleLikesMcpRequest(
    new Request('https://likes.test.example/api/likes?op=mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(
    unauthorized.headers.get('www-authenticate'),
    'Bearer resource_metadata="https://likes.test.example/.well-known/oauth-protected-resource"',
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createLikesMcpServer();
  const client = new Client({
    name: 'likes-regression-test',
    version: '1.0.0',
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'get_like',
    'save_like',
    'save_likes',
    'search_likes',
  ]);
  for (const input of [
    { text: 'Invalid category', category: '   ' },
    { text: 'Invalid tags', tags: ['   '] },
    { text: 'Unexpected input', unexpected: true },
  ]) {
    const invalid = await client.callTool({
      name: 'save_like',
      arguments: { input },
    });
    assert.equal(invalid.isError, true);
  }
  const valid = await client.callTool({
    name: 'save_like',
    arguments: {
      input: {
        text: 'Trimmed capture',
        category: ' fragrance ',
        tags: [' woody '],
      },
    },
  });
  assert.ok(!valid.isError);
  assert.match(JSON.stringify(valid), /"category":"fragrance"/);
  assert.match(JSON.stringify(valid), /"tags":\["woody"\]/);
  const photo = {
    input: { note: 'a small black ceramic mug' },
    photo_base64: (
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#fff' },
      })
        .jpeg()
        .toBuffer()
    ).toString('base64'),
    photo_filename: 'mug.jpg',
    photo_content_type: 'image/jpeg',
    idempotency_key: 'photo-replay',
  };
  const firstPhoto = await client.callTool({
    name: 'save_like',
    arguments: photo,
  });
  assert.equal(firstPhoto.isError, undefined, JSON.stringify(firstPhoto));
  const firstContent = firstPhoto.content as { type: string; text?: string }[];
  const first = JSON.parse(
    firstContent[0]?.type === 'text' ? (firstContent[0].text ?? '') : '',
  ) as { duplicate: boolean; item: { id: string } };
  assert.equal(first.duplicate, false);
  const replayPhoto = await client.callTool({
    name: 'save_like',
    arguments: photo,
  });
  assert.equal(replayPhoto.isError, undefined);
  const replayContent = replayPhoto.content as {
    type: string;
    text?: string;
  }[];
  const replay = JSON.parse(
    replayContent[0]?.type === 'text' ? (replayContent[0].text ?? '') : '',
  ) as { duplicate: boolean; item: { id: string } };
  assert.equal(replay.duplicate, true);
  assert.equal(replay.item.id, first.item.id);
  await client.close();
  await server.close();
});
test('native HTTP transport initializes and calls tools with the official SDK client', async () => {
  const transport = new StreamableHTTPClientTransport(
    new URL('https://likes.test.example/api/likes?op=mcp'),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${process.env.LIKES_API_KEY}` },
      },
      fetch: async (url, init) => handleLikesMcpRequest(new Request(url, init)),
    },
  );
  const client = new Client({ name: 'http-client-test', version: '1.0.0' });
  await client.connect(transport);
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name).sort(),
    ['get_like', 'save_like', 'save_likes', 'search_likes'],
  );
  const saved = await client.callTool({
    name: 'save_like',
    arguments: {
      input: { text: 'A brass lantern', note: 'Warm light' },
      idempotency_key: 'http-lantern',
    },
  });
  assert.ok(!saved.isError);
  const structured = await client.callTool({
    name: 'save_likes',
    arguments: {
      inputs: [
        { text: 'A striped wool blanket', note: 'Good texture' },
        { url: 'https://example.com/chair', note: 'Simple joinery' },
      ],
      idempotency_key: 'http-structured-batch',
    },
  });
  assert.ok(!structured.isError);
  assert.match(JSON.stringify(structured), /striped wool blanket/);
  const searched = await client.callTool({
    name: 'search_likes',
    arguments: { q: 'lantern' },
  });
  assert.ok(!searched.isError);
  assert.match(JSON.stringify(searched), /brass lantern/);
  assert.doesNotMatch(
    JSON.stringify(searched),
    /striped wool blanket|Simple joinery/,
  );
  const imported = await client.callTool({
    name: 'save_likes',
    arguments: {
      inputs: 'A cedar table lamp\nhttps://example.com/lamp',
      idempotency_key: 'http-raw-import',
    },
  });
  assert.ok(!imported.isError);
  const importedText = JSON.stringify(imported);
  const batchId = importedText.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  assert.ok(batchId);
  const importStatus = await client.callTool({
    name: 'get_like',
    arguments: { id: batchId },
  });
  assert.ok(!importStatus.isError);
  assert.match(JSON.stringify(importStatus), /import/);
  await client.close();
});
