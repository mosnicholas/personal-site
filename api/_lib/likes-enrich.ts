/**
 * Fills in each like's title, description, category and tags with Claude
 * Haiku 5.5, which can search the web to pin down what a photo or note is.
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
import { getSyncState } from './documents.js';
import {
  downloadPicture,
  type Picture,
  uploadPicture,
  USER_AGENT,
} from './pictures.js';
import { htmlToText } from './summarize.js';
import { tracedCall } from './traces.js';
import type { Like } from '../../shared/likes.js';

const MODEL = 'claude-haiku-5-5';

/** How many of a like's photos Haiku looks at; the first is the cover */
const MAX_PHOTOS = 4;

const IDENTIFY_PROMPT = `Someone saved this to their collection of things they like: links, notes and photos they keep so they can find them again and remember what each one was. Search the web for it and say exactly what it is: brand and model for a product, the name of a place or work. The pages you find also give it its picture in the collection, so search even when you already know what it is. Their text, note and photos show what caught their eye: when they single out one version, like a color, a material, or one of several models on a page, say which.`;

const SYSTEM_PROMPT = `You organize a personal collection of things someone likes: links, notes and photos they save so they can find them again and remember what each one was. From what they saved and what it turned out to be, fill in the details: the title and description let them recognize it at a glance, and the category and tags group it with similar things when they browse. When they singled out one version of something, the details are about that version. Reuse a category and its tags when they fit, and start a new one when none does.`;

/** The categories the last realign settled on, which Haiku sees when it organizes a like (likes-realign.ts) */
export interface LikeCategoryDescription {
  name: string;
  description: string;
}

export const CATEGORIES_STATE = 'likes_categories';

/** What the category and tags are for; Claude saving over MCP is told the same */
export const CATEGORY_DESCRIPTION =
  'One broad kind of thing, like furniture, clothing or restaurants';
export const TAGS_DESCRIPTION =
  'What kind of thing it is within its category, broad to narrow, like jacket and chore coat in clothing. The title and description hold the brand, materials and other specifics';

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
      category: { type: 'string', description: CATEGORY_DESCRIPTION },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: TAGS_DESCRIPTION,
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description:
          'URLs of the search results about this exact thing, best first',
      },
    },
    required: ['title', 'description', 'category', 'tags', 'sources'],
    additionalProperties: false,
  },
};

const PICK_PROMPT = `Someone saved this to their collection of things they like, and these pictures come from pages about it. Which of them show it? If they singled out one version of it, only pictures of that version. The sharpest of the ones you pick becomes its picture in the collection.`;

const PICK_PICTURES: Anthropic.Tool = {
  name: 'pick_pictures',
  description: 'Say which pictures show it.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      pictures: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Their numbers; empty if none do',
      },
    },
    required: ['pictures'],
    additionalProperties: false,
  },
};

const SPLIT_PROMPT = `You split notes someone kept about things they like (links, products, places, books, ideas) into the separate things, so each can be saved on its own. Keep their words for each one, and its link if it has one.`;

// Long pastes are split a piece at a time, at paragraph breaks
const SPLIT_CHUNK_CHARS = 8_000;

interface Page {
  title: string;
  description: string;
  text: string;
  /** og:image, which some sites set to their own picture on every page */
  previewImage: string | null;
  /** The page's first few <img>s */
  images: string[];
}

// Pictures shown to Haiku: files under 5 MB once base64-encoded (the API's
// limit), at least a few KB (smaller ones are icons, flags and spacers), and
// at most this many and these many bytes in one request
const MAX_PICTURE_BYTES = 3_700_000;
const MIN_PICTURE_BYTES = 3_000;
const MAX_PICTURES = 16;
const MAX_REQUEST_PICTURE_BYTES = 15_000_000;

/** An <img>'s biggest version: the largest in its srcset, else its src */
function imgSource(tag: string): string | undefined {
  const attribute = (name: string) =>
    tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)`, 'i'))?.[1];
  const largest = attribute('srcset')
    ?.split(/,\s+/)
    .map((entry) => {
      const [url, size = '1x'] = entry.trim().split(/\s+/);
      return { url, size: parseFloat(size) || 0 };
    })
    .sort((a, b) => b.size - a.size)[0]?.url;
  return largest ?? attribute('src');
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
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    if (!response.headers.get('content-type')?.includes('html')) {
      return undefined;
    }
    const html = await response.text();
    const meta = metaTags(html);
    // An image's absolute URL; null for an SVG (Claude can't read it) or a
    // src that isn't a web URL
    const absolute = (src: string) => {
      try {
        const resolved = new URL(htmlToText(src), response.url).toString();
        return isHttpUrl(resolved) && !/\.svg(\?|$)/i.test(resolved)
          ? resolved
          : null;
      } catch {
        return null;
      }
    };
    const preview = meta.get('og:image') ?? meta.get('twitter:image');
    const images = [...html.matchAll(/<img\b[^>]*>/gi)]
      .map(([tag]) => imgSource(tag))
      .map((src) => (src ? absolute(src) : null))
      .filter((url): url is string => url !== null);
    return {
      title:
        meta.get('og:title') ??
        htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
      description: meta.get('og:description') ?? meta.get('description') ?? '',
      text: htmlToText(html).slice(0, 20_000),
      previewImage: preview ? absolute(preview) : null,
      images: [...new Set(images)].slice(0, 5),
    };
  } catch {
    return undefined;
  }
}

/** A picture from the web, if it loads, is a kind Claude reads, and isn't too big */
async function loadPicture(
  url: string,
): Promise<(Picture & { url: string }) | undefined> {
  const { picture } = await downloadPicture(url, MAX_PICTURE_BYTES);
  return picture && { url, ...picture };
}

/** The request without image bytes, which don't belong in the trace log */
const withoutImages = <Request extends { messages: Anthropic.MessageParam[] }>(
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
              ? { type: 'image', source: '(image)' }
              : block,
          ),
        },
  ),
});

/** The save as Haiku sees it: the photos, then the rest as JSON */
function saveContent(
  save: Record<string, unknown>,
  photos: Picture[],
): Anthropic.ContentBlockParam[] {
  return [
    ...photos.map((photo) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: photo.type,
        data: photo.data.toString('base64'),
      },
    })),
    { type: 'text', text: JSON.stringify(save, null, 2) },
  ];
}

/**
 * Haiku says what the like is, searching the web when it needs to. Returns
 * its answer and the search results it saw. A long search pauses the turn,
 * which is resumed by sending it back.
 *
 * This is a separate request from filling in the details because after a
 * search Haiku cites as it writes: in a tool call, that came out as
 * citation markup around a quoted fragment instead of a description
 */
async function identify(like: Like, content: Anthropic.ContentBlockParam[]) {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];
  let answer = '';
  const results = new Map<string, string>();
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
        request: withoutImages(request),
      },
      async () => (response = await getAnthropic().messages.create(request)),
      (message) =>
        message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join(''),
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
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  return { answer: answer.trim(), results };
}

/**
 * Haiku fills in the details from the save, what it turned out to be, and
 * the search results, picking the ones about it as sources
 */
async function organize(like: Like, content: Anthropic.ContentBlockParam[]) {
  const [inUse, described] = await Promise.all([
    likeCategories(),
    getSyncState<LikeCategoryDescription[]>(CATEGORIES_STATE),
  ]);
  const descriptions = new Map(
    (described ?? []).map(({ name, description }) => [name, description]),
  );
  const categories = inUse
    .map(({ name, likes, examples, tags }) => {
      const description = descriptions.get(name);
      return `${name} (${likes})${description ? `: ${description}` : ''}. Latest: ${examples.join('; ')}${tags.length ? `. Tags: ${tags.join(', ')}` : ''}`;
    })
    .join('\n');
  const request = {
    model: MODEL,
    max_tokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nCategories so far, with how many likes, what belongs in them, the latest few, and their most used tags:\n${categories || '(none yet)'}`,
    tools: [SAVE_DETAILS],
    tool_choice: { type: 'tool' as const, name: SAVE_DETAILS.name },
    messages: [{ role: 'user' as const, content }],
  };
  const details = await tracedCall(
    {
      kind: 'likes_enrichment',
      subjectId: like.id,
      model: MODEL,
      request: withoutImages(request),
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
      return call.input as Omit<LikeDetails, 'imageUrl' | 'sources'> & {
        sources: string[];
      };
    },
  );
  return {
    title: details.title.trim(),
    description: details.description.trim(),
    category: details.category.trim(),
    tags: [...new Set(details.tags.map((tag) => tag.trim().toLowerCase()))],
    sources: details.sources,
  };
}

/** The picture chosen for a like, with its bytes if they were loaded */
interface ChosenImage {
  url: string;
  picture?: Picture;
}

/**
 * The like's image: the sharpest picture that shows it, among the preview
 * images and first few images of the linked page and the source pages. A preview image can be the site's own picture, a page that moved,
 * or another version, so Haiku says which pictures show it; of those, the
 * biggest file is taken to be the sharpest (some sites' are thumbnails).
 * Returns the picture's bytes too when they're at hand, to store it
 */
async function pickImage(
  like: Like,
  details: Pick<LikeDetails, 'title' | 'description' | 'sources'>,
  page: Page | undefined,
): Promise<ChosenImage | null> {
  // With no pick there's only the linked page's own preview image
  const preview = async (): Promise<ChosenImage | null> => {
    const url = page?.previewImage;
    if (!url) return null;
    const picture = await loadPicture(url);
    return {
      url,
      picture:
        picture && picture.data.length >= MIN_PICTURE_BYTES
          ? picture
          : undefined,
    };
  };
  const sourcePages = await Promise.all(
    details.sources.slice(0, 5).map((source) => fetchPage(source.url)),
  );
  // Most likely to show it first: many stores' preview image is a logo or
  // missing, but their pages have product photos
  const urls = [
    page?.previewImage,
    ...(page?.images ?? []),
    ...sourcePages.map((sourcePage) => sourcePage?.previewImage),
    ...sourcePages.flatMap(
      (sourcePage) => sourcePage?.images.slice(0, 4) ?? [],
    ),
  ].filter((url): url is string => Boolean(url));
  const loaded = await Promise.all([...new Set(urls)].map(loadPicture));
  const pictures: (Picture & { url: string })[] = [];
  let bytes = 0;
  for (const picture of loaded) {
    if (!picture || picture.data.length < MIN_PICTURE_BYTES) continue;
    if (bytes + picture.data.length > MAX_REQUEST_PICTURE_BYTES) continue;
    pictures.push(picture);
    bytes += picture.data.length;
    if (pictures.length === MAX_PICTURES) break;
  }
  if (pictures.length === 0) return preview();

  const request = {
    model: MODEL,
    max_tokens: 1024,
    system: PICK_PROMPT,
    tools: [PICK_PICTURES],
    tool_choice: { type: 'tool' as const, name: PICK_PICTURES.name },
    messages: [
      {
        role: 'user' as const,
        content: [
          ...pictures.flatMap((picture, i) => [
            { type: 'text' as const, text: `Picture ${i + 1}: ${picture.url}` },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: picture.type,
                data: picture.data.toString('base64'),
              },
            },
          ]),
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                title: details.title,
                description: details.description,
                note: like.note || undefined,
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  };
  const shown = await tracedCall(
    {
      kind: 'likes_enrichment',
      subjectId: like.id,
      model: MODEL,
      request: withoutImages(request),
    },
    () => getAnthropic().messages.create(request),
    (message) => {
      const call = message.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      const numbers =
        (call?.input as { pictures: number[] } | undefined)?.pictures ?? [];
      return pictures.filter((_, i) => numbers.includes(i + 1));
    },
  ).catch((error: unknown) => {
    // An image the API won't take shouldn't cost the like its details. Most
    // candidates are just pictures on a page
    console.error(`Could not pick an image for like ${like.id}:`, error);
    return undefined;
  });
  if (!shown) return preview();
  return shown.sort((a, b) => b.data.length - a.data.length)[0] ?? null;
}

async function enrichLike(like: Like): Promise<void> {
  try {
    const page = like.url ? await fetchPage(like.url) : undefined;
    const photos = await photoBytes(like, MAX_PHOTOS);
    // Haiku runs even when every field is filled in (Claude often knows what
    // it is): its search finds the sources, and the pages that give the like
    // its picture. finishLike keeps the fields that were set
    const save = {
      url: like.url,
      title: like.title || undefined,
      description: like.description || undefined,
      text: like.text || undefined,
      note: like.note || undefined,
      page: page && {
        title: page.title,
        description: page.description,
        text: page.text,
      },
    };
    const { answer, results } = await identify(like, saveContent(save, photos));
    const found = await organize(
      like,
      saveContent(
        {
          ...save,
          what_it_is: answer || undefined,
          search_results: results.size
            ? [...results].map(([url, title]) => ({ url, title }))
            : undefined,
        },
        photos,
      ),
    );
    const details = {
      ...found,
      // Only real search results, so a made-up URL can't become a source
      sources: [...new Set(found.sources)]
        .filter((url) => results.has(url))
        .map((url) => ({ url, title: results.get(url)! })),
    };
    const image = await pickImage(like, details, page);
    // Saved only when the like has no image yet (finishLike keeps one it
    // has), so a picture that wouldn't be used isn't stored
    const imagePath =
      image?.picture && !like.imageUrl
        ? await uploadPicture(like.id, image.picture.data, image.picture.type)
        : null;
    await finishLike(like.id, {
      ...details,
      imageUrl: image?.url ?? null,
      imagePath,
    });
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
