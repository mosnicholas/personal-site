import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { load } from 'cheerio';
import { getLikesSql } from './likes-store.js';

import {
  handleLikesOAuthRequest,
  mcpResourceUrl,
  pkceChallenge,
  verifyOAuthToken,
} from './likes-oauth.js';

process.env.LIKES_API_KEY = 'test-owner-key-that-is-at-least-32-characters';
process.env.LIKES_ORIGIN = 'https://likes.test.example';
process.env.LIKES_LOCAL_DATABASE ??= join(
  tmpdir(),
  `likes-oauth-${randomUUID()}`,
);
process.env.LIKES_LOCAL_STORAGE ??= join(
  tmpdir(),
  `likes-oauth-assets-${randomUUID()}`,
);

const origin = process.env.LIKES_ORIGIN;
const resource = mcpResourceUrl();

async function registerClient() {
  const response = await handleLikesOAuthRequest(
    new Request(`${origin}/api/likes/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'OAuth regression client',
        redirect_uris: ['https://client.test.example/callback'],
      }),
    }),
    'oauth-register',
  );
  assert.equal(response.status, 201);
  return (await response.json()) as { client_id: string };
}

async function authorizeCode(clientId: string, verifier: string) {
  const parameters = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'https://client.test.example/callback',
    scope: 'likes',
    resource,
    code_challenge_method: 'S256',
    code_challenge: pkceChallenge(verifier),
    state: 'state-value',
  });
  const page = await handleLikesOAuthRequest(
    new Request(`${origin}/api/likes/oauth/authorize?${parameters}`),
    'oauth-authorize',
  );
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = load(await page.text());
  const actualFields: Record<string, string> = {};
  html('input[type="hidden"]').each((_index, element) => {
    actualFields[html(element).attr('name')!] =
      html(element).attr('value') ?? '';
  });
  const csrf = page.headers
    .get('set-cookie')
    ?.match(/likes_oauth_csrf=([^;]+)/)?.[1];
  assert.ok(csrf);
  const approval = await handleLikesOAuthRequest(
    new Request(`${origin}/api/likes/oauth/authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `likes_oauth_csrf=${csrf}`,
      },
      body: new URLSearchParams({
        ...actualFields,
        csrf,
        decision: 'approve',
        owner_key: 'test-owner-key-that-is-at-least-32-characters',
      }),
      redirect: 'manual',
    }),
    'oauth-authorize',
  );
  assert.equal(approval.status, 302);
  const location = approval.headers.get('location');
  assert.ok(location);
  const redirect = new URL(location);
  assert.equal(redirect.searchParams.get('state'), 'state-value');
  const code = redirect.searchParams.get('code');
  assert.ok(code);
  return code;
}

function tokenRequest(parameters: URLSearchParams) {
  return handleLikesOAuthRequest(
    new Request(`${origin}/api/likes/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: parameters,
    }),
    'oauth-token',
  );
}

test('authorization codes are single-use and issue an audience-bound access token', async () => {
  const client = await registerClient();
  const verifier = 'a'.repeat(43);
  const code = await authorizeCode(client.client_id, verifier);
  const request = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: client.client_id,
    redirect_uri: 'https://client.test.example/callback',
    resource,
    code_verifier: verifier,
  });
  const first = await tokenRequest(request);
  assert.equal(first.status, 200);
  const tokens = (await first.json()) as {
    access_token: string;
    refresh_token: string;
  };
  assert.ok(verifyOAuthToken(tokens.access_token));
  assert.ok(tokens.refresh_token);
  const replay = await tokenRequest(request);
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), { error: 'invalid_grant' });
});

test('duplicate registrations reuse their client ID and unused registrations expire', async () => {
  const one = await registerClient();
  for (let i = 0; i < 110; i++)
    assert.equal((await registerClient()).client_id, one.client_id);
  const sql = await getLikesSql();
  await sql`UPDATE likes_oauth_clients SET approved_at=NULL,expires_at=now()-interval '1 minute' WHERE client_id=${one.client_id}`;
  const next = await registerClient();
  assert.notEqual(next.client_id, one.client_id);
});

test('authorization codes reject an incorrect PKCE verifier and mismatched resource', async () => {
  const client = await registerClient();
  const verifier = 'b'.repeat(43);
  const code = await authorizeCode(client.client_id, verifier);
  const wrongPkce = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      redirect_uri: 'https://client.test.example/callback',
      resource,
      code_verifier: 'c'.repeat(43),
    }),
  );
  assert.equal(wrongPkce.status, 400);
  assert.deepEqual(await wrongPkce.json(), { error: 'invalid_grant' });

  const otherCode = await authorizeCode(client.client_id, verifier);
  const wrongResource = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: otherCode,
      client_id: client.client_id,
      redirect_uri: 'https://client.test.example/callback',
      resource: `${resource}&other=1`,
      code_verifier: verifier,
    }),
  );
  assert.equal(wrongResource.status, 400);
  assert.deepEqual(await wrongResource.json(), { error: 'invalid_grant' });
});
