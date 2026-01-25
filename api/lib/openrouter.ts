/**
 * OpenRouter API client for LLM access
 * Uses Gemini Flash for tagging (fast/cheap) and Gemini Pro for summaries (better quality)
 */

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

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
  model: string = 'google/gemini-flash-1.5'
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nimo.dev',
      'X-Title': 'nimo.dev workflows',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data: OpenRouterResponse = await response.json();
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
    'google/gemini-flash-1.5'
  );

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]) as TagGenerationResult;
  } catch (error) {
    console.error('Failed to parse tag generation response:', response);
    throw new Error(`Failed to parse LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export interface WeeklySummaryResult {
  html: string;
  subject: string;
}

/**
 * Generate weekly reading summary using Gemini Pro
 */
export async function generateWeeklySummary(articles: {
  title: string;
  author: string | null;
  url: string;
  summary: string | null;
  tags: Record<string, unknown>;
  reading_progress: number;
}[]): Promise<WeeklySummaryResult> {
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

  const articleList = articles.map((a, i) =>
    `${i + 1}. "${a.title}" by ${a.author ?? 'Unknown'}
   URL: ${a.url}
   Progress: ${Math.round(a.reading_progress * 100)}%
   Summary: ${a.summary ?? 'No summary'}
   Tags: ${Object.keys(a.tags).join(', ') || 'None'}`
  ).join('\n\n');

  const userPrompt = `Analyze these ${articles.length} articles from this week's reading:

${articleList}

Generate a comprehensive weekly reading summary.`;

  const response = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    'google/gemini-pro-1.5'
  );

  // Extract subject line
  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const subject = subjectMatch?.[1]?.trim() ?? `Weekly Reading Summary - ${new Date().toLocaleDateString()}`;

  // Extract HTML content (everything after the subject line)
  let html = response.replace(/SUBJECT:\s*.+?(?:\n|$)/i, '').trim();

  // Wrap in basic email template if not already wrapped
  if (!html.toLowerCase().includes('<!doctype') && !html.toLowerCase().includes('<html')) {
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

  return { html, subject };
}
