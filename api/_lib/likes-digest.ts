import { randomUUID } from 'node:crypto';
import { escapeHtml } from './email.js';
import { likesOrigin } from './likes-auth.js';
import { getSettings, getLikesSql, LikesError } from './likes-store.js';

export async function sendLikesDigest({
  dryRun = false,
}: { dryRun?: boolean } = {}) {
  const settings = await getSettings();
  if (!settings.digestEnabled) return { sent: false, reason: 'disabled' };
  const sql = await getLikesSql();
  // UTC week identity matches the Vercel cron schedule and is independent of
  // deployment timezone. A successful week is never mailed a second time.
  const [clock] =
    await sql`SELECT date_trunc('week',now())::date::text AS week`;
  const week = String(clock.week);
  const lease = randomUUID();
  const [run] =
    await sql`INSERT INTO likes_digest_runs(week,status,lease_id,lease_until) VALUES (${week},'processing',${lease},now()+interval '5 minutes') ON CONFLICT(week) DO UPDATE SET status='processing',lease_id=excluded.lease_id,lease_until=excluded.lease_until WHERE likes_digest_runs.status<>'sent' AND (likes_digest_runs.lease_until IS NULL OR likes_digest_runs.lease_until<now()) RETURNING item_ids`;
  if (!run) return { sent: false, reason: 'already sent or processing' };
  let ids = run.item_ids as string[];
  try {
    let rows;
    if (ids.length)
      rows =
        await sql`SELECT * FROM liked_items WHERE id=ANY(${ids}) AND NOT dismissed AND (snoozed_until IS NULL OR snoozed_until<=now()) ORDER BY last_shown_at ASC NULLS FIRST,created_at,id`;
    else
      rows =
        await sql`SELECT * FROM liked_items WHERE NOT dismissed AND (snoozed_until IS NULL OR snoozed_until<=now()) AND created_at<=now()-interval '7 days' ORDER BY last_shown_at ASC NULLS FIRST,created_at,id LIMIT ${settings.digestCount}`;
    if (!rows.length || dryRun) {
      await sql`UPDATE likes_digest_runs SET status='pending',lease_id=NULL,lease_until=NULL WHERE week=${week} AND lease_id=${lease}`;
      return {
        sent: false,
        reason: dryRun ? 'dry run' : 'no eligible older items',
        items: rows.map((r) => ({ id: r.id, title: r.title })),
      };
    }
    ids = rows.map((r) => String(r.id));
    await sql`UPDATE likes_digest_runs SET item_ids=${ids} WHERE week=${week} AND lease_id=${lease}`;
    const recipient = process.env.WEEKLY_SUMMARY_RECIPIENT_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;
    if (!recipient || !apiKey)
      throw new LikesError('Email is not configured', 503);
    const html = `<html><body><h1>A few things you liked</h1>${rows.map((r) => `<section><h2><a href="${escapeHtml(likesOrigin() + '/likes?item=' + r.id)}">${escapeHtml(String(r.title))}</a></h2><p>${escapeHtml(String(r.note || r.description || r.original_text))}</p><small>${escapeHtml(String(r.category))}</small></section>`).join('')}<p><a href="${escapeHtml(likesOrigin() + '/likes')}">Open your collection to snooze, dismiss, or change email settings</a></p></body></html>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `nimo-likes-${week}`,
      },
      body: JSON.stringify({
        from: 'Things I like <reader@nimo.fyi>',
        to: recipient,
        subject: 'A few things you liked',
        html,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new LikesError(
        'Email delivery failed; this week can be retried',
        502,
      );
    await sql.transaction([
      sql`UPDATE liked_items SET last_shown_at=now() WHERE id=ANY(${ids}) AND EXISTS(SELECT 1 FROM likes_digest_runs WHERE week=${week} AND lease_id=${lease})`,
      sql`UPDATE likes_digest_runs SET status='sent',sent_at=now(),error=NULL,lease_id=NULL,lease_until=NULL WHERE week=${week} AND lease_id=${lease}`,
    ]);
    return { sent: true, count: ids.length };
  } catch (error) {
    await sql`UPDATE likes_digest_runs SET status='pending',lease_id=NULL,lease_until=NULL,error='Email delivery failed' WHERE week=${week} AND lease_id=${lease}`;
    throw error;
  }
}
