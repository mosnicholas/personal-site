import { createHmac, randomBytes } from 'node:crypto';
import { secretsMatch } from './auth.js';
import { verifyOAuthToken } from './likes-oauth.js';
import { likesOrigin, trustedLikesOrigins } from './likes-origin.js';
import { likesOwnerKey } from './personal-site-config.js';

export { likesOrigin } from './likes-origin.js';
const cookieName = 'nimo_likes';
export const effectiveLikesOwnerKey = () => likesOwnerKey();
const likesBearerKey = () => process.env.LIKES_API_KEY ?? '';
const ownerKeyIsConfigured = () => effectiveLikesOwnerKey().length >= 32;
const sign = (value: string) =>
  createHmac('sha256', effectiveLikesOwnerKey())
    .update(`likes-session:${value}`)
    .digest('base64url');
export function sessionToken(now = Date.now()) {
  const value = `${Math.floor(now / 1000) + 7 * 86400}.${randomBytes(16).toString('hex')}`;
  return `${value}.${sign(value)}`;
}
export function authorizeLikeToken(token: string): boolean {
  if (!ownerKeyIsConfigured()) return false;
  if (secretsMatch(token, effectiveLikesOwnerKey())) return true;
  return isSignedOwnerSessionToken(token);
}
function isSignedOwnerSessionToken(token: string): boolean {
  if (!ownerKeyIsConfigured()) return false;
  const [expires, nonce, mac, extra] = token.split('.');
  return (
    !extra &&
    /^[0-9]+$/.test(expires ?? '') &&
    /^[a-f0-9]{32}$/.test(nonce ?? '') &&
    Number(expires) > Date.now() / 1000 &&
    Number(expires) <= Date.now() / 1000 + 7 * 86400 + 60 &&
    secretsMatch(mac, sign(`${expires}.${nonce}`))
  );
}
export function ownerCookie(request: Request): boolean {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  return Boolean(cookie && isSignedOwnerSessionToken(cookie));
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return origin !== null && trustedLikesOrigins().includes(origin);
}
export function rejectUnauthorizedLikes(
  request: Request,
): Response | undefined {
  if (!ownerKeyIsConfigured())
    return Response.json(
      { error: 'Private collection is not configured' },
      { status: 503 },
    );
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer (.+)$/)?.[1];
  const actualOrigin = new URL(request.url).origin;
  // Browser sessions must stay in cookies; bearer access accepts only the API
  // key or purpose-scoped OAuth token, never a stolen session as a bearer.
  if (
    token &&
    (secretsMatch(token, effectiveLikesOwnerKey()) ||
      (likesBearerKey().length >= 32 &&
        secretsMatch(token, likesBearerKey())) ||
      (trustedLikesOrigins().includes(actualOrigin) &&
        verifyOAuthToken(token, `${actualOrigin}/api/likes?op=mcp`)))
  )
    return undefined;
  if (ownerCookie(request)) {
    if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request))
      return Response.json(
        { error: 'Cross-origin request rejected' },
        { status: 403 },
      );
    return undefined;
  }
  return Response.json(
    { error: 'Sign in to your collection' },
    { status: 401 },
  );
}
export function loginLikes(request: Request, supplied: unknown) {
  if (!ownerKeyIsConfigured())
    return Response.json(
      { error: 'Private collection is not configured' },
      { status: 503 },
    );
  if (!sameOrigin(request))
    return Response.json(
      { error: 'Cross-origin request rejected' },
      { status: 403 },
    );
  if (
    typeof supplied !== 'string' ||
    !secretsMatch(supplied, effectiveLikesOwnerKey())
  )
    return Response.json({ error: 'Incorrect access key' }, { status: 401 });
  return Response.json(
    { success: true },
    {
      headers: {
        'Set-Cookie': cookieHeader(sessionToken()),
        'Cache-Control': 'no-store',
      },
    },
  );
}
export function cookieHeader(value: string) {
  const secure = new URL(likesOrigin()).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 7 * 86400 : 0}${secure}`;
}
export function logoutLikes() {
  return Response.json(
    { success: true },
    { headers: { 'Set-Cookie': cookieHeader('') } },
  );
}
