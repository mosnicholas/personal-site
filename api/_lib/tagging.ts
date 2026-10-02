/**
 * Article tagging with Claude Haiku 4.5, limited to the existing taxonomy:
 * structured outputs make the current tags and `other` the only values the
 * model can return, so it can't invent tags.
 */

import { getAnthropic } from './anthropic.js';
import { OTHER_TAG } from './taxonomy.js';

const TAGGING_MODEL = 'claude-haiku-4-5';
const MAX_TAGS = 5;

const SYSTEM_PROMPT = `You tag documents in a personal reading library. From \`allowed_tags\`, pick the tags that name a main topic of the document, not something it only mentions in passing. Use at most ${MAX_TAGS}, most relevant first.

Also add \`other\` when the document's main subject isn't covered by any allowed tag, even if some tags apply. If none apply, return only \`other\`.`;

export interface TaggableDocument {
  title: string;
  author: string | null;
  url: string;
  summary: string | null;
}

/**
 * Picks tags for a document from `taxonomy`. Includes `other` when nothing
 * fits or the document's main subject has no tag yet.
 */
export async function classifyDocument(
  document: TaggableDocument,
  taxonomy: string[],
): Promise<string[]> {
  if (taxonomy.length === 0) return [OTHER_TAG];

  const response = await getAnthropic().messages.create({
    model: TAGGING_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ allowed_tags: taxonomy, document }, null, 2),
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string', enum: [...taxonomy, OTHER_TAG] },
            },
          },
          required: ['tags'],
          additionalProperties: false,
        },
      },
    },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Tagging request was declined');
  }

  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  const { tags } = JSON.parse(text) as { tags: string[] };

  const picked = [...new Set(tags)]
    .filter((tag) => tag !== OTHER_TAG && taxonomy.includes(tag))
    .slice(0, MAX_TAGS);
  return picked.length === 0 || tags.includes(OTHER_TAG)
    ? [...picked, OTHER_TAG]
    : picked;
}
