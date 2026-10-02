/**
 * Our own document summaries, written by Claude Haiku 4.5 from the full text.
 * They replace Readwise's summaries everywhere we read one (tagging, the
 * weekly summary, the synthesis, the rebalance, tag briefs), so we control
 * their shape: specific claims, not just the topic.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import type { OurSummary } from './documents.js';
import { tracedCall } from './traces.js';

export const SUMMARY_MODEL = 'claude-haiku-4-5';
// About 10k tokens: enough for most articles, and it bounds the cost
const MAX_TEXT_CHARS = 40_000;
// Below this there's nothing worth summarizing beyond the title
export const MIN_TEXT_CHARS = 200;

const SYSTEM_PROMPT = `You summarize documents for a personal reading library. People read these summaries instead of the documents, a tagger files documents by them, and they're synthesized across many documents later, so be specific: name the actual claims, numbers, examples, and conclusions, not just the topic.

Return:
- summary: 2 to 4 sentences on what the document argues or covers and why it matters. Plain prose; don't open with "This article" or "The author".
- key_points: 3 to 6 specific takeaways, one sentence each.

If the text is cut off, summarize what's there. If it's mostly navigation, ads, or boilerplate, summarize the substance you can find and keep it short.`;

export interface SummarizableDocument {
  title: string;
  author: string | null;
  site: string | null;
  category: string;
}

/**
 * Crude HTML to text: enough for a model to read, without a dependency
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&amp;/g, '&')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function summarizeDocument(
  documentId: string,
  document: SummarizableDocument,
  text: string,
): Promise<OurSummary> {
  const truncated = text.length > MAX_TEXT_CHARS;
  const request = {
    model: SUMMARY_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify({
          ...document,
          text: truncated
            ? `${text.slice(0, MAX_TEXT_CHARS)} […cut off]`
            : text,
        }),
      },
    ],
    output_config: {
      format: {
        type: 'json_schema' as const,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            key_points: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary', 'key_points'],
          additionalProperties: false,
        },
      },
    },
  } satisfies Anthropic.MessageCreateParamsNonStreaming;

  return tracedCall(
    {
      kind: 'document_summary',
      subjectId: documentId,
      model: SUMMARY_MODEL,
      request,
    },
    () => getAnthropic().messages.create(request),
    (response) => {
      if (response.stop_reason === 'refusal') {
        throw new Error('Summary request was declined');
      }
      const output = JSON.parse(
        response.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(''),
      ) as { summary: string; key_points: string[] };
      return {
        summary: output.summary.trim(),
        keyPoints: output.key_points
          .map((point) => point.trim())
          .filter(Boolean),
      };
    },
  );
}
