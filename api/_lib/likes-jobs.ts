import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import type { LikeInput, LikedItem } from '../../shared/likes.js';
import { enrichLike, splitNotes } from './likes-enrichment.js';
import {
  getLike,
  getLikesSql,
  saveLike,
  hash,
  stableJson,
  LikesError,
} from './likes-store.js';

const MAX_ATTEMPTS = 3;
const safeError = (error: unknown) =>
  error instanceof LikesError
    ? error.message
    : 'Could not finish processing. Your original is saved; retry to try again.';
export async function retryImport(id: string) {
  const sql = await getLikesSql();
  const rows =
    await sql`UPDATE likes_imports SET status='pending',attempts=0,error=NULL,available_at=now() WHERE id=${id} AND (lease_until IS NULL OR lease_until<now()) RETURNING id`;
  if (!rows.length)
    throw new LikesError('Import not found or already processing', 409);
}
export async function processLikes({
  limit = 5,
  budgetMs = 200000,
}: { limit?: number; budgetMs?: number } = {}) {
  const sql = await getLikesSql();
  const deadline = Date.now() + Math.min(budgetMs, 240000);
  const stats = { processed: 0, failed: 0, imported: 0 };
  // Expired workers relinquish their leases; a lost result cannot overwrite a
  // newer worker's outcome. Every final write carries its lease UUID.
  while (
    stats.processed + stats.failed < Math.min(limit, 20) &&
    Date.now() < deadline
  ) {
    const lease = randomUUID();
    const [batch] = await sql`
      UPDATE likes_imports SET status='processing',lease_id=${lease},lease_until=now()+interval '5 minutes',attempts=attempts+1
      WHERE id=(SELECT id FROM likes_imports WHERE (status='pending' OR (status='processing' AND lease_until<now())) AND attempts<${MAX_ATTEMPTS} AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    if (batch) {
      try {
        let parsed = (batch.parsed_items as LikeInput[] | null) ?? [];
        if (!batch.parse_complete) {
          const original = String(batch.original_text);
          const parseCursor = Number(batch.parse_cursor);
          const remaining = original.slice(parseCursor);
          let boundary = Math.min(6000, remaining.length);
          if (remaining.length > boundary) {
            const paragraph = remaining.lastIndexOf('\n\n', boundary);
            const line = remaining.lastIndexOf('\n', boundary);
            const space = remaining.lastIndexOf(' ', boundary);
            boundary =
              paragraph > 3000
                ? paragraph
                : line > 3000
                  ? line
                  : space > 0
                    ? space
                    : boundary;
          }
          const part = remaining.slice(0, boundary);
          const extracted = await splitNotes(
            part,
            `${batch.id}:${parseCursor}`,
          );
          if (!extracted.length)
            throw new LikesError(
              'No individual items could be extracted. Your pasted text is saved.',
            );
          parsed = [...parsed, ...extracted];
          const nextCursor = parseCursor + part.length;
          const complete = nextCursor >= original.length;
          const written =
            await sql`UPDATE likes_imports SET parsed_items=${JSON.stringify(parsed)}::jsonb,parse_cursor=${nextCursor},parse_complete=${complete} WHERE id=${batch.id} AND lease_id=${lease} RETURNING id`;
          if (!written.length) continue;
          if (!complete) {
            await sql`UPDATE likes_imports SET status='pending',lease_id=NULL,lease_until=NULL,attempts=0,error=NULL WHERE id=${batch.id} AND lease_id=${lease}`;
            stats.processed++;
            continue;
          }
        }
        let cursor = Number(batch.cursor);
        let created = Number(batch.created);
        let duplicates = Number(batch.duplicates);
        for (; cursor < parsed.length && Date.now() < deadline; cursor++) {
          const input = { ...parsed[cursor], source: 'notes-backfill' };
          const result = await saveLike(
            input,
            `import:${batch.id}:${cursor}:${hash(stableJson(input))}`,
            String(batch.id),
          );
          const wasDuplicate = result.originallyDuplicate ?? result.duplicate;
          created += Number(!wasDuplicate);
          duplicates += Number(wasDuplicate);
          const rows =
            await sql`UPDATE likes_imports SET cursor=${cursor + 1},created=${created},duplicates=${duplicates} WHERE id=${batch.id} AND lease_id=${lease} RETURNING id`;
          if (!rows.length) break;
          stats.imported++;
        }
        await sql`UPDATE likes_imports SET status=${cursor >= parsed.length ? 'ready' : 'pending'},lease_id=NULL,lease_until=NULL,attempts=CASE WHEN ${cursor >= parsed.length} THEN attempts ELSE 0 END,error=NULL WHERE id=${batch.id} AND lease_id=${lease}`;
        stats.processed++;
      } catch (error) {
        console.warn(
          'Likes import processing failed:',
          error instanceof Error ? error.name : 'unknown',
        );
        await sql`UPDATE likes_imports SET status=${Number(batch.attempts) >= MAX_ATTEMPTS ? 'failed' : 'pending'},error=${safeError(error)},available_at=now()+interval '5 minutes',lease_id=NULL,lease_until=NULL WHERE id=${batch.id} AND lease_id=${lease}`;
        stats.failed++;
      }
      continue;
    }
    const [row] = await sql`
      UPDATE liked_items SET status='processing',lease_id=${lease},lease_until=now()+interval '5 minutes',attempts=attempts+1
      WHERE id=(SELECT id FROM liked_items WHERE (status='pending' OR (status='processing' AND lease_until<now())) AND attempts<${MAX_ATTEMPTS} AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,attempts`;
    if (!row) break;
    try {
      const item = (await getLike(String(row.id)))!;
      const patch = await enrichLike(item);
      const fields: Record<string, string> = {
        title: 'title',
        category: 'category',
        tags: 'tags',
        description: 'description',
        brand: 'brand',
        extractedText: 'extracted_text',
        identification: 'identification',
        archiveStatus: 'archive_status',
        error: 'error',
      };
      const manual = new Set(['title', 'category', 'tags']);
      const values: unknown[] = [item.id, lease];
      const assignments = Object.entries(fields)
        .filter(([field]) => patch[field as keyof LikedItem] !== undefined)
        .map(([field, column]) => {
          values.push(patch[field as keyof LikedItem]);
          const arg = `$${values.length}`;
          return manual.has(field)
            ? `${column}=CASE WHEN '${field}'=ANY(manual_fields) THEN ${column} ELSE ${arg} END`
            : `${column}=${arg}`;
        });
      const failed = patch.status === 'failed';
      values.push(
        failed
          ? Number(row.attempts) >= MAX_ATTEMPTS
            ? 'failed'
            : 'pending'
          : 'ready',
      );
      await sql.query(
        `UPDATE liked_items SET ${assignments.length ? assignments.join(',') + ',' : ''} status=$${values.length},available_at=CASE WHEN $${values.length}='pending' THEN now()+interval '5 minutes' ELSE available_at END,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2`,
        values,
      );
      if (failed) stats.failed++;
      else stats.processed++;
    } catch (error) {
      console.warn(
        'Like processing failed:',
        error instanceof Error ? error.name : 'unknown',
      );
      await sql`UPDATE liked_items SET status=${Number(row.attempts) >= MAX_ATTEMPTS ? 'failed' : 'pending'},error=${safeError(error)},available_at=now()+interval '5 minutes',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=${row.id} AND lease_id=${lease}`;
      stats.failed++;
    }
  }
  // Expired last-attempt workers otherwise get stuck in 'processing' forever.
  await sql`UPDATE liked_items SET status='failed',error='Processing timed out. Your original is saved; retry to try again.',lease_id=NULL,lease_until=NULL WHERE status='processing' AND lease_until<now() AND attempts>=${MAX_ATTEMPTS}`;
  await sql`UPDATE likes_imports SET status='failed',error='Import timed out. Your original text is saved; retry to continue.',lease_id=NULL,lease_until=NULL WHERE status='processing' AND lease_until<now() AND attempts>=${MAX_ATTEMPTS}`;
  const [[items], [imports]] = await Promise.all([
    sql`SELECT count(*) AS count FROM liked_items WHERE status IN ('pending','processing')`,
    sql`SELECT count(*) AS count FROM likes_imports WHERE status IN ('pending','processing')`,
  ]);
  return { ...stats, pending: Number(items.count) + Number(imports.count) };
}
let kicked = false;
export function kickLikes() {
  if (kicked) return;
  kicked = true;
  const work = processLikes({ limit: 10, budgetMs: 220000 })
    .catch(() => {})
    .finally(() => {
      kicked = false;
    });
  if (process.env.VERCEL) waitUntil(work);
}
