import { strToU8, zipSync } from 'fflate';
import { escapeHtml } from './email.js';
import {
  getLikesSql,
  listLikes,
  readAttachment,
  LikesError,
} from './likes-store.js';

export async function exportLikes({
  q = '',
  category = '',
}: { q?: string; category?: string } = {}) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const page = await listLikes({ q, category, limit: 100, offset });
    items.push(...page.items);
    if (items.length >= page.total) break;
    if (items.length > 10000)
      throw new LikesError(
        'Export this collection by category to keep each download manageable',
        413,
      );
  }
  const totalBytes = items
    .flatMap((i) => i.attachments)
    .reduce((sum, a) => sum + a.bytes, 0);
  if (totalBytes > 100 * 1024 * 1024)
    throw new LikesError(
      'This export exceeds 100 MB. Select a category or search to download a smaller collection.',
      413,
    );
  const files: Record<string, Uint8Array> = {};
  const records = [];
  const failures: string[] = [];
  for (const item of items) {
    const attachments = [];
    for (const asset of item.attachments) {
      const path = `files/${asset.id}/${asset.filename}`;
      try {
        const { data } = await readAttachment(asset.id);
        files[path] = data;
        attachments.push({ ...asset, url: path });
      } catch {
        failures.push(asset.id);
      }
    }
    records.push({ ...item, attachments });
    files[`notes/${item.id}.txt`] = strToU8(
      `${item.title}\n\n${item.originalText}\n\n${item.note}\n\n${item.extractedText}\n\nOriginal URL: ${item.url ?? '(none)'}\n`,
    );
  }
  if (failures.length)
    throw new LikesError(
      `Export stopped: ${failures.length} saved files could not be read. Retry after restoring storage; no incomplete ZIP was returned.`,
      502,
    );
  const sql = await getLikesSql();
  const ids = items.map((i) => i.id);
  const captures = ids.length
    ? await sql`SELECT id,item_id,payload,import_id,created_at FROM likes_captures WHERE item_id=ANY(${ids}) ORDER BY created_at`
    : [];
  const importIds = [
    ...new Set(captures.map((c) => c.import_id).filter(Boolean)),
  ];
  const imports = importIds.length
    ? await sql`SELECT id,original_text,created_at FROM likes_imports WHERE id=ANY(${importIds})`
    : [];
  files['items.json'] = strToU8(JSON.stringify(records, null, 2));
  files['captures.json'] = strToU8(JSON.stringify(captures, null, 2));
  files['imports.json'] = strToU8(JSON.stringify(imports, null, 2));
  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        items: records.length,
        files: records
          .flatMap((i) => i.attachments)
          .map((a) => ({ path: a.url, bytes: a.bytes, sha256: a.sha256 })),
      },
      null,
      2,
    ),
  );
  const cards = records
    .map((i) => {
      const image = i.attachments.find((a) =>
        a.contentType.startsWith('image/'),
      );
      const archives = i.attachments.filter((a) => a.role === 'archive');
      return `<article>${image ? `<img src="${escapeHtml(image.url)}" alt="">` : ''}<h2>${escapeHtml(i.title)}</h2><small>${escapeHtml(i.category)} · ${escapeHtml(i.tags.join(', '))}</small><p>${escapeHtml(i.note || i.description)}</p><pre>${escapeHtml(i.originalText)}</pre>${archives.map((a) => `<a href="${escapeHtml(a.url)}">Open saved copy</a>`).join(' ')} <a href="notes/${i.id}.txt">Saved text</a>${i.url ? ` <a href="${escapeHtml(i.url)}" rel="noreferrer">Original URL</a>` : ''}<small>Archive: ${escapeHtml(i.archiveStatus)}</small></article>`;
    })
    .join('\n');
  files['index.html'] = strToU8(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><title>Things I like</title><style>body{background:#111;color:#eee;font:16px system-ui;max-width:900px;margin:3rem auto;padding:1rem}article{border-bottom:1px solid #444;padding:2rem 0}img{max-width:240px;max-height:200px}a{color:#a6cbff}pre{white-space:pre-wrap}small{display:block;color:#aaa}</style></head><body><h1>Things I like</h1><p>${records.length} saved items. Open this file without an internet connection.</p>${cards}</body></html>`,
  );
  const zip = zipSync(files, { level: 1 });
  return new Response(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="nimo-likes.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
