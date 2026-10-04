import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
} from 'undici';
import {
  getLikesSql,
  LikesError,
  saveAttachment,
} from './likes-store.js';

const database = join(tmpdir(), `likes-blob-config-${randomUUID()}`);
const oidcToken = `eyJhbGciOiJub25lIn0.${Buffer.from(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
).toString('base64url')}.test`;
const readWriteToken = 'vercel_blob_rw_teststore';
const originalDispatcher = getGlobalDispatcher();
const mockAgent = new MockAgent({ enableCallHistory: true });
const blobApi = 'https://blob.test';
const blobPool = mockAgent.get(blobApi);

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

async function saveBlobAttachment() {
  return saveAttachment({
    role: 'archive',
    filename: 'snapshot.html',
    contentType: 'text/html',
    data: new TextEncoder().encode('stored through the Blob SDK'),
  });
}

test.before(async () => {
  await withEnv(
    {
      LIKES_LOCAL_DATABASE: database,
      LIKES_LOCAL_STORAGE: undefined,
      NODE_ENV: 'test',
      VERCEL: undefined,
    },
    async () => {
      await getLikesSql();
    },
  );
  // @vercel/blob imports undici's fetch, so intercept its global dispatcher.
  mockAgent.disableNetConnect();
  blobPool
    .intercept({ path: /^\/\?pathname=/, method: 'PUT' })
    .reply(200, {
      url: 'https://teststore.private.blob.vercel-storage.com/likes/test/snapshot.html',
      downloadUrl: 'https://teststore.private.blob.vercel-storage.com/download',
      pathname: 'likes/test/snapshot.html',
      contentType: 'text/html',
      contentDisposition: 'inline',
      etag: 'test-etag',
    })
    .persist();
  setGlobalDispatcher(mockAgent);
});

test.after(async () => {
  setGlobalDispatcher(originalDispatcher);
  await mockAgent.close();
});

test('private Blob uploads accept Vercel OIDC or a read-write token and save metadata', async () => {
  await withEnv(
    {
      BLOB_READ_WRITE_TOKEN: undefined,
      VERCEL_OIDC_TOKEN: oidcToken,
      BLOB_STORE_ID: 'store_teststore',
      VERCEL_BLOB_API_URL: blobApi,
      NODE_ENV: 'production',
      VERCEL: undefined,
    },
    async () => {
      const attachment = await saveBlobAttachment();
      const request = mockAgent.getCallHistory()!.lastCall()!;
      const headers = request.headers!;
      assert.equal(headers.authorization, `Bearer ${oidcToken}`);
      assert.equal(headers['x-vercel-blob-store-id'], 'teststore');
      assert.equal(headers['x-add-random-suffix'], '0');
      assert.equal(headers['x-vercel-blob-access'], 'private');
      const [metadata] = await (
        await getLikesSql()
      )`SELECT backend,storage_key FROM likes_attachments WHERE id=${attachment.id}`;
      assert.deepEqual(metadata, {
        backend: 'blob',
        storage_key:
          'https://teststore.private.blob.vercel-storage.com/likes/test/snapshot.html',
      });
      assert.equal(attachment.url, `/api/likes?op=asset&id=${attachment.id}`);
    },
  );

  await withEnv(
    {
      BLOB_READ_WRITE_TOKEN: readWriteToken,
      VERCEL_OIDC_TOKEN: undefined,
      BLOB_STORE_ID: undefined,
      VERCEL_BLOB_API_URL: blobApi,
      NODE_ENV: 'production',
      VERCEL: undefined,
    },
    async () => {
      await saveBlobAttachment();
      const request = mockAgent.getCallHistory()!.lastCall()!;
      const headers = request.headers!;
      assert.equal(
        headers.authorization,
        `Bearer ${readWriteToken}`,
      );
      assert.equal(headers['x-vercel-blob-store-id'], 'teststore');
    },
  );
  assert.equal(mockAgent.getCallHistory()!.calls().length, 2);
});

test('incomplete private Blob credentials return 503 before the SDK fetches', async () => {
  for (const values of [
    { VERCEL_OIDC_TOKEN: oidcToken, BLOB_STORE_ID: undefined },
    { VERCEL_OIDC_TOKEN: undefined, BLOB_STORE_ID: 'store_teststore' },
    { VERCEL_OIDC_TOKEN: undefined, BLOB_STORE_ID: undefined },
  ]) {
    const before = mockAgent.getCallHistory()!.calls().length;
    await withEnv(
      {
        BLOB_READ_WRITE_TOKEN: undefined,
        VERCEL_BLOB_API_URL: blobApi,
        NODE_ENV: 'production',
        VERCEL: undefined,
        ...values,
      },
      async () => {
        await assert.rejects(
          saveBlobAttachment(),
          (error) => error instanceof LikesError && error.status === 503,
        );
      },
    );
    assert.equal(mockAgent.getCallHistory()!.calls().length, before);
  }
});
