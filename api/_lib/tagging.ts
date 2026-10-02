/**
 * Article tagging with Claude Haiku 4.5. It reuses existing tags where they
 * fit and creates new ones when nothing covers a main topic - the taxonomy is
 * still growing. The weekly rebalance merges any duplicates this creates.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import { tracedCall } from './traces.js';
import { normalizeTag, OTHER_TAG } from './taxonomy.js';

const TAGGING_MODEL = 'claude-haiku-4-5';
const MAX_TAGS = 5;

const SYSTEM_PROMPT = `You tag documents in a personal reading library so related reading can be found together. Give each document 1-${MAX_TAGS} tags naming its main topics, most relevant first, not things it only mentions in passing.

Reuse tags from \`existing_tags\` whenever one fits; that list is the library's taxonomy. Create a new tag only when no existing tag covers a main topic. New tags are lowercase kebab-case, specific enough to be useful and broad enough that other documents could share them (\`startup-fundraising\`, not \`series-a-term-sheet-tips\`).

If you can't tell what the document is about, return only \`other\`.`;

export interface TaggableDocument {
  title: string;
  author: string | null;
  url: string;
  summary: string | null;
}

/**
 * Picks tags for a document, preferring the existing `taxonomy`
 */
export async function classifyDocument(
  documentId: string,
  document: TaggableDocument,
  taxonomy: string[],
): Promise<string[]> {
  const request = {
    model: TAGGING_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify({ existing_tags: taxonomy, document }, null, 2),
      },
    ],
    output_config: {
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
