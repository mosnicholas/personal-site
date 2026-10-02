import { secretsMatch } from './_lib/auth.js';
import {
  type OurSummary,
  saveDocumentSummary,
  setDocumentTags,
  upsertDocuments,
} from './_lib/documents.js';
import { fetchArticle, updateDocument } from './_lib/readwise.js';
import {
  htmlToText,
  MIN_TEXT_CHARS,
  SUMMARY_MODEL,
  summarizeDocument,
} from './_lib/summarize.js';
import { classifyDocument } from './_lib/tagging.js';
import { getTaxonomy } from './_lib/taxonomy.js';

/**
 * Readwise Reader Webhook Handler
 *
 * Receives Readwise Reader webhooks when new documents are saved. For saved
 * (non-feed) documents it writes our summary from the full text
 * (_lib/summarize.ts); then it tags the document against the taxonomy
 * (_lib/taxonomy.ts), writes the tags back, and records it all in the mirror
 * (_lib/documents.ts). If the full text isn't ready yet, the daily sync writes
 * the summary later.
 *
 * Subscribe it to one created event, `reader.any_document.created` (what you
 * save and every feed item), or `reader.non_feed_document.created` (only what
 * you save). Each checked event is a separate delivery, so checking several
 * tags a document several times. Readwise sends the document fields at the top level of the
 * JSON body, along with `event_type` and the webhook `secret`.
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

    const payload = (await request
      .json()
      .catch(() => null)) as WebhookPayload | null;

    // Only tag new documents. Writing tags triggers `tags_updated`, so
    // reacting to other events could loop forever. Skipping does nothing, so
    // it needs no secret. That includes bodies that aren't JSON events, like
    // Readwise's "Test Endpoint" request, which must get a 2xx.
    if (!payload?.event_type?.endsWith('document.created')) {
      return Response.json({ skipped: true, eventType: payload?.event_type });
    }

    // Readwise only shows the secret after the webhook is created, and it
    // won't create one until the endpoint answers its test. Until the secret
    // is set, acknowledge events without acting on them.
    const expectedSecret = process.env.READWISE_WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.warn('READWISE_WEBHOOK_SECRET is not set - ignoring webhook');
      return Response.json({
        skipped: true,
        reason: 'READWISE_WEBHOOK_SECRET is not set',
      });
    }

    // Readwise puts the secret in the body; the headers support manual testing
    const providedSecret =
      payload.secret ??
      request.headers.get('x-webhook-secret') ??
      request.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!secretsMatch(providedSecret, expectedSecret)) {
      return errorResponse('Unauthorized - invalid webhook secret', 401);
    }

    if (!payload.id || !payload.url || !payload.title) {
      return errorResponse(
        'Missing required fields',
        400,
        'Payload must include id, url, and title',
      );
    }

    try {
      console.log(
        `Processing ${payload.event_type}: ${payload.title} (${payload.id})`,
      );

      // The full document: Readwise's summary may be better than the
      // payload's, and the HTML is what we summarize
      const article = await fetchArticle(payload.id, {
        withHtmlContent: true,
      }).catch((fetchError: unknown) => {
        console.warn(
          'Could not fetch the article, using the payload:',
          fetchError,
        );
        return undefined;
      });
      if (article) {
        await upsertDocuments([article]).catch((dbError: unknown) =>
          console.warn('Could not save the document:', dbError),
        );
      }

      let ours: OurSummary | undefined;
      const text = htmlToText(article?.html_content ?? '');
      if (
        article &&
        article.location !== 'feed' &&
        text.length >= MIN_TEXT_CHARS
      ) {
        try {
          ours = await summarizeDocument(
            payload.id,
            {
              title: article.title,
              author: article.author,
              site: article.site_name,
              category: article.category,
            },
            text,
          );
          await saveDocumentSummary(payload.id, ours, SUMMARY_MODEL);
        } catch (summaryError) {
          // The daily sync tries again; tag from Readwise's summary for now
          console.warn('Could not summarize the article:', summaryError);
        }
      }

      const tags = await classifyDocument(
        payload.id,
        {
          title: payload.title,
          author: payload.author ?? null,
          summary: ours?.summary ?? article?.summary ?? payload.summary ?? null,
          keyPoints: ours?.keyPoints,
          url: payload.url,
        },
        await getTaxonomy(),
      );

      await updateDocument(payload.id, { tags });
      await setDocumentTags([{ id: payload.id, tags }]).catch(
        (dbError: unknown) => console.warn('Could not save the tags:', dbError),
      );
      console.log(`Tagged ${payload.id}${ours ? ' (summarized)' : ''}:`, tags);

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
