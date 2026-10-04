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
import { processLikes } from './likes-jobs.js';
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
    };
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
          identification: 'suggested',
          extractedText: 'TEST LABEL',
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
