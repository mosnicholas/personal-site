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

export function personalSiteOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.PERSONAL_SITE_ORIGIN) return absoluteOrigin(env.PERSONAL_SITE_ORIGIN);
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

export function trustedPersonalSiteOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.PERSONAL_SITE_ORIGIN || env.LIKES_ORIGIN)
    return [personalSiteOrigin(env)];
  const domains = env.VERCEL ? [env.VERCEL_URL, env.VERCEL_BRANCH_URL] : [];
  return [
    ...new Set([
      personalSiteOrigin(env),
      ...domains
        .filter((value): value is string => Boolean(value))
        .map(deploymentOrigin),
    ]),
  ];
}

export function personalSiteRequestOrigin(request: Request): string {
  const actual = new URL(request.url).origin;
  return trustedPersonalSiteOrigins().includes(actual)
    ? actual
    : personalSiteOrigin();
}

export const likesOrigin = personalSiteOrigin;
export const trustedLikesOrigins = trustedPersonalSiteOrigins;
export const likesRequestOrigin = personalSiteRequestOrigin;

export function isLikesResourceUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    trustedPersonalSiteOrigins().some(
      (site) => value === `${site}/api/likes?op=mcp`,
    )
  );
}
