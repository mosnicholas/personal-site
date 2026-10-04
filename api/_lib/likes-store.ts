import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { get, put } from '@vercel/blob';
import { z } from 'zod';
import sharp from 'sharp';
import type {
  ImportBatch,
  LikeAttachment,
  LikeInput,
  LikedItem,
  LikesSettings,
} from '../../shared/likes.js';
import { requireSql, type Sql } from './db.js';
import { LIKES_SCHEMA } from './likes-schema.js';

export class LikesError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const isLocalLikes = () =>
  !process.env.VERCEL && process.env.NODE_ENV !== 'production';
let ready: Promise<Sql> | undefined;
export function getLikesSql(): Promise<Sql> {
  ready ??= (async () => {
    let sql: Sql;
    if (process.env.LIKES_LOCAL_DATABASE && isLocalLikes()) {
      const { PGlite } = await import('@electric-sql/pglite');
      const pg = new PGlite(process.env.LIKES_LOCAL_DATABASE);
      await pg.waitReady;
      // Match Neon's tagged query API, including lazy transaction queries.
      type Query = { text: string; params: unknown[] };
      const deferred = (query: Query) => {
        let promise: Promise<Record<string, unknown>[]> | undefined;
        const execute = () =>
          (promise ??= pg
            .query<Record<string, unknown>>(query.text, query.params)
            .then((r) => r.rows));
        return {
          query,
          then: (
            yes: (rows: Record<string, unknown>[]) => unknown,
            no?: (error: unknown) => unknown,
          ) => execute().then(yes, no),
          catch: (no: (error: unknown) => unknown) => execute().catch(no),
          finally: (callback: () => void) => execute().finally(callback),
        };
      };
      const local = (strings: TemplateStringsArray, ...params: unknown[]) =>
        deferred({
          text: strings.reduce(
            (s, part, i) => s + (i ? `$${i}` : '') + part,
            '',
          ),
          params,
        });
      Object.assign(local, {
        query: (text: string, params: unknown[] = []) =>
          deferred({ text, params }),
        transaction: (queries: { query: Query }[]) =>
          pg.transaction(async (tx) => {
            const rows: Record<string, unknown>[][] = [];
            for (const { query } of queries)
              rows.push(
                (
                  await tx.query<Record<string, unknown>>(
                    query.text,
                    query.params,
                  )
                ).rows,
              );
            return rows;
          }),
      });
      sql = local as unknown as Sql;
    } else {
      if (process.env.LIKES_LOCAL_DATABASE)
        throw new LikesError(
          'Local storage cannot run on a deployed site',
          503,
        );
      sql = await requireSql();
    }
    for (const statement of LIKES_SCHEMA) await sql.query(statement);
    return sql;
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

export const likeInputSchema = z
  .object({
    kind: z.enum(['link', 'note', 'photo']).optional(),
    url: z.string().max(4096).optional(),
    text: z.string().max(30000).optional(),
    title: z.string().max(500).optional(),
    note: z.string().max(10000).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    source: z.string().max(80).optional(),
  })
  .strict();
export function normalizeLike(input: LikeInput) {
  const parsed = likeInputSchema.safeParse(input);
  if (!parsed.success)
    throw new LikesError(
      'Invalid item: ' +
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
    );
  const data = parsed.data;
  const kind =
    data.kind ??
    (data.url ? 'link' : data.attachmentIds?.length ? 'photo' : 'note');
  let url: string | null = null;
  if (data.url) {
    try {
      const u = new URL(data.url.trim());
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        throw new Error();
      for (const key of [...u.searchParams.keys()])
        if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
      u.hash = '';
      url = u.toString();
    } catch {
      throw new LikesError('Use a valid http or https URL without credentials');
    }
  }
  const text =
    data.text?.trim() || (kind === 'note' ? data.title?.trim() : '') || '';
  if (kind === 'link' && !url) throw new LikesError('A link needs a URL');
  if (kind === 'note' && !text) throw new LikesError('A note needs some text');
  if (kind === 'photo' && !data.attachmentIds?.length)
    throw new LikesError('Upload a photo before saving');
  return { ...data, kind, url, text, note: data.note?.trim() ?? '' };
}
export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stableJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function checkKey(key?: string) {
  if (
    key !== undefined &&
    (typeof key !== 'string' || !key.trim() || key.length > 200)
  )
    throw new LikesError('Invalid idempotency key');
}
const date = (value: unknown) =>
  value ? new Date(String(value)).toISOString() : null;
export function itemFromRow(
  r: Record<string, unknown>,
  attachments: LikeAttachment[] = [],
): LikedItem {
  return {
    id: String(r.id),
    kind: r.kind as LikedItem['kind'],
    url: r.url as string | null,
    originalText: String(r.original_text),
    title: String(r.title),
    note: String(r.note),
    category: String(r.category),
    tags: r.tags as string[],
    description: String(r.description),
    brand: r.brand as string | null,
    extractedText: String(r.extracted_text),
    identification: r.identification as LikedItem['identification'],
    webLookup: (r.web_lookup as LikedItem['webLookup']) ?? {
      status: 'none',
      sources: [],
      checkedAt: null,
    },
    status: r.status as LikedItem['status'],
    archiveStatus: r.archive_status as LikedItem['archiveStatus'],
    error: r.error as string | null,
    source: String(r.source),
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
    lastShownAt: date(r.last_shown_at),
    snoozedUntil: date(r.snoozed_until),
    dismissed: Boolean(r.dismissed),
    attachments,
  };
}
function attachmentFromRow(r: Record<string, unknown>): LikeAttachment {
  return {
    id: String(r.id),
    itemId: r.item_id as string | null,
    role: r.role as LikeAttachment['role'],
    filename: String(r.filename),
    contentType: String(r.content_type),
    bytes: Number(r.bytes),
    sha256: String(r.sha256),
    url: `/api/likes?op=asset&id=${r.id}`,
  };
}
function batchFromRow(r: Record<string, unknown>): ImportBatch {
  return {
    id: String(r.id),
    status: r.status as ImportBatch['status'],
    created: Number(r.created),
    duplicates: Number(r.duplicates),
    error: r.error as string | null,
    createdAt: date(r.created_at)!,
  };
}
export async function getLike(id: string): Promise<LikedItem | undefined> {
  const sql = await getLikesSql();
  const [r] = await sql`SELECT * FROM liked_items WHERE id=${id}`;
  if (!r) return undefined;
  const assets =
    await sql`SELECT * FROM likes_attachments WHERE item_id=${id} ORDER BY created_at`;
  return itemFromRow(r, assets.map(attachmentFromRow));
}
export async function listLikes({
  q = '',
  category = '',
  limit = 50,
  offset = 0,
}: { q?: string; category?: string; limit?: number; offset?: number } = {}) {
  if (
    q.length > 1000 ||
    category.length > 80 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new LikesError('Invalid search or pagination');
  const sql = await getLikesSql();
  const where = `($1='' OR to_tsvector('simple', title || ' ' || original_text || ' ' || note || ' ' || category || ' ' || description || ' ' || extracted_text) @@ plainto_tsquery('simple', $1) OR title ILIKE '%' || $1 || '%' OR $1=ANY(tags) OR url ILIKE '%' || $1 || '%') AND ($2='' OR category=$2)`;
  const [rows, count, cats] = await Promise.all([
    sql.query(
      `SELECT * FROM liked_items WHERE ${where} ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
      [q, category, limit, offset],
    ),
    sql.query(`SELECT count(*) AS count FROM liked_items WHERE ${where}`, [
      q,
      category,
    ]),
    sql`SELECT DISTINCT category FROM liked_items ORDER BY category`,
  ]);
  const ids = rows.map((r) => String(r.id));
  const assets = ids.length
    ? await sql`SELECT * FROM likes_attachments WHERE item_id=ANY(${ids}) ORDER BY created_at`
    : [];
  return {
    items: rows.map((r) =>
      itemFromRow(
        r,
        assets.filter((a) => a.item_id === r.id).map(attachmentFromRow),
      ),
    ),
    total: Number(count[0].count),
    categories: cats.map((r) => String(r.category)),
  };
}
export async function saveLike(
  input: LikeInput,
  idempotencyKey?: string,
  importId?: string,
): Promise<{
  item: LikedItem;
  duplicate: boolean;
  replayed?: boolean;
  originallyDuplicate?: boolean;
}> {
  checkKey(idempotencyKey);
  const data = normalizeLike(input);
  const sql = await getLikesSql();
  if (idempotencyKey) {
    const [old] =
      await sql`SELECT item_id,payload,duplicate FROM likes_captures WHERE idempotency_key=${idempotencyKey}`;
    if (old) {
      if (stableJson(old.payload) !== stableJson(data))
        throw new LikesError(
          'This idempotency key was used for a different item',
          409,
        );
      return {
        item: (await getLike(String(old.item_id)))!,
        duplicate: true,
        replayed: true,
        originallyDuplicate: Boolean(old.duplicate),
      };
    }
  }
  const attachmentIds = data.attachmentIds ?? [];
  const assets = attachmentIds.length
    ? await sql`SELECT * FROM likes_attachments WHERE id=ANY(${attachmentIds})`
    : [];
  if (
    assets.length !== attachmentIds.length ||
    assets.some((a) => a.role !== 'original' || a.item_id)
  )
    throw new LikesError(
      'Attachments must be existing, unused original uploads',
    );
  const fingerprint = hash(
    data.kind === 'link'
      ? `link:${data.url}`
      : data.kind === 'photo'
        ? `photo:${assets
            .map((a) => a.sha256)
            .sort()
            .join(':')}`
        : `note:${data.text}`,
  );
  const id = randomUUID();
  const title =
    data.title?.trim() ||
    (data.kind === 'link'
      ? new URL(data.url!).hostname
      : data.text.slice(0, 100) || 'Photo');
  const manual = ['title', 'category', 'tags'].filter(
    (k) => data[k as keyof typeof data] !== undefined,
  );
  // CTEs share one statement/transaction: retries never append the note twice,
  // and upload binding cannot race another save. Unique keys serialize dedupe.
  const result = await sql
    .query(
      `
    WITH valid AS MATERIALIZED (
      SELECT id FROM likes_attachments WHERE id=ANY($17::text[]) AND item_id IS NULL AND role='original' FOR UPDATE
    ), chosen AS (
      INSERT INTO liked_items (id,fingerprint,kind,url,original_text,title,note,category,tags,source,manual_fields,archive_status)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE (SELECT count(*) FROM valid)=$18
      ON CONFLICT(fingerprint) DO UPDATE SET
        note=CASE WHEN $7='' OR liked_items.note=$7 THEN liked_items.note
          WHEN liked_items.note='' THEN $7 ELSE liked_items.note || E'\\n\\n' || $7 END,
        updated_at=now()
      RETURNING id
    ), capture AS (
      INSERT INTO likes_captures(id,item_id,idempotency_key,payload,import_id,duplicate)
      SELECT $13,id,$14,$15::jsonb,$16,id<>$1 FROM chosen RETURNING item_id,duplicate
    ), bound AS (
      UPDATE likes_attachments SET item_id=(SELECT id FROM chosen)
      WHERE id IN (SELECT id FROM valid) AND EXISTS(SELECT 1 FROM capture) RETURNING id
    ) SELECT item_id,duplicate, (SELECT count(*) FROM bound) AS bound FROM capture`,
      [
        id,
        fingerprint,
        data.kind,
        data.url,
        data.text,
        title,
        data.note,
        data.category ?? 'uncategorized',
        data.tags ?? [],
        data.source ?? 'web',
        manual,
        data.kind === 'link' ? 'pending' : 'none',
        randomUUID(),
        idempotencyKey ?? null,
        JSON.stringify(data),
        importId ?? null,
        attachmentIds,
        attachmentIds.length,
      ],
    )
    .catch(async (error) => {
      if (
        idempotencyKey &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) {
        const [existing] =
          await sql`SELECT item_id,payload,duplicate FROM likes_captures WHERE idempotency_key=${idempotencyKey}`;
        if (existing && stableJson(existing.payload) === stableJson(data))
          return [
            {
              item_id: existing.item_id,
              duplicate: existing.duplicate,
              bound: attachmentIds.length,
              replayed: true,
            },
          ];
        if (existing)
          throw new LikesError(
            'This idempotency key was used for a different item',
            409,
          );
      }
      throw error;
    });
  if (!result.length || Number(result[0].bound) !== attachmentIds.length)
    throw new LikesError(
      'An upload was already attached; retry with the original idempotency key',
      409,
    );
  return {
    item: (await getLike(String(result[0].item_id)))!,
    duplicate: Boolean(result[0].duplicate) || Boolean(result[0].replayed),
    ...(result[0].replayed
      ? { replayed: true, originallyDuplicate: Boolean(result[0].duplicate) }
      : {}),
  };
}
/** A photo retry must reuse its original upload rather than manufacture new IDs. */
export async function savePhotoLike(
  input: LikeInput,
  photo: { data: Uint8Array; filename: string; contentType: string },
  idempotencyKey?: string,
) {
  checkKey(idempotencyKey);
  await validateUpload(photo.contentType, photo.data);
  const sql = await getLikesSql();
  const replay = async () => {
    if (!idempotencyKey) return undefined;
    const [capture] =
      await sql`SELECT item_id,payload FROM likes_captures WHERE idempotency_key=${idempotencyKey}`;
    if (!capture) return undefined;
    const saved = capture.payload as LikeInput;
    const ids = saved.attachmentIds ?? [];
    const rows =
      await sql`SELECT sha256 FROM likes_attachments WHERE id=ANY(${ids}) AND item_id=${capture.item_id}`;
    if (!rows.some((r) => r.sha256 === hash(photo.data)))
      throw new LikesError(
        'This idempotency key was used for a different photo',
        409,
      );
    return saveLike(
      { ...input, kind: input.kind ?? 'photo', attachmentIds: ids },
      idempotencyKey,
    );
  };
  const existing = await replay();
  if (existing) return existing;
  const attachment = await saveAttachment({ role: 'original', ...photo });
  try {
    return await saveLike(
      {
        ...input,
        kind: input.kind ?? 'photo',
        attachmentIds: [...(input.attachmentIds ?? []), attachment.id],
      },
      idempotencyKey,
    );
  } catch (error) {
    const concurrent = await replay();
    if (concurrent) return concurrent;
    throw error;
  }
}
const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    note: z.string().max(10000).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    brand: z.string().trim().min(1).max(160).nullable().optional(),
    description: z.string().trim().max(2000).optional(),
    snoozedUntil: z.string().datetime().nullable().optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();
export async function updateLike(
  id: string,
  patch: z.infer<typeof patchSchema>,
) {
  const p = patchSchema.safeParse(patch);
  if (!p.success) throw new LikesError('Invalid item changes');
  const fields: Record<string, string> = {
    title: 'title',
    note: 'note',
    category: 'category',
    tags: 'tags',
    brand: 'brand',
    description: 'description',
    snoozedUntil: 'snoozed_until',
    dismissed: 'dismissed',
  };
  const pairs = Object.entries(p.data);
  if (!pairs.length) throw new LikesError('No changes supplied');
  const manual = pairs
    .filter(([key]) =>
      ['title', 'category', 'tags', 'note', 'brand', 'description'].includes(
        key,
      ),
    )
    .map(([key]) => key);
  const sql = await getLikesSql();
  const rows = await sql.query(
    `UPDATE liked_items SET ${pairs.map(([key], i) => `${fields[key]}=$${i + 2}`).join(',')}, manual_fields=ARRAY(SELECT DISTINCT unnest(manual_fields || $${pairs.length + 2}::text[])),updated_at=now() WHERE id=$1 RETURNING id`,
    [id, ...pairs.map(([, value]) => value), manual],
  );
  if (!rows.length) throw new LikesError('Item not found', 404);
  return (await getLike(id))!;
}
export async function retryLike(id: string) {
  const sql = await getLikesSql();
  const rows =
    await sql`UPDATE liked_items SET status='pending',attempts=0,error=NULL,available_at=now(),updated_at=now() WHERE id=${id} AND (lease_until IS NULL OR lease_until<now()) RETURNING id`;
  if (!rows.length)
    throw new LikesError('Item not found or already processing', 409);
  return (await getLike(id))!;
}
export async function startImport(
  text: string,
  idempotencyKey?: string,
): Promise<ImportBatch> {
  checkKey(idempotencyKey);
  if (typeof text !== 'string' || !text.trim() || text.length > 100000)
    throw new LikesError('Paste between 1 and 100,000 characters of notes');
  const sql = await getLikesSql();
  const [r] =
    await sql`INSERT INTO likes_imports(id,idempotency_key,original_text) VALUES (${randomUUID()},${idempotencyKey ?? null},${text}) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`;
  if (r.original_text !== text)
    throw new LikesError(
      'This idempotency key was used for different notes',
      409,
    );
  return batchFromRow(r);
}
export async function getImport(id: string): Promise<ImportBatch | undefined> {
  const sql = await getLikesSql();
  const [r] = await sql`SELECT * FROM likes_imports WHERE id=${id}`;
  return r ? batchFromRow(r) : undefined;
}
export async function getSettings(): Promise<LikesSettings> {
  const sql = await getLikesSql();
  const [r] = await sql`SELECT * FROM likes_settings WHERE id=1`;
  return {
    digestEnabled: Boolean(r.digest_enabled),
    digestCount: Number(r.digest_count),
  };
}
export async function updateSettings(patch: Partial<LikesSettings>) {
  const p = z
    .object({
      digestEnabled: z.boolean().optional(),
      digestCount: z.number().int().min(1).max(10).optional(),
    })
    .strict()
    .safeParse(patch);
  if (!p.success) throw new LikesError('Invalid settings');
  const sql = await getLikesSql();
  await sql`UPDATE likes_settings SET digest_enabled=coalesce(${p.data.digestEnabled ?? null}::boolean,digest_enabled),digest_count=coalesce(${p.data.digestCount ?? null}::integer,digest_count) WHERE id=1`;
  return getSettings();
}
function safeFilename(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 120) || 'file'
  );
}
export async function validateUpload(contentType: string, data: Uint8Array) {
  if (!data.length || data.length > 10 * 1024 * 1024)
    throw new LikesError('Uploads must be nonempty and at most 10 MB');
  const b = Buffer.from(data);
  const matches =
    contentType === 'image/jpeg'
      ? b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : contentType === 'image/png'
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : contentType === 'image/webp'
          ? b.toString('ascii', 0, 4) === 'RIFF' &&
            b.toString('ascii', 8, 12) === 'WEBP'
          : contentType === 'image/gif'
            ? /^GIF8[79]a/.test(b.toString('ascii', 0, 6))
            : contentType === 'application/pdf'
              ? b.toString('ascii', 0, 5) === '%PDF-'
              : contentType === 'text/plain';
  if (!matches)
    throw new LikesError(
      'Use a JPEG, PNG, WebP, GIF, PDF, or text file matching its file type. Convert HEIC photos to JPEG first.',
    );
  if (contentType.startsWith('image/')) {
    try {
      // Decode pixels (metadata alone also accepts truncated headers), keeping
      // memory bounded even for a decompression bomb. Store original bytes.
      await sharp(data, { failOn: 'error', limitInputPixels: 25000000 })
        .resize(1, 1)
        .png()
        .toBuffer();
    } catch {
      throw new LikesError(
        'This image is corrupt or exceeds 25 megapixels. Save a smaller JPEG or PNG and try again.',
      );
    }
  }
}
export async function saveAttachment({
  itemId,
  role,
  filename,
  contentType,
  data,
  signal,
}: {
  itemId?: string | null;
  role: LikeAttachment['role'];
  filename: string;
  contentType: string;
  data: Uint8Array;
  signal?: AbortSignal;
}): Promise<LikeAttachment> {
  signal?.throwIfAborted();
  if (role === 'original') await validateUpload(contentType, data);
  if (!data.length || data.length > 20 * 1024 * 1024)
    throw new LikesError('File exceeds the 20 MB archive limit');
  if (itemId && !(await getLike(itemId)))
    throw new LikesError('Item not found', 404);
  signal?.throwIfAborted();
  const id = randomUUID();
  const name = safeFilename(filename);
  const key = `likes/${id}/${name}`;
  let storageKey: string;
  let backend: string;
  if (process.env.LIKES_LOCAL_STORAGE && isLocalLikes()) {
    storageKey = join(resolve(process.env.LIKES_LOCAL_STORAGE), id);
    await mkdir(resolve(process.env.LIKES_LOCAL_STORAGE), { recursive: true });
    await writeFile(storageKey, data, { mode: 0o600, flag: 'wx', signal });
    backend = 'local';
  } else {
    const hasReadWriteToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
    const hasOidcCredentials = Boolean(
      process.env.VERCEL_OIDC_TOKEN?.trim() &&
        process.env.BLOB_STORE_ID?.trim(),
    );
    if (!hasReadWriteToken && !hasOidcCredentials)
      throw new LikesError('Private file storage is not configured', 503);
    const blob = await put(key, Buffer.from(data), {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      abortSignal: signal,
    });
    storageKey = blob.url;
    backend = 'blob';
  }
  const sql = await getLikesSql();
  signal?.throwIfAborted();
  const [row] =
    await sql`INSERT INTO likes_attachments(id,item_id,role,filename,content_type,bytes,sha256,storage_key,backend) VALUES (${id},${itemId ?? null},${role},${name},${contentType},${data.length},${hash(data)},${storageKey},${backend}) RETURNING *`;
  return attachmentFromRow(row);
}
export async function readAttachment(
  id: string,
  signal?: AbortSignal,
): Promise<{ attachment: LikeAttachment; data: Uint8Array }> {
  signal?.throwIfAborted();
  const sql = await getLikesSql();
  const [r] = await sql`SELECT * FROM likes_attachments WHERE id=${id}`;
  if (!r) throw new LikesError('File not found', 404);
  signal?.throwIfAborted();
  let data: Uint8Array;
  if (r.backend === 'local' && isLocalLikes())
    data = new Uint8Array(await readFile(String(r.storage_key), { signal }));
  else if (r.backend === 'blob') {
    const blob = await get(String(r.storage_key), {
      access: 'private',
      abortSignal: signal,
    });
    if (!blob || blob.statusCode !== 200)
      throw new LikesError('Stored file is unavailable', 502);
    data = new Uint8Array(
      await new Response(
        blob.stream as unknown as ReadableStream,
      ).arrayBuffer(),
    );
  } else throw new LikesError('File storage is unavailable', 503);
  signal?.throwIfAborted();
  if (data.length !== Number(r.bytes) || hash(data) !== r.sha256)
    throw new LikesError('File integrity check failed', 502);
  return { attachment: attachmentFromRow(r), data };
}
