/** The site-wide owner secret. It never falls back to a feature-specific key. */
export function personalSiteOwnerKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.PERSONAL_SITE_OWNER_KEY ?? '';
}

/**
 * The effective owner secret for Likes.
 *
 * LIKES_API_KEY remains a backwards-compatible Likes-only owner secret when
 * the site-wide key has not been configured. A non-empty site-wide key always
 * wins, including an invalid one, so a bad rotation cannot silently fall back.
 */
export function likesOwnerKey(env: NodeJS.ProcessEnv = process.env): string {
  return personalSiteOwnerKey(env) || env.LIKES_API_KEY || '';
}
