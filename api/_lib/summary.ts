/**
 * Weekly reading summary, written by Claude Opus 5.5
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import { tracedCall } from './traces.js';

const SUMMARY_MODEL = 'claude-opus-5-5';

export interface WeeklySummaryResult {
  html: string;
  subject: string;
  /** The Readwise documents the summary covers */
  articleIds: string[];
}

/**
 * Generate weekly reading summary using Claude Opus 5.5
 */
export async function generateWeeklySummary(
  articles: {
    id: string;
    title: string;
    author: string | null;
    url: string;
    summary: string | null;
    tags: Record<string, unknown>;
    reading_progress: number;
  }[],
): Promise<WeeklySummaryResult> {
  const systemPrompt = `You are acting as a CTO and Executive Coach, analyzing a week's worth of reading to extract insights and actionable learnings.

Your analysis should be comprehensive and include these 10 sections:

1. **Executive Brief** - 3-4 sentence overview of the week's reading themes
2. **Per-Article Learnings** - Key insight from each article (1-2 sentences each)
3. **Emerging Themes** - 3-5 patterns or themes across the reading
4. **Principles** - Timeless principles reinforced or discovered
5. **Tactics** - Specific, actionable tactics that can be applied immediately
6. **Failure Modes** - Common mistakes or anti-patterns to avoid
7. **Implications** - What these learnings mean for strategy and decisions
8. **Language & Metaphors** - Useful mental models or ways of explaining concepts
9. **Action Items** - 3-5 concrete next steps based on the reading
10. **Open Questions** - Thought-provoking questions raised by the reading

Format your response as clean HTML suitable for email. Use semantic tags like <h2>, <ul>, <li>, <p>, <strong>, <em>.
Include a compelling email subject line at the very start, formatted as: SUBJECT: Your subject here

Then provide the HTML content.`;

  const articleList = articles
    .map(
      (a, i) =>
        `${i + 1}. "${a.title}" by ${a.author ?? 'Unknown'}
   URL: ${a.url}
   Progress: ${Math.round(a.reading_progress * 100)}%
   Summary: ${a.summary ?? 'No summary'}
   Tags: ${Object.keys(a.tags).join(', ') || 'None'}`,
    )
    .join('\n\n');

  const userPrompt = `Analyze these ${articles.length} articles from this week's reading:

${articleList}

Generate a comprehensive weekly reading summary.`;

  const request = {
    model: SUMMARY_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' as const },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: systemPrompt,
    messages: [{ role: 'user' as const, content: userPrompt }],
  };

  return tracedCall(
    {
      kind: 'weekly_summary',
      subjectId: new Date().toISOString().split('T')[0],
      model: SUMMARY_MODEL,
      request,
    },
    // Streaming keeps a long response from hitting HTTP timeouts
    () => getAnthropic().beta.messages.stream(request).finalMessage(),
    (message) =>
      parseSummary(
        message,
        articles.map((a) => a.id),
      ),
  );
}

function parseSummary(
  message: Anthropic.Beta.Messages.BetaMessage,
  articleIds: string[],
): WeeklySummaryResult {
  if (message.stop_reason === 'refusal') {
    throw new Error(
      `Summary request was declined (${message.stop_details?.category ?? 'no category'})`,
    );
  }
  if (message.stop_reason === 'max_tokens') {
    console.warn('Summary hit max_tokens - the email may be cut off');
  }

  const response = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n');

  // Extract subject line
  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const subject =
    subjectMatch?.[1]?.trim() ??
    `Weekly Reading Summary - ${new Date().toLocaleDateString()}`;

  // Extract HTML content (everything after the subject line), minus any code fence
  let html = response
    .replace(/SUBJECT:\s*.+?(?:\n|$)/i, '')
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '');

  // Wrap in basic email template if not already wrapped
  if (
    !html.toLowerCase().includes('<!doctype') &&
    !html.toLowerCase().includes('<html')
  ) {
    html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 10px; }
    h2 { color: #2a2a2a; margin-top: 30px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    a { color: #0066cc; }
    .article-link { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
  }

  return { html, subject, articleIds };
}
