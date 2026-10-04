import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fetchPublicUrl } from './likes-fetch.js';
import { archiveLike } from './likes-archive.js';
import { saveAttachment } from './likes-store.js';
import { tokenUsage, SEED_PRICES } from './pricing.js';
import type { LikedItem } from '../../shared/likes.js';

const item: LikedItem = {
  id: 'deadline-item',
  kind: 'link',
  url: 'https://example.com/product',
  originalText: '',
  title: 'Product',
  note: '',
  category: 'uncategorized',
  tags: [],
  description: '',
  brand: null,
  extractedText: '',
  identification: 'unknown',
  status: 'pending',
  archiveStatus: 'pending',
  webLookup: { status: 'none', sources: [], checkedAt: null },
  error: null,
  source: 'web',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastShownAt: null,
  snoozedUntil: null,
  dismissed: false,
  attachments: [],
};

test('an expired deadline prevents DNS, fetching, and private attachment writes', async () => {
  const reason = new Error('item deadline exhausted');
  const signal = AbortSignal.abort(reason);
  await assert.rejects(
    fetchPublicUrl('https://example.com', { signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    saveAttachment({
      role: 'archive',
      filename: 'test.html',
      contentType: 'text/html',
      data: new Uint8Array([1]),
      signal,
    }),
    (error) => error === reason,
  );
});

test('archive cancellation stops before image storage and later resources', async () => {
  const controller = new AbortController();
  const reason = new Error('archive deadline exhausted');
  const storage = join(tmpdir(), `likes-cancelled-${randomUUID()}`);
  process.env.LIKES_LOCAL_STORAGE = storage;
  let requests = 0;
  await assert.rejects(
    archiveLike(
      item,
      async (url, options) => {
        assert.equal(options?.signal, controller.signal);
        requests++;
        if (requests === 1)
          return {
            url,
            contentType: 'text/html',
            body: new TextEncoder().encode(
              '<html><body><img src="/one.png"><img src="/two.png"></body></html>',
            ),
          };
        controller.abort(reason);
        return {
          url,
          contentType: 'image/png',
          body: new Uint8Array([1, 2, 3]),
        };
      },
      controller.signal,
    ),
    (error) => error === reason,
  );
  assert.equal(requests, 2);
  await assert.rejects(access(storage));
});

test('trace cost includes provider-reported native search charges', () => {
  const price = SEED_PRICES.find(
    (entry) => entry.model === 'claude-haiku-4-5',
  )!;
  const tokens = { input_tokens: 100, output_tokens: 200 };
  const base = tokenUsage(tokens, price).costUsd!;
  const withSearch = tokenUsage(
    { ...tokens, server_tool_use: { web_search_requests: 3 } },
    price,
  ).costUsd!;
  assert.ok(Math.abs(withSearch - base - 0.03) < 1e-10);
  assert.equal(
    tokenUsage(
      { ...tokens, server_tool_use: { web_search_requests: 3 } },
      undefined,
    ).costUsd,
    undefined,
  );
});
