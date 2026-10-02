/**
 * Best-effort fixed-window rate limiter kept in function memory.
 *
 * Counts live in the function instance: Vercel can run more than one instance
 * and cold starts reset them, so this caps abuse rather than enforcing an exact
 * global limit. It's free and needs no external store. For a hard ceiling, set
 * a spend limit on the API key; for an exact limit, add a Vercel WAF rule.
 */

// Bounds memory if someone cycles through lots of IPs
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function createRateLimiter({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return (key: string): RateLimitResult => {
    const now = Date.now();
    let window = windows.get(key);

    if (!window || window.resetAt <= now) {
      if (windows.size >= MAX_TRACKED_KEYS) {
        for (const [k, w] of windows) {
          if (w.resetAt <= now) windows.delete(k);
        }
        if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
      }
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }

    window.count += 1;
    return {
      allowed: window.count <= limit,
      retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000),
    };
  };
}

/**
 * The caller's IP. Vercel overwrites x-forwarded-for with the real client IP,
 * so clients can't spoof it.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  );
}
