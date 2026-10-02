/**
 * Readwise Reader API client
 * Documentation: https://readwise.io/reader_api
 */

const READWISE_API_BASE = 'https://readwise.io/api/v3';
const MAX_RATE_LIMIT_RETRIES = 3;

export type Location = 'new' | 'later' | 'shortlist' | 'archive' | 'feed';

export interface Article {
  id: string;
  url: string;
  title: string;
  author: string | null;
  source: string | null;
  category: string;
  location: string;
  tags: Record<string, unknown>;
  site_name: string | null;
  word_count: number | null;
  created_at: string;
  updated_at: string;
  published_date: string | null;
  summary: string | null;
  image_url: string | null;
  content: string | null;
  source_url: string | null;
  notes: string | null;
  parent_id: string | null;
  reading_progress: number;
  saved_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
}

export interface Tag {
  key: string;
  name: string;
}

interface Page<T> {
  count: number;
  nextPageCursor: string | null;
  results: T[];
}

export interface ArticleListResponse {
  count: number;
  nextPageCursor: string | null;
  results: Article[];
}

export interface SaveDocumentPayload {
  url: string;
  html?: string;
  should_clean_html?: boolean;
  title?: string;
  author?: string;
  summary?: string;
  published_date?: string;
  image_url?: string;
  location?: Location;
  category?:
    | 'article'
    | 'email'
    | 'rss'
    | 'highlight'
    | 'note'
    | 'pdf'
    | 'epub'
    | 'tweet'
    | 'video';
  saved_using?: string;
  tags?: string[];
  notes?: string;
}

export interface UpdateDocumentPayload {
  tags?: string[];
  notes?: string;
  location?: Location;
  reading_progress?: number;
}

function getApiKey(): string {
  const apiKey = process.env.READWISE_API_KEY;
  if (!apiKey) {
    throw new Error('READWISE_API_KEY environment variable is not set');
  }
  return apiKey;
}

async function makeRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  attempt = 0,
): Promise<T> {
  const apiKey = getApiKey();

  const response = await fetch(`${READWISE_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Readwise rate limits per token (e.g. 20/min on /list/) and says when to retry
  if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const retryAfterSeconds = Number(response.headers.get('Retry-After')) || 60;
    await new Promise((resolve) =>
      setTimeout(resolve, retryAfterSeconds * 1000),
    );
    return makeRequest<T>(endpoint, options, attempt + 1);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Readwise API error (${response.status}): ${errorText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

/**
 * Follow `nextPageCursor`, yielding one page at a time
 */
async function* listPages<T>(
  path: string,
  params: URLSearchParams = new URLSearchParams(),
): AsyncGenerator<T[]> {
  let nextPageCursor: string | null = null;

  do {
    if (nextPageCursor) {
      params.set('pageCursor', nextPageCursor);
    }
    const queryString = params.toString();
    const response: Page<T> = await makeRequest<Page<T>>(
      `${path}${queryString ? `?${queryString}` : ''}`,
    );
    yield response.results;
    nextPageCursor = response.nextPageCursor;
  } while (nextPageCursor);
}

/**
 * Load every page of a list endpoint
 */
async function fetchAllPages<T>(
  path: string,
  params?: URLSearchParams,
): Promise<T[]> {
  const items: T[] = [];
  for await (const page of listPages<T>(path, params)) {
    items.push(...page);
  }
  return items;
}

interface ArticleFilter {
  /** Only articles updated after this date */
  updatedAfter?: Date;
  /** Only articles in this location (new, later, shortlist, archive, feed) */
  location?: Location;
  /** Only articles with this tag key; `''` returns untagged ones */
  tag?: string;
}

function articleParams({
  updatedAfter,
  location,
  tag,
}: ArticleFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (updatedAfter) {
    params.set('updatedAfter', updatedAfter.toISOString());
  }
  if (location) {
    params.set('location', location);
  }
  if (tag !== undefined) {
    params.set('tag', tag);
  }
  return params;
}

/**
 * Fetch articles from Readwise Reader
 */
export async function fetchArticles(
  filter: ArticleFilter = {},
): Promise<Article[]> {
  return fetchAllPages<Article>('/list/', articleParams(filter));
}

/**
 * Like fetchArticles, but a page (up to 100 articles) at a time, so callers
 * can work through a big list and stop when they run out of time
 */
export function articlePages(filter: ArticleFilter = {}) {
  return listPages<Article>('/list/', articleParams(filter));
}

/**
 * Every tag in the library
 */
export async function fetchTags(): Promise<Tag[]> {
  return fetchAllPages<Tag>('/tags/');
}

/**
 * The tag names on an article (its `tags` field is keyed by tag key)
 */
export function articleTagNames(article: Pick<Article, 'tags'>): string[] {
  return Object.entries(article.tags ?? {}).map(
    ([key, tag]) => (tag as { name?: string } | null)?.name ?? key,
  );
}

/**
 * Fetch a single article by ID (the list endpoint is the only way to read one)
 */
export async function fetchArticle(id: string): Promise<Article | undefined> {
  const params = new URLSearchParams({ id });
  const response = await makeRequest<ArticleListResponse>(`/list/?${params}`);
  return response.results[0];
}

/**
 * Update an article's tags and/or notes
 */
export async function updateDocument(
  id: string,
  payload: UpdateDocumentPayload,
): Promise<void> {
  await makeRequest(`/update/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Replace the tags on many documents, 50 per request (the API's limit)
 */
export async function bulkUpdateTags(
  updates: { id: string; tags: string[] }[],
): Promise<{ updated: number; failed: string[] }> {
  let updated = 0;
  const failed: string[] = [];

  for (let i = 0; i < updates.length; i += 50) {
    const response = await makeRequest<{
      results?: { id: string; success: boolean; error?: string }[];
    }>('/bulk_update/', {
      method: 'PATCH',
      body: JSON.stringify({ updates: updates.slice(i, i + 50) }),
    });
    // 207 means some items failed; each result says which
    for (const result of response.results ?? []) {
      if (result.success) updated += 1;
      else failed.push(`${result.id}: ${result.error ?? 'unknown error'}`);
    }
  }

  return { updated, failed };
}

/**
 * Save a new document to Readwise Reader
 */
export async function saveDocument(
  payload: SaveDocumentPayload,
): Promise<{ id: string; url: string }> {
  return makeRequest('/save/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
