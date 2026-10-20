/**
 * The pages behind a like: a linked page's title, description, text and
 * pictures, for Haiku to go by and to find the like's picture among
 */

import { isHttpUrl } from './likes.js';
import { USER_AGENT } from './pictures.js';
import { htmlToText } from './summarize.js';

export interface Page {
  title: string;
  description: string;
  text: string;
  /** og:image, which some sites set to their own picture on every page */
  previewImage: string | null;
  /** The page's first few <img>s */
  images: string[];
}

/** An <img>'s biggest version: the largest in its srcset, else its src */
function imgSource(tag: string): string | undefined {
  const attribute = (name: string) =>
    tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)`, 'i'))?.[1];
  const largest = attribute('srcset')
    ?.split(/,\s+/)
    .map((entry) => {
      const [url, size = '1x'] = entry.trim().split(/\s+/);
      return { url, size: parseFloat(size) || 0 };
    })
    .sort((a, b) => b.size - a.size)[0]?.url;
  return largest ?? attribute('src');
}

/** `<meta>` tags by property or name, e.g. og:image */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
        ([, name, double, single]) => [name.toLowerCase(), double ?? single],
      ),
    );
    const key = (
      attributes.get('property') ?? attributes.get('name')
    )?.toLowerCase();
    const content = attributes.get('content');
    if (key && content && !tags.has(key)) tags.set(key, htmlToText(content));
  }
  return tags;
}

/**
 * The linked page's title, description, preview image and text. Many sites
 * turn away servers; then Haiku goes by the link alone
 */
export async function fetchPage(url: string): Promise<Page | undefined> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    if (!response.headers.get('content-type')?.includes('html')) {
      return undefined;
    }
    const html = await response.text();
    const meta = metaTags(html);
    // An image's absolute URL; null for an SVG (Claude can't read it) or a
    // src that isn't a web URL
    const absolute = (src: string) => {
      try {
        const resolved = new URL(htmlToText(src), response.url).toString();
        return isHttpUrl(resolved) && !/\.svg(\?|$)/i.test(resolved)
          ? resolved
          : null;
      } catch {
        return null;
      }
    };
    const preview = meta.get('og:image') ?? meta.get('twitter:image');
    const images = [...html.matchAll(/<img\b[^>]*>/gi)]
      .map(([tag]) => imgSource(tag))
      .map((src) => (src ? absolute(src) : null))
      .filter((url): url is string => url !== null);
    return {
      title:
        meta.get('og:title') ??
        htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
      description: meta.get('og:description') ?? meta.get('description') ?? '',
      text: htmlToText(html).slice(0, 20_000),
      previewImage: preview ? absolute(preview) : null,
      images: [...new Set(images)].slice(0, 5),
    };
  } catch {
    return undefined;
  }
}
