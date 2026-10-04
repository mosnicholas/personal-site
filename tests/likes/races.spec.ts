import { expect, test, type Page, type Route } from '@playwright/test';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'like-1',
  kind: 'note',
  url: null,
  originalText: 'A cedar scent',
  title: 'Cedar bottle',
  note: 'Original why',
  category: 'fragrance',
  tags: ['wood'],
  description: '',
  brand: null,
  extractedText: '',
  identification: 'unknown',
  status: 'ready',
  archiveStatus: 'none',
  error: null,
  source: 'web',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  lastShownAt: null,
  snoozedUntil: null,
  dismissed: false,
  attachments: [],
  ...overrides,
});

const collection = (items: ReturnType<typeof item>[]) => ({
  items,
  total: items.length,
  categories: ['fragrance'],
  settings: { digestEnabled: false, digestCount: 3 },
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const signIn = async (page: Page) => {
  await page.goto('/likes');
  await page
    .getByLabel('Owner key')
    .fill('local-development-key-32-characters-only');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Save it before you lose it.' }),
  ).toBeVisible();
};

test('a deferred prior-query refresh cannot replace a newer filter', async ({
  page,
}) => {
  let signedIn = false;
  let unfilteredReads = 0;
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const refreshResponded = deferred();
  const old = item({ title: 'old query result', status: 'pending' });
  const fresh = item({ id: 'like-2', title: 'new query result' });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (op === 'process') {
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      if (url.searchParams.get('q') === 'new') {
        return json(route, collection([fresh]));
      }
      unfilteredReads += 1;
      if (unfilteredReads === 1) return json(route, collection([old]));
      refreshStarted.resolve();
      await releaseRefresh.promise;
      try {
        await json(route, collection([old]));
      } catch {
        // The fixed page cancels this route; the old implementation accepts it.
      } finally {
        refreshResponded.resolve();
      }
      return;
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await refreshStarted.promise;
  await page.getByPlaceholder('Search', { exact: true }).fill('new');
  await expect(
    page.getByText('new query result', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.body.dataset.staleQuerySeen = 'false';
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll('.likes-card')].some((card) =>
          card.textContent?.includes('old query result'),
        )
      ) {
        document.body.dataset.staleQuerySeen = 'true';
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  releaseRefresh.resolve();
  await refreshResponded.promise;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.locator('body').getAttribute('data-stale-query-seen')).toBe(
    'false',
  );
  await expect(page.getByText('old query result', { exact: true })).toHaveCount(
    0,
  );
});

test('an authorized delayed read cannot restore the collection after logout', async ({
  page,
}) => {
  let signedIn = false;
  let unfilteredReads = 0;
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const refreshResponded = deferred();
  const old = item({ title: 'old row', status: 'pending' });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (op === 'logout') {
      signedIn = false;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (op === 'process') {
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      unfilteredReads += 1;
      if (unfilteredReads === 1) return json(route, collection([old]));
      refreshStarted.resolve();
      await releaseRefresh.promise;
      try {
        await json(route, collection([old]));
      } catch {
        // Logout cancels the active collection read in the fixed page.
      } finally {
        refreshResponded.resolve();
      }
      return;
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await refreshStarted.promise;
  await page.getByRole('button', { name: 'logout', exact: true }).click();
  await expect(page.getByLabel('Owner key')).toBeVisible();

  releaseRefresh.resolve();
  await refreshResponded.promise;
  await expect(page.getByLabel('Owner key')).toBeVisible();
  await expect(page.getByText('old row', { exact: true })).toHaveCount(0);
});

test('a newer enrichment response preserves an unsaved Why draft', async ({
  page,
}) => {
  let signedIn = false;
  let listReads = 0;
  const processStarted = deferred();
  const releaseProcess = deferred();
  const refreshRequested = deferred();
  const releaseRefresh = deferred();
  const before = item({ status: 'pending' });
  const enriched = item({
    note: 'Server enrichment',
    description: 'Fresh metadata',
    status: 'ready',
    updatedAt: '2026-10-02T12:00:00.000Z',
  });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (op === 'process') {
      processStarted.resolve();
      await releaseProcess.promise;
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      listReads += 1;
      if (listReads === 1) return json(route, collection([before]));
      refreshRequested.resolve();
      await releaseRefresh.promise;
      return json(route, collection([enriched]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await processStarted.promise;
  await page.locator('.likes-card').first().click();
  const why = page.locator('.likes-detail textarea');
  await why.fill('Keep this draft');

  releaseProcess.resolve();
  await refreshRequested.promise;
  releaseRefresh.resolve();
  await expect(page.getByText('Fresh metadata', { exact: true })).toBeVisible();
  await expect(why).toHaveValue('Keep this draft');
});

test('zero-progress processing retries once after backoff and stops at zero pending', async ({
  page,
}) => {
  let signedIn = false;
  let processCalls = 0;
  const firstProcessStarted = deferred();
  const releaseFirstProcess = deferred();
  const queued = item({ status: 'pending' });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (op === 'process') {
      processCalls += 1;
      if (processCalls === 1) {
        firstProcessStarted.resolve();
        await releaseFirstProcess.promise;
      }
      return json(
        route,
        processCalls === 1
          ? { processed: 0, failed: 0, imported: 0, pending: 1 }
          : { processed: 0, failed: 0, imported: 0, pending: 0 },
      );
    }
    if (route.request().method() === 'GET' && !op) {
      return json(route, collection([queued]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await firstProcessStarted.promise;
  await page.clock.install();
  releaseFirstProcess.resolve();
  await expect.poll(() => processCalls).toBe(1);
  await page.clock.fastForward(5 * 60_000);
  await expect.poll(() => processCalls).toBe(2);
  await page.clock.fastForward(10 * 60_000);
  expect(processCalls).toBe(2);
});

test('a delayed deep item lookup survives a collection refresh', async ({
  page,
}) => {
  let signedIn = false;
  let listReads = 0;
  let detailReads = 0;
  const detailStarted = deferred();
  const releaseDetail = deferred();
  const refreshStarted = deferred();
  const listItem = item({ id: 'listed-item', status: 'pending' });
  const detailItem = item({
    id: 'deep-item',
    title: 'Deep link item',
    status: 'ready',
  });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'GET' && url.searchParams.get('id')) {
      detailReads += 1;
      detailStarted.resolve();
      await releaseDetail.promise;
      return json(route, { item: detailItem });
    }
    if (op === 'process') {
      await detailStarted.promise;
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      listReads += 1;
      if (listReads === 1) return json(route, collection([listItem]));
      refreshStarted.resolve();
      return json(route, collection([listItem]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await page.goto('/likes?item=deep-item');
  await page
    .getByLabel('Owner key')
    .fill('local-development-key-32-characters-only');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await detailStarted.promise;
  await refreshStarted.promise;
  expect(detailReads).toBe(1);

  releaseDetail.resolve();
  await expect(page.getByLabel('Like details')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Deep link item');
});

test('a cancelled initial detail lookup can restart after a collection error', async ({
  page,
}) => {
  let signedIn = false;
  let listReads = 0;
  let detailReads = 0;
  const detailStarted = deferred();
  const releaseOldDetail = deferred();
  const oldDetailFinished = deferred();
  const queued = item({ id: 'listed-pending', status: 'pending' });
  const recovered = item({ id: 'retry-detail', title: 'Recovered detail' });
  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (url.searchParams.has('id') && !op) {
      detailReads++;
      if (detailReads === 1) {
        detailStarted.resolve();
        await releaseOldDetail.promise;
        try {
          await json(route, { item: { ...recovered, title: 'Stale detail' } });
        } catch {
          /* The obsolete request was cancelled. */
        } finally {
          oldDetailFinished.resolve();
        }
        return;
      }
      return json(route, { item: recovered });
    }
    if (op === 'process') {
      await detailStarted.promise;
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      listReads++;
      return listReads === 2
        ? json(route, { error: 'Temporary collection error' }, 500)
        : json(route, collection([queued]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });
  await page.goto('/likes?item=retry-detail');
  await page
    .getByLabel('Owner key')
    .fill('local-development-key-32-characters-only');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Recovered detail');
  releaseOldDetail.resolve();
  await oldDetailFinished.promise;
  await expect(page.getByLabel('Title')).toHaveValue('Recovered detail');
  expect(detailReads).toBe(2);
});

test('an import-status poll cannot cancel a slow collection refresh', async ({
  page,
}) => {
  let signedIn = false;
  let listReads = 0;
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const importPollStarted = deferred();
  const initial = item({ title: 'Initial list' });
  const afterRefresh = item({
    id: 'new-list-item',
    title: 'New list after import poll',
  });
  const batch = {
    id: 'import-1',
    status: 'pending',
    created: 0,
    duplicates: 0,
    error: null,
    createdAt: '2026-10-01T12:00:00.000Z',
  };

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (op === 'import' && route.request().method() === 'POST') {
      return json(route, batch, 202);
    }
    if (op === 'import' && route.request().method() === 'GET') {
      importPollStarted.resolve();
      return json(route, batch);
    }
    if (op === 'process') {
      return json(route, { processed: 0, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      listReads += 1;
      if (listReads === 1) return json(route, collection([initial]));
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return json(route, collection([afterRefresh]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await page.getByText('Import a pile of notes', { exact: true }).click();
  await page
    .getByPlaceholder(
      'Paste old notes, lists, or bookmarks. They will be kept alongside the individual captures.',
    )
    .fill('An import waiting for status');
  await page.getByRole('button', { name: 'Import notes', exact: true }).click();
  await refreshStarted.promise;
  await importPollStarted.promise;

  releaseRefresh.resolve();
  await expect(
    page.getByText('New list after import poll', { exact: true }),
  ).toBeVisible();
});

test('a delayed capture completion reloads the active filter, not its old closure', async ({
  page,
}) => {
  let signedIn = false;
  const captureStarted = deferred();
  const releaseCapture = deferred();
  const initial = item({ title: 'Initial capture list' });
  const filtered = item({ id: 'filtered-item', title: 'Active filter item' });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'POST' && !op) {
      captureStarted.resolve();
      await releaseCapture.promise;
      return json(route, { item: initial, duplicate: false }, 201);
    }
    if (route.request().method() === 'GET' && !op) {
      return json(
        route,
        collection([
          url.searchParams.get('q') === 'active' ? filtered : initial,
        ]),
      );
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await page.getByLabel('What is it?').fill('A delayed capture');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await captureStarted.promise;
  await page.getByPlaceholder('Search', { exact: true }).fill('active');
  await expect(
    page.getByText('Active filter item', { exact: true }),
  ).toBeVisible();

  releaseCapture.resolve();
  await expect(
    page.getByText('Active filter item', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Initial capture list', { exact: true }),
  ).toHaveCount(0);
});

test('fresh page metadata wins when a delayed deep-link response finishes later', async ({
  page,
}) => {
  let signedIn = false;
  let listReads = 0;
  const detailStarted = deferred();
  const releaseDetail = deferred();
  const listed = item({ id: 'queued-item', status: 'pending' });
  const staleDetail = item({
    id: 'deep-item',
    title: 'Deep metadata from before',
  });
  const freshPage = item({
    id: 'deep-item',
    title: 'Fresh page metadata',
    updatedAt: '2026-10-02T12:00:00.000Z',
  });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'GET' && url.searchParams.get('id')) {
      detailStarted.resolve();
      await releaseDetail.promise;
      return json(route, { item: staleDetail });
    }
    if (op === 'process') {
      await detailStarted.promise;
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      listReads += 1;
      return json(route, collection([listReads === 1 ? listed : freshPage]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await page.goto('/likes?item=deep-item');
  await page
    .getByLabel('Owner key')
    .fill('local-development-key-32-characters-only');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await detailStarted.promise;
  await expect(page.getByLabel('Title')).toHaveValue('Fresh page metadata');

  releaseDetail.resolve();
  await expect(page.getByLabel('Title')).toHaveValue('Fresh page metadata');
});

test('a selected pending item remains open when it leaves the active filter', async ({
  page,
}) => {
  let signedIn = false;
  let processed = false;
  const processStarted = deferred();
  const releaseProcess = deferred();
  const queued = item({ status: 'pending', title: 'Pending filtered item' });
  const enriched = item({
    status: 'ready',
    title: 'Pending filtered item',
    category: 'new-category',
  });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'GET' && url.searchParams.get('id')) {
      return json(route, { item: enriched });
    }
    if (op === 'process') {
      processStarted.resolve();
      await releaseProcess.promise;
      processed = true;
      return json(route, { processed: 1, failed: 0, imported: 0, pending: 0 });
    }
    if (route.request().method() === 'GET' && !op) {
      return json(route, collection(processed ? [] : [queued]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await processStarted.promise;
  await page.locator('.likes-card').first().click();
  const why = page.locator('.likes-detail textarea');
  await why.fill('Keep this while filtering');
  await page.getByLabel('Filter by category').selectOption('fragrance');

  releaseProcess.resolve();
  await expect(page.locator('.likes-card')).toHaveCount(0);
  await expect(page.getByLabel('Like details')).toBeVisible();
  await expect(why).toHaveValue('Keep this while filtering');
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue(
    'new-category',
  );
});

test('a saved Why yields to later server rationale once its draft is committed', async ({
  page,
}) => {
  let signedIn = false;
  let listReads = 0;
  const saved = item({ note: 'My saved Why' });
  const appended = item({ note: 'My saved Why\n\nServer rationale' });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'PATCH')
      return json(route, { item: saved });
    if (route.request().method() === 'GET' && !op) {
      listReads += 1;
      return json(route, collection([listReads === 1 ? item() : appended]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await page.locator('.likes-card').first().click();
  const why = page.locator('.likes-detail textarea');
  await why.fill('My saved Why');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();

  await expect(why).toHaveValue('My saved Why\n\nServer rationale');
});

test('typing during a pending save keeps the later draft', async ({ page }) => {
  let signedIn = false;
  const patchStarted = deferred();
  const releasePatch = deferred();
  const saved = item({ note: 'First version' });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'PATCH') {
      patchStarted.resolve();
      await releasePatch.promise;
      return json(route, { item: saved });
    }
    if (route.request().method() === 'GET' && !op) {
      return json(route, collection([item()]));
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await page.locator('.likes-card').first().click();
  const why = page.locator('.likes-detail textarea');
  await why.fill('First version');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await patchStarted.promise;
  await why.fill('Second version');

  releasePatch.resolve();
  await expect(why).toHaveValue('Second version');
});

test('a Why-only save patches only note and keeps newer server category', async ({
  page,
}) => {
  let signedIn = false;
  let patchBody: unknown;
  let listReads = 0;
  const initial = item({ category: 'fragrance', note: 'Original why' });
  const categoryChanged = item({
    category: 'home-fragrance',
    note: 'Why only',
  });

  await page.route('**/api/likes**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (op === 'login') {
      signedIn = true;
      return json(route, { success: true });
    }
    if (!signedIn) return json(route, { error: 'Sign in' }, 401);
    if (route.request().method() === 'PATCH') {
      patchBody = route.request().postDataJSON();
      return json(route, { item: categoryChanged });
    }
    if (route.request().method() === 'GET' && !op) {
      listReads += 1;
      return json(
        route,
        collection([listReads === 1 ? initial : categoryChanged]),
      );
    }
    return json(route, { error: 'Unexpected request' }, 500);
  });

  await signIn(page);
  await page.locator('.likes-card').first().click();
  const why = page.locator('.likes-detail textarea');
  await why.fill('Why only');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();

  await expect.poll(() => patchBody).toEqual({ note: 'Why only' });
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue(
    'home-fragrance',
  );
});
