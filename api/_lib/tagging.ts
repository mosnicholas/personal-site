/**
 * Article tagging with Claude Haiku 4.5. It reuses existing tags where they
 * fit and creates new ones when nothing covers a main topic - the taxonomy is
 * still growing. It sees each tag's document count and glossary definition,
 * and the weekly rebalance merges any duplicates it creates.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import { tracedCall } from './traces.js';
import { normalizeTag, OTHER_TAG, type TaxonomyTag } from './taxonomy.js';

const TAGGING_MODEL = 'claude-haiku-5-5';
const MAX_TAGS = 5;

const SYSTEM_PROMPT = `You tag documents in a personal reading library so related reading can be found together. Give each document 1-${MAX_TAGS} tags naming its main topics, most relevant first, not things it only mentions in passing.

Reuse tags from the library's existing tags whenever one fits. Each line there is a tag, how many documents use it, and what it covers; prefer well-used tags and follow the definitions to choose between neighbors. Create a new tag only when no existing tag covers a main topic. New tags are lowercase kebab-case, specific enough to be useful and broad enough that other documents could share them (\`startup-fundraising\`, not \`series-a-term-sheet-tips\`).

If you can't tell what the document is about, return only \`other\`.`;

export interface TaggableDocument {
  title: string;
  author: string | null;
  url: string;
  /** Ours when we have one (summarize.ts), otherwise Readwise's */
  summary: string | null;
  keyPoints?: string[];
}

// One line per tag: `name (documents): definition`
const formatTaxonomy = (taxonomy: TaxonomyTag[]) =>
  taxonomy
    .map(
      ({ name, documents, definition }) =>
        `${name}${documents === undefined ? '' : ` (${documents})`}${definition ? `: ${definition}` : ''}`,
    )
    .join('\n');

/**
 * Picks tags for a document, preferring the existing `taxonomy`
 */
export async function classifyDocument(
  documentId: string,
  document: TaggableDocument,
  taxonomy: TaxonomyTag[],
): Promise<string[]> {
  const request = {
    model: TAGGING_MODEL,
    // Room for thinking before the tags
    max_tokens: 4096,
    system: [
      { type: 'text' as const, text: SYSTEM_PROMPT },
      // The same for every document, so cache it across calls (a backfill
      // tags hundreds in a row)
      {
        type: 'text' as const,
        text: `Existing tags:\n${formatTaxonomy(taxonomy) || '(none yet)'}`,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify({ document }, null, 2),
      },
    ],
    output_config: {
      effort: 'low' as const,
      format: {
        type: 'json_schema' as const,
        schema: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['tags'],
          additionalProperties: false,
        },
      },
    },
  } satisfies Anthropic.MessageCreateParamsNonStreaming;

  return tracedCall(
    { kind: 'tagging', subjectId: documentId, model: TAGGING_MODEL, request },
    () => getAnthropic().messages.create(request),
    (response) => {
      if (response.stop_reason === 'refusal') {
        throw new Error('Tagging request was declined');
      }
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      const { tags } = JSON.parse(text) as { tags: string[] };

      const picked = [...new Set(tags.map(normalizeTag))]
        .filter((tag) => tag && tag !== OTHER_TAG)
        .slice(0, MAX_TAGS);
      return picked.length > 0 ? picked : [OTHER_TAG];
    },
  );
}
