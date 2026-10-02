/**
 * Keeps the `documents` mirror in step with Readwise, and fills in our
 * summaries. Both work within a deadline and pick up where they left off, so
 * the first backfill can take several runs.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  countDocumentsNeedingSummary,
  documentsNeedingSummary,
  getDocumentText,
  getSyncState,
  recordSummaryFailure,
  saveDocumentSummary,
  saveDocumentText,
  setSyncState,
  upsertDocuments,
} from './documents.js';
import { fetchArticle, fetchArticlePage } from './readwise.js';
import {
  htmlToText,
  MIN_TEXT_CHARS,
  SUMMARY_VERSION,
  summarizeDocument,
} from './summarize.js';

const SYNC_STATE = 'documents';
// Re-list a little before the last sync started, in case of clock skew
const OVERLAP_MS = 10 * 60_000;
// Readwise allows 20 list requests a minute, and a document whose text we
// don't have yet needs one; Sonnet takes ~30s per document
const SUMMARY_CONCURRENCY = 6;

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
 * Summarize saved documents that have no summary yet (newest saves first),
 * from their stored text, fetching and storing it first if needed. A prompt
 * change doesn't rewrite existing summaries; `redo` does, for every summary
 * from an older SUMMARY_VERSION. `limit` caps how many this run tries
 */
export async function summarizeMissing(
  deadline: number,
  { limit = Infinity, redo = false }: { limit?: number; redo?: boolean } = {},
): Promise<{
  summarized: number;
  failed: number;
  remaining: number;
}> {
  let summarized = 0;
  let failed = 0;
  let throttled = false;
  const tried = new Set<string>();

  while (Date.now() < deadline && !throttled && tried.size < limit) {
    const batch = (
      await documentsNeedingSummary(
        SUMMARY_VERSION,
        SUMMARY_CONCURRENCY + tried.size,
        redo,
      )
    ).filter(({ id }) => !tried.has(id));
    if (batch.length === 0) break;

    await Promise.all(
      batch
        .slice(0, Math.min(SUMMARY_CONCURRENCY, limit - tried.size))
        .map(async (document) => {
          const { id } = document;
          tried.add(id);
          try {
            let text = await getDocumentText(id);
            if (!text) {
              const article = await fetchArticle(id, { withHtmlContent: true });
              if (!article) throw new Error('not found');
              text = htmlToText(article.html_content ?? '');
              if (text.length >= MIN_TEXT_CHARS)
                await saveDocumentText(id, text);
            }
            if (text.length < MIN_TEXT_CHARS) {
              throw new Error(`only ${text.length} characters of text`);
            }
            const summary = await summarizeDocument(id, document, text);
            await saveDocumentSummary(id, summary, SUMMARY_VERSION);
            summarized += 1;
          } catch (error) {
            // Rate limits and overload aren't the document's fault: stop this
            // run without using up its attempts, and let the next run retry
            if (
              error instanceof Anthropic.APIError &&
              (error.status === 429 || error.status === 529)
            ) {
              console.warn(
                `Anthropic is throttling (${error.status}), stopping`,
              );
              throttled = true;
              return;
            }
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
    remaining: await countDocumentsNeedingSummary(SUMMARY_VERSION, redo),
  };
}
