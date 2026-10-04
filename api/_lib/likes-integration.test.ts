import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { handleLikesRequest } from './likes-http.js';
import {
  authorizeLikeToken,
  ownerCookie,
  rejectUnauthorizedLikes,
  sessionToken,
} from './likes-auth.js';
import { exportLikes } from './likes-export.js';
import { sendLikesDigest } from './likes-digest.js';
import { archiveLike } from './likes-archive.js';
import {
  IMPORT_CHUNK_CHARS,
  setLikesEnrichmentTestDependencies,
} from './likes-enrichment.js';
import { processLikes, drainLikes } from './likes-jobs.js';
import {
  getImport,
  getLike,
  getLikesSql,
  getSettings,
  listLikes,
  readAttachment,
  saveAttachment,
  saveLike,
  savePhotoLike,
  startImport,
  retryLike,
  updateLike,
  updateSettings,
  validateUpload,
} from './likes-store.js';

process.env.LIKES_API_KEY = 'integration-test-key-with-32-characters-minimum';
process.env.LIKES_ORIGIN = 'http://localhost:3000';
process.env.LIKES_LOCAL_DATABASE = join(
  tmpdir(),
  `nimo-likes-db-${randomUUID()}`,
);
process.env.LIKES_LOCAL_STORAGE = join(
  tmpdir(),
  `nimo-likes-files-${randomUUID()}`,
);
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.RESEND_API_KEY = 'mock-resend-key';
process.env.WEEKLY_SUMMARY_RECIPIENT_EMAIL = 'test@example.invalid';
process.env.CRON_SECRET = 'test-cron-key';
const key = process.env.LIKES_API_KEY;
const originalFetch = globalThis.fetch;
let mailCalls = 0;
let mailFails = false;
let failFrontier = false;
let webFixtureMatch = false;
let webFixtureUrl = 'https://example.com/cedar';
const matchedRequests: string[] = [];
let frontierFailureGate: Promise<void> | undefined;
let frontierFailureStarted: (() => void) | undefined;
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes('api.anthropic.com')) {
    const request = JSON.parse(String(init?.body)) as {
      system: string;
      messages: { content: string }[];
      tools?: unknown[];
    };
    if (
      failFrontier &&
      typeof request.messages[0].content === 'string' &&
      request.messages[0].content.includes('Failed frontier')
    ) {
      frontierFailureStarted?.();
      await frontierFailureGate;
      return Response.json(
        {
          type: 'error',
          error: { type: 'overloaded_error', message: 'Mock failure' },
        },
        { status: 503 },
      );
    }
    if (webFixtureMatch) matchedRequests.push(JSON.stringify(request));
    if (request.tools?.length) {
      return Response.json({
        id: randomUUID(),
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        content: [
          {
            type: 'server_tool_use',
            id: 'search-test',
            name: 'web_search',
            input: { query: 'CEDAR perfume' },
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'search-test',
            content: webFixtureMatch
              ? [
                  {
                    type: 'web_search_result',
                    url: webFixtureUrl,
                    title: 'Official Cedar perfume',
                    encrypted_content: 'test-search-content',
                    page_age: null,
                  },
                ]
              : [],
          },
          {
            type: 'text',
            text: webFixtureMatch
              ? 'The label matches Cedar perfume.'
              : 'No clear web match found.',
            citations: webFixtureMatch
              ? [
                  {
                    type: 'web_search_result_location',
                    url: webFixtureUrl,
                    title: 'Official Cedar perfume',
                    cited_text: 'CEDAR perfume from Model brand',
                    encrypted_index: 'test-index',
                  },
                ]
              : [],
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 20,
          server_tool_use: { web_search_requests: 1 },
        },
      });
    }
    const payload = request.system.includes('Split')
      ? {
          complete: true,
          items: [
            {
              excerpt: request.messages[0].content,
              tags: ['test'],
              category: 'fragrance',
              title: 'Imported perfume',
            },
          ],
        }
      : {
          category: 'fragrance',
          tags: ['woody'],
          title: 'A woody perfume',
          description: 'Label preserved',
          brand: 'Model brand',
          identification: 'suggested',
          extractedText: 'TEST LABEL',
          lookupStatus: webFixtureMatch ? 'matched' : 'no-match',
          sourceIndexes: webFixtureMatch ? [0] : [],
        };
    return Response.json({
      id: randomUUID(),
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      usage: { input_tokens: 20, output_tokens: 20 },
    });
  }
  if (url === 'https://api.resend.com/emails') {
    mailCalls++;
    assert.ok(new Headers(init?.headers).get('idempotency-key'));
    return mailFails
      ? Response.json({ error: 'failure' }, { status: 500 })
      : Response.json({ id: randomUUID() });
  }
  throw new Error('Live network calls are disabled in this test');
};
test.after(() => {
  globalThis.fetch = originalFetch;
});

test('owner auth fails closed and session writes enforce same origin', async () => {
  assert.equal(authorizeLikeToken(key), true);
  const token = sessionToken();
  assert.equal(authorizeLikeToken(token), true);
  assert.equal(authorizeLikeToken(token + 'x'), false);
  assert.equal(
    authorizeLikeToken(sessionToken(Date.now() - 8 * 86400000)),
    false,
  );
  const request = (method: string, origin?: string) =>
    new Request('http://localhost:3000/api/likes', {
      method,
      headers: { cookie: `nimo_likes=${token}`, ...(origin ? { origin } : {}) },
    });
  assert.equal(ownerCookie(request('GET')), true);
  assert.equal(rejectUnauthorizedLikes(request('GET')), undefined);
  assert.equal(
    rejectUnauthorizedLikes(request('POST', 'https://evil.invalid'))?.status,
    403,
  );
  assert.equal(
    rejectUnauthorizedLikes(request('POST', 'http://localhost:3000')),
    undefined,
  );
  assert.equal(
    rejectUnauthorizedLikes(new Request('http://localhost:3000/api/likes'))
      ?.status,
    401,
  );
  const login = await handleLikesRequest(
    new Request('http://localhost:3000/api/likes?op=login', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key }),
    }),
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  assert.ok(!JSON.stringify(await login.json()).includes(key));
});

test('SQL capture dedupe is atomic, preserves new notes, and rejects conflicting retry keys', async () => {
  const first = await saveLike(
    {
      url: 'https://example.com/perfume?utm_source=test&size=50',
      note: 'Loved the drydown',
    },
    'capture-one',
  );
  const replay = await saveLike(
    {
      url: 'https://example.com/perfume?utm_source=test&size=50',
      note: 'Loved the drydown',
    },
    'capture-one',
  );
  assert.equal(first.item.id, replay.item.id);
  assert.equal((await getLike(first.item.id))!.note, 'Loved the drydown');
  const other = await saveLike(
    {
      url: 'https://example.com/perfume?size=50',
      note: 'Try the smaller bottle',
    },
    'capture-two',
  );
  assert.equal(other.duplicate, true);
  assert.match(
    other.item.note,
    /Loved the drydown[\s\S]*Try the smaller bottle/,
  );
  assert.equal(other.item.url, 'https://example.com/perfume?size=50');
  await assert.rejects(
    saveLike({ text: 'Different input' }, 'capture-one'),
    /different item/,
  );
  const results = await Promise.all([
    saveLike({ text: 'Concurrent note' }, 'same-retry'),
    saveLike({ text: 'Concurrent note' }, 'same-retry'),
  ]);
  assert.equal(results[0].item.id, results[1].item.id);
  assert.equal((await listLikes({ q: 'Concurrent' })).total, 1);
  // Search is real PostgreSQL FTS, including why and categories.
  assert.equal((await listLikes({ q: 'drydown' })).total, 1);
});

test('real private photo bytes survive retries and offline ZIP export', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  const photo = {
    data: png,
    filename: 'perfume.png',
    contentType: 'image/png',
  };
  const first = await savePhotoLike(
    { note: 'Photo of the bottle' },
    photo,
    'photo-retry',
  );
  const replay = await savePhotoLike(
    { note: 'Photo of the bottle' },
    photo,
    'photo-retry',
  );
  assert.equal(first.item.id, replay.item.id);
  assert.equal(replay.item.attachments.length, 1);
  assert.deepEqual(
    Buffer.from((await readAttachment(replay.item.attachments[0].id)).data),
    png,
  );
  await assert.rejects(
    savePhotoLike({ note: 'Different note' }, photo, 'photo-retry'),
    /different item/,
  );
  const concurrent = await Promise.all([
    savePhotoLike({ note: 'Same concurrent photo' }, photo, 'concurrent-photo'),
    savePhotoLike({ note: 'Same concurrent photo' }, photo, 'concurrent-photo'),
  ]);
  assert.equal(concurrent[0].item.id, concurrent[1].item.id);
  await saveAttachment({
    itemId: first.item.id,
    role: 'archive',
    filename: 'snapshot.html',
    contentType: 'text/html',
    data: new TextEncoder().encode('<html><body>Saved bottle</body></html>'),
  });
  const zip = await exportLikes();
  assert.equal(zip.status, 200);
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.match(strFromU8(files['index.html']), /Things I like/);
  assert.ok(Object.keys(files).some((path) => path.endsWith('/perfume.png')));
  const exportedPng = Object.entries(files).find(([path]) =>
    path.endsWith('/perfume.png'),
  )![1];
  assert.deepEqual(Buffer.from(exportedPng), png);
  assert.match(strFromU8(files['captures.json']), /Photo of the bottle/);
  assert.ok(!Object.keys(files).some((path) => path.includes('..')));
  await assert.rejects(
    saveAttachment({
      role: 'original',
      filename: 'fake.jpg',
      contentType: 'image/jpeg',
      data: new TextEncoder().encode('bad'),
    }),
    /matching its file type/,
  );
});

test('truncated image headers are rejected and original note terms are searchable before enrichment', async () => {
  await assert.rejects(
    validateUpload('image/jpeg', Buffer.from([255, 216, 255])),
    /corrupt/,
  );
  await assert.rejects(
    validateUpload('image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    /corrupt/,
  );
  await saveLike({
    title: 'Shopping list',
    text: 'A long shopping note. '.repeat(10) + 'uniquebrasslantern',
  });
  assert.equal((await listLikes({ q: 'uniquebrasslantern' })).total, 1);
});

test('archives an OG-only product preview as local image and static HTML', async () => {
  const item = await saveLike({ url: 'https://product.example/only-og' });
  const image = new Uint8Array(
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#bca' },
    })
      .png()
      .toBuffer(),
  );
  const archived = await archiveLike(item.item, async (url) => {
    if (url === 'https://product.example/only-og') {
      return {
        url,
        contentType: 'text/html',
        body: new TextEncoder().encode(
          '<html><head><meta property="og:title" content="OG product"><meta property="og:image" content="https://cdn.example/preview.png"></head><body>Saved product</body></html>',
        ),
      };
    }
    assert.equal(url, 'https://cdn.example/preview.png');
    return { url, contentType: 'image/png', body: image };
  });
  assert.equal(archived.patch.archiveStatus, 'complete');
  const preview = archived.patch.attachments!.find(
    (attachment) => attachment.role === 'image',
  )!;
  assert.deepEqual((await readAttachment(preview.id)).data, image);
  const archive = archived.patch.attachments!.find(
    (attachment) => attachment.role === 'archive',
  )!;
  const archiveHtml = new TextDecoder().decode(
    (await readAttachment(archive.id)).data,
  );
  assert.match(archiveHtml, /Content-Security-Policy/);
  assert.ok(
    archiveHtml.includes(
      'data:image/png;base64,' + Buffer.from(image).toString('base64'),
    ),
  );
  assert.doesNotMatch(archiveHtml, /(?:src|srcset|background)=["']https?:/i);
  assert.doesNotMatch(archiveHtml, /cdn\.example/);
  const files = unzipSync(
    new Uint8Array(await (await exportLikes()).arrayBuffer()),
  );
  const archivePath = `files/${archive.id}/${archive.filename}`;
  assert.deepEqual(files[archivePath], new TextEncoder().encode(archiveHtml));
});

test('raw backfill, cursor retries, and enrichment preserve user category/title', async () => {
  const note = await saveLike({
    text: 'The wonderful perfume',
    title: 'My own title',
    category: 'my-category',
    tags: ['my-tag'],
  });
  const batch = await startImport(
    'Perfume I liked at the shop\nLoved its drydown',
    'import-once',
  );
  assert.equal(
    (
      await startImport(
        'Perfume I liked at the shop\nLoved its drydown',
        'import-once',
      )
    ).id,
    batch.id,
  );
  await assert.rejects(
    startImport('Other notes', 'import-once'),
    /different notes/,
  );
  const sql = await getLikesSql();
  await sql`UPDATE liked_items SET status='ready' WHERE kind='link'`;
  const job = await processLikes({ limit: 20 });
  assert.equal(job.failed, 0);
  const imported = (await getImport(batch.id))!;
  assert.equal(imported.status, 'ready');
  assert.equal(imported.created, 1);
  const enriched = (await getLike(note.item.id))!;
  assert.equal(enriched.title, 'My own title');
  assert.equal(enriched.category, 'my-category');
  assert.deepEqual(enriched.tags, ['my-tag']);
  const [stored] =
    await sql`SELECT original_text FROM likes_imports WHERE id=${batch.id}`;
  assert.equal(
    stored.original_text,
    'Perfume I liked at the shop\nLoved its drydown',
  );
  // Simulate interruption after save, before cursor update: replay creates no duplicate.
  await sql`UPDATE likes_imports SET cursor=0,status='pending',created=0,duplicates=0 WHERE id=${batch.id}`;
  await processLikes({ limit: 20 });
  assert.equal((await getImport(batch.id))!.created, 1);
  assert.equal((await listLikes({ q: 'Imported perfume' })).total, 1);
});

test('long backfills checkpoint parsing between bounded runs', async () => {
  const text = 'A perfume note to preserve in full.\n'.repeat(650);
  const batch = await startImport(text, 'long-import');
  await processLikes({ limit: 1 });
  const sql = await getLikesSql();
  const [partial] =
    await sql`SELECT parse_cursor,parse_complete,parsed_items FROM likes_imports WHERE id=${batch.id}`;
  assert.ok(
    Number(partial.parse_cursor) > 0 &&
      Number(partial.parse_cursor) < text.length,
  );
  assert.equal(partial.parse_complete, false);
  await processLikes({ limit: 20 });
  const done = (await getImport(batch.id))!;
  assert.equal(done.status, 'ready');
  const [finished] =
    await sql`SELECT original_text,parse_cursor,parse_complete,parsed_items FROM likes_imports WHERE id=${batch.id}`;
  assert.equal(finished.original_text, text);
  assert.equal(Number(finished.parse_cursor), text.length);
  assert.equal(finished.parse_complete, true);
  assert.ok((finished.parsed_items as unknown[]).length > 1);
});

test('trailing whitespace advances the import checkpoint without a second parse', async () => {
  const text = `${'x'.repeat(IMPORT_CHUNK_CHARS)} \n\t `;
  const batch = await startImport(text, 'whitespace-tail-import');
  await processLikes({ limit: 1 });
  const sql = await getLikesSql();
  const [first] =
    await sql`SELECT parse_cursor,parse_complete,parsed_items FROM likes_imports WHERE id=${batch.id}`;
  assert.equal(Number(first.parse_cursor), IMPORT_CHUNK_CHARS);
  assert.equal(first.parse_complete, false);
  assert.equal((first.parsed_items as unknown[]).length, 1);
  const result = await processLikes({ limit: 1 });
  assert.equal(result.failed, 0);
  const [finished] =
    await sql`SELECT parse_cursor,parse_complete,parsed_items,status FROM likes_imports WHERE id=${batch.id}`;
  assert.equal(Number(finished.parse_cursor), text.length);
  assert.equal(finished.parse_complete, true);
  assert.equal(finished.status, 'ready');
  assert.equal((finished.parsed_items as unknown[]).length, 1);
});

test('background processing continues across batches without an MCP processing tool', async () => {
  for (let i = 0; i < 25; i++)
    await saveLike({
      text: `Background task ${i}`,
      title: `Background task ${i}`,
    });
  await drainLikes(20000);
  const tasks = await listLikes({ q: 'Background task', limit: 100 });
  assert.equal(tasks.total, 25);
  assert.ok(tasks.items.every((item) => item.status === 'ready'));
});

test('failed processing batches do not leave healthy saves behind them untouched', async () => {
  const sql = await getLikesSql();
  const failedIds = [];
  for (let i = 0; i < 20; i++)
    failedIds.push((await saveLike({ text: `Failed frontier ${i}` })).item.id);
  await sql`UPDATE liked_items SET created_at=now()-interval '1 day' WHERE id=ANY(${failedIds})`;
  const healthy = await saveLike({
    text: 'Healthy save after failed frontier',
  });
  failFrontier = true;
  try {
    await drainLikes(20000);
  } finally {
    failFrontier = false;
  }
  assert.equal((await getLike(healthy.item.id))!.status, 'ready');
  const rows =
    await sql`SELECT attempts FROM liked_items WHERE id=ANY(${failedIds})`;
  assert.ok(rows.every((row) => Number(row.attempts) === 1));
});

test('automatic retry clears the old enrichment error after recovery', async () => {
  const originalText = 'Failed frontier automatic recovery';
  const saved = await saveLike({ text: originalText });
  const sql = await getLikesSql();
  await sql`UPDATE liked_items SET status='ready' WHERE id<>${saved.item.id}`;
  failFrontier = true;
  try {
    await processLikes({ limit: 1 });
  } finally {
    failFrontier = false;
  }
  const failedAttempt = (await getLike(saved.item.id))!;
  assert.equal(failedAttempt.status, 'pending');
  assert.match(failedAttempt.error ?? '', /Web lookup failed/);
  // Resume the scheduled job directly, without retryLike clearing its error.
  await sql`UPDATE liked_items SET available_at=now() WHERE id=${saved.item.id}`;
  await processLikes({ limit: 1 });
  const recovered = (await getLike(saved.item.id))!;
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.error, null);
  assert.equal(recovered.originalText, originalText);
  const [row] =
    await sql`SELECT attempts FROM liked_items WHERE id=${saved.item.id}`;
  assert.equal(Number(row.attempts), 2);
});

test('manual brand and description survive a mid-flight failure, scheduled retries, and a retry', async () => {
  const originalText = 'Failed frontier manual correction';
  const saved = await saveLike({ text: originalText });
  const sql = await getLikesSql();
  await sql`UPDATE liked_items SET status='ready' WHERE id<>${saved.item.id}`;

  let releaseFailure!: () => void;
  frontierFailureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const failureStarted = new Promise<void>((resolve) => {
    frontierFailureStarted = resolve;
  });
  failFrontier = true;
  try {
    const firstAttempt = processLikes({ limit: 1 });
    await failureStarted;
    await updateLike(saved.item.id, {
      brand: 'Manual brand',
      description: 'Manual description',
    });
    releaseFailure();
    await firstAttempt;
    frontierFailureGate = undefined;
    frontierFailureStarted = undefined;

    const afterFirstFailure = (await getLike(saved.item.id))!;
    assert.equal(afterFirstFailure.status, 'pending');
    assert.equal(afterFirstFailure.brand, 'Manual brand');
    assert.equal(afterFirstFailure.description, 'Manual description');
    assert.equal(afterFirstFailure.originalText, originalText);
    assert.match(afterFirstFailure.error ?? '', /Web lookup failed/);

    await sql`UPDATE liked_items SET available_at=now() WHERE id=${saved.item.id}`;
    await processLikes({ limit: 1 });
    assert.equal((await getLike(saved.item.id))!.status, 'pending');

    await sql`UPDATE liked_items SET available_at=now() WHERE id=${saved.item.id}`;
    await processLikes({ limit: 1 });
    const terminalFailure = (await getLike(saved.item.id))!;
    assert.equal(terminalFailure.status, 'failed');
    assert.equal(terminalFailure.brand, 'Manual brand');
    assert.equal(terminalFailure.description, 'Manual description');

    const retried = await retryLike(saved.item.id);
    assert.equal(retried.status, 'pending');
    assert.equal(retried.error, null);
  } finally {
    releaseFailure?.();
    frontierFailureGate = undefined;
    frontierFailureStarted = undefined;
    failFrontier = false;
  }

  await processLikes({ limit: 1 });
  const recovered = (await getLike(saved.item.id))!;
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.brand, 'Manual brand');
  assert.equal(recovered.description, 'Manual description');
  assert.equal(recovered.originalText, originalText);

  await updateLike(saved.item.id, { brand: null, description: '' });
  await sql`UPDATE liked_items SET status='failed',error='A later attempt failed' WHERE id=${saved.item.id}`;
  await retryLike(saved.item.id);
  await processLikes({ limit: 1 });
  const cleared = (await getLike(saved.item.id))!;
  assert.equal(cleared.status, 'ready');
  assert.equal(cleared.brand, null);
  assert.equal(cleared.description, '');
  assert.equal(cleared.originalText, originalText);
});

test('a web-grounded photo retains citations, OCR, and its matched page in API and offline export', async () => {
  const png = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  const saved = await savePhotoLike(
    { note: 'Loved this bottle in the shop' },
    {
      data: png,
      filename: 'web-bottle.png',
      contentType: 'image/png',
    },
  );
  const sql = await getLikesSql();
  await sql`UPDATE liked_items SET status='ready' WHERE id<>${saved.item.id}`;
  webFixtureMatch = true;
  setLikesEnrichmentTestDependencies({
    archiveLike: (item, _fetcher, signal) =>
      archiveLike(
        item,
        async (url) => ({
          url,
          contentType: 'text/html',
          body: new TextEncoder().encode(
            `<html><head><title>Product webpage title</title></head><body>Product webpage prose, distinct from the bottle label. ${url}</body></html>`,
          ),
        }),
        signal,
      ),
  });
  try {
    await processLikes({ limit: 1 });
    const enriched = (await getLike(saved.item.id))!;
    assert.equal(enriched.status, 'ready');
    assert.equal(enriched.webLookup.status, 'matched');
    assert.equal(enriched.identification, 'suggested');
    assert.equal(enriched.extractedText, 'TEST LABEL');
    assert.equal(enriched.note, 'Loved this bottle in the shop');
    assert.equal(enriched.url, null);
    assert.equal(
      enriched.webLookup.sources[0]?.url,
      'https://example.com/cedar',
    );
    assert.equal(
      enriched.attachments.filter((asset) => asset.role === 'archive').length,
      1,
    );
    const firstArchiveId = enriched.webLookup.archiveAttachmentId;
    assert.ok(firstArchiveId);
    const correctedCue = 'Distinctive corrected product with silver cap';
    await updateLike(enriched.id, { description: correctedCue });
    webFixtureUrl = 'https://example.com/cedar-corrected';
    await retryLike(enriched.id);
    await processLikes({ limit: 1 });
    const refreshed = (await getLike(enriched.id))!;
    assert.equal(refreshed.status, 'ready');
    assert.equal(refreshed.description, correctedCue);
    assert.equal(refreshed.webLookup.sources[0]?.url, webFixtureUrl);
    assert.ok(refreshed.webLookup.archiveAttachmentId);
    assert.notEqual(refreshed.webLookup.archiveAttachmentId, firstArchiveId);
    assert.ok(
      refreshed.attachments.some((asset) => asset.id === firstArchiveId),
    );
    assert.equal(matchedRequests.slice(-2).length, 2);
    assert.ok(
      matchedRequests.slice(-2).every((body) => body.includes(correctedCue)),
    );
    assert.match(
      new TextDecoder().decode(
        (await readAttachment(refreshed.webLookup.archiveAttachmentId!)).data,
      ),
      /cedar-corrected/,
    );
    const response = await handleLikesRequest(
      new Request(`http://localhost:3000/api/likes?id=${enriched.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      ((await response.json()) as { item: { webLookup: unknown } }).item
        .webLookup,
      refreshed.webLookup,
    );
    const exported = unzipSync(
      new Uint8Array(
        await (
          await exportLikes({ q: 'Loved this bottle in the shop' })
        ).arrayBuffer(),
      ),
    );
    const records = JSON.parse(strFromU8(exported['items.json']!));
    assert.equal(records[0].webLookup.status, 'matched');
    assert.match(strFromU8(exported['index.html']!), /Official Cedar perfume/);
    assert.match(
      strFromU8(exported[`notes/${enriched.id}.txt`]!),
      /https:\/\/example.com\/cedar/,
    );
    const page = records[0].attachments.find(
      (asset: { id: string }) =>
        asset.id === records[0].webLookup.archiveAttachmentId,
    );
    assert.match(strFromU8(exported[page.url]!), /cedar-corrected/);
  } finally {
    webFixtureMatch = false;
    webFixtureUrl = 'https://example.com/cedar';
    setLikesEnrichmentTestDependencies();
  }
});

test('digest opt-in, failures, retries, and successful weekly idempotency', async () => {
  assert.equal((await getSettings()).digestEnabled, false);
  assert.deepEqual(await sendLikesDigest(), {
    sent: false,
    reason: 'disabled',
  });
  assert.equal(mailCalls, 0);
  const sql = await getLikesSql();
  await sql`UPDATE liked_items SET created_at=now()-interval '30 days'`;
  await updateSettings({ digestEnabled: true, digestCount: 2 });
  const dismissed = (await listLikes()).items[0];
  await updateLike(dismissed.id, { dismissed: true });
  const dry = await sendLikesDigest({ dryRun: true });
  assert.ok(
    'items' in dry &&
      dry.items &&
      !dry.items.some((item) => item.id === dismissed.id),
  );
  assert.equal(mailCalls, 0);
  mailFails = true;
  await assert.rejects(sendLikesDigest(), /delivery failed/);
  const [{ count }] =
    await sql`SELECT count(*) AS count FROM liked_items WHERE last_shown_at IS NOT NULL`;
  assert.equal(Number(count), 0);
  mailFails = false;
  assert.equal((await sendLikesDigest()).sent, true);
  assert.equal((await sendLikesDigest()).sent, false);
  assert.equal(mailCalls, 2);
});
