import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import {
  effectiveLikesOwnerKey,
  ownerCookie,
  sameOrigin,
} from './likes-auth.js';
import { secretsMatch } from './auth.js';
import { readBoundedText } from './likes-request.js';
import { getLikesSql } from './likes-store.js';
import {
  likesOrigin as origin,
  likesRequestOrigin,
  isLikesResourceUrl,
} from './likes-origin.js';

const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const CSRF_COOKIE = 'likes_oauth_csrf';
const MAX_REDIRECT_URIS = 5;
const OAUTH_BODY_LIMIT = 16384;

type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[] | string;
};

type AuthorizationCode = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string;
};

type RefreshToken = {
  client_id: string;
  resource: string;
  scope: string;
};

export function mcpResourceUrl(siteOrigin = origin()): string {
  return `${siteOrigin}/api/likes?op=mcp`;
}

function authorizationEndpoint(): string {
  return `${origin()}/api/likes/oauth/authorize`;
}

function tokenEndpoint(): string {
  return `${origin()}/api/likes/oauth/token`;
}

function registrationEndpoint(): string {
  return `${origin()}/api/likes/oauth/register`;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return undefined;
  }
}

function oauthSecret(): string | undefined {
  const ownerKey = effectiveLikesOwnerKey();
  return ownerKey.length >= 32 ? ownerKey : undefined;
}

function tokenHash(token: string): string | undefined {
  const secret = oauthSecret();
  return secret
    ? createHmac('sha256', secret)
        .update(`likes-oauth-token:${token}`)
        .digest('hex')
    : undefined;
}

function json(
  value: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  const result = Response.json(value, { status, headers });
  result.headers.set('Cache-Control', 'no-store');
  return result;
}

function oauthError(
  error: string,
  description?: string,
  status = 400,
): Response {
  return json(
    description ? { error, error_description: description } : { error },
    status,
  );
}

function noStoreHtml(
  html: string,
  status = 200,
  headers?: Record<string, string>,
): Response {
  const response = new Response(html, { status, headers });
  response.headers.set('Content-Type', 'text/html; charset=utf-8');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });
}

function parseCookies(request: Request): {
  values: Record<string, string>;
  malformed: boolean;
} {
  const header = request.headers.get('cookie');
  if (!header) return { values: {}, malformed: false };
  let malformed = false;
  const values = Object.fromEntries(
    header.split(';').flatMap((part) => {
      const index = part.indexOf('=');
      if (index < 1) return [];
      try {
        return [
          [
            part.slice(0, index).trim(),
            decodeURIComponent(part.slice(index + 1).trim()),
          ],
        ];
      } catch {
        malformed = true;
        return [];
      }
    }),
  );
  return { values, malformed };
}

function csrfCookie(value: string): string {
  const secure = origin().startsWith('https://') ? '; Secure' : '';
  return `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/api/likes/oauth/authorize; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

function clearCsrfCookie(): string {
  const secure = origin().startsWith('https://') ? '; Secure' : '';
  return `${CSRF_COOKIE}=; Path=/api/likes/oauth/authorize; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function isAllowedRedirectUri(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.hash) return false;
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname === '[::1]'))
    );
  } catch {
    return false;
  }
}

function redirectUris(client: OAuthClient): string[] {
  const values = Array.isArray(client.redirect_uris)
    ? client.redirect_uris
    : (JSON.parse(client.redirect_uris) as unknown);
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

async function findClient(clientId: string): Promise<OAuthClient | undefined> {
  const sql = await getLikesSql();
  const rows = (await sql.query(
    'SELECT client_id, client_name, redirect_uris FROM likes_oauth_clients WHERE client_id = $1 AND (approved_at IS NOT NULL OR expires_at>now())',
    [clientId],
  )) as unknown as OAuthClient[];
  return rows[0];
}

type AuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  state: string | undefined;
};

async function validateAuthorizationRequest(
  values: URLSearchParams,
): Promise<{ request?: AuthorizationRequest; error?: string }> {
  if (values.get('response_type') !== 'code')
    return { error: 'response_type must be code' };
  if (values.get('scope') !== 'likes')
    return { error: 'scope must be exactly likes' };
  if (values.get('code_challenge_method') !== 'S256')
    return { error: 'PKCE S256 is required' };
  const clientId = values.get('client_id') ?? '';
  const redirectUri = values.get('redirect_uri') ?? '';
  const codeChallenge = values.get('code_challenge') ?? '';
  const resource = values.get('resource') ?? '';
  if (
    !clientId ||
    !redirectUri ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)
  ) {
    return { error: 'missing or invalid authorization parameters' };
  }
  if (!isLikesResourceUrl(resource))
    return { error: 'resource must identify this MCP endpoint' };
  const client = await findClient(clientId);
  if (!client || !redirectUris(client).includes(redirectUri))
    return { error: 'unknown client or redirect URI' };
  return {
    request: {
      clientId,
      clientName: client.client_name,
      redirectUri,
      codeChallenge,
      resource,
      state: values.get('state') ?? undefined,
    },
  };
}

function authorizationForm(
  request: AuthorizationRequest,
  csrf: string,
  message?: string,
): string {
  const fields: Record<string, string> = {
    response_type: 'code',
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
    resource: request.resource,
    scope: 'likes',
    csrf,
  };
  if (request.state) fields.state = request.state;
  const hidden = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('');
  const client = request.clientName || request.clientId;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Authorize Likes</title><body><main><h1>Authorize Likes access</h1><p>${escapeHtml(client)} requests private access to your Likes library.</p><p>The authorization code will be sent to <code>${escapeHtml(request.redirectUri)}</code>.</p>${message ? `<p role="alert">${escapeHtml(message)}</p>` : ''}<form method="post" action="${escapeHtml(authorizationEndpoint())}">${hidden}<label>Server key <input type="password" name="owner_key" autocomplete="current-password"></label><button type="submit" name="decision" value="approve">Approve</button><button type="submit" name="decision" value="deny">Deny</button></form></main></body></html>`;
}

function authorizationResponse(
  url: URL,
  headers?: Record<string, string>,
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createAccessToken(
  resource = mcpResourceUrl(),
  scope = 'likes',
): string {
  const secret = oauthSecret();
  if (!secret) throw new Error('PERSONAL_SITE_OWNER_KEY is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: origin(),
      sub: 'owner',
      aud: resource,
      scope,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
    }),
  );
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}

/** Verifies only access tokens issued by this server for this exact MCP resource. */
export function verifyOAuthToken(
  token: string,
  expectedResource?: string,
): boolean {
  const secret = oauthSecret();
  const parts = token.split('.');
  if (!secret || parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest();
  const actual = decodeBase64url(signature);
  if (
    !actual ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return false;
  try {
    const parsedHeader = JSON.parse(
      decodeBase64url(header)?.toString('utf8') ?? '',
    ) as { alg?: string; typ?: string };
    const claims = JSON.parse(
      decodeBase64url(payload)?.toString('utf8') ?? '',
    ) as Record<string, unknown>;
    return (
      parsedHeader.alg === 'HS256' &&
      parsedHeader.typ === 'JWT' &&
      claims.iss === origin() &&
      claims.sub === 'owner' &&
      isLikesResourceUrl(claims.aud) &&
      (!expectedResource || claims.aud === expectedResource) &&
      claims.scope === 'likes' &&
      typeof claims.iat === 'number' &&
      typeof claims.exp === 'number' &&
      claims.iat <= Math.floor(Date.now() / 1000) + 60 &&
      claims.exp > Math.floor(Date.now() / 1000) &&
      claims.exp - claims.iat <= ACCESS_TOKEN_TTL_SECONDS
    );
  } catch {
    return false;
  }
}

async function handleRegistration(request: Request): Promise<Response> {
  if (request.method !== 'POST')
    return oauthError('invalid_request', 'POST required', 405);
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(request, OAUTH_BODY_LIMIT));
  } catch {
    return oauthError('invalid_request', 'body must be JSON');
  }
  if (!payload || typeof payload !== 'object')
    return oauthError('invalid_request');
  const body = payload as { redirect_uris?: unknown; client_name?: unknown };
  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every((uri) => typeof uri === 'string' && isAllowedRedirectUri(uri))
  ) {
    return oauthError(
      'invalid_redirect_uri',
      'redirect_uris must contain up to five exact HTTPS or loopback URLs',
    );
  }
  if (new Set(uris).size !== uris.length)
    return oauthError('invalid_redirect_uri', 'redirect_uris must be unique');
  const clientName =
    typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : '';
  const clientId = `likes_${randomUUID()}`;
  const sql = await getLikesSql();
  const metadataHash = createHash('sha256')
    .update(JSON.stringify([clientName, [...uris].sort()]))
    .digest('hex');
  // Unapproved registrations expire; identical metadata reuses a public
  // client ID, so reconnects cannot exhaust a permanent anonymous bucket.
  await sql.query(
    'DELETE FROM likes_oauth_clients WHERE approved_at IS NULL AND expires_at<=now()',
  );
  const inserted = await sql.query(
    `INSERT INTO likes_oauth_clients (client_id,client_name,redirect_uris,metadata_hash)
     SELECT $1,$2,$3::jsonb,$4 WHERE (SELECT count(*) FROM likes_oauth_clients WHERE approved_at IS NULL)<500 OR EXISTS(SELECT 1 FROM likes_oauth_clients WHERE metadata_hash=$4)
     ON CONFLICT(metadata_hash) DO UPDATE SET expires_at=now()+interval '1 hour'
     RETURNING client_id`,
    [clientId, clientName, JSON.stringify(uris), metadataHash],
  );
  if (!inserted.length)
    return oauthError(
      'invalid_client_metadata',
      'client registration limit reached',
    );
  return json(
    {
      client_id: inserted[0].client_id,
      client_name: clientName,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}

async function handleAuthorizeGet(request: Request): Promise<Response> {
  const validation = await validateAuthorizationRequest(
    new URL(request.url).searchParams,
  );
  if (!validation.request)
    return noStoreHtml(
      `<h1>Authorization failed</h1><p>${escapeHtml(validation.error ?? 'invalid request')}</p>`,
      400,
    );
  const csrf = randomBytes(32).toString('base64url');
  return noStoreHtml(authorizationForm(validation.request, csrf), 200, {
    'Set-Cookie': csrfCookie(csrf),
  });
}

async function ownerAuthorizedRequest(
  request: Request,
  ownerKey: string,
): Promise<Response | undefined> {
  const key = effectiveLikesOwnerKey();
  if (ownerKey && key.length >= 32 && secretsMatch(ownerKey, key))
    return undefined;
  if (ownerCookie(request) && sameOrigin(request)) return undefined;
  return Response.json(
    { error: 'Sign in to your collection' },
    { status: 401 },
  );
}

async function handleAuthorizePost(request: Request): Promise<Response> {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(
      await readBoundedText(request, OAUTH_BODY_LIMIT),
    );
  } catch {
    return noStoreHtml('<h1>Authorization failed</h1>', 400);
  }
  const validation = await validateAuthorizationRequest(form);
  if (!validation.request)
    return noStoreHtml(
      `<h1>Authorization failed</h1><p>${escapeHtml(validation.error ?? 'invalid request')}</p>`,
      400,
    );
  const cookies = parseCookies(request);
  if (cookies.malformed)
    return noStoreHtml('<h1>Authorization failed</h1>', 400);
  const csrf = form.get('csrf') ?? '';
  if (!csrf || csrf !== cookies.values[CSRF_COOKIE]) {
    return noStoreHtml(
      authorizationForm(
        validation.request,
        randomBytes(32).toString('base64url'),
        'This approval form expired. Start again.',
      ),
      403,
      { 'Set-Cookie': clearCsrfCookie() },
    );
  }
  if (form.get('decision') !== 'approve') {
    const redirect = new URL(validation.request.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    if (validation.request.state)
      redirect.searchParams.set('state', validation.request.state);
    return authorizationResponse(redirect, { 'Set-Cookie': clearCsrfCookie() });
  }
  const unauthorized = await ownerAuthorizedRequest(
    request,
    form.get('owner_key') ?? '',
  );
  if (unauthorized) {
    return noStoreHtml(
      authorizationForm(
        validation.request,
        csrf,
        'Enter your server key or use your signed owner session.',
      ),
      401,
    );
  }
  const code = randomBytes(32).toString('base64url');
  const hash = tokenHash(code);
  if (!hash) return noStoreHtml('<h1>Authorization unavailable</h1>', 503);
  const sql = await getLikesSql();
  await sql.query(
    `INSERT INTO likes_oauth_authorization_codes
      (code_hash, client_id, redirect_uri, code_challenge, resource, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'likes', now() + $6 * interval '1 second')`,
    [
      hash,
      validation.request.clientId,
      validation.request.redirectUri,
      validation.request.codeChallenge,
      validation.request.resource,
      AUTHORIZATION_CODE_TTL_SECONDS,
    ],
  );
  await sql.query(
    'UPDATE likes_oauth_clients SET approved_at=now() WHERE client_id=$1',
    [validation.request.clientId],
  );
  const redirect = new URL(validation.request.redirectUri);
  redirect.searchParams.set('code', code);
  if (validation.request.state)
    redirect.searchParams.set('state', validation.request.state);
  return authorizationResponse(redirect, { 'Set-Cookie': clearCsrfCookie() });
}

function tokenResponse(accessToken: string, refreshToken: string): Response {
  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: 'likes',
  });
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
): Promise<Response> {
  const code = form.get('code') ?? '';
  const clientId = form.get('client_id') ?? '';
  const redirectUri = form.get('redirect_uri') ?? '';
  const verifier = form.get('code_verifier') ?? '';
  const resource = form.get('resource') ?? '';
  const hash = tokenHash(code);
  if (
    !hash ||
    !clientId ||
    !redirectUri ||
    !resource ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
  )
    return oauthError('invalid_grant');
  const sql = await getLikesSql();
  const rows = (await sql.query(
    `UPDATE likes_oauth_authorization_codes SET consumed_at = now()
     WHERE code_hash = $1 AND client_id = $2 AND redirect_uri = $3 AND resource = $4 AND code_challenge = $5
       AND consumed_at IS NULL AND expires_at > now()
     RETURNING client_id, redirect_uri, code_challenge, resource, scope`,
    [hash, clientId, redirectUri, resource, pkceChallenge(verifier)],
  )) as unknown as AuthorizationCode[];
  const claimed = rows[0];
  if (!claimed) return oauthError('invalid_grant');
  const refreshToken = randomBytes(48).toString('base64url');
  const refreshHash = tokenHash(refreshToken);
  if (!refreshHash) return oauthError('server_error', undefined, 503);
  await sql.query(
    `INSERT INTO likes_oauth_refresh_tokens (token_hash, client_id, resource, scope, expires_at)
     VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')`,
    [
      refreshHash,
      claimed.client_id,
      claimed.resource,
      claimed.scope,
      REFRESH_TOKEN_TTL_SECONDS,
    ],
  );
  return tokenResponse(
    createAccessToken(claimed.resource, claimed.scope),
    refreshToken,
  );
}

async function exchangeRefreshToken(form: URLSearchParams): Promise<Response> {
  const refreshToken = form.get('refresh_token') ?? '';
  const clientId = form.get('client_id') ?? '';
  const resource = form.get('resource') ?? '';
  const currentHash = tokenHash(refreshToken);
  const nextToken = randomBytes(48).toString('base64url');
  const nextHash = tokenHash(nextToken);
  if (!currentHash || !nextHash || !clientId || !resource)
    return oauthError('invalid_grant');
  const sql = await getLikesSql();
  const rows = (await sql.query(
    `WITH claimed AS (
       UPDATE likes_oauth_refresh_tokens SET consumed_at = now(), replaced_by_hash = $4
       WHERE token_hash = $1 AND client_id = $2 AND resource = $3
         AND consumed_at IS NULL AND expires_at > now()
       RETURNING client_id, resource, scope
     ), inserted AS (
       INSERT INTO likes_oauth_refresh_tokens (token_hash, client_id, resource, scope, expires_at)
       SELECT $4, client_id, resource, scope, now() + $5 * interval '1 second' FROM claimed
     ) SELECT client_id, resource, scope FROM claimed`,
    [currentHash, clientId, resource, nextHash, REFRESH_TOKEN_TTL_SECONDS],
  )) as unknown as RefreshToken[];
  const claimed = rows[0];
  if (!claimed) return oauthError('invalid_grant');
  return tokenResponse(
    createAccessToken(claimed.resource, claimed.scope),
    nextToken,
  );
}

async function handleToken(request: Request): Promise<Response> {
  if (request.method !== 'POST')
    return oauthError('invalid_request', 'POST required', 405);
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded'))
    return oauthError('invalid_request', 'form body required');
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(
      await readBoundedText(request, OAUTH_BODY_LIMIT),
    );
  } catch {
    return oauthError('invalid_request', 'Request too large');
  }
  if (form.get('grant_type') === 'authorization_code')
    return exchangeAuthorizationCode(form);
  if (form.get('grant_type') === 'refresh_token')
    return exchangeRefreshToken(form);
  return oauthError('unsupported_grant_type');
}

export async function handleLikesOAuthRequest(
  request: Request,
  operation: string,
): Promise<Response> {
  try {
    if (operation === 'oauth-resource') {
      if (request.method !== 'GET')
        return oauthError('invalid_request', 'GET required', 405);
      return json({
        resource: mcpResourceUrl(likesRequestOrigin(request)),
        authorization_servers: [origin()],
        scopes_supported: ['likes'],
        bearer_methods_supported: ['header'],
      });
    }
    if (operation === 'oauth-server') {
      if (request.method !== 'GET')
        return oauthError('invalid_request', 'GET required', 405);
      return json({
        issuer: origin(),
        authorization_endpoint: authorizationEndpoint(),
        token_endpoint: tokenEndpoint(),
        registration_endpoint: registrationEndpoint(),
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['likes'],
      });
    }
    if (operation === 'oauth-register') return handleRegistration(request);
    if (operation === 'oauth-authorize')
      return request.method === 'GET'
        ? handleAuthorizeGet(request)
        : request.method === 'POST'
          ? handleAuthorizePost(request)
          : noStoreHtml('<h1>Method not allowed</h1>', 405);
    if (operation === 'oauth-token') return handleToken(request);
    return oauthError('invalid_request', 'unknown OAuth operation', 404);
  } catch (error) {
    console.error('Likes OAuth request failed', error);
    return oauthError('server_error', undefined, 500);
  }
}
