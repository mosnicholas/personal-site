import assert from 'node:assert/strict';
import test from 'node:test';
import {
  likesOrigin,
  personalSiteOrigin,
  trustedLikesOrigins,
} from './likes-origin.js';
import { sameOrigin, rejectUnauthorizedLikes } from './likes-auth.js';
import {
  handleLikesOAuthRequest,
  mcpResourceUrl,
  createAccessToken,
  verifyOAuthToken,
} from './likes-oauth.js';
import {
  selectResourceURL,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';

test('production uses its primary domain; previews use their own branch/deployment URL', () => {
  const production = {
    VERCEL: '1',
    VERCEL_ENV: 'production',
    VERCEL_PROJECT_PRODUCTION_URL: 'nimo.fyi',
    VERCEL_URL: 'deployment.vercel.app',
  };
  assert.equal(likesOrigin(production), 'https://nimo.fyi');
  const preview = {
    ...production,
    VERCEL_ENV: 'preview',
    VERCEL_BRANCH_URL: 'branch.vercel.app',
  };
  assert.equal(likesOrigin(preview), 'https://branch.vercel.app');
  assert.equal(
    likesOrigin({ ...preview, VERCEL_BRANCH_URL: undefined }),
    'https://deployment.vercel.app',
  );
  assert.deepEqual(trustedLikesOrigins(preview).sort(), [
    'https://branch.vercel.app',
    'https://deployment.vercel.app',
  ]);
  assert.ok(!trustedLikesOrigins(preview).includes('https://nimo.fyi'));
  assert.equal(likesOrigin({}), 'https://nimo.fyi');
});

test('optional overrides support tests and reject credentials or non-origin URLs', () => {
  assert.equal(
    personalSiteOrigin({
      PERSONAL_SITE_ORIGIN: 'https://site.example',
      LIKES_ORIGIN: 'http://localhost:5173',
    }),
    'https://site.example',
  );
  assert.equal(
    likesOrigin({ LIKES_ORIGIN: 'http://localhost:5173/' }),
    'http://localhost:5173',
  );
  assert.deepEqual(
    trustedLikesOrigins({
      LIKES_ORIGIN: 'http://localhost:5173',
      VERCEL: '1',
      VERCEL_URL: 'elsewhere.vercel.app',
    }),
    ['http://localhost:5173'],
  );
  const credentialUrl = new URL('https://example.com');
  credentialUrl.username = 'fixture-user';
  credentialUrl.password = 'invalid-test-password';
  assert.throws(() => likesOrigin({ LIKES_ORIGIN: credentialUrl.toString() }));
  for (const value of [
    'https://example.com/path',
    'https://example.com?x=1',
    'https://example.com#x',
    'file:///tmp',
  ]) {
    assert.throws(() => likesOrigin({ LIKES_ORIGIN: value }));
  }
});

test('OAuth resource/issuer and cookie origin checks share inferred deployment metadata', async () => {
  const names = [
    'LIKES_ORIGIN',
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_URL',
    'VERCEL_BRANCH_URL',
    'VERCEL_PROJECT_PRODUCTION_URL',
    'LIKES_API_KEY',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    delete process.env.LIKES_ORIGIN;
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_BRANCH_URL = 'preview-branch.vercel.app';
    process.env.VERCEL_URL = 'preview-deployment.vercel.app';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'nimo.fyi';
    process.env.LIKES_API_KEY = 'test-origin-key-at-least-32-characters';
    const request = new Request(
      'https://preview-deployment.vercel.app/api/likes',
      {
        method: 'POST',
        headers: { origin: 'https://preview-deployment.vercel.app' },
      },
    );
    assert.ok(sameOrigin(request));
    assert.equal(
      sameOrigin(
        new Request(request, {
          headers: {
            origin: 'https://evil.example',
            'x-forwarded-host': 'evil.example',
          },
        }),
      ),
      false,
    );
    const metadata = await handleLikesOAuthRequest(
      new Request('https://evil.example/.well-known/oauth-protected-resource', {
        headers: { host: 'evil.example' },
      }),
      'oauth-resource',
    );
    const body = (await metadata.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(
      body.resource,
      'https://preview-branch.vercel.app/api/likes?op=mcp',
    );
    assert.equal(mcpResourceUrl(), body.resource);
    assert.deepEqual(body.authorization_servers, [
      'https://preview-branch.vercel.app',
    ]);
    const alias = 'https://preview-deployment.vercel.app';
    const aliasMetadata = await handleLikesOAuthRequest(
      new Request(alias + '/.well-known/oauth-protected-resource'),
      'oauth-resource',
    );
    const aliasBody = (await aliasMetadata.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(aliasBody.resource, alias + '/api/likes?op=mcp');
    const selected = await selectResourceURL(
      alias + '/api/likes?op=mcp',
      {} as OAuthClientProvider,
      aliasBody,
    );
    assert.equal(selected!.toString(), aliasBody.resource);
    const token = createAccessToken(aliasBody.resource);
    assert.ok(verifyOAuthToken(token, aliasBody.resource));
    assert.equal(verifyOAuthToken(token, mcpResourceUrl()), false);
    assert.equal(
      rejectUnauthorizedLikes(
        new Request(aliasBody.resource, {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
      undefined,
    );
    assert.equal(
      verifyOAuthToken(
        createAccessToken('https://evil.example/api/likes?op=mcp'),
      ),
      false,
    );
    assert.equal(
      rejectUnauthorizedLikes(
        new Request('https://evil.example/api/likes?op=mcp', {
          headers: { authorization: `Bearer ${createAccessToken()}` },
        }),
      )?.status,
      401,
    );
  } finally {
    for (const name of names)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
  }
});
