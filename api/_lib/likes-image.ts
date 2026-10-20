/**
 * The like's picture: Haiku 5.5 looks at the pictures on the pages about it
 * and says which show it, and the biggest of those is kept
 */

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './anthropic.js';
import type { LikeDetails } from './likes.js';
import { fetchPage, type Page } from './likes-pages.js';
import { downloadPicture, type Picture } from './pictures.js';
import { tracedCall, withoutImages } from './traces.js';
import type { Like } from '../../shared/likes.js';

const MODEL = 'claude-haiku-5-5';

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

// Pictures shown to Haiku: files under 5 MB once base64-encoded (the API's
// limit), at least a few KB (smaller ones are icons, flags and spacers), and
// at most this many and these many bytes in one request
const MAX_PICTURE_BYTES = 3_700_000;
const MIN_PICTURE_BYTES = 3_000;
const MAX_PICTURES = 16;
const MAX_REQUEST_PICTURE_BYTES = 15_000_000;

/** A picture from the web, if it loads, is a kind Claude reads, and isn't too big */
async function loadPicture(
  url: string,
): Promise<(Picture & { url: string }) | undefined> {
  const { picture } = await downloadPicture(url, MAX_PICTURE_BYTES);
  return picture && { url, ...picture };
}

/** The picture chosen for a like, with its bytes if they were loaded */
export interface ChosenImage {
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
export async function pickImage(
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
  // The trace keeps every candidate (URL, type, size) and the ones Haiku
  // said show it, so a pick can be checked again later; never the bytes
  const shownUrls = await tracedCall(
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
      return {
        candidates: pictures.map(({ url, type, data }) => ({
          url,
          type,
          bytes: data.length,
        })),
        shown: pictures
          .filter((_, i) => numbers.includes(i + 1))
          .map((picture) => picture.url),
      };
    },
  )
    .then((result) => result.shown)
    .catch((error: unknown) => {
      // An image the API won't take shouldn't cost the like its details. Most
      // candidates are just pictures on a page
      console.error(`Could not pick an image for like ${like.id}:`, error);
      return undefined;
    });
  if (!shownUrls) return preview();
  const best = pictures
    .filter((picture) => shownUrls.includes(picture.url))
    .sort((a, b) => b.data.length - a.data.length)[0];
  return best ? { url: best.url, picture: best } : null;
}
