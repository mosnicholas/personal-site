import { rejectUnauthorizedCron } from './_lib/auth.js';
import { rebalanceTags } from './_lib/rebalance.js';
import { loggedCron } from './_lib/traces.js';

/**
 * Weekly Tag Rebalance Cron Handler
 *
 * Triggered by Vercel cron (Sundays at 7am UTC, before the 9am summary; see
 * vercel.json) with `Authorization: Bearer $CRON_SECRET`. Tags documents the
 * webhook missed, merges duplicate tags, and sorts the `other` bucket. See
 * _lib/rebalance.ts.
 *
 * Can also be triggered manually with the same Authorization header:
 * - days: How far back to look for untagged documents (default: 8, max: 3650).
 *   A large value backfills the whole library over a few runs.
 */

const DEFAULT_SWEEP_DAYS = 8;
const MAX_SWEEP_DAYS = 3650;
// Vercel stops functions at 300s; leave time to write the updates
const TIME_BUDGET_MS = 220_000;

export default loggedCron('rebalance-tags', {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const unauthorized = rejectUnauthorizedCron(request);
    if (unauthorized) return unauthorized;

    try {
      const requestedDays =
        Number.parseInt(
          new URL(request.url).searchParams.get('days') ?? '',
          10,
        ) || DEFAULT_SWEEP_DAYS;
      const report = await rebalanceTags({
        sweepDays: Math.min(Math.max(requestedDays, 1), MAX_SWEEP_DAYS),
        deadline: Date.now() + TIME_BUDGET_MS,
      });
      console.log('Rebalance report:', JSON.stringify(report));
      return Response.json({ success: true, ...report });
    } catch (error) {
      console.error('Error rebalancing tags:', error);
      return Response.json(
        {
          error: 'Failed to rebalance tags',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  },
});
