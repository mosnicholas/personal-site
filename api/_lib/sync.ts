/**
 * Keeps the `documents` mirror in step with Readwise, and fills in our
 * summaries. Both work within a deadline and pick up where they left off, so
 * the first backfill can take several runs.
 */

import {
  countDocumentsNeedingSummary,
  documentsNeedingSummary,
  getSyncState,
  recordSummaryFailure,
  saveDocumentSummary,
  setSyncState,
  upsertDocuments,
} from './documents.js';
import { fetchArticle, fetchArticlePage } from './readwise.js';
import {
  htmlToText,
  MIN_TEXT_CHARS,
  SUMMARY_MODEL,
  summarizeDocument,
} from './summarize.js';

const SYNC_STATE = 'documents';
// Re-list a little before the last sync started, in case of clock skew
const OVERLAP_MS = 10 * 60_000;
// Readwise allows 20 list requests a minute, and each summary needs one
const SUMMARY_CONCURRENCY = 4;

interface SyncState {
  /** When the last complete listing started; the next one lists from here */
  lastCompleteStart: string | null;
  /** A listing in progress, resumed by the next run */
  listing: {
    since: string | null;
    startedAt: string;
    pageCursor: string | null;
  } | null;
}

/**
 * Copy documents changed since the last complete sync (or everything, the
 * first time) into the mirror, a page at a time, saving the page cursor so
 * the next run resumes
 */
export async function syncDocuments(
  deadline: number,
): Promise<{ upserted: number; complete: boolean }> {
  const state = (await getSyncState<SyncState>(SYNC_STATE)) ?? {
    lastCompleteStart: null,
    listing: null,
  };
  const listing = state.listing ?? {
    since: state.lastCompleteStart
      ? new Date(Date.parse(state.lastCompleteStart) - OVERLAP_MS).toISOString()
      : null,
    startedAt: new Date().toISOString(),
    pageCursor: null,
  };
  const filter = listing.since ? { updatedAfter: new Date(listing.since) } : {};

  let upserted = 0;
  while (Date.now() < deadline) {
    let page;
    try {
      page = await fetchArticlePage(filter, listing.pageCursor);
    } catch (error) {
      if (!listing.pageCursor) throw error;
      // A saved cursor can expire; start this listing over
      console.warn('Page cursor failed, restarting the listing:', error);
      listing.pageCursor = null;
      continue;
    }
    upserted += await upsertDocuments(page.results);
    listing.pageCursor = page.nextPageCursor;
    if (!listing.pageCursor) {
      await setSyncState(SYNC_STATE, {
        lastCompleteStart: listing.startedAt,
        listing: null,
      } satisfies SyncState);
      return { upserted, complete: true };
    }
    await setSyncState(SYNC_STATE, { ...state, listing } satisfies SyncState);
  }
  return { upserted, complete: false };
}

/**
 * Summarize saved documents that don't have our summary yet, newest first
 */
export async function summarizeMissing(deadline: number): Promise<{
  summarized: number;
  failed: number;
  remaining: number;
}> {
  let summarized = 0;
  let failed = 0;
  const tried = new Set<string>();

  while (Date.now() < deadline) {
    const batch = (
      await documentsNeedingSummary(SUMMARY_CONCURRENCY + tried.size)
    ).filter(({ id }) => !tried.has(id));
    if (batch.length === 0) break;

    await Promise.all(
      batch.slice(0, SUMMARY_CONCURRENCY).map(async ({ id }) => {
        tried.add(id);
        try {
          const article = await fetchArticle(id, { withHtmlContent: true });
          const text = htmlToText(article?.html_content ?? '');
          if (!article || text.length < MIN_TEXT_CHARS) {
            throw new Error(
              article ? `only ${text.length} characters of text` : 'not found',
            );
          }
          const summary = await summarizeDocument(
            id,
            {
              title: article.title,
              author: article.author,
              site: article.site_name,
              category: article.category,
            },
            text,
          );
          await saveDocumentSummary(id, summary, SUMMARY_MODEL);
          summarized += 1;
        } catch (error) {
          console.warn(`Could not summarize ${id}:`, error);
          await recordSummaryFailure(id);
          failed += 1;
        }
      }),
    );
  }

  return {
    summarized,
    failed,
    remaining: await countDocumentsNeedingSummary(),
  };
}
