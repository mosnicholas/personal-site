import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchArticles, saveDocument } from './lib/readwise.js';
import { generateWeeklySummary } from './lib/openrouter.js';
import { sendWeeklySummary } from './lib/email.js';

/**
 * Weekly Reading Summary Cron Handler
 *
 * This endpoint is triggered by Vercel cron (every Sunday at 9am UTC).
 * It fetches articles from the past 7 days, generates an AI-powered summary,
 * and sends it via email.
 *
 * Can also be triggered manually via GET request with optional query params:
 * - days: Number of days to look back (default: 7)
 * - save: Whether to save summary to Readwise (default: true)
 * - email: Whether to send email (default: true)
 */

interface SuccessResponse {
  success: true;
  articlesProcessed: number;
  emailSent: boolean;
  savedToReadwise: boolean;
  subject: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

function validateCronSecret(req: VercelRequest): boolean {
  // Vercel cron jobs include this header
  const cronSecret = req.headers['authorization'];

  // Allow if it's a Vercel cron job
  if (cronSecret === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }

  // Allow manual triggers in development or with valid secret
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Check for manual trigger authorization
  const manualSecret = req.query.secret || req.headers['x-cron-secret'];
  if (manualSecret === process.env.CRON_SECRET) {
    return true;
  }

  return false;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<SuccessResponse | ErrorResponse>
) {
  // Only allow GET requests (cron triggers via GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate cron secret (optional - can be disabled for testing)
  if (process.env.CRON_SECRET && !validateCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Parse query parameters for manual triggers
    const daysBack = parseInt(req.query.days as string) || 7;
    const shouldSendEmail = req.query.email !== 'false';
    const shouldSaveToReadwise = req.query.save !== 'false';

    console.log(`Generating weekly summary for last ${daysBack} days`);

    // Calculate date range
    const updatedAfter = new Date();
    updatedAfter.setDate(updatedAfter.getDate() - daysBack);

    // Fetch articles from Readwise
    const articles = await fetchArticles(updatedAfter);

    if (articles.length === 0) {
      console.log('No articles found in the specified time range');
      return res.status(200).json({
        success: true,
        articlesProcessed: 0,
        emailSent: false,
        savedToReadwise: false,
        subject: 'No articles to summarize',
      });
    }

    console.log(`Found ${articles.length} articles to summarize`);

    // Filter to articles with meaningful content
    const articlesToSummarize = articles.filter((a) =>
      a.category === 'article' ||
      a.category === 'email' ||
      a.category === 'pdf' ||
      a.reading_progress > 0.1 // Include items with at least 10% progress
    );

    console.log(`${articlesToSummarize.length} articles meet criteria for summary`);

    // Generate summary using LLM
    const summary = await generateWeeklySummary(
      articlesToSummarize.map((a) => ({
        title: a.title,
        author: a.author,
        url: a.url,
        summary: a.summary,
        tags: a.tags,
        reading_progress: a.reading_progress,
      }))
    );

    console.log(`Generated summary with subject: ${summary.subject}`);

    let emailSent = false;
    let savedToReadwise = false;

    // Send email
    if (shouldSendEmail) {
      try {
        await sendWeeklySummary(summary.html, summary.subject);
        emailSent = true;
        console.log('Email sent successfully');
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    // Save summary to Readwise as a note
    if (shouldSaveToReadwise) {
      try {
        const today = new Date().toISOString().split('T')[0];
        await saveDocument({
          url: `https://nimo.dev/reading-summary/${today}`,
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
        // Don't fail the whole request if save fails
      }
    }

    return res.status(200).json({
      success: true,
      articlesProcessed: articlesToSummarize.length,
      emailSent,
      savedToReadwise,
      subject: summary.subject,
    });
  } catch (error) {
    console.error('Error generating weekly summary:', error);
    return res.status(500).json({
      error: 'Failed to generate weekly summary',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
