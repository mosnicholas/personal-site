/**
 * Pasted notes, split by Claude Haiku 5.5 into separate likes
 */

import { getAnthropic } from './anthropic.js';
import { isHttpUrl, saveLike } from './likes.js';
import { tracedCall } from './traces.js';
import type { Like } from '../../shared/likes.js';

const MODEL = 'claude-haiku-5-5';

const SPLIT_PROMPT = `You split notes someone kept about things they like (links, products, places, books, ideas) into the separate things, so each can be saved on its own. Keep their words for each one, and its link if it has one.`;

// Long pastes are split a piece at a time, at paragraph breaks
const SPLIT_CHUNK_CHARS = 8_000;

/** Pieces of about SPLIT_CHUNK_CHARS, broken between paragraphs */
function chunks(text: string): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (piece && piece.length + paragraph.length > SPLIT_CHUNK_CHARS) {
      pieces.push(piece);
      piece = '';
    }
    piece += (piece ? '\n\n' : '') + paragraph;
  }
  if (piece.trim()) pieces.push(piece);
  return pieces;
}

async function splitNotes(
  notes: string,
  subjectId: string,
): Promise<{ text: string; url: string }[]> {
  const request = {
    model: MODEL,
    max_tokens: 16000,
    system: SPLIT_PROMPT,
    messages: [{ role: 'user' as const, content: notes }],
    output_config: {
      effort: 'low' as const,
      format: {
        type: 'json_schema' as const,
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  url: { type: 'string', description: 'Empty if none' },
                },
                required: ['text', 'url'],
                additionalProperties: false,
              },
            },
          },
          required: ['items'],
          additionalProperties: false,
        },
      },
    },
  };
  return tracedCall(
    { kind: 'likes_import', subjectId, model: MODEL, request },
    () => getAnthropic().messages.create(request),
    (response) => {
      const text = response.content.find((block) => block.type === 'text');
      if (response.stop_reason !== 'end_turn' || !text) {
        throw new Error(`Haiku stopped early (${response.stop_reason})`);
      }
      return (
        JSON.parse(text.text) as { items: { text: string; url: string }[] }
      ).items;
    },
  );
}

/**
 * Splits pasted notes into likes and saves them for enrichment. A piece
 * that can't be split is saved whole, so nothing pasted is lost
 */
export async function importNotes(notes: string): Promise<Like[]> {
  const importId = new Date().toISOString();
  const pieces = await Promise.all(
    chunks(notes).map((piece, i) =>
      splitNotes(piece, `${importId}/${i}`).catch((error: unknown) => {
        console.error('Could not split notes; saving the piece whole:', error);
        return [{ text: piece, url: '' }];
      }),
    ),
  );
  const saved: Like[] = [];
  for (const item of pieces.flat()) {
    if (!item.text.trim() && !isHttpUrl(item.url)) continue;
    saved.push(
      await saveLike({
        text: item.text,
        url: isHttpUrl(item.url) ? item.url : undefined,
        source: 'import',
      }),
    );
  }
  return saved;
}
