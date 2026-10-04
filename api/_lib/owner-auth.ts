/**
 * The site's owner (me), for /likes and the MCP server. One secret,
 * PERSONAL_SITE_OWNER_KEY, signs me in on the site (a signed session
 * cookie), works as a bearer token, and signs the OAuth tokens Claude and
 * ChatGPT use for the MCP server.
 *
 * The OAuth server is the least their connectors need: discovery, dynamic
 * client registration, and authorization codes with PKCE, approved by typing
 * the key. Codes and tokens carry their own signed contents (what they're
 * for, the PKCE challenge, the expiry), so nothing is stored and there are no
 * tables; changing the key signs everything out.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

import { secretsMatch } from './auth.js';
import { escapeHtml } from './email.js';

const DAY_SECONDS = 86_400;
const SESSION_COOKIE = 'nimo_session';

const ownerKey = () => process.env.PERSONAL_SITE_OWNER_KEY ?? '';

export const ownerKeyIsSet = () => ownerKey().length > 0;

// The signature covers what the token is for, so a session can't be used as
// an access token, nor an access token as a refresh token
const signature = (purpose: string, body: string) =>
  createHmac('sha256', ownerKey())
    .update(`${purpose}.${body}`)
    .digest('base64url');

function sign(
  purpose: string,
  payload: Record<string, string>,
  ttlSeconds: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString(
    'base64url',
  );
  return `${body}.${signature(purpose, body)}`;
}

/** The token's payload, if it's signed for `purpose` and unexpired */
function verify(
  purpose: string,
  token: string | null | undefined,
): Record<string, string> | undefined {
  const [body, mac] = token?.split('.') ?? [];
  if (!ownerKeyIsSet() || !body || !secretsMatch(mac, signature(purpose, body)))
    return undefined;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  return payload.exp > Date.now() / 1000 ? payload : undefined;
}

/** Signed in on the site, or a bearer: the key itself or an access token */
export function isOwner(request: Request): boolean {
  const bearer = request.headers
    .get('authorization')
    ?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    return (
      secretsMatch(bearer, ownerKey()) || Boolean(verify('access', bearer))
    );
  }
  const session = request.headers
    .get('cookie')
    ?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  return Boolean(verify('session', session));
}

const sessionCookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

export function login(key: unknown): Response {
  if (typeof key !== 'string' || !secretsMatch(key, ownerKey())) {
    return Response.json({ error: 'Wrong key' }, { status: 401 });
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': sessionCookie(
          sign('session', {}, 30 * DAY_SECONDS),
          30 * DAY_SECONDS,
        ),
      },
    },
  );
}

export const logout = () =>
  Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookie('', 0) } },
  );

const origin = (request: Request) => new URL(request.url).origin;

export const mcpUrl = (request: Request) => `${origin(request)}/api/mcp`;

/** Where the MCP server's OAuth metadata is, for its 401s */
export const resourceMetadataUrl = (request: Request) =>
  `${origin(request)}/.well-known/oauth-protected-resource`;

export function protectedResource(request: Request): Response {
  return Response.json({
    resource: mcpUrl(request),
    authorization_servers: [origin(request)],
  });
}

export function authorizationServer(request: Request): Response {
  const site = origin(request);
  return Response.json({
    issuer: site,
    authorization_endpoint: `${site}/api/oauth/authorize`,
    token_endpoint: `${site}/api/oauth/token`,
    registration_endpoint: `${site}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}

/** Any client may register; it still needs me to approve it */
export async function registerClient(request: Request): Promise<Response> {
  const metadata: unknown = await request.json().catch(() => ({}));
  return Response.json(
    {
      ...(metadata as object),
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: 'none',
    },
    { status: 201 },
  );
}

const isRedirectUri = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { background: #000; color: #fff; font: 16px/1.5 system-ui, sans-serif; max-width: 420px; margin: 15vh auto; padding: 0 16px; }
    input, button { font: inherit; padding: 8px 12px; border-radius: 6px; border: 1px solid #444; }
    input { background: #111; color: #fff; width: 100%; box-sizing: border-box; margin: 8px 0; }
    button { background: #fff; color: #000; cursor: pointer; }
    .muted { color: #9ca3af; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    },
  });
}

/**
 * The consent page (GET), and its form (POST): the right key sends the
 * client back to its redirect URI with an authorization code
 */
export async function authorize(request: Request): Promise<Response> {
  const params =
    request.method === 'POST'
      ? new URLSearchParams(await request.text())
      : new URL(request.url).searchParams;
  const redirectUri = params.get('redirect_uri') ?? '';
  const challenge = params.get('code_challenge') ?? '';
  if (
    params.get('response_type') !== 'code' ||
    !isRedirectUri(redirectUri) ||
    !challenge ||
    params.get('code_challenge_method') !== 'S256'
  ) {
    return page(
      'Can’t connect',
      '<p>The request needs a code response type, an https redirect URI, and an S256 PKCE challenge.</p>',
      400,
    );
  }

  if (
    request.method === 'POST' &&
    secretsMatch(params.get('key'), ownerKey())
  ) {
    const location = new URL(redirectUri);
    location.searchParams.set(
      'code',
      sign('code', { redirectUri, challenge }, 5 * 60),
    );
    const state = params.get('state');
    if (state) location.searchParams.set('state', state);
    return new Response(null, {
      status: 302,
      headers: { Location: location.toString(), 'Cache-Control': 'no-store' },
    });
  }

  const fields = [...params]
    .filter(([name]) => name !== 'key')
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n    ');
  const wrongKey = request.method === 'POST' ? '<p>Wrong key.</p>' : '';
  return page(
    'Connect to nimo',
    `<p class="muted">${escapeHtml(new URL(redirectUri).host)} wants to save likes and read your likes and reading.</p>
  ${wrongKey}
  <form method="post">
    ${fields}
    <input type="password" name="key" placeholder="Owner key" autocomplete="current-password" autofocus>
    <button>Allow</button>
  </form>`,
  );
}

const tokens = () =>
  Response.json(
    {
      access_token: sign('access', {}, DAY_SECONDS),
      token_type: 'Bearer',
      expires_in: DAY_SECONDS,
      refresh_token: sign('refresh', {}, 90 * DAY_SECONDS),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );

/** Trades an authorization code (with its PKCE verifier) or a refresh token for tokens */
export async function token(request: Request): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const grant = params.get('grant_type');
  if (grant === 'authorization_code') {
    const code = verify('code', params.get('code'));
    const challenge = createHash('sha256')
      .update(params.get('code_verifier') ?? '')
      .digest('base64url');
    if (
      code?.challenge === challenge &&
      code.redirectUri === params.get('redirect_uri')
    ) {
      return tokens();
    }
  } else if (grant === 'refresh_token') {
    if (verify('refresh', params.get('refresh_token'))) return tokens();
  } else {
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }
  return Response.json({ error: 'invalid_grant' }, { status: 400 });
}
