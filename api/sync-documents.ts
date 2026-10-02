import { rejectUnauthorizedCron } from './_lib/auth.js';
import { summarizeMissing, syncDocuments } from './_lib/sync.js';

/**
 * Library Sync Cron Handler
 *
 * Triggered by Vercel cron daily at 6am UTC (see vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. Copies documents that changed in
 * Readwise into the `documents` mirror, then writes our summaries for saved
 * documents that don't have one (see _lib/sync.ts).
 *
 * The first run backfills the whole library; it takes several runs, each
 * resuming where the last stopped. Run it by hand with the same header until
 * `incomplete` is false. Options:
 * - summarize: Whether to write summaries this run (default: true)
 */

// Vercel stops functions at 300s; a summary in flight can take a minute
const TIME_BUDGET_MS = 220_000;
// Leave most of the budget for summaries once the listing is caught up
const LISTING_SHARE = 0.5;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const unauthorized = rejectUnauthorizedCron(request);
    if (unauthorized) return unauthorized;

    try {
      const started = Date.now();
      const deadline = started + TIME_BUDGET_MS;
      const shouldSummarize =
        new URL(request.url).searchParams.get('summarize') !== 'false';

      const listing = await syncDocuments(
        shouldSummarize ? started + TIME_BUDGET_MS * LISTING_SHARE : deadline,
      );
      const summaries = shouldSummarize
        ? await summarizeMissing(deadline)
        : undefined;

      const report = {
        success: true,
        listing,
        summaries,
        incomplete: !listing.complete || (summaries?.remaining ?? 0) > 0,
      };
      console.log('Sync report:', JSON.stringify(report));
      return Response.json(report);
    } catch (error) {
      console.error('Error syncing documents:', error);
      return Response.json(
        {
          error: 'Failed to sync documents',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  },
};
