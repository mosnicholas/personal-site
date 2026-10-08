/**
 * The monthly likes email: a few things I saved over a month ago, the ones
 * emailed least recently first, to remember them by. Run by the cron in
 * api/likes.ts (`?op=digest`).
 */

import { likeTitle, type Like } from '../../shared/likes.js';
import { requireSql } from './db.js';
import { escapeHtml, sendReadingEmail } from './email.js';
import { likeFromRow } from './likes.js';

const LIKES_PER_EMAIL = 5;
const SITE = 'https://nimo.fyi';

async function likesToResurface(): Promise<Like[]> {
  const sql = requireSql();
  const rows = await sql`
    SELECT * FROM likes
    WHERE status = 'ready' AND created_at < now() - interval '30 days'
    ORDER BY emailed_at NULLS FIRST, random()
    LIMIT ${LIKES_PER_EMAIL}`;
  return rows.map(likeFromRow);
}

function likeHtml(like: Like): string {
  const link = `${SITE}/likes?item=${like.id}`;
  const image = like.imageUrl
    ? `<img src="${escapeHtml(like.imageUrl)}" alt="" style="max-width: 240px; max-height: 180px">`
    : '';
  const note = like.note
    ? `<p style="margin: 4px 0; color: #666">Why: ${escapeHtml(like.note)}</p>`
    : '';
  return `
<div style="margin: 28px 0">
  ${image}
  <h2 style="font-size: 16px; margin: 8px 0 4px">
    <a href="${escapeHtml(link)}">${escapeHtml(likeTitle(like))}</a>
  </h2>
  <p style="margin: 0">${escapeHtml(like.description)}</p>
  ${note}
</div>`;
}

export function digestHtml(likes: Like[]): string {
  return `<div style="font-family: sans-serif; font-size: 14px">
${likes.map(likeHtml).join('\n')}
<p><a href="${SITE}/likes">All your likes</a></p>
</div>`;
}

export async function sendLikesDigest(): Promise<{ sent: number }> {
  const likes = await likesToResurface();
  if (likes.length === 0) return { sent: 0 };

  await sendReadingEmail({
    fromName: 'Things I like',
    subject: 'Some things you liked',
    html: digestHtml(likes),
  });
  const sql = requireSql();
  await sql`
    UPDATE likes SET emailed_at = now()
    WHERE id = ANY(${likes.map((like) => like.id)})`;
  return { sent: likes.length };
}
