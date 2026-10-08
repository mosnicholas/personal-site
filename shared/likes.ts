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
   * Where /likes loads my photos from, the first one the cover; each URL
   * changes when its photo does
   */
  photoUrls: string[];
  /** Filled in by enrichment unless I set them first */
  title: string;
  description: string;
  category: string | null;
  tags: string[];
  /** The page's preview image (og:image), for links */
  imageUrl: string | null;
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
