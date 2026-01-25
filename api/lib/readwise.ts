/**
 * Readwise Reader API client
 * Documentation: https://readwise.io/reader_api
 */

const READWISE_API_BASE = 'https://readwise.io/api/v3';

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
  location?: 'new' | 'later' | 'archive' | 'feed';
  category?: 'article' | 'email' | 'rss' | 'highlight' | 'note' | 'pdf' | 'epub' | 'tweet' | 'video';
  saved_using?: string;
  tags?: string[];
  notes?: string;
}

export interface UpdateDocumentPayload {
  tags?: string[];
  notes?: string;
  location?: 'new' | 'later' | 'archive' | 'feed';
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
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();

  const response = await fetch(`${READWISE_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Readwise API error (${response.status}): ${errorText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Fetch articles from Readwise Reader
 * @param updatedAfter - Only return articles updated after this date
 * @param location - Filter by location (new, later, archive, feed)
 */
export async function fetchArticles(
  updatedAfter?: Date,
  location?: string
): Promise<Article[]> {
  const articles: Article[] = [];
  let nextPageCursor: string | null = null;

  do {
    const params = new URLSearchParams();
    if (updatedAfter) {
      params.set('updatedAfter', updatedAfter.toISOString());
    }
    if (location) {
      params.set('location', location);
    }
    if (nextPageCursor) {
      params.set('pageCursor', nextPageCursor);
    }

    const queryString = params.toString();
    const endpoint = `/list/${queryString ? `?${queryString}` : ''}`;

    const response = await makeRequest<ArticleListResponse>(endpoint);
    articles.push(...response.results);
    nextPageCursor = response.nextPageCursor;
  } while (nextPageCursor);

  return articles;
}

/**
 * Fetch a single article by ID
 */
export async function fetchArticle(id: string): Promise<Article> {
  return makeRequest<Article>(`/get/${id}/`);
}

/**
 * Update an article's tags and/or notes
 */
export async function updateDocument(
  id: string,
  payload: UpdateDocumentPayload
): Promise<void> {
  await makeRequest(`/update/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Save a new document to Readwise Reader
 */
export async function saveDocument(payload: SaveDocumentPayload): Promise<{ id: string; url: string }> {
  return makeRequest('/save/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
