import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loginLikes,
  ownerCookie,
  rejectUnauthorizedLikes,
  sessionToken,
} from './likes-auth.js';
import {
  createAccessToken,
  handleLikesOAuthRequest,
  pkceChallenge,
  verifyOAuthToken,
} from './likes-oauth.js';
import { likesOwnerKey, personalSiteOwnerKey } from './personal-site-config.js';

const origin = 'https://owner-config.test.example';
const rootKey = 'root-owner-key-that-is-at-least-32-characters';
const likesKey = 'likes-bearer-key-that-is-at-least-32-characters';

process.env.LIKES_LOCAL_DATABASE ??= join(
  tmpdir(),
  `likes-owner-config-${randomUUID()}`,
);

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>,
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values))
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of Object.entries(previous))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    });
}

function request(headers?: Record<string, string>) {
  return new Request(`${origin}/api/likes`, { headers });
}

test('site owner key is distinct from the Likes bearer key', async () => {
  await withEnv(
    {
      PERSONAL_SITE_OWNER_KEY: rootKey,
      LIKES_API_KEY: likesKey,
      PERSONAL_SITE_ORIGIN: origin,
      LIKES_ORIGIN: undefined,
    },
    () => {
      assert.equal(personalSiteOwnerKey(), rootKey);
      assert.equal(likesOwnerKey(), rootKey);
      assert.equal(
        rejectUnauthorizedLikes(
          request({ authorization: `Bearer ${rootKey}` }),
        ),
        undefined,
      );
      assert.equal(
        rejectUnauthorizedLikes(
          request({ authorization: `Bearer ${likesKey}` }),
        ),
        undefined,
      );

      assert.equal(
        loginLikes(
          new Request(`${origin}/api/likes`, { headers: { origin } }),
          likesKey,
        ).status,
        401,
      );
      const login = loginLikes(
        new Request(`${origin}/api/likes`, { headers: { origin } }),
        rootKey,
      );
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      assert.ok(ownerCookie(request({ cookie })));
      assert.equal(
        ownerCookie(request({ cookie: `nimo_likes=${likesKey}` })),
        false,
      );
      const expires = Math.floor(Date.now() / 1000) + 60;
      const nonce = 'a'.repeat(32);
      const forged = `${expires}.${nonce}.${createHmac('sha256', likesKey)
        .update(`likes-session:${expires}.${nonce}`)
        .digest('base64url')}`;
      assert.equal(
        ownerCookie(request({ cookie: `nimo_likes=${forged}` })),
        false,
      );

      const token = createAccessToken();
      assert.ok(verifyOAuthToken(token));
      const [, payload, signature] = token.split('.');
      const likesSigned = createHmac('sha256', likesKey)
        .update(`${token.split('.')[0]}.${payload}`)
        .digest('base64url');
      assert.notEqual(signature, likesSigned);
    },
  );
});

test('legacy Likes key remains the effective owner key until the site key is set', async () => {
  await withEnv(
    {
      PERSONAL_SITE_OWNER_KEY: undefined,
      LIKES_API_KEY: likesKey,
      PERSONAL_SITE_ORIGIN: origin,
    },
    () => {
      assert.equal(likesOwnerKey(), likesKey);
      assert.equal(personalSiteOwnerKey(), '');
      assert.equal(
        rejectUnauthorizedLikes(
          request({ authorization: `Bearer ${likesKey}` }),
        ),
        undefined,
      );
      assert.ok(verifyOAuthToken(createAccessToken()));
      assert.ok(sessionToken());
    },
  );
});

test('Likes bearer key cannot approve OAuth authorization once a site key exists', async () => {
  await withEnv(
    {
      PERSONAL_SITE_OWNER_KEY: rootKey,
      LIKES_API_KEY: likesKey,
      PERSONAL_SITE_ORIGIN: origin,
    },
    async () => {
      const registration = await handleLikesOAuthRequest(
        new Request(`${origin}/api/likes/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: `Owner config ${randomUUID()}`,
            redirect_uris: ['https://client.owner-config.test/callback'],
          }),
        }),
        'oauth-register',
      );
      assert.equal(registration.status, 201);
      const { client_id: clientId } = (await registration.json()) as {
        client_id: string;
      };
      const form = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'https://client.owner-config.test/callback',
        scope: 'likes',
        resource: `${origin}/api/likes?op=mcp`,
        code_challenge_method: 'S256',
        code_challenge: pkceChallenge('a'.repeat(43)),
      });
      const page = await handleLikesOAuthRequest(
        new Request(`${origin}/api/likes/oauth/authorize?${form}`),
        'oauth-authorize',
      );
      const csrf = page.headers
        .get('set-cookie')
        ?.match(/likes_oauth_csrf=([^;]+)/)?.[1];
      assert.ok(csrf);
      const approval = new URLSearchParams({
        ...Object.fromEntries(form),
        csrf,
        decision: 'approve',
        owner_key: likesKey,
      });
      const rejected = await handleLikesOAuthRequest(
        new Request(`${origin}/api/likes/oauth/authorize`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: `likes_oauth_csrf=${csrf}`,
          },
          body: approval,
        }),
        'oauth-authorize',
      );
      assert.equal(rejected.status, 401);
      approval.set('owner_key', rootKey);
      const accepted = await handleLikesOAuthRequest(
        new Request(`${origin}/api/likes/oauth/authorize`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: `likes_oauth_csrf=${csrf}`,
          },
          body: approval,
          redirect: 'manual',
        }),
        'oauth-authorize',
      );
      assert.equal(accepted.status, 302);
    },
  );
});

test('an invalid site owner key fails closed and a short Likes bearer key is ignored', async () => {
  await withEnv(
    {
      PERSONAL_SITE_OWNER_KEY: 'too-short',
      LIKES_API_KEY: likesKey,
      PERSONAL_SITE_ORIGIN: origin,
    },
    () => {
      assert.equal(likesOwnerKey(), 'too-short');
      assert.equal(
        rejectUnauthorizedLikes(
          request({ authorization: `Bearer ${likesKey}` }),
        )?.status,
        503,
      );
      assert.throws(() => createAccessToken());
    },
  );
  await withEnv(
    {
      PERSONAL_SITE_OWNER_KEY: rootKey,
      LIKES_API_KEY: 'too-short',
      PERSONAL_SITE_ORIGIN: origin,
    },
    () => {
      assert.equal(
        rejectUnauthorizedLikes(request({ authorization: 'Bearer too-short' }))
          ?.status,
        401,
      );
      assert.equal(
        rejectUnauthorizedLikes(
          request({ authorization: `Bearer ${rootKey}` }),
        ),
        undefined,
      );
    },
  );
});
