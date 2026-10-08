/**
 * Applies the files in db/migrations that `schema_migrations` doesn't list
 * yet, in name order, each in its own transaction. Run with
 * `npm run db:migrate`; it connects with SUPABASE_SESSION_URL (the session
 * pooler, since migrations can use statements the transaction pooler can't).
 */

import { readdirSync, readFileSync } from 'node:fs';

import postgres from 'postgres';

const url = process.env.SUPABASE_SESSION_URL;
if (!url) throw new Error('SUPABASE_SESSION_URL is not set in .env.local');

const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = new URL('../db/migrations/', import.meta.url);

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((row) => row.name),
  );
  const pending = readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && !applied.has(name))
    .sort();

  for (const name of pending) {
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(new URL(name, dir), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    console.log(`Applied ${name}`);
  }
  if (pending.length === 0) console.log('Nothing to apply.');
} finally {
  await sql.end();
}
