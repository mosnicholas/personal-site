/**
 * The data behind the public /reading page, read from the mirror: tags with
 * their clusters and definitions, which tags share documents, and saves per
 * week by cluster. Only saved (non-feed) documents count, and reading state
 * is left out.
 */

import { requireSql } from './db.js';
import { OTHER_TAG } from './taxonomy.js';

// Tags on a single document, and links between tags sharing only one, are
// noise on the map
const MIN_TAG_DOCUMENTS = 2;
const MIN_EDGE_WEIGHT = 2;
const TIMELINE_WEEKS = 52;
const MAX_TAG_DOCUMENTS = 200;

export interface ReadingGraph {
  generatedAt: string;
  documents: number;
  clusters: { id: string; label: string; tags: number; documents: number }[];
  tags: {
    name: string;
    documents: number;
    cluster: string | null;
    definition: string | null;
  }[];
  edges: { source: string; target: string; weight: number }[];
  timeline: { weeks: string[]; byCluster: Record<string, number[]> };
}

export interface TagDetail {
  tag: {
    name: string;
    documents: number;
    cluster: string | null;
    definition: string | null;
    brief: string | null;
  };
  documents: {
    title: string;
    author: string | null;
    site: string | null;
    url: string;
    saved: string;
  }[];
}

/** A cluster label as a stable id, e.g. "Food & cooking" -> "food-cooking" */
export const clusterId = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export async function readingGraph(): Promise<ReadingGraph> {
  const sql = requireSql();

  const [[totals], tagRows, edgeRows, clusterRows, weekRows] =
    await Promise.all([
      sql`
        SELECT count(*) AS documents FROM documents
        WHERE location IS DISTINCT FROM 'feed'`,
      sql`
        SELECT tag AS name, count(*) AS documents,
          max(t.cluster) AS cluster, max(t.definition) AS definition
        FROM documents d
        CROSS JOIN LATERAL unnest(d.tags) AS tag
        LEFT JOIN tags t ON t.name = tag
        WHERE d.location IS DISTINCT FROM 'feed' AND tag <> ${OTHER_TAG}
        GROUP BY tag
        HAVING count(*) >= ${MIN_TAG_DOCUMENTS}
        ORDER BY count(*) DESC, tag`,
      sql`
        SELECT a AS source, b AS target, count(*) AS weight
        FROM documents d
        CROSS JOIN LATERAL unnest(d.tags) AS a
        CROSS JOIN LATERAL unnest(d.tags) AS b
        WHERE d.location IS DISTINCT FROM 'feed' AND a < b
          AND a <> ${OTHER_TAG} AND b <> ${OTHER_TAG}
        GROUP BY a, b
        HAVING count(*) >= ${MIN_EDGE_WEIGHT}
        ORDER BY count(*) DESC`,
      sql`
        SELECT t.cluster AS label, count(DISTINCT t.name) AS tags,
          count(DISTINCT d.id) AS documents
        FROM tags t
        JOIN documents d
          ON t.name = ANY(d.tags) AND d.location IS DISTINCT FROM 'feed'
        WHERE t.cluster IS NOT NULL
        GROUP BY t.cluster
        ORDER BY count(DISTINCT d.id) DESC`,
      sql`
        SELECT date_trunc('week', d.saved_at)::date::text AS week,
          t.cluster AS label, count(DISTINCT d.id) AS documents
        FROM documents d
        CROSS JOIN LATERAL unnest(d.tags) AS tag
        JOIN tags t ON t.name = tag AND t.cluster IS NOT NULL
        WHERE d.location IS DISTINCT FROM 'feed'
          AND d.saved_at >= date_trunc('week', now()) - ${`${TIMELINE_WEEKS - 1} weeks`}::interval
        GROUP BY 1, 2`,
    ]);

  // Mondays, oldest first, ending this week; leading empty weeks trimmed
  const thisMonday = new Date();
  thisMonday.setUTCHours(0, 0, 0, 0);
  thisMonday.setUTCDate(
    thisMonday.getUTCDate() - ((thisMonday.getUTCDay() + 6) % 7),
  );
  let weeks = Array.from({ length: TIMELINE_WEEKS }, (_, i) => {
    const monday = new Date(thisMonday);
    monday.setUTCDate(monday.getUTCDate() - (TIMELINE_WEEKS - 1 - i) * 7);
    return monday.toISOString().slice(0, 10);
  });
  const firstWeek = weekRows.map((row) => row.week as string).sort()[0];
  if (firstWeek) weeks = weeks.filter((week) => week >= firstWeek);

  const byCluster: Record<string, number[]> = {};
  for (const row of weekRows) {
    const id = clusterId(row.label as string);
    byCluster[id] ??= weeks.map(() => 0);
    const index = weeks.indexOf(row.week as string);
    if (index >= 0) byCluster[id][index] = Number(row.documents);
  }

  return {
    generatedAt: new Date().toISOString(),
    documents: Number(totals.documents),
    clusters: clusterRows.map((row) => ({
      id: clusterId(row.label as string),
      label: row.label as string,
      tags: Number(row.tags),
      documents: Number(row.documents),
    })),
    tags: tagRows.map((row) => ({
      name: row.name as string,
      documents: Number(row.documents),
      cluster: row.cluster ? clusterId(row.cluster as string) : null,
      definition: row.definition as string | null,
    })),
    edges: edgeRows.map((row) => ({
      source: row.source as string,
      target: row.target as string,
      weight: Number(row.weight),
    })),
    timeline: { weeks, byCluster },
  };
}

export async function tagDetail(name: string): Promise<TagDetail | undefined> {
  const sql = requireSql();
  const [[tag], documents] = await Promise.all([
    sql`
      SELECT ${name}::text AS name, count(d.id) AS documents,
        t.cluster, t.definition, t.brief
      FROM documents d
      LEFT JOIN tags t ON t.name = ${name}
      WHERE ${name} = ANY(d.tags) AND d.location IS DISTINCT FROM 'feed'
      GROUP BY t.cluster, t.definition, t.brief`,
    sql`
      SELECT title, author, site_name AS site,
        coalesce(source_url, url) AS url, saved_at::date::text AS saved
      FROM documents
      WHERE ${name} = ANY(tags) AND location IS DISTINCT FROM 'feed'
      ORDER BY saved_at DESC NULLS LAST
      LIMIT ${MAX_TAG_DOCUMENTS}`,
  ]);
  if (!tag) return undefined;

  return {
    tag: {
      name,
      documents: Number(tag.documents),
      cluster: tag.cluster ? clusterId(tag.cluster as string) : null,
      definition: tag.definition as string | null,
      brief: tag.brief as string | null,
    },
    documents: documents.map((row) => ({
      title: row.title as string,
      author: row.author as string | null,
      site: row.site as string | null,
      url: row.url as string,
      saved: row.saved as string,
    })),
  };
}
