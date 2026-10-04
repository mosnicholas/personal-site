import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import {
  extractArchiveMetadata,
  sanitizeArchiveHtml,
} from './likes-archive.js';
import {
  assertSourceCoverage,
  enrichLike,
  IMPORT_CHUNK_CHARS,
  redactPhotoTraceRequest,
  setLikesEnrichmentTestDependencies,
  splitNotes,
} from './likes-enrichment.js';
import { fetchPublicUrl, isPublicIp, SafeFetchError } from './likes-fetch.js';
import type { LikedItem } from '../../shared/likes.js';

function modelResponse(body: unknown): Anthropic.Message {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    stop_reason: 'end_turn',
  } as Anthropic.Message;
}

function mockClient(
  body: unknown | Anthropic.Message[],
  requests?: Anthropic.MessageCreateParamsNonStreaming[],
): Pick<Anthropic, 'messages'> {
  const responses = Array.isArray(body) ? [...body] : undefined;
  return {
    messages: {
      create: async (request: Anthropic.MessageCreateParamsNonStreaming) => {
        requests?.push(request);
        return responses?.shift() ?? modelResponse(body);
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}

test('rejects loopback and private ranges before fetching', async () => {
  await assert.rejects(
    () => fetchPublicUrl('http://127.0.0.1/internal'),
    (error: unknown) =>
      error instanceof SafeFetchError &&
      error.message === 'The URL is not safe to fetch',
  );
  await assert.rejects(
    () => fetchPublicUrl('ftp://example.com/file'),
    (error: unknown) =>
      error instanceof SafeFetchError &&
      error.message === 'The URL is not safe to fetch',
  );
});

test('accepts only globally routable IP address families', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('10.0.0.1'), false);
  assert.equal(isPublicIp('169.254.169.254'), false);
  assert.equal(isPublicIp('::1'), false);
  assert.equal(isPublicIp('fc00::1'), false);
});

test('reads OpenGraph and Product JSON-LD without trusting page scripts', () => {
  const metadata = extractArchiveMetadata(
    `<!doctype html><html><head>
      <title>fallback title</title>
      <meta property="og:description" content="A lovely thing">
      <meta property="og:image" content="/cover.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"Verified product","brand":{"name":"Acme"},"image":["/product.jpg"]}</script>
    </head><body>Visible <strong>product</strong> description</body></html>`,
    'https://example.com/path',
  );
  assert.equal(metadata.title, 'Verified product');
  assert.equal(metadata.description, 'A lovely thing');
  assert.equal(metadata.brand, 'Acme');
  assert.deepEqual(metadata.imageUrls, [
    'https://example.com/product.jpg',
    'https://example.com/cover.jpg',
  ]);
  assert.equal(metadata.extractedText, 'Visible product description');
});

test('removes active content and unsafe URLs from archived HTML', () => {
  const archive = sanitizeArchiveHtml(
    `<html><head><meta http-equiv="refresh" content="0;url=https://evil.example">
      <link rel="preload" href="https://evil.example/asset"><style>.hero { background: url(https://evil.example/pixel) }</style>
    </head><body><script>alert('x')</script><video src="https://cdn.example/video.mp4"></video>
      <a href="javascript:alert(1)" onclick="alert(1)">unsafe</a><img src="data:image/png;base64,abc"></body></html>`,
    'https://example.com',
  );
  assert.equal(archive.partial, true);
  assert.doesNotMatch(
    archive.html,
    /script|video|onclick|javascript:|http-equiv|preload/i,
  );
  assert.doesNotMatch(archive.html, /evil\.example/);
  assert.doesNotMatch(archive.html, /data:image/i);
});

test('does not mark metadata-only JSON-LD as dynamic content', () => {
  const archive = sanitizeArchiveHtml(
    '<html><body><script type="application/ld+json">{"@type":"Product"}</script><p>Static</p></body></html>',
    'https://example.com',
  );
  assert.equal(archive.partial, false);
  assert.doesNotMatch(archive.html, /application\/ld\+json/);
});

test('rejects a note-import result that leaves source text uncovered', () => {
  assert.throws(
    () =>
      assertSourceCoverage('first saved thing\n\nsecond saved thing', [
        'first saved thing',
      ]),
    /did not cover the complete source chunk/,
  );
  assert.doesNotThrow(() =>
    assertSourceCoverage('first saved thing\n\nsecond saved thing', [
      'first saved thing',
      'second saved thing',
    ]),
  );
});

test('imports a URL excerpt as a link while preserving its full rationale', async () => {
  const excerpt =
    'Buy https://example.com/perfume because it smells like cedar.';
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  setLikesEnrichmentTestDependencies({
    client: mockClient(
      {
        complete: true,
        items: [
          {
            excerpt,
            title: 'Cedar perfume',
            category: 'fragrance',
            tags: ['cedar'],
          },
        ],
      },
      requests,
    ),
  });
  try {
    const inputs = await splitNotes(excerpt, 'import-test');
    assert.deepEqual(inputs, [
      {
        kind: 'link',
        url: 'https://example.com/perfume',
        text: excerpt,
        note: excerpt,
        title: 'Cedar perfume',
        category: 'fragrance',
        tags: ['cedar'],
        source: 'import',
      },
    ]);
    const schema = requests[0]?.output_config?.format as
      { schema?: { required?: string[] } } | undefined;
    assert.deepEqual(schema?.schema?.required, ['complete', 'items']);
  } finally {
    setLikesEnrichmentTestDependencies();
  }
});

test('photo enrichment keeps product identification suggested and records visible label text', async () => {
  const item = {
    id: 'photo-test',
    kind: 'photo',
    url: null,
    originalText: '',
    title: 'Photo',
    note: 'Maybe this is the one.',
    category: 'uncategorized',
    tags: [],
    description: 'Corrected amber edition cue',
    brand: null,
    extractedText: '',
    identification: 'unknown',
    webLookup: { status: 'none', sources: [], checkedAt: null },
    status: 'pending',
    archiveStatus: 'none',
    error: null,
    source: 'web',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    lastShownAt: null,
    snoozedUntil: null,
    dismissed: false,
    attachments: [
      {
        id: 'original-photo',
        itemId: 'photo-test',
        role: 'original',
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        bytes: 3,
        sha256: 'test',
        url: '/api/likes?op=asset&id=original-photo',
      },
      {
        id: 'older-archive',
        itemId: 'photo-test',
        role: 'archive',
        filename: 'old.html',
        contentType: 'text/html',
        bytes: 3,
        sha256: 'old',
        url: '/api/likes?op=asset&id=older-archive',
      },
      {
        id: 'older-image',
        itemId: 'photo-test',
        role: 'image',
        filename: 'old.png',
        contentType: 'image/png',
        bytes: 3,
        sha256: 'old-image',
        url: '/api/likes?op=asset&id=older-image',
      },
    ],
  } satisfies LikedItem;
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  setLikesEnrichmentTestDependencies({
    client: mockClient(
      [
        {
          content: [
            {
              type: 'server_tool_use',
              id: 'search-1',
              name: 'web_search',
              input: { query: 'ACME PARFUM fragrance' },
            },
            {
              type: 'web_search_tool_result',
              tool_use_id: 'search-1',
              caller: { type: 'direct' },
              content: [
                {
                  type: 'web_search_result',
                  url: 'https://acme.example/parfum',
                  title: 'Acme Parfum',
                  page_age: null,
                  encrypted_content: 'encrypted',
                },
              ],
            },
            {
              type: 'text',
              text: 'Acme makes this fragrance.',
              citations: [
                {
                  type: 'web_search_result_location',
                  url: 'https://acme.example/parfum',
                  title: 'Acme Parfum',
                  cited_text: 'Acme Parfum',
                  encrypted_index: 'citation',
                },
              ],
            },
          ],
          stop_reason: 'end_turn',
        } as unknown as Anthropic.Message,
        modelResponse({
          category: 'fragrance',
          tags: ['perfume'],
          title: 'Acme',
          extractedText: 'ACME PARFUM',
          identification: 'confirmed',
          lookupStatus: 'matched',
          sourceIndexes: [0],
        }),
      ],
      requests,
    ),
    readAttachment: async () => ({
      attachment: item.attachments[0]!,
      data: new Uint8Array([1, 2, 3]),
    }),
    archiveLike: async () => ({
      patch: {
        archiveStatus: 'complete',
        attachments: [
          ...item.attachments,
          {
            ...item.attachments[1]!,
            id: 'current-archive',
            url: '/api/likes?op=asset&id=current-archive',
          },
          {
            ...item.attachments[2]!,
            id: 'current-image',
            url: '/api/likes?op=asset&id=current-image',
          },
        ],
      },
    }),
  });
  try {
    const patch = await enrichLike(item);
    assert.equal(patch.identification, 'suggested');
    assert.equal(patch.extractedText, 'ACME PARFUM');
    assert.equal(patch.category, 'fragrance');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0]?.tool_choice, {
      type: 'tool',
      name: 'web_search',
    });
    assert.equal(requests[0]?.tools?.[0]?.type, 'web_search_20250305');
    assert.deepEqual(requests[0]?.thinking, { type: 'disabled' });
    assert.equal(requests[0]?.output_config, undefined);
    assert.match(
      JSON.stringify(requests[0]?.messages[0]?.content),
      /Corrected amber edition cue/,
    );
    assert.equal(requests[1]?.tools, undefined);
    assert.deepEqual(requests[1]?.thinking, { type: 'disabled' });
    assert.match(
      JSON.stringify(requests[1]?.messages[0]?.content),
      /Corrected amber edition cue/,
    );
    assert.equal(patch.webLookup?.status, 'matched');
    assert.equal(patch.webLookup?.archiveAttachmentId, 'current-archive');
    assert.deepEqual(patch.webLookup?.imageAttachmentIds, ['current-image']);
    assert.deepEqual(patch.webLookup?.sources, [
      {
        url: 'https://acme.example/parfum',
        title: 'Acme Parfum',
        excerpt: 'Acme Parfum',
      },
    ]);
    const schema = requests[1]?.output_config?.format as
      { schema?: { required?: string[] } } | undefined;
    assert.ok(schema?.schema?.required?.includes('tags'));
    for (const [contentType, data] of [
      ['application/pdf', new Uint8Array([1])],
      ['image/jpeg', new Uint8Array(5 * 1024 * 1024 + 1)],
    ] as const) {
      setLikesEnrichmentTestDependencies({
        client: mockClient({}),
        readAttachment: async () => ({
          attachment: { ...item.attachments[0]!, contentType },
          data,
        }),
      });
      const unsupported = await enrichLike(item);
      assert.equal(unsupported.status, 'failed');
      assert.equal(unsupported.identification, 'unknown');
      assert.match(unsupported.error ?? '', /not a supported size/);
    }
  } finally {
    setLikesEnrichmentTestDependencies();
  }
});

test('rejects incomplete model responses and oversized import segments', async () => {
  for (const stopReason of ['refusal', 'max_tokens'] as const) {
    setLikesEnrichmentTestDependencies({
      client: {
        messages: {
          create: async () =>
            ({
              content: [],
              stop_reason: stopReason,
            }) as unknown as Anthropic.Message,
        },
      } as unknown as Pick<Anthropic, 'messages'>,
    });
    await assert.rejects(
      () => splitNotes('one saved note', `rejected-${stopReason}`),
      /did not finish/,
    );
  }
  setLikesEnrichmentTestDependencies();
  await assert.rejects(
    () => splitNotes('a'.repeat(IMPORT_CHUNK_CHARS + 1), 'too-large'),
    /safety limit/,
  );
});

test('photo trace records private attachment provenance instead of base64 bytes', () => {
  const request = {
    model: 'claude-haiku-4-5',
    max_tokens: 10,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'AQIDBA==',
            },
          },
          { type: 'text', text: '{"note":"bottle"}' },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'web_search_tool_result',
            tool_use_id: 'search-1',
            caller: { type: 'direct' },
            content: [
              {
                type: 'web_search_result',
                url: 'https://maker.example/product',
                title: 'Maker Product',
                page_age: null,
                encrypted_content: 'keep-encrypted-search-result',
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;
  const trace = redactPhotoTraceRequest(request, {
    id: 'stored-photo',
    itemId: 'photo-test',
    role: 'original',
    filename: 'photo.png',
    contentType: 'image/png',
    bytes: 4,
    sha256: 'private-sha',
    url: '/api/likes?op=asset&id=stored-photo',
  });
  const recorded = JSON.stringify(trace);
  assert.doesNotMatch(recorded, /AQIDBA==|base64/);
  assert.match(recorded, /stored-photo|private-sha/);
  assert.match(recorded, /keep-encrypted-search-result/);
});
