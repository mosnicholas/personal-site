import { rejectUnauthorizedCron } from './_lib/auth.js';
import { defineTags, writeBriefs } from './_lib/glossary.js';
import { loggedCron } from './_lib/traces.js';

/**
 * Tag Glossary Cron Handler
 *
 * Triggered by Vercel cron on Sundays at 8am UTC, after the 7am rebalance and
 * before the 9am summary (see vercel.json), with
 * `Authorization: Bearer $CRON_SECRET`. Claude Opus 5.5 defines the tags that
 * are new and places them in the existing clusters, then Claude Sonnet 5.5
 * writes briefs for tags that have grown enough (see _lib/glossary.ts). A full
 * pass, defining and clustering every tag again, runs when the last one is
 * over 27 days old. Options:
 * - redefine: Force the full pass (default: false)
 */

// Vercel stops functions at 300s; a brief in flight can take a minute
const TIME_BUDGET_MS = 220_000;

export default loggedCron('tag-glossary', {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const unauthorized = rejectUnauthorizedCron(request);
    if (unauthorized) return unauthorized;

    try {
      const deadline = Date.now() + TIME_BUDGET_MS;
      const force =
        new URL(request.url).searchParams.get('redefine') === 'true';

      const definitions = await defineTags({ force });
      const briefs = await writeBriefs(deadline);

      const report = {
        success: true,
        definitions,
        briefs,
        incomplete: briefs.remaining > 0,
      };
      console.log('Glossary report:', JSON.stringify(report));
      return Response.json(report);
    } catch (error) {
      console.error('Error updating the tag glossary:', error);
      return Response.json(
        {
          error: 'Failed to update the tag glossary',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  },
});
