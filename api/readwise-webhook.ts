import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchArticle, updateDocument } from './lib/readwise.js';
import { generateTags } from './lib/openrouter.js';

/**
 * Readwise Reader Webhook Handler
 *
 * This endpoint receives webhooks from Readwise Reader when new articles are saved.
 * It generates AI-powered tags and updates the article in Readwise.
 *
 * Webhook payload from Readwise:
 * - id: Document ID
 * - url: Article URL
 * - title: Article title
 * - author: Article author
 * - summary: Article summary
 */

interface WebhookPayload {
  id: string;
  url: string;
  title: string;
  author?: string;
  summary?: string;
}

interface SuccessResponse {
  success: true;
  documentId: string;
  tags: string[];
  primaryTag: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

function validateWebhookSecret(req: VercelRequest): boolean {
  const secret = process.env.READWISE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('READWISE_WEBHOOK_SECRET not configured - skipping validation');
    return true;
  }

  // Check for secret in various locations
  const providedSecret =
    req.headers['x-webhook-secret'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    (req.body as { secret?: string })?.secret;

  return providedSecret === secret;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<SuccessResponse | ErrorResponse>
) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Webhook-Secret, Content-Type, Authorization'
  );

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate webhook secret
  if (!validateWebhookSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized - invalid webhook secret' });
  }

  try {
    const payload = req.body as WebhookPayload;

    // Validate required fields
    if (!payload.id || !payload.url || !payload.title) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'Payload must include id, url, and title',
      });
    }

    console.log(`Processing article: ${payload.title} (${payload.id})`);

    // Fetch full article content from Readwise for better context
    let articleSummary = payload.summary;
    try {
      const fullArticle = await fetchArticle(payload.id);
      if (fullArticle.summary) {
        articleSummary = fullArticle.summary;
      }
    } catch (fetchError) {
      console.warn('Could not fetch full article, using webhook payload:', fetchError);
    }

    // Generate tags using LLM
    const tagResult = await generateTags({
      title: payload.title,
      author: payload.author ?? null,
      summary: articleSummary ?? null,
      url: payload.url,
    });

    console.log(`Generated tags for ${payload.id}:`, tagResult.tags);

    // Update the article in Readwise with generated tags
    // Remove # prefix from tags for Readwise API
    const cleanTags = tagResult.tags.map((tag) => tag.replace(/^#/, ''));

    await updateDocument(payload.id, {
      tags: cleanTags,
      notes: tagResult.notes,
    });

    console.log(`Updated article ${payload.id} with tags`);

    return res.status(200).json({
      success: true,
      documentId: payload.id,
      tags: tagResult.tags,
      primaryTag: tagResult.primary_tag,
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({
      error: 'Failed to process webhook',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
