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

const ORIGINAL = '/storage/v1/object/public/';

/**
 * A stored picture at `width` pixels, rendered by Supabase's image
 * transformations (WebP when the browser takes it); any other URL as it is.
 * `contain` keeps the proportions: width alone kept the original height.
 * `keepFormat` skips WebP, for email (Outlook on Windows doesn't show it)
 */
export const sizedPicture = (url: string, width: number, keepFormat = false) =>
  url.includes(ORIGINAL)
    ? `${url.replace(ORIGINAL, '/storage/v1/render/image/public/')}?width=${width}&resize=contain${keepFormat ? '&format=origin' : ''}`
    : url;

/**
 * The like's picture at `width`: its first photo, else its stored picture,
 * else the page's preview image where it came from (until it's stored)
 */
export const likeImage = (like: Like, width: number, keepFormat = false) => {
  const picture = like.photoUrls[0] ?? like.pictureUrl;
  return picture ? sizedPicture(picture, width, keepFormat) : like.imageUrl;
};
