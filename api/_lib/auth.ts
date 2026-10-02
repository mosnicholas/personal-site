import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for shared secrets.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Guards cron endpoints, which Vercel calls with `Authorization: Bearer
 * $CRON_SECRET`; manual runs send the same header. Returns an error response
 * to send back, or undefined when the request may proceed.
 *
 * Fails closed: without a secret anyone could trigger LLM calls and writes.
 * Local `vercel dev` runs are the only exception.
 */
export function rejectUnauthorizedCron(request: Request): Response | undefined {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.VERCEL_ENV === 'development') return undefined;
    console.error('CRON_SECRET is not set - rejecting request');
    return Response.json({ error: 'Cron not configured' }, { status: 500 });
  }
  if (
    !secretsMatch(request.headers.get('authorization'), `Bearer ${cronSecret}`)
  ) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return undefined;
}
