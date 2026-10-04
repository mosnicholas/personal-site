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

const IDENTIFY_PROMPT = `Someone saved this to their collection of things they like: links, notes and photos they keep so they can find them again and remember what each one was. Say exactly what it is: brand and model for a product, the name of a place or work. When that isn't clear from what they saved, like a product in a photo or a place named in a note, search the web to pin it down. Their text, note and photo show what caught their eye: when they single out one version, like a color, a material, or one of several models on a page, say which.`;

const SYSTEM_PROMPT = `You organize a personal collection of things someone likes: links, notes and photos they save so they can find them again and remember what each one was. From what they saved and what it turned out to be, fill in the details that will let them recognize it at a glance and find it later. When they singled out one version of something, the details are about that version. Reuse one of the collection's categories when one fits.`;

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
    },
    required: ['title', 'description', 'category', 'tags'],
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

// Some sites turn away requests that don't look like a browser
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/**
 * The linked page's title, description, preview image and text. Many sites
 * turn away servers; then Haiku goes by the link alone
 */
async function fetchPage(url: string): Promise<Page | undefined> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
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

/** The image file's size in bytes, or 0 if it doesn't load */
async function imageSize(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.headers.get('content-type')?.startsWith('image/')) return 0;
    return response.ok ? (await response.arrayBuffer()).byteLength : 0;
  } catch {
    return 0;
  }
}

/**
 * The sharpest of the preview images of the linked page and the source
 * pages, taken to be the biggest file: some sites' preview images are small
 * thumbnails. If none can be loaded from here, the linked page's
 */
async function bestImage(page: Page | undefined, sources: Like['sources']) {
  const pages = await Promise.all(
    sources.slice(0, 5).map((source) => fetchPage(source.url)),
  );
  const urls = [
    ...new Set(
      [page, ...pages]
        .map((candidate) => candidate?.imageUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  if (urls.length < 2) return urls[0] ?? null;
  const sizes = await Promise.all(urls.map(imageSize));
  const biggest = Math.max(...sizes);
  return biggest > 0 ? urls[sizes.indexOf(biggest)] : urls[0];
}

/** The request without the photo's bytes, which don't belong in the trace log */
const withoutPhoto = <Request extends { messages: Anthropic.MessageParam[] }>(
  request: Request,
) => ({
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

/** The save as Haiku sees it: the photo, then the rest as JSON */
function saveContent(
  save: Record<string, unknown>,
  photo?: Buffer,
): Anthropic.ContentBlockParam[] {
  return [
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
  ];
}

/**
 * Haiku says what the like is, searching the web when it needs to; the
 * pages its answer cites are the sources. A long search pauses the turn,
 * which is resumed by sending it back.
 *
 * This is a separate request from filling in the details because after a
 * search Haiku cites as it writes: in a tool call, that came out as
 * citation markup around a quoted fragment instead of a description
 */
async function identify(like: Like, content: Anthropic.ContentBlockParam[]) {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];
  let answer = '';
  const sources = new Map<string, string>();
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const request = {
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'disabled' as const },
      system: IDENTIFY_PROMPT,
      tools: [WEB_SEARCH],
      messages: [...messages],
    };
    let response!: Anthropic.Message;
    answer += await tracedCall(
      {
        kind: 'likes_enrichment',
        subjectId: like.id,
        model: MODEL,
        request: withoutPhoto(request),
      },
      async () => (response = await getAnthropic().messages.create(request)),
      (message) =>
        message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join(''),
    );
    for (const block of response.content) {
      if (block.type !== 'text') continue;
      for (const citation of block.citations ?? []) {
        if (
          citation.type === 'web_search_result_location' &&
          !sources.has(citation.url)
        ) {
          sources.set(citation.url, citation.title ?? citation.url);
        }
      }
    }
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  return {
    answer: answer.trim(),
    sources: [...sources].map(([url, title]) => ({ url, title })),
  };
}

/** Haiku fills in the details from the save and what it turned out to be */
async function organize(like: Like, content: Anthropic.ContentBlockParam[]) {
  const categories = await likeCategories();
  const request = {
    model: MODEL,
    max_tokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nCategories so far: ${categories.join(', ') || '(none yet)'}`,
    tools: [SAVE_DETAILS],
    tool_choice: { type: 'tool' as const, name: SAVE_DETAILS.name },
    messages: [{ role: 'user' as const, content }],
  };
  const details = await tracedCall(
    {
      kind: 'likes_enrichment',
      subjectId: like.id,
      model: MODEL,
      request: withoutPhoto(request),
    },
    () => getAnthropic().messages.create(request),
    (message) => {
      const call = message.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!call) {
        throw new Error(
          `Haiku stopped without saving details (${message.stop_reason})`,
        );
      }
      return call.input as Omit<LikeDetails, 'imageUrl' | 'sources'>;
    },
  );
  return {
    title: details.title.trim(),
    description: details.description.trim(),
    category: details.category.trim(),
    tags: [...new Set(details.tags.map((tag) => tag.trim().toLowerCase()))],
  };
}

async function enrichLike(like: Like): Promise<void> {
  try {
    const page = like.url ? await fetchPage(like.url) : undefined;
    // Saved with everything filled in (Claude often knows what it is), so
    // only the preview image is missing
    const complete =
      like.title && like.description && like.category && like.tags.length;
    let details: Omit<LikeDetails, 'imageUrl'>;
    if (complete) {
      details = { ...like, category: like.category!, sources: [] };
    } else {
      const photo = like.photoUrl ? await photoBytes(like.id) : undefined;
      const save = {
        url: like.url,
        title: like.title || undefined,
        text: like.text || undefined,
        note: like.note || undefined,
        page,
      };
      const { answer, sources } = await identify(
        like,
        saveContent(save, photo),
      );
      const found = await organize(
        like,
        saveContent({ ...save, what_it_is: answer || undefined }, photo),
      );
      details = { ...found, sources };
    }
    const imageUrl = await bestImage(page, details.sources);
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
