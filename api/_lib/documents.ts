/**
 * Our mirror of the Readwise library (the `documents` table): Readwise's
 * fields, kept fresh by the daily sync, the webhook and the rebalance, plus
 * our own summaries, and each saved document's full text
 * (`document_texts`).
 *
 * Readwise stays the source of truth for documents, reading state and tags;
 * the mirror lets everything else read without Readwise's 20 requests/min
 * limit. Writers that can run without a database (the webhook, the rebalance)
 * skip the mirror when DATABASE_URL isn't set.
 */

import { getSql, requireSql, wordPatterns } from './db.js';
import { type Article, articleTagNames } from './readwise.js';

export interface OurSummary {
  summary: string;
  keyPoints: string[];
}

/** Documents only: no highlights or notes */
export const isDocument = (article: Article) =>
  !article.parent_id &&
  article.category !== 'highlight' &&
  article.category !== 'note';

/**
 * Insert documents or refresh their Readwise fields (never our summaries)
 */
export async function upsertDocuments(articles: Article[]): Promise<number> {
  const sqlPromise = getSql();
  const rows = articles.filter(isDocument).map((article) => ({
    id: article.id,
    title: article.title ?? '',
    author: article.author,
    url: article.url,
    source_url: article.source_url,
    site_name: article.site_name,
    category: article.category,
    location: article.location,
    saved_at: article.saved_at ?? article.created_at,
    updated_at: article.updated_at,
    first_opened_at: article.first_opened_at,
    last_opened_at: article.last_opened_at,
    reading_progress: article.reading_progress ?? 0,
    word_count: article.word_count,
    readwise_summary: article.summary,
    tags: articleTagNames(article),
  }));
  if (!sqlPromise || rows.length === 0) return 0;

  const sql = await sqlPromise;
  await sql`
    INSERT INTO documents (
      id, title, author, url, source_url, site_name, category, location,
      saved_at, updated_at, first_opened_at, last_opened_at,
      reading_progress, word_count, readwise_summary, tags, synced_at
    )
    SELECT
      id, coalesce(title, ''), author, url, source_url, site_name, category,
      location, saved_at, updated_at, first_opened_at, last_opened_at,
      coalesce(reading_progress, 0), word_count, readwise_summary,
      coalesce(tags, '{}'), now()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
      id text, title text, author text, url text, source_url text,
      site_name text, category text, location text, saved_at timestamptz,
      updated_at timestamptz, first_opened_at timestamptz,
      last_opened_at timestamptz, reading_progress real, word_count integer,
      readwise_summary text, tags text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      url = excluded.url,
      source_url = excluded.source_url,
      site_name = excluded.site_name,
      category = excluded.category,
      location = excluded.location,
      saved_at = excluded.saved_at,
      updated_at = excluded.updated_at,
      first_opened_at = excluded.first_opened_at,
      last_opened_at = excluded.last_opened_at,
      reading_progress = excluded.reading_progress,
      word_count = excluded.word_count,
      readwise_summary = excluded.readwise_summary,
      tags = excluded.tags,
      synced_at = now()`;
  return rows.length;
}

/**
 * Record tags just written to Readwise
 */
export async function setDocumentTags(
  updates: { id: string; tags: string[] }[],
): Promise<void> {
  const sqlPromise = getSql();
  if (!sqlPromise || updates.length === 0) return;
  const sql = await sqlPromise;
  await sql`
    UPDATE documents d SET tags = r.tags
    FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
      AS r(id text, tags text[])
    WHERE d.id = r.id`;
}

/**
 * Store our summary; `version` (model and prompt) records what wrote it, and
 * lets a deliberate redo (`?redo=true` on the sync) find older ones
 */
export async function saveDocumentSummary(
  id: string,
  { summary, keyPoints }: OurSummary,
  version: string,
): Promise<void> {
  const sqlPromise = getSql();
  if (!sqlPromise) return;
  const sql = await sqlPromise;
  await sql`
    UPDATE documents
    SET summary = ${summary}, key_points = ${JSON.stringify(keyPoints)}::jsonb,
        summary_model = ${version}, summarized_at = now()
    WHERE id = ${id}`;
}

/** Counts a failed attempt, so a document that can't be summarized is retried a few times, not forever */
export async function recordSummaryFailure(id: string): Promise<void> {
  const sql = await requireSql();
  await sql`
    UPDATE documents SET summary_attempts = summary_attempts + 1
    WHERE id = ${id}`;
}

/**
 * Our summaries for these documents, where they exist
 */
export async function ourSummaries(
  ids: string[],
): Promise<Map<string, OurSummary>> {
  const summaries = new Map<string, OurSummary>();
  const sqlPromise = getSql();
  if (!sqlPromise || ids.length === 0) return summaries;
  try {
    const sql = await sqlPromise;
    const rows = await sql`
      SELECT id, summary, key_points FROM documents
      WHERE id = ANY(${ids}) AND summary IS NOT NULL`;
    for (const row of rows) {
      summaries.set(row.id as string, {
        summary: row.summary as string,
        keyPoints: (row.key_points as string[] | null) ?? [],
      });
    }
  } catch (error) {
    console.warn('Could not load our summaries:', error);
  }
  return summaries;
}

export const MAX_SUMMARY_ATTEMPTS = 3;
// Books can run to millions of characters; this keeps one from eating the
// free plan's 1 GB
const MAX_STORED_TEXT_CHARS = 1_000_000;

export interface DocumentToSummarize {
  id: string;
  title: string;
  author: string | null;
  site: string | null;
  category: string;
}

/**
 * Saved (non-feed) documents without a summary, newest first. With `redo`,
 * also those whose summary came from an older `version`, missing ones first
 */
export async function documentsNeedingSummary(
  version: string,
  limit: number,
  redo = false,
): Promise<DocumentToSummarize[]> {
  const sql = await requireSql();
  return (await sql`
    SELECT id, title, author, site_name AS site, category FROM documents
    WHERE (summary IS NULL
        OR (${redo}::boolean AND summary_model IS DISTINCT FROM ${version}))
      AND location IS DISTINCT FROM 'feed'
      AND summary_attempts < ${MAX_SUMMARY_ATTEMPTS}
    ORDER BY summary IS NULL DESC, saved_at DESC NULLS LAST
    LIMIT ${limit}`) as DocumentToSummarize[];
}

export async function countDocumentsNeedingSummary(
  version: string,
  redo = false,
): Promise<number> {
  const sql = await requireSql();
  const [row] = await sql`
    SELECT count(*) AS count FROM documents
    WHERE (summary IS NULL
        OR (${redo}::boolean AND summary_model IS DISTINCT FROM ${version}))
      AND location IS DISTINCT FROM 'feed'
      AND summary_attempts < ${MAX_SUMMARY_ATTEMPTS}`;
  return Number(row.count);
}

export async function saveDocumentText(
  id: string,
  text: string,
): Promise<void> {
  const sqlPromise = getSql();
  if (!sqlPromise) return;
  const sql = await sqlPromise;
  const stored = text.slice(0, MAX_STORED_TEXT_CHARS);
  await sql`
    INSERT INTO document_texts (id, text, chars, truncated, fetched_at)
    VALUES (${id}, ${stored}, ${text.length}, ${text.length > stored.length}, now())
    ON CONFLICT (id) DO UPDATE SET
      text = excluded.text, chars = excluded.chars,
      truncated = excluded.truncated, fetched_at = now()`;
}

export async function getDocumentText(id: string): Promise<string | undefined> {
  const sql = await requireSql();
  const [row] = await sql`SELECT text FROM document_texts WHERE id = ${id}`;
  return row?.text as string | undefined;
}

/**
 * Full texts for as many of these documents as fit in `budgetChars`,
 * shortest first, so the most documents come with their text; the rest are
 * left to their summaries
 */
export async function documentTexts(
  ids: string[],
  budgetChars: number,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  const sqlPromise = getSql();
  if (!sqlPromise || ids.length === 0) return texts;
  try {
    const sql = await sqlPromise;
    const sizes = await sql`
      SELECT id, length(text) AS chars FROM document_texts
      WHERE id = ANY(${ids}) ORDER BY length(text), id`;
    const chosen: string[] = [];
    let used = 0;
    for (const row of sizes) {
      const chars = Number(row.chars);
      if (used + chars > budgetChars) break;
      used += chars;
      chosen.push(row.id as string);
    }
    if (chosen.length === 0) return texts;
    const rows = await sql`
      SELECT id, text FROM document_texts WHERE id = ANY(${chosen})`;
    for (const row of rows) texts.set(row.id as string, row.text as string);
  } catch (error) {
    console.warn('Could not load document texts:', error);
  }
  return texts;
}

export interface TagInUse {
  name: string;
  documents: number;
  definition: string | null;
}

/**
 * Every tag in the mirror with how many documents use it and its glossary
 * definition, most used first; undefined if the mirror is empty or
 * unavailable
 */
export async function tagsInUse(): Promise<TagInUse[] | undefined> {
  const sqlPromise = getSql();
  if (!sqlPromise) return undefined;
  try {
    const sql = await sqlPromise;
    const rows = await sql`
      SELECT tag AS name, count(*) AS documents, max(t.definition) AS definition
      FROM documents d
      CROSS JOIN LATERAL unnest(d.tags) AS tag
      LEFT JOIN tags t ON t.name = tag
      GROUP BY tag
      ORDER BY count(*) DESC, tag`;
    if (rows.length === 0) return undefined;
    return rows.map((row) => ({
      name: row.name as string,
      documents: Number(row.documents),
      definition: row.definition as string | null,
    }));
  } catch (error) {
    console.warn('Could not load tags from the mirror:', error);
    return undefined;
  }
}

/** A saved document as the MCP server shows it */
export interface SavedDocument {
  id: string;
  title: string;
  author: string | null;
  site: string | null;
  /** The original article, else Reader's copy */
  url: string | null;
  /** YYYY-MM-DD */
  saved: string | null;
  /** new, later, shortlist or archive */
  location: string | null;
  /** How far I got, 0-1 */
  progress: number;
  tags: string[];
  /** Ours, or Readwise's when we have none */
  summary: string | null;
}

const savedDocument = (row: Record<string, unknown>): SavedDocument => ({
  id: String(row.id),
  title: String(row.title),
  author: (row.author as string | null) ?? null,
  site: (row.site_name as string | null) ?? null,
  url: (row.url as string | null) ?? null,
  saved: (row.saved as string | null) ?? null,
  location: (row.location as string | null) ?? null,
  progress: Number(row.reading_progress),
  tags: row.tags as string[],
  summary: (row.summary as string | null) ?? null,
});

/**
 * Saved documents (not the feed) matching every word of `query` in their
 * title, author, site, tags or summary, newest first; `since` is a date
 */
export async function searchDocuments({
  query = '',
  since,
  limit = 20,
}: {
  query?: string;
  since?: string;
  limit?: number;
}): Promise<SavedDocument[]> {
  const sql = await requireSql();
  const rows = await sql`
    SELECT id, title, author, site_name, coalesce(source_url, url) AS url,
      saved_at::date::text AS saved, location, reading_progress, tags,
      coalesce(summary, readwise_summary) AS summary
    FROM documents
    WHERE location IS DISTINCT FROM 'feed'
      AND (${since ?? null}::date IS NULL OR saved_at >= ${since ?? null}::date)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${wordPatterns(query)}::text[]) AS pattern
        WHERE concat_ws(' ', title, author, site_name, summary,
          readwise_summary, array_to_string(tags, ' ')) NOT ILIKE pattern)
    ORDER BY saved_at DESC NULLS LAST
    LIMIT ${limit}`;
  return rows.map(savedDocument);
}

/** One saved document, with its full text when we have it */
export async function getSavedDocument(
  id: string,
): Promise<(SavedDocument & { text: string | null }) | undefined> {
  const sql = await requireSql();
  const [row] = await sql`
    SELECT d.id, d.title, d.author, d.site_name,
      coalesce(d.source_url, d.url) AS url, d.saved_at::date::text AS saved,
      d.location, d.reading_progress, d.tags,
      coalesce(d.summary, d.readwise_summary) AS summary, t.text
    FROM documents d
    LEFT JOIN document_texts t ON t.id = d.id
    WHERE d.id = ${id} AND d.location IS DISTINCT FROM 'feed'`;
  return row
    ? { ...savedDocument(row), text: (row.text as string | null) ?? null }
    : undefined;
}

export async function getSyncState<T>(name: string): Promise<T | undefined> {
  const sql = await requireSql();
  const [row] = await sql`SELECT value FROM sync_state WHERE name = ${name}`;
  return row?.value as T | undefined;
}

export async function setSyncState(
  name: string,
  value: unknown,
): Promise<void> {
  const sql = await requireSql();
  await sql`
    INSERT INTO sync_state (name, value, updated_at)
    VALUES (${name}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`;
}
