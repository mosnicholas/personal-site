/** Trusted deployment metadata, never request Host/forwarded headers. */
function absoluteOrigin(value: string): string {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'The Likes origin must be an http(s) origin without credentials or a path',
    );
  }
  return url.origin;
}
const deploymentOrigin = (domain: string) =>
  absoluteOrigin(`https://${domain}`);

export function likesOrigin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LIKES_ORIGIN) return absoluteOrigin(env.LIKES_ORIGIN);
  if (
    env.VERCEL_ENV === 'preview' &&
    (env.VERCEL_BRANCH_URL || env.VERCEL_URL)
  ) {
    return deploymentOrigin(env.VERCEL_BRANCH_URL || env.VERCEL_URL!);
  }
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return deploymentOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
  }
  return 'https://nimo.fyi';
}

export function trustedLikesOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.LIKES_ORIGIN) return [likesOrigin(env)];
  const domains = env.VERCEL ? [env.VERCEL_URL, env.VERCEL_BRANCH_URL] : [];
  return [
    ...new Set([
      likesOrigin(env),
      ...domains
        .filter((value): value is string => Boolean(value))
        .map(deploymentOrigin),
    ]),
  ];
}

export function likesRequestOrigin(request: Request): string {
  const actual = new URL(request.url).origin;
  return trustedLikesOrigins().includes(actual) ? actual : likesOrigin();
}

export function isLikesResourceUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    trustedLikesOrigins().some((site) => value === `${site}/api/likes?op=mcp`)
  );
}
