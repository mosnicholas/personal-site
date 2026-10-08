/**
 * Postgres on Supabase (the transaction pooler, SUPABASE_DATABASE_URL). Holds
 * the LLM trace log and model prices, a mirror of the Readwise library with
 * each saved document's text and our summary, the tag glossary, the likes
 * collection (/likes), and a log of Readwise saves and webhook deliveries.
 *
 * The schema lives in db/migrations, applied with `npm run db:migrate`
 * (scripts/migrate.ts); nothing here creates tables.
 */

import { attachDatabasePool } from '@vercel/functions';
import postgres from 'postgres';

export type Sql = postgres.Sql;

// Kept alive this long after a query, so Vercel doesn't freeze the function
// with open connections
const IDLE_TIMEOUT_S = 10;

let client: Sql | undefined;

/**
 * The shared client, or undefined without SUPABASE_DATABASE_URL. It connects
 * on its first query
 */
export function getSql(): Sql | undefined {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) return undefined;

  if (!client) {
    // Fluid compute shares an instance between concurrent requests, so a few
    // connections; Supavisor's transaction mode has no prepared statements
    const listeners: (() => void)[] = [];
    client = postgres(url, {
      prepare: false,
      max: 3,
      // Supavisor stalls when a second query is sent before the first one
      // answers, so queries wait for a free connection instead
      // (a real option that postgres.js's types leave out)
      ...({ max_pipeline: 0 } as object),
      idle_timeout: IDLE_TIMEOUT_S,
      connect_timeout: 10,
      // Every query is a "release" for attachDatabasePool
      debug: () => listeners.forEach((listener) => listener()),
      types: {
        // Our code passes JSON as a string cast to ::jsonb; the default
        // serializer would encode that string a second time
        jsonb: {
          to: 3802,
          from: [3802],
          serialize: (value: unknown) =>
            typeof value === 'string' ? value : JSON.stringify(value),
          parse: (value: string) => JSON.parse(value) as unknown,
        },
      },
    });
    // postgres.js doesn't have the pool events attachDatabasePool listens
    // for, so it gets an object that looks like a pg pool
    attachDatabasePool({
      options: { idleTimeoutMillis: IDLE_TIMEOUT_S * 1000 + 1000 },
      on: (_event: 'release', listener: () => void) => {
        listeners.push(listener);
      },
    });
  }
  return client;
}

/**
 * ILIKE patterns for each word of a search, so a row matches when every word
 * appears somewhere in it
 */
export const wordPatterns = (query: string) =>
  query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`);

/**
 * Like getSql, for callers that can't work without the database
 */
export function requireSql(): Sql {
  const sql = getSql();
  if (!sql) throw new Error('SUPABASE_DATABASE_URL is not set');
  return sql;
}
