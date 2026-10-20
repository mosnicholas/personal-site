/**
 * Fills in each like's title, description, category and tags with Claude
 * Haiku 5.5, which can search the web to pin down what a photo or note is.
 * It runs right after a save, once the response is sent (waitUntil), and
 * daily from the cron for anything left over. Its picture is picked in
 * likes-image.ts; pasted notes are split in likes-import.ts.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { waitUntil } from '@vercel/functions';

import { getAnthropic } from './anthropic.js';
import {
  claimLikes,
  failLike,
  finishLike,
  likeCategories,
  type LikeDetails,
  photoBytes,
} from './likes.js';
import { getSyncState } from './documents.js';
import { pickImage } from './likes-image.js';
import { fetchPage } from './likes-pages.js';
import { type Picture, uploadPicture } from './pictures.js';
import { tracedCall, withoutImages } from './traces.js';
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
