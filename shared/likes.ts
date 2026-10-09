/** A saved like, as the API returns it to /likes and the MCP tools */
export interface Like {
  id: string;
  url: string | null;
  /** What I wrote or pasted when saving it */
  text: string;
  /** Why I like it, or who recommended it */
  note: string;
  /**
   * Where I stand with it, in my own words; so far "want to try" or "been".
   * Null when it's just something I like
   */
  list: string | null;
  /** What I thought of it, once I've been or tried it */
  review: string;
  /**
   * My photos, the first the cover: the public URL of each original in
   * Storage (size them with sizedPicture)
   */
  photoUrls: string[];
  /** Filled in by enrichment unless I set them first */
  title: string;
  description: string;
  category: string | null;
  tags: string[];
  /** Where the picture came from, usually the page's preview image (og:image) */
  imageUrl: string | null;
  /** That picture as stored in Storage (the original), once it is */
  pictureUrl: string | null;
  /** Web pages the model used to identify it */
  sources: { url: string; title: string }[];
  /** pending until enrichment runs; failed keeps the error until a retry */
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  /** web, mcp, or import */
  source: string;
  createdAt: string;
}

/** The fields I can edit on /likes */
export type LikePatch = Partial<
  Pick<
    Like,
    'title' | 'note' | 'list' | 'review' | 'description' | 'category' | 'tags'
  >
>;

/** A like's title, or what to call it until it has one */
export const likeTitle = (like: Like) =>
  like.title ||
  like.url?.replace(/^https?:\/\/(www\.)?/, '') ||
  like.text.slice(0, 80) ||
  'Photo';

/**
 * The sizes each stored picture is saved at besides its original, as the
 * longest width it can be (narrower pictures keep theirs): small for the
 * faces and the Wander path, medium for cards, tiles and email, large for
 * Wander, the edit panel and the models. Phones have 2-3x screens, so a card
 * on a phone needs about the pixels of one on a desktop: sizes go by where a
 * picture is shown, not the device
 */
export const PICTURE_SIZES = { small: 200, medium: 640, large: 1600 } as const;
export type PictureSize = keyof typeof PICTURE_SIZES;

const ORIGINAL = /\/storage\/v1\/object\/public\/(.+)\.\w+$/;

/**
 * Where a stored picture is kept at `size`: next to the original, under its
 * name without the extension (`{likeId}/{uuid}.jpg` is at
 * `{likeId}/{uuid}/medium`). Any other URL as it is
 */
export const sizedPicture = (url: string, size: PictureSize) =>
  url.replace(
    ORIGINAL,
    (_, path: string) => `/storage/v1/object/public/${path}/${size}`,
  );

/**
 * The like's picture at `size`: its first photo, else its stored picture,
 * else the page's preview image where it came from (until it's stored)
 */
export const likeImage = (like: Like, size: PictureSize) => {
  const picture = like.photoUrls[0] ?? like.pictureUrl;
  return picture ? sizedPicture(picture, size) : like.imageUrl;
};
