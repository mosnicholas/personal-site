import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

test('private capture, photo upload, raw note backfill, searching and export', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/likes');
  await page
    .getByLabel('Owner key')
    .fill('local-development-key-32-characters-only');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Save it before you lose it.' }),
  ).toBeVisible();
  const unique = `Perfume ${Date.now()}`;
  await page.getByLabel('What is it?').fill(unique);
  await page.getByLabel('Why do you like it?').fill('Loved the woody drydown');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search', { exact: true }).fill(unique);
  await expect(page.locator('.likes-card')).toHaveCount(1);
  await page.getByPlaceholder('Search', { exact: true }).fill('');
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#d6bb89' },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'bottle.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.likes-card img').first()).toBeVisible();
  await page.getByText('Import a pile of notes', { exact: true }).click();
  await page
    .getByPlaceholder(
      'Paste old notes, lists, or bookmarks. They will be kept alongside the individual captures.',
    )
    .fill(
      `Amber scent ${Date.now()}\nLiked it in the shop\n\nCedar candle ${Date.now()}\nLoved the jar`,
    );
  await page.getByRole('button', { name: 'Import notes', exact: true }).click();
  await expect(page.getByText(/Import ready · 2 saved/)).toBeVisible({
    timeout: 20000,
  });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'export', exact: true }).click();
  const zipDownload = await download;
  expect(zipDownload.suggestedFilename()).toBe('nimo-likes.zip');
  const zipPath = resolve('test-results/export.zip');
  await zipDownload.saveAs(zipPath);
  await page.screenshot({
    path: 'test-results/likes-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/likes-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(failures).toEqual([]);
  await page.getByRole('button', { name: 'logout', exact: true }).click();
  await expect(page.getByLabel('Owner key')).toBeVisible();
  const offlineRoot = resolve('test-results/offline-export');
  const files = unzipSync(new Uint8Array(await readFile(zipPath)));
  for (const [filename, bytes] of Object.entries(files)) {
    const target = resolve(offlineRoot, filename);
    expect(target.startsWith(offlineRoot + '/')).toBe(true);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve(offlineRoot, 'index.html')).href);
  await expect(
    page.getByRole('heading', { name: 'Things I like', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('img')
        .first()
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
});
