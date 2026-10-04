import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readBoundedBytes,
  readBoundedText,
  RequestSizeError,
} from './likes-request.js';
import { handleLikesRequest } from './likes-http.js';
import { handleLikesOAuthRequest } from './likes-oauth.js';

const origin = 'https://request-tests.example';
process.env.LIKES_ORIGIN = origin;
process.env.LIKES_API_KEY = 'test-request-key-at-least-32-characters';

function streamed(chunks: Uint8Array[], headers?: Record<string, string>) {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(origin + '/api/likes', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  });
  return { request, cancelled: () => cancelled };
}

test('one reader bounds actual streamed bytes regardless of Content-Length', async () => {
  const valid = streamed([Buffer.from('abc'), Buffer.from('def')]);
  assert.equal((await readBoundedBytes(valid.request, 6)).toString(), 'abcdef');
  for (const headers of [undefined, { 'content-length': '1' }]) {
    const large = streamed(
      [Buffer.from('abcd'), Buffer.from('efgh'), Buffer.from('ijkl')],
      headers,
    );
    await assert.rejects(readBoundedBytes(large.request, 6), RequestSizeError);
    assert.ok(large.cancelled());
  }
  const declaredLarge = streamed([Buffer.from('a')], {
    'content-length': '1000',
  });
  await assert.rejects(
    readBoundedBytes(declaredLarge.request, 6),
    RequestSizeError,
  );
  assert.ok(declaredLarge.cancelled());
  assert.equal(await readBoundedText(new Request(origin), 1), '');
  assert.equal(
    await readBoundedText(
      new Request(origin, { method: 'POST', body: 'é' }),
      2,
    ),
    'é',
  );
  await assert.rejects(
    readBoundedText(new Request(origin, { method: 'POST', body: 'é' }), 1),
    RequestSizeError,
  );
});

test('JSON and OAuth retain their protocol-specific malformed/oversized responses', async () => {
  const auth = {
    authorization: `Bearer ${process.env.LIKES_API_KEY}`,
    'content-type': 'application/json',
  };
  const invalid = await handleLikesRequest(
    new Request(origin + '/api/likes', {
      method: 'POST',
      headers: auth,
      body: '[]',
    }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    ((await invalid.json()) as { error: string }).error,
    'Provide a valid JSON object',
  );
  const login = streamed([Buffer.alloc(4001), Buffer.from('unused')], {
    origin,
    'content-type': 'application/json',
  });
  const rejected = await handleLikesRequest(
    new Request(origin + '/api/likes?op=login', login.request),
  );
  assert.equal(rejected.status, 413);
  assert.ok(login.cancelled());
  const oauth = streamed([Buffer.alloc(16385), Buffer.from('unused')], {
    'content-type': 'application/json',
  });
  const registration = await handleLikesOAuthRequest(
    oauth.request,
    'oauth-register',
  );
  assert.equal(registration.status, 400);
  assert.equal(
    ((await registration.json()) as { error: string }).error,
    'invalid_request',
  );
  assert.ok(oauth.cancelled());
});

test('uploads and screenshots stop oversized chunked bodies before multipart parsing', async () => {
  for (const operation of ['upload', 'screenshot']) {
    const large = streamed(
      [Buffer.alloc(4 * 1024 * 1024), Buffer.from('x'), Buffer.from('unused')],
      {
        authorization: `Bearer ${process.env.LIKES_API_KEY}`,
        'content-type': 'multipart/form-data; boundary=test',
      },
    );
    const response = await handleLikesRequest(
      new Request(`${origin}/api/likes?op=${operation}`, large.request),
    );
    assert.equal(response.status, 413);
    assert.ok(large.cancelled());
  }
  const malformed = await handleLikesRequest(
    new Request(origin + '/api/likes?op=upload', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.LIKES_API_KEY}`,
        'content-type': 'multipart/form-data; boundary=test',
      },
      body: 'invalid',
    }),
  );
  assert.equal(malformed.status, 400);
  assert.equal(
    ((await malformed.json()) as { error: string }).error,
    'Provide a multipart upload',
  );
});
