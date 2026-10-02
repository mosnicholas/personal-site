/**
 * The tag glossary (`tags` table). Weekly, Claude Opus 5.5 writes a one-line
 * definition for every tag and sorts the tags into named clusters: the tagger
 * reads the definitions so it can tell neighboring tags apart, and the
 * /reading page draws the clusters. Tags that have grown get a brief from
 * Claude Sonnet 5.5 on what the documents under them say.
 */

import { getAnthropic } from './anthropic.js';
import { getSql, requireSql } from './db.js';
import { OTHER_TAG } from './taxonomy.js';
import { tracedCall } from './traces.js';

const GLOSSARY_MODEL = 'claude-opus-5-5';
const BRIEF_MODEL = 'claude-sonnet-5-5';
// Definitions are redone weekly; reruns within the week skip them
const REDEFINE_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
const MIN_DOCUMENTS_FOR_BRIEF = 3;
const MAX_BRIEF_DOCUMENTS = 40;
const BRIEF_CONCURRENCY = 6;

export interface GlossaryEntry {
  definition: string | null;
  cluster: string | null;
}

const GLOSSARY_PROMPT = `You keep the glossary for the tag taxonomy of a personal reading library. You get every tag in use, with how many documents carry it and a few example titles, plus last week's definition and cluster where there was one.

1. For every tag, write a definition of at most 15 words saying what it covers, precise enough that a tagger can tell it from neighboring tags. When a neighbor is close, say what this one excludes (for example "Measuring model quality and benchmarks; not training methods").
2. Group all the tags into 6 to 12 clusters with short, plain labels of 1 to 3 words (for example "AI engineering", "Company building", "Food & cooking"). Every tag belongs to exactly one cluster.

Keep last week's definitions and cluster labels unless they're wrong or the tag's meaning has shifted, so the glossary and the clusters stay stable from week to week.`;

const GLOSSARY_SCHEMA = {
  type: 'object',
  properties: {
    clusters: { type: 'array', items: { type: 'string' } },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          definition: { type: 'string' },
          cluster: { type: 'string' },
        },
        required: ['name', 'definition', 'cluster'],
        additionalProperties: false,
      },
    },
  },
  required: ['clusters', 'tags'],
  additionalProperties: false,
};

const BRIEF_PROMPT = `You write the brief for one tag on a public page that maps everything nimo (founder of Junior, an AI startup) has saved to read. You get the tag, its definition, and the documents saved under it, newest first, with their summaries.

Write 3 to 5 sentences on what these documents say together: the main ideas and claims, where sources disagree, and how the thread has developed over time. Name a standout piece or two by title. Write about the documents, not about the reader. Plain text: no preamble, headings, or lists.`;

/**
 * Definitions and clusters by tag name (empty without a database)
 */
export async function getGlossary(): Promise<Map<string, GlossaryEntry>> {
  const glossary = new Map<string, GlossaryEntry>();
  const sqlPromise = getSql();
  if (!sqlPromise) return glossary;
  try {
    const sql = await sqlPromise;
    const rows = await sql`SELECT name, definition, cluster FROM tags`;
    for (const row of rows) {
      glossary.set(row.name as string, {
        definition: row.definition as string | null,
        cluster: row.cluster as string | null,
      });
    }
  } catch (error) {
    console.warn('Could not load the tag glossary:', error);
  }
  return glossary;
}

/**
 * Have Opus define and cluster every tag in use, unless that happened in the
 * last few days (or `force`)
 */
export async function defineTags({ force = false } = {}): Promise<
  { tags: number; clusters: number } | { skipped: string }
> {
  const sql = await requireSql();
  const [last] = await sql`SELECT max(defined_at) AS at FROM tags`;
  if (
    !force &&
    last?.at &&
    Date.now() - new Date(last.at as string).getTime() < REDEFINE_AFTER_MS
  ) {
    return { skipped: `defined ${new Date(last.at as string).toISOString()}` };
  }

  const rows = await sql`
    SELECT tag AS name, count(*) AS documents,
      (array_agg(title ORDER BY saved_at DESC NULLS LAST))[1:3] AS examples
    FROM documents, unnest(tags) AS tag
    WHERE tag <> ${OTHER_TAG}
    GROUP BY tag
    ORDER BY count(*) DESC, tag`;
  if (rows.length === 0) return { skipped: 'no tagged documents yet' };

  const previous = await getGlossary();
  const request = {
    model: GLOSSARY_MODEL,
    max_tokens: 32000,
    output_config: {
      effort: 'low' as const,
      format: { type: 'json_schema' as const, schema: GLOSSARY_SCHEMA },
    },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: GLOSSARY_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify({
          tags: rows.map((row) => ({
            name: row.name,
            documents: Number(row.documents),
            examples: row.examples,
            previous_definition: previous.get(row.name as string)?.definition,
            previous_cluster: previous.get(row.name as string)?.cluster,
          })),
        }),
      },
    ],
  };

  const names = new Set(rows.map((row) => row.name as string));
  const glossary = await tracedCall(
    {
      kind: 'tag_glossary',
      subjectId: new Date().toISOString().slice(0, 10),
      model: GLOSSARY_MODEL,
      request,
    },
    // Streaming keeps a long response from hitting HTTP timeouts
    () => getAnthropic().beta.messages.stream(request).finalMessage(),
    (message) => {
      if (
        message.stop_reason === 'refusal' ||
        message.stop_reason === 'max_tokens'
      ) {
        throw new Error(`Glossary incomplete (${message.stop_reason})`);
      }
      const output = JSON.parse(
        message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(''),
      ) as {
        clusters: string[];
        tags: { name: string; definition: string; cluster: string }[];
      };
      const clusters = new Set(output.clusters.map((label) => label.trim()));
      // Only tags in use, each once; an unknown cluster label becomes null
      const entries = new Map<string, GlossaryEntry>();
      for (const tag of output.tags) {
        if (!names.has(tag.name) || entries.has(tag.name)) continue;
        entries.set(tag.name, {
          definition: tag.definition.trim(),
          cluster: clusters.has(tag.cluster.trim()) ? tag.cluster.trim() : null,
        });
      }
      return { clusters: [...clusters], entries };
    },
  );

  const values = [...glossary.entries].map(([name, entry]) => ({
    name,
    ...entry,
  }));
  await sql`
    INSERT INTO tags (name, definition, cluster, defined_at)
    SELECT name, definition, cluster, now()
    FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb)
      AS r(name text, definition text, cluster text)
    ON CONFLICT (name) DO UPDATE SET
      definition = excluded.definition,
      cluster = excluded.cluster,
      defined_at = now()`;
  // Tags merged away or no longer used drop out of the glossary
  await sql`DELETE FROM tags WHERE NOT (name = ANY(${[...names]}))`;

  return { tags: values.length, clusters: glossary.clusters.length };
}

/**
 * Write briefs for tags with enough saved documents whose document count
 * changed since their last brief, biggest first
 */
export async function writeBriefs(
  deadline: number,
): Promise<{ written: number; failed: number; remaining: number }> {
  const sql = await requireSql();
  const pending = await sql`
    SELECT t.name, t.definition, count(d.id) AS documents
    FROM tags t
    JOIN documents d
      ON t.name = ANY(d.tags) AND d.location IS DISTINCT FROM 'feed'
    GROUP BY t.name, t.definition, t.brief_documents
    HAVING count(d.id) >= ${MIN_DOCUMENTS_FOR_BRIEF}
      AND t.brief_documents IS DISTINCT FROM count(d.id)
    ORDER BY count(d.id) DESC, t.name`;

  let written = 0;
  let failed = 0;
  let next = 0;
  while (next < pending.length && Date.now() < deadline) {
    const batch = pending.slice(next, next + BRIEF_CONCURRENCY);
    next += batch.length;
    await Promise.all(
      batch.map(async (tag) => {
        try {
          await writeBrief(
            tag.name as string,
            tag.definition as string | null,
            Number(tag.documents),
          );
          written += 1;
        } catch (error) {
          console.warn(`Could not write the brief for ${tag.name}:`, error);
          failed += 1;
        }
      }),
    );
  }
  return { written, failed, remaining: pending.length - written };
}

async function writeBrief(
  name: string,
  definition: string | null,
  documentCount: number,
): Promise<void> {
  const sql = await requireSql();
  const documents = await sql`
    SELECT title, site_name AS site, saved_at::date::text AS saved,
      coalesce(summary, readwise_summary) AS summary, key_points
    FROM documents
    WHERE ${name} = ANY(tags) AND location IS DISTINCT FROM 'feed'
    ORDER BY saved_at DESC NULLS LAST
    LIMIT ${MAX_BRIEF_DOCUMENTS}`;

  const request = {
    model: BRIEF_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' as const },
    system: BRIEF_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: JSON.stringify({
          tag: name,
          definition,
          documents_total: documentCount,
          documents,
        }),
      },
    ],
  };

  const brief = await tracedCall(
    { kind: 'tag_brief', subjectId: name, model: BRIEF_MODEL, request },
    () => getAnthropic().messages.create(request),
    (message) => {
      if (message.stop_reason === 'refusal') {
        throw new Error('Brief request was declined');
      }
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
      if (!text) throw new Error('Empty brief');
      return text;
    },
  );

  await sql`
    UPDATE tags
    SET brief = ${brief}, brief_documents = ${documentCount}, briefed_at = now()
    WHERE name = ${name}`;
}
