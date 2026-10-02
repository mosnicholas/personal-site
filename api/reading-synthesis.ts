import { rejectUnauthorizedCron } from './_lib/auth.js';
import { sendReadingEmail } from './_lib/email.js';
import { type Article, fetchArticles, type Location } from './_lib/readwise.js';
import {
  buildSynthesisRequest,
  generateSynthesis,
  prepareDocuments,
} from './_lib/synthesis.js';

/**
 * Reading Synthesis Cron Handler
 *
 * Triggered by Vercel cron on the 1st of each month at 10am UTC (see
 * vercel.json) with `Authorization: Bearer $CRON_SECRET`. Emails a synthesis
 * of everything saved to the library in the window (see _lib/synthesis.ts).
 * Feed items are left out unless they were saved to the library.
 *
 * Can also be triggered manually with the same Authorization header:
 * - days: How far back to look (default: 90, max: 183)
 * - email: Whether to send the email (default: true)
 * - dry_run: Report what the model would get, without calling it
 */

// Each month looks back a quarter, for the longer arc rather than one month
const DEFAULT_DAYS = 90;
const MAX_DAYS = 183;
const LIBRARY_LOCATIONS: Location[] = ['new', 'later', 'shortlist', 'archive'];

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const unauthorized = rejectUnauthorizedCron(request);
    if (unauthorized) return unauthorized;

    try {
      const params = new URL(request.url).searchParams;
      const requestedDays =
        Number.parseInt(params.get('days') ?? '', 10) || DEFAULT_DAYS;
      const days = Math.min(Math.max(requestedDays, 1), MAX_DAYS);
      const shouldSendEmail = params.get('email') !== 'false';
      const dryRun = params.get('dry_run') === 'true';

      const until = new Date();
      const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

      // Everything saved in the window. `updatedAfter` narrows the listing;
      // `saved_at` decides, since rewriting tags also bumps `updated_at`
      const savedInWindow = (doc: Article) =>
        Date.parse(doc.saved_at ?? doc.created_at) >= since.getTime();
      const documents: Article[] = [];
      for (const location of LIBRARY_LOCATIONS) {
        const inLocation = await fetchArticles({
          updatedAfter: since,
          location,
        });
        documents.push(
          ...inLocation.filter(
            (doc) =>
              savedInWindow(doc) &&
              !doc.parent_id &&
              doc.category !== 'highlight' &&
              doc.category !== 'note',
          ),
        );
      }

      // Highlights show what mattered; the synthesis works without them
      let highlights: Article[] = [];
      try {
        highlights = await fetchArticles({
          updatedAfter: since,
          category: 'highlight',
        });
      } catch (error) {
        console.warn('Could not load highlights:', error);
      }

      const prepared = prepareDocuments(documents, highlights);
      const synthesisRequest = buildSynthesisRequest(prepared, since, until);
      const inputChars =
        synthesisRequest.system.length +
        synthesisRequest.messages[0].content.length;
      console.log(
        `Synthesis over ${days} days: ${prepared.length} documents, ~${Math.round(inputChars / 4)} input tokens`,
      );

      if (prepared.length === 0) {
        return Response.json({ success: true, days, documents: 0 });
      }

      if (dryRun) {
        const byMonth: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        for (const doc of prepared) {
          byMonth[doc.saved.slice(0, 7)] =
            (byMonth[doc.saved.slice(0, 7)] ?? 0) + 1;
          const status = doc.read.startsWith('started') ? 'started' : doc.read;
          byStatus[status] = (byStatus[status] ?? 0) + 1;
        }
        return Response.json({
          success: true,
          dryRun: true,
          days,
          documents: prepared.length,
          withHighlights: prepared.filter((doc) => doc.highlights).length,
          byMonth,
          byStatus,
          approxInputTokens: Math.round(inputChars / 4),
        });
      }

      const subjectId = `${until.toISOString().slice(0, 10)}/${days}d`;
      const synthesis = await generateSynthesis(synthesisRequest, subjectId);
      console.log(`Generated synthesis: ${synthesis.subject}`);

      let emailSent = false;
      if (shouldSendEmail) {
        try {
          await sendReadingEmail({
            fromName: 'Reading Synthesis',
            subject: synthesis.subject,
            html: synthesis.html,
          });
          emailSent = true;
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
        }
      }

      return Response.json({
        success: true,
        days,
        documents: prepared.length,
        emailSent,
        subject: synthesis.subject,
      });
    } catch (error) {
      console.error('Error generating reading synthesis:', error);
      return Response.json(
        {
          error: 'Failed to generate reading synthesis',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  },
};
