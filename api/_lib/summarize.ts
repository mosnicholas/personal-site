/**
 * Our own document summaries, written by Claude Sonnet 5.5 from the full text.
 * They replace Readwise's summaries everywhere we read one (tagging, the
 * rebalance, tag briefs, and the emails for documents whose full text
 * doesn't fit). The prompt says what the summaries are for and leaves length
 * to the model: length rules made models wordier in testing elsewhere, and an
 * earlier prompt that told it the summary "stands in for the document" got
 * full-length paraphrases of short posts. Documents too short to shorten (a
 * tweet) are their own summary, with no model call.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import type { OurSummary } from './documents.js';
import { tracedCall } from './traces.js';

export const SUMMARY_MODEL = 'claude-sonnet-5-5';
// Stored with each summary, so you can tell which prompt wrote it; bump it
// when the prompt or model changes. Existing summaries stay as they are
// unless regenerated on purpose (`?redo=true` on /api/sync-documents)
export const SUMMARY_VERSION = `${SUMMARY_MODEL}/5`;
// About 150k tokens: whole articles and long reports; books are cut off
const MAX_TEXT_CHARS = 600_000;
// Below this there's nothing worth summarizing beyond the title
export const MIN_TEXT_CHARS = 200;
// Up to this length (a tweet, a short thread) the text is its own summary: it
// reads in about a minute. Tested on 35 documents, the model's summaries of
// posts this short ran 50-85% of their length whatever the prompt said
export const VERBATIM_MAX_WORDS = 300;

export const countWords = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;

export const SYSTEM_PROMPT = `You summarize documents for a personal reading library. The reader saves far more than they can read, and uses these summaries to recall what each piece said and to decide which are worth reading in full. Models also read them to tag and connect documents. Write the summary that serves that: the main points and what supports them, specific rather than vague, and much quicker to read than the document itself.

The reader skims, so make it easy to take in: lead with the main point, and give it whatever structure fits the content, such as short paragraphs or a list. If the text is cut off, summarize what's there and say it's partial. If it's mostly navigation, ads, or boilerplate, summarize the substance you can find.`;

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

/**
 * The summary request for a document. `system` is only swapped by the eval
 * scripts (scripts/eval), to compare a prompt change on the exact request
 */
export function summaryRequest(
  document: SummarizableDocument,
  text: string,
  system = SYSTEM_PROMPT,
) {
  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    model: SUMMARY_MODEL,
    // Room for thinking plus a long summary of a long document
    max_tokens: 32000,
    system,
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
          properties: { summary: { type: 'string' } },
          required: ['summary'],
          additionalProperties: false,
        },
      },
    },
  };
}

/** The summary from a response to summaryRequest */
export function readSummary(response: Anthropic.Message): OurSummary {
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
  ) as { summary: string };
  // Key points are no longer asked for: they repeated the summary
  return { summary: output.summary.trim(), keyPoints: [] };
}

export async function summarizeDocument(
  documentId: string,
  document: SummarizableDocument,
  text: string,
): Promise<OurSummary> {
  if (countWords(text) <= VERBATIM_MAX_WORDS) {
    return { summary: text.trim(), keyPoints: [] };
  }
  const request = summaryRequest(document, text);
  return tracedCall(
    {
      kind: 'document_summary',
      subjectId: documentId,
      model: SUMMARY_MODEL,
      request,
    },
    // Streaming keeps a long response from hitting HTTP timeouts
    () => getAnthropic().messages.stream(request).finalMessage(),
    readSummary,
  );
}
