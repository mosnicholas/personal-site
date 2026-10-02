import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for shared secrets.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
