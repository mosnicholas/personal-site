import { secretsMatch } from './_lib/auth.js';
import { fetchArticle, updateDocument } from './_lib/readwise.js';
import { classifyDocument } from './_lib/tagging.js';
import { getTaxonomy } from './_lib/taxonomy.js';

/**
 * Readwise Reader Webhook Handler
 *
 * Receives Readwise Reader webhooks when new documents are saved, tags them
 * from the existing taxonomy (see _lib/taxonomy.ts), and writes the tags back.
 *
 * Subscribe it to `reader.any_document.created` (or the feed / non-feed
 * variants). Readwise sends the document fields at the top level of the JSON
 * body, along with `event_type` and the webhook `secret`.
 * Docs: https://docs.readwise.io/readwise/docs/webhooks
 */

interface WebhookPayload {
  event_type?: string;
  secret?: string;
  id?: string;
  url?: string;
  title?: string;
  author?: string | null;
  summary?: string | null;
}

const errorResponse = (error: string, status: number, details?: string) =>
  Response.json({ error, details }, { status });

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const expectedSecret = process.env.READWISE_WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.error('READWISE_WEBHOOK_SECRET is not set - rejecting webhook');
      return errorResponse('Webhook not configured', 500);
    }

    const payload = (await request
      .json()
      .catch(() => null)) as WebhookPayload | null;
    if (!payload) {
      return errorResponse('Invalid JSON body', 400);
    }

    // Readwise puts the secret in the body; the headers support manual testing
    const providedSecret =
      payload.secret ??
      request.headers.get('x-webhook-secret') ??
      request.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!secretsMatch(providedSecret, expectedSecret)) {
      return errorResponse('Unauthorized - invalid webhook secret', 401);
    }

    // Only tag new documents. Writing tags triggers `tags_updated`, so
    // reacting to other events could loop forever.
    if (
      payload.event_type &&
      !payload.event_type.endsWith('document.created')
    ) {
      return Response.json({ skipped: true, eventType: payload.event_type });
    }

    if (!payload.id || !payload.url || !payload.title) {
      return errorResponse(
        'Missing required fields',
        400,
        'Payload must include id, url, and title',
      );
    }

    try {
      console.log(`Processing article: ${payload.title} (${payload.id})`);

      // Readwise may have a better summary than the webhook payload
      let articleSummary = payload.summary;
      try {
        const fullArticle = await fetchArticle(payload.id);
        if (fullArticle?.summary) {
          articleSummary = fullArticle.summary;
        }
      } catch (fetchError) {
        console.warn(
          'Could not fetch full article, using webhook payload:',
          fetchError,
        );
      }

      const tags = await classifyDocument(
        {
          title: payload.title,
          author: payload.author ?? null,
          summary: articleSummary ?? null,
          url: payload.url,
        },
        await getTaxonomy(),
      );

      await updateDocument(payload.id, { tags });
      console.log(`Tagged ${payload.id}:`, tags);

      return Response.json({ success: true, documentId: payload.id, tags });
    } catch (error) {
      console.error('Error processing webhook:', error);
      return errorResponse(
        'Failed to process webhook',
        500,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  },
};
