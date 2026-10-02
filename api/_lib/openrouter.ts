/**
 * OpenRouter API client for LLM access
 * Uses Gemini Flash to tag articles (fast/cheap)
 * Model list: https://openrouter.ai/models?q=google%2Fgemini
 */

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const TAGGING_MODEL = 'google/gemini-3.8-flash';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }
  return apiKey;
}

async function chat(
  messages: OpenRouterMessage[],
  model: string,
  options: { json?: boolean } = {},
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nimo.dev',
      'X-Title': 'nimo.dev workflows',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      ...(options.json && { response_format: { type: 'json_object' } }),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  return data.choices[0]?.message?.content ?? '';
}

export interface TagGenerationResult {
  tags: string[];
  notes: string;
  primary_tag: string;
}

/**
 * Generate tags for an article using Gemini Flash
 */
export async function generateTags(article: {
  title: string;
  author: string | null;
  summary: string | null;
  url: string;
}): Promise<TagGenerationResult> {
  const systemPrompt = `You are a librarian assistant helping build a searchable knowledge graph. Your task is to analyze articles and generate relevant tags.

Rules for tags:
- Generate 3-7 tags per article
- Use #lowercase-with-hyphens format (e.g., #machine-learning, #startup-strategy)
- Tags should be specific enough to be useful but general enough to group related content
- Include a mix of: topic tags, domain tags, and format/type tags
- Avoid overly generic tags like #article or #interesting

You must respond with valid JSON only, no other text. Use this exact format:
{
  "tags": ["#tag-one", "#tag-two", "#tag-three"],
  "notes": "A brief 1-2 sentence summary of why these tags were chosen",
  "primary_tag": "#most-relevant-tag"
}`;

  const userPrompt = `Analyze this article and generate appropriate tags:

Title: ${article.title}
Author: ${article.author ?? 'Unknown'}
URL: ${article.url}
Summary: ${article.summary ?? 'No summary available'}

Generate tags in JSON format.`;

  const response = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    TAGGING_MODEL,
    { json: true },
  );

  try {
    return parseTagResult(response);
  } catch (error) {
    console.error('Failed to parse tag generation response:', response);
    throw new Error(
      `Failed to parse LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error },
    );
  }
}

function parseTagResult(response: string): TagGenerationResult {
  // Extract JSON from response (handle potential markdown code blocks)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const data = JSON.parse(jsonMatch[0]) as Partial<TagGenerationResult>;
  const tags = Array.isArray(data.tags)
    ? data.tags.filter(
        (tag): tag is string => typeof tag === 'string' && tag.length > 0,
      )
    : [];
  if (tags.length === 0) {
    throw new Error('Response did not include any tags');
  }

  return {
    tags,
    notes: typeof data.notes === 'string' ? data.notes : '',
    primary_tag:
      typeof data.primary_tag === 'string' ? data.primary_tag : tags[0],
  };
}
