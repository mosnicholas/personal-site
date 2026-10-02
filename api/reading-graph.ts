import { readingGraph, tagDetail } from './_lib/graph.js';

/**
 * Public data for the /reading page (see _lib/graph.ts).
 *
 * - GET /api/reading-graph: tags, clusters, shared-document edges, timeline
 * - GET /api/reading-graph?tag=<name>: one tag's brief and documents
 *
 * The data changes at most daily, so Vercel's CDN caches responses for an
 * hour and serves stale ones for a day while refreshing.
 */

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const tag = new URL(request.url).searchParams.get('tag');
      if (tag !== null) {
        const detail = await tagDetail(tag);
        return detail
          ? Response.json(detail, { headers: CACHE_HEADERS })
          : Response.json({ error: 'Unknown tag' }, { status: 404 });
      }
      return Response.json(await readingGraph(), { headers: CACHE_HEADERS });
    } catch (error) {
      console.error('Error building the reading graph:', error);
      return Response.json(
        { error: 'Could not load the reading graph' },
        { status: 500 },
      );
    }
  },
};
