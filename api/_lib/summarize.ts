/**
 * Our own document summaries, written by Claude Sonnet 5.5 from the full text.
 * They replace Readwise's summaries everywhere we read one (tagging, the
 * rebalance, tag briefs, and the emails for documents whose full text
 * doesn't fit), so we control their shape: specific claims, at whatever
 * length the document needs.
 */

import { getAnthropic } from './anthropic.js';
import type { OurSummary } from './documents.js';
import { tracedCall } from './traces.js';

export const SUMMARY_MODEL = 'claude-sonnet-5-5';
// Stored with each summary; bump it when the prompt changes and the daily
// sync redoes every summary written by an older version
export const SUMMARY_VERSION = `${SUMMARY_MODEL}/2`;
// About 150k tokens: whole articles and long reports; books are cut off
const MAX_TEXT_CHARS = 600_000;
// Below this there's nothing worth summarizing beyond the title
export const MIN_TEXT_CHARS = 200;

const SYSTEM_PROMPT = `You summarize documents for a personal reading library. The summary stands in for the document: the reader may never open the original, a tagger files documents by their summaries, and summaries are synthesized across many documents later. So be specific: the actual arguments, claims, evidence, numbers, examples, and conclusions, not just the topic.

Let the document set the length. A short post may need two or three sentences; a long essay, paper, or report needs several paragraphs that follow its structure and keep its reasoning. Don't pad a thin document or squeeze a dense one.

Return:
- summary: plain prose, with paragraphs separated by blank lines. Don't open with "This article" or "The author".
- key_points: the document's most important specific takeaways, one sentence each, as many as it actually has.

If the text is cut off, summarize what's there and say it's partial. If it's mostly navigation, ads, or boilerplate, summarize the substance you can find and keep it short.`;

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
    // Room for thinking plus a long summary of a long document
    max_tokens: 32000,
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
      effort: 'medium' as const,
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
  };

  return tracedCall(
    {
      kind: 'document_summary',
      subjectId: documentId,
      model: SUMMARY_MODEL,
      request,
    },
    // Streaming keeps a long response from hitting HTTP timeouts
    () => getAnthropic().messages.stream(request).finalMessage(),
    (response) => {
      if (
        response.stop_reason === 'refusal' ||
        response.stop_reason === 'max_tokens'
      ) {
        throw new Error(`Summary incomplete (${response.stop_reason})`);
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
