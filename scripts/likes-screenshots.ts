/** Render stored snapshots with networking blocked; run on a trusted local worker. */
import { chromium } from '@playwright/test';
import type { LikedItem } from '../shared/likes.js';

const origin = process.env.LIKES_ORIGIN ?? 'https://nimo.fyi';
const key = process.env.LIKES_API_KEY;
if (!key) throw new Error('Set LIKES_API_KEY in the worker environment');
const api = async (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${key}`);
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Worker request failed (${response.status})`);
  return response;
};
const browser = await chromium.launch({
  channel: process.env.LIKES_BROWSER_CHANNEL,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  for (let offset = 0; ; offset += 100) {
    const response = await api(`/api/likes?limit=100&offset=${offset}`);
    const { items, total } = (await response.json()) as {
      items: LikedItem[];
      total: number;
    };
    for (const item of items) {
      if (item.attachments.some((a) => a.role === 'screenshot')) continue;
      const archive = item.attachments.find(
        (a) => a.role === 'archive' && a.contentType.startsWith('text/html'),
      );
      if (!archive) continue;
      const html = await (await api(archive.url)).text();
      // Snapshot contains static HTML plus embedded assets. No remote browsing.
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const png = await page.screenshot({ fullPage: true, timeout: 15000 });
      const form = new FormData();
      form.set(
        'file',
        new File([new Uint8Array(png)], 'screenshot.png', {
          type: 'image/png',
        }),
      );
      await api(`/api/likes?op=screenshot&id=${item.id}`, {
        method: 'POST',
        body: form,
      });
      console.log(`Rendered saved item ${item.id}`);
    }
    if (offset + items.length >= total) break;
  }
} finally {
  await browser.close();
}
