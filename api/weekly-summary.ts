import { rejectUnauthorizedCron } from './_lib/auth.js';
import { documentTexts, ourSummaries } from './_lib/documents.js';
import { sendReadingEmail } from './_lib/email.js';
import { fetchArticles, saveDocument } from './_lib/readwise.js';
import {
  generateWeeklySummary,
  WEEKLY_TEXT_BUDGET_CHARS,
} from './_lib/summary.js';
import { describeTraceStorage } from './_lib/traces.js';

/**
 * Weekly Reading Summary Cron Handler
 *
 * Triggered by Vercel cron (every Sunday at 9am UTC, see vercel.json), which
 * sends `Authorization: Bearer $CRON_SECRET`. Fetches articles saved or opened
 * in the past 7 days, generates an AI-powered summary, and emails it.
 *
 * Can also be triggered manually with the same Authorization header and
 * optional query params:
 * - days: Number of days to look back (default: 7, max: 31)
 * - save: Whether to save summary to Readwise (default: true)
 * - email: Whether to send email (default: true)
 */

const MAX_DAYS = 31;

const errorResponse = (error: string, status: number, details?: string) =>
  Response.json({ error, details }, { status });

export default {
  async fetch(request: Request): Promise<Response> {
    // Vercel cron triggers via GET
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const unauthorized = rejectUnauthorizedCron(request);
    if (unauthorized) return unauthorized;

    try {
      const params = new URL(request.url).searchParams;
      const requestedDays = Number.parseInt(params.get('days') ?? '', 10) || 7;
      const daysBack = Math.min(Math.max(requestedDays, 1), MAX_DAYS);
      const shouldSendEmail = params.get('email') !== 'false';
      const shouldSaveToReadwise = params.get('save') !== 'false';

      console.log(`Generating weekly summary for last ${daysBack} days`);

      const updatedAfter = new Date();
      updatedAfter.setDate(updatedAfter.getDate() - daysBack);

      const articles = await fetchArticles({ updatedAfter });
      console.log(`Found ${articles.length} documents in the time range`);

      // `updatedAfter` also matches old documents whose tags were just
      // rewritten (by the Sunday rebalance or a backfill), so keep only what
      // was saved or opened in the window
      const since = updatedAfter.getTime();
      const inWindow = (date: string | null) =>
        date !== null && Date.parse(date) >= since;

      // Filter to articles with meaningful content
      const articlesToSummarize = articles.filter(
        (a) =>
          (inWindow(a.saved_at) || inWindow(a.last_opened_at)) &&
          (a.category === 'article' ||
            a.category === 'email' ||
            a.category === 'pdf' ||
            a.reading_progress > 0.1), // Include items with at least 10% progress
      );

      console.log(
        `${articlesToSummarize.length} articles meet criteria for summary`,
      );

      if (articlesToSummarize.length === 0) {
        return Response.json({
          success: true,
          articlesProcessed: 0,
          emailSent: false,
          savedToReadwise: false,
          subject: 'No articles to summarize',
        });
      }

      // Our summaries where we have them, and full texts as far as they fit
      const ids = articlesToSummarize.map((a) => a.id);
      const ours = await ourSummaries(ids);
      const texts = await documentTexts(ids, WEEKLY_TEXT_BUDGET_CHARS);
      const summary = await generateWeeklySummary(
        articlesToSummarize.map((a) => ({
          id: a.id,
          title: a.title,
          author: a.author,
          url: a.url,
          summary: ours.get(a.id)?.summary ?? a.summary,
          keyPoints: ours.get(a.id)?.keyPoints,
          text: texts.get(a.id),
          tags: a.tags,
          reading_progress: a.reading_progress,
        })),
      );

      console.log(`Generated summary with subject: ${summary.subject}`);

      let emailSent = false;
      let savedToReadwise = false;

      // A failed email or save shouldn't fail the whole run
      if (shouldSendEmail) {
        try {
          // The trace database gives no warning before it fills up, so the
          // email reports how full it is
          await sendReadingEmail({
            fromName: 'Weekly Reading',
            subject: summary.subject,
            html: summary.html,
            footer: await describeTraceStorage(),
          });
          emailSent = true;
          console.log('Email sent successfully');
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
        }
      }

      if (shouldSaveToReadwise) {
        try {
          const today = new Date().toISOString().split('T')[0];
          await saveDocument({
            url: `https://nimo.fyi/reading-summary/${today}`,
            title: summary.subject,
            html: summary.html,
            should_clean_html: false,
            category: 'note',
            location: 'archive',
            saved_using: 'Weekly Summary Bot',
            tags: ['weekly-summary', 'reading-notes'],
          });
          savedToReadwise = true;
          console.log('Summary saved to Readwise');
        } catch (saveError) {
          console.error('Failed to save to Readwise:', saveError);
        }
      }

      return Response.json({
        success: true,
        articlesProcessed: articlesToSummarize.length,
        emailSent,
        savedToReadwise,
        subject: summary.subject,
      });
    } catch (error) {
      console.error('Error generating weekly summary:', error);
      return errorResponse(
        'Failed to generate weekly summary',
        500,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  },
};
