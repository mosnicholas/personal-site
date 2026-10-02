/**
 * Reading synthesis over a longer stretch (a month, a quarter), written by
 * Claude Opus 5.5: what everything saved says together, how the reading
 * shifted over time, and the model's own read on it. Most of these documents
 * go unread, so the email has to stand in for them.
 */

import { getAnthropic } from './anthropic.js';
import { type Article, articleTagNames } from './readwise.js';
import { parseEmailResponse } from './summary.js';
import { tracedCall } from './traces.js';

const SYNTHESIS_MODEL = 'claude-opus-5-5';
// Room for thinking plus a ~3,000 word email, inside Vercel's 300s limit
const MAX_OUTPUT_TOKENS = 20000;
const MAX_SUMMARY_CHARS = 600;
const MAX_HIGHLIGHTS_PER_DOCUMENT = 5;
const MAX_HIGHLIGHT_CHARS = 400;

const SYSTEM_PROMPT = `You write a reading synthesis for one reader: nimo, founder and CEO of Junior (myjunior.ai), an AI startup, who also loves adventure travel and cooking. You get every document they saved to Readwise Reader over a stretch of time: title, source, date saved, tags, Readwise's summary, how far they got, and any notes and highlights. They saved far more than they read, so this email has to tell them what the documents say without reading them, and then step back and think about the reading itself.

Write to the reader directly, as "you", in these sections:

1. **The short version** - one paragraph: the few ideas that matter most from this stretch, and the one thing you'd most want them to take away.
2. **What it all says** - 5 to 9 themes that together cover every document. For each, synthesize what the documents argue as a group: the main claims, where sources agree and disagree, and what's new or surprising. Name and link the standout pieces; you don't need to list every document.
3. **How it changed** - the story of how the reading moved over the stretch: what grew, what faded, what arrived suddenly, and what might have prompted it. Anchor it in dates and months.
4. **Meta observations** - your own reading of the reader: what they keep circling back to, the questions underneath the reading, tensions and contradictions between sources, blind spots and what's missing, the gap between what they save and what they finish, and where you'd push back. Be direct and specific; this is the part the documents can't give them.
5. **Worth reading in full** - 5 to 10 documents they haven't finished, each with a sentence on why.
6. **Questions to sit with** - 3 to 5.

Ground claims in the summaries, notes, and highlights you're given, and say so when a summary is too thin to judge a document. Highlights and notes show what the reader found important; weigh them. Link a document by putting its title in an <a> tag with its \`link\`. Aim for about 3,000 words.

Format: start with the subject line on its own line, as SUBJECT: <subject>, then clean HTML for email using <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>, and <a>. No code fences.`;

interface SynthesisDocument {
  link: string;
  saved: string;
  title: string;
  author: string | null;
  site: string | null;
  type: string;
  read: string;
  tags: string[];
  summary: string | null;
  note?: string;
  highlights?: { text?: string; note?: string }[];
}

const truncate = (text: string | null | undefined, max: number) =>
  text && text.length > max ? `${text.slice(0, max - 1)}…` : text || undefined;

const savedAt = (doc: Article) => doc.saved_at ?? doc.created_at;

function readStatus(progress: number): string {
  if (progress >= 0.9) return 'finished';
  if (progress > 0.02) return `started (${Math.round(progress * 100)}%)`;
  return 'not opened';
}

/**
 * The documents as the model sees them, oldest first, with their highlights
 */
export function prepareDocuments(
  documents: Article[],
  highlights: Article[],
): SynthesisDocument[] {
  const highlightsByDocument = new Map<string, Article[]>();
  for (const highlight of highlights) {
    if (!highlight.parent_id) continue;
    const list = highlightsByDocument.get(highlight.parent_id) ?? [];
    list.push(highlight);
    highlightsByDocument.set(highlight.parent_id, list);
  }

  return [...documents]
    .sort((a, b) => savedAt(a).localeCompare(savedAt(b)))
    .map((doc) => {
      const docHighlights = (highlightsByDocument.get(doc.id) ?? [])
        .slice(0, MAX_HIGHLIGHTS_PER_DOCUMENT)
        .map((highlight) => ({
          text: truncate(highlight.content, MAX_HIGHLIGHT_CHARS),
          note: truncate(highlight.notes, MAX_HIGHLIGHT_CHARS),
        }))
        .filter((highlight) => highlight.text || highlight.note);
      return {
        link: `https://read.readwise.io/read/${doc.id}`,
        saved: savedAt(doc).slice(0, 10),
        title: doc.title,
        author: doc.author,
        site: doc.site_name,
        type: doc.category,
        read: readStatus(doc.reading_progress),
        tags: articleTagNames(doc),
        summary: truncate(doc.summary, MAX_SUMMARY_CHARS) ?? null,
        note: truncate(doc.notes, MAX_HIGHLIGHT_CHARS),
        highlights: docHighlights.length > 0 ? docHighlights : undefined,
      };
    });
}

/**
 * The request for a synthesis of `documents` saved between `since` and `until`
 */
export function buildSynthesisRequest(
  documents: SynthesisDocument[],
  since: Date,
  until: Date,
) {
  return {
    model: SYNTHESIS_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: 'medium' as const },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify({
          from: since.toISOString().slice(0, 10),
          to: until.toISOString().slice(0, 10),
          documents,
        }),
      },
    ],
  };
}

export async function generateSynthesis(
  request: ReturnType<typeof buildSynthesisRequest>,
  subjectId: string,
): Promise<{ html: string; subject: string }> {
  return tracedCall(
    {
      kind: 'reading_synthesis',
      subjectId,
      model: SYNTHESIS_MODEL,
      request,
    },
    // Streaming keeps a long response from hitting HTTP timeouts
    () => getAnthropic().beta.messages.stream(request).finalMessage(),
    (message) => parseEmailResponse(message, `Reading synthesis: ${subjectId}`),
  );
}
