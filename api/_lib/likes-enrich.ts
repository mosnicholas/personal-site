/**
 * Fills in each like's title, description, category and tags with Claude
 * Haiku 4.5, which can search the web to pin down what a photo or note is.
 * It runs right after a save, once the response is sent (waitUntil), and
 * daily from the cron for anything left over. Also splits pasted notes into
 * separate likes.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { waitUntil } from '@vercel/functions';

import { getAnthropic } from './anthropic.js';
import {
  claimLikes,
  failLike,
  finishLike,
  isHttpUrl,
  likeCategories,
  type LikeDetails,
  photoBytes,
  saveLike,
} from './likes.js';
import { htmlToText } from './summarize.js';
import { tracedCall } from './traces.js';
import type { Like } from '../../shared/likes.js';

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You organize a personal collection of things someone likes: links, notes and photos they save so they can find them again and remember what each one was. For each save, work out what it is and fill in the details that will let them recognize it at a glance and find it later.

When a save points at something specific, like a product in a photo or a place or book named in a note, search the web to identify it exactly. Their text, note and photo show what caught their eye: when they single out one version of something, like a color, a material, or one of several models on a page, describe that version. Reuse one of the collection's categories when one fits. Then call save_details.`;

const WEB_SEARCH: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 10,
};

// A long search pauses the turn; it's resumed by sending it back, this many
// requests in all
const MAX_TURNS = 6;

const SAVE_DETAILS: Anthropic.Tool = {
  name: 'save_details',
  description: 'Save the details of this like.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'What it is, specific enough to recognize: brand and model for a product, the name of a place or work',
      },
      description: { type: 'string', description: 'A sentence or two' },
      category: {
        type: 'string',
        description: 'One broad category, like clothing or restaurants',
      },
      tags: { type: 'array', items: { type: 'string' } },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'URLs of the search results that identified it',
      },
    },
    required: ['title', 'description', 'category', 'tags', 'sources'],
    additionalProperties: false,
  },
};

const SPLIT_PROMPT = `You split notes someone kept about things they like (links, products, places, books, ideas) into the separate things, so each can be saved on its own. Keep their words for each one, and its link if it has one.`;

// Long pastes are split a piece at a time, at paragraph breaks
const SPLIT_CHUNK_CHARS = 8_000;

interface Page {
  title: string;
  description: string;
  imageUrl: string | null;
  text: string;
}

/** `<meta>` tags by property or name, e.g. og:image */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
        ([, name, double, single]) => [name.toLowerCase(), double ?? single],
      ),
    );
    const key = (
      attributes.get('property') ?? attributes.get('name')
    )?.toLowerCase();
    const content = attributes.get('content');
    if (key && content && !tags.has(key)) tags.set(key, htmlToText(content));
  }
  return tags;
}

/**
 * The linked page's title, description, preview image and text. Many sites
 * turn away servers; then Haiku goes by the link alone
 */
async function fetchPage(url: string): Promise<Page | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    if (!response.headers.get('content-type')?.includes('html')) {
      return undefined;
    }
    const html = await response.text();
    const meta = metaTags(html);
    const image = meta.get('og:image') ?? meta.get('twitter:image');
    const imageUrl = image ? new URL(image, response.url).toString() : null;
    return {
      title:
        meta.get('og:title') ??
        htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
      description: meta.get('og:description') ?? meta.get('description') ?? '',
      imageUrl: imageUrl && isHttpUrl(imageUrl) ? imageUrl : null,
      text: htmlToText(html).slice(0, 20_000),
    };
  } catch {
    return undefined;
  }
}

// After searching, Haiku sometimes copies the citation markup it reads
// (`<cite index="1-6">`) into what it writes
const plain = (text: string) => text.replace(/<\/?cite\b[^>]*>/g, '').trim();

/** The request without the photo's bytes, which don't belong in the trace log */
const withoutPhoto = (request: Anthropic.MessageCreateParamsNonStreaming) => ({
  ...request,
  messages: request.messages.map((message) =>
    typeof message.content === 'string'
      ? message
      : {
          ...message,
          content: message.content.map((block) =>
            block.type === 'image'
              ? { type: 'image', source: '(photo)' }
              : block,
          ),
        },
  ),
});

/**
 * Asks Haiku for the like's details. It searches first when it needs to and
 * finishes with a save_details call; a long search can pause the turn, which
 * is resumed by sending it back
 */
async function askForDetails(like: Like, page?: Page, photo?: Buffer) {
  const save = {
    url: like.url,
    title: like.title || undefined,
    text: like.text || undefined,
    note: like.note || undefined,
    page,
  };
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        ...(photo
          ? [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: photo.toString('base64'),
                },
              },
            ]
          : []),
        { type: 'text', text: JSON.stringify(save, null, 2) },
      ],
    },
  ];
  const categories = await likeCategories();
  // Search results seen, url -> title: sources must be among them
  const results = new Map<string, string>();

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const request = {
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'disabled' as const },
      system: `${SYSTEM_PROMPT}\n\nCategories so far: ${categories.join(', ') || '(none yet)'}`,
      tools: [WEB_SEARCH, SAVE_DETAILS],
      messages: [...messages],
    };
    let response!: Anthropic.Message;
    const details = await tracedCall(
      {
        kind: 'likes_enrichment',
        subjectId: like.id,
        model: MODEL,
        request: withoutPhoto(request),
      },
      async () => (response = await getAnthropic().messages.create(request)),
      (message) =>
        message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'save_details',
        )?.input as Omit<LikeDetails, 'imageUrl' | 'sources'> & {
          sources: string[];
        },
    );
    for (const block of response.content) {
      if (
        block.type === 'web_search_tool_result' &&
        Array.isArray(block.content)
      ) {
        for (const result of block.content) {
          results.set(result.url, result.title);
        }
      }
    }
    if (details) {
      return {
        title: plain(details.title),
        description: plain(details.description),
        category: plain(details.category),
        tags: [...new Set(details.tags.map((tag) => plain(tag).toLowerCase()))],
        sources: details.sources
          .filter((url) => results.has(url))
          .map((url) => ({ url, title: results.get(url)! })),
      };
    }
    if (response.stop_reason !== 'pause_turn') {
      throw new Error(
        `Haiku stopped without saving details (${response.stop_reason})`,
      );
    }
    messages.push({ role: 'assistant', content: response.content });
  }
  throw new Error('Haiku kept searching without saving details');
}

async function enrichLike(like: Like): Promise<void> {
  try {
    const page = like.url ? await fetchPage(like.url) : undefined;
    const photo = like.photoUrl ? await photoBytes(like.id) : undefined;
    // Saved with everything filled in (Claude often knows what it is), so
    // only the preview image is missing
    const complete =
      like.title && like.description && like.category && like.tags.length;
    const details = complete
      ? { ...like, category: like.category!, sources: [] }
      : await askForDetails(like, page, photo);
    // The linked page's image, else the first source page that has one
    let imageUrl = page?.imageUrl ?? null;
    for (const source of details.sources.slice(0, 3)) {
      imageUrl ??= (await fetchPage(source.url))?.imageUrl ?? null;
    }
    await finishLike(like.id, { ...details, imageUrl });
  } catch (error) {
    console.error(`Could not enrich like ${like.id}:`, error);
    await failLike(
      like.id,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Enriches waiting likes, a few at once, until none are left or it's too
 * late to start more in this function's 300 seconds
 */
export async function processLikes(): Promise<number> {
  const stopStartingAt = Date.now() + 180_000;
  let processed = 0;
  while (Date.now() < stopStartingAt) {
    const likes = await claimLikes(8);
    if (likes.length === 0) break;
    await Promise.all(likes.map(enrichLike));
    processed += likes.length;
  }
  return processed;
}

/** Enriches waiting likes after the response is sent */
export function processLikesLater(): void {
  waitUntil(
    processLikes().catch((error: unknown) => {
      console.error('Could not process likes:', error);
    }),
  );
}

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
