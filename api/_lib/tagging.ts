/**
 * Article tagging with Claude Haiku 4.5
 */

import { getAnthropic } from './anthropic.js';

const TAGGING_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are a librarian assistant helping build a searchable knowledge graph. Your task is to analyze articles and generate relevant tags.

Rules for tags:
- Generate 3-7 tags per article
- Use #lowercase-with-hyphens format (e.g., #machine-learning, #startup-strategy)
- Tags should be specific enough to be useful but general enough to group related content
- Include a mix of: topic tags, domain tags, and format/type tags
- Avoid overly generic tags like #article or #interesting

Also give "notes": a brief 1-2 sentence summary of why these tags were chosen, and "primary_tag": the most relevant of your tags.`;

// Structured outputs guarantee the reply is JSON in this shape
const TAG_SCHEMA = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    primary_tag: { type: 'string' },
  },
  required: ['tags', 'notes', 'primary_tag'],
  additionalProperties: false,
};

export interface TagGenerationResult {
  tags: string[];
  notes: string;
  primary_tag: string;
}

/**
 * Generate tags for an article
 */
export async function generateTags(article: {
  title: string;
  author: string | null;
  summary: string | null;
  url: string;
}): Promise<TagGenerationResult> {
  const userPrompt = `Analyze this article and generate appropriate tags:

Title: ${article.title}
Author: ${article.author ?? 'Unknown'}
URL: ${article.url}
Summary: ${article.summary ?? 'No summary available'}`;

  const response = await getAnthropic().messages.create({
    model: TAGGING_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    output_config: { format: { type: 'json_schema', schema: TAG_SCHEMA } },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Tagging request was declined');
  }

  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  const result = JSON.parse(text) as TagGenerationResult;
  const tags = result.tags.filter((tag) => tag.trim());
  if (tags.length === 0) {
    throw new Error('Response did not include any tags');
  }

  return { ...result, tags };
}
