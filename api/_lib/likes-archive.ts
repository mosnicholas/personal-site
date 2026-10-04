import * as cheerio from 'cheerio';

import type { LikeAttachment, LikedItem } from '../../shared/likes.js';
import { fetchPublicUrl, isHtml, isImage } from './likes-fetch.js';
import { saveAttachment } from './likes-store.js';

const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MAX_BYTES = 1024 * 1024;
const CSS_MAX_BYTES = 256 * 1024;
const MAX_IMAGES = 4;
const MAX_STYLESHEETS = 2;
const IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ARCHIVE_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; script-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export type ArchiveFetcher = typeof fetchPublicUrl;

export interface ArchiveMetadata {
  title?: string;
  description?: string;
  brand?: string;
  imageUrls: string[];
  extractedText: string;
}

export interface ArchiveLikeResult {
  patch: Pick<
    Partial<LikedItem>,
    | 'archiveStatus'
    | 'title'
    | 'description'
    | 'brand'
    | 'extractedText'
    | 'attachments'
  >;
  error?: string;
}

const attributeText = (
  $: cheerio.CheerioAPI,
  selector: string,
  attribute: string,
) => $(selector).first().attr(attribute)?.trim() || undefined;

const cleanText = (value: string | undefined) =>
  value?.replace(/\s+/g, ' ').trim() || undefined;

function jsonLdMetadata(
  $: cheerio.CheerioAPI,
): Pick<ArchiveMetadata, 'title' | 'description' | 'brand' | 'imageUrls'> {
  const nodes: unknown[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      nodes.push(parsed);
    } catch {
      // JSON-LD is optional page metadata; malformed markup is not an archive failure.
    }
  });
  const flatten = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    return [record, ...flatten(record['@graph'])];
  };
  const product = nodes.flatMap(flatten).find((node) => {
    const type = node['@type'];
    return (
      type === 'Product' || (Array.isArray(type) && type.includes('Product'))
    );
  });
  if (!product) return { imageUrls: [] };
  const images = Array.isArray(product.image) ? product.image : [product.image];
  const brand = product.brand;
  return {
    title:
      typeof product.name === 'string' ? cleanText(product.name) : undefined,
    description:
      typeof product.description === 'string'
        ? cleanText(product.description)
        : undefined,
    brand:
      typeof brand === 'string'
        ? cleanText(brand)
        : brand &&
            typeof brand === 'object' &&
            typeof (brand as { name?: unknown }).name === 'string'
          ? cleanText((brand as { name: string }).name)
          : undefined,
    imageUrls: images.flatMap((image) =>
      typeof image === 'string'
        ? [image]
        : image &&
            typeof image === 'object' &&
            typeof (image as { url?: unknown }).url === 'string'
          ? [(image as { url: string }).url]
          : [],
    ),
  };
}

export function extractArchiveMetadata(
  html: string,
  pageUrl: string,
): ArchiveMetadata {
  const $ = cheerio.load(html);
  const product = jsonLdMetadata($);
  const ogImages = $('meta[property="og:image"], meta[name="twitter:image"]')
    .map((_index, element) => $(element).attr('content'))
    .get()
    .filter((value): value is string => Boolean(value));
  const images = [...product.imageUrls, ...ogImages]
    .map((value) => {
      try {
        return new URL(value, pageUrl).toString();
      } catch {
        return undefined;
      }
    })
    .filter((value): value is string => Boolean(value));
  const uniqueImages = [...new Set(images)].slice(0, MAX_IMAGES);
  const title =
    product.title ??
    cleanText(attributeText($, 'meta[property="og:title"]', 'content')) ??
    cleanText($('title').text());
  const description =
    product.description ??
    cleanText(attributeText($, 'meta[property="og:description"]', 'content')) ??
    cleanText(attributeText($, 'meta[name="description"]', 'content'));
  return {
    title,
    description,
    brand: product.brand,
    imageUrls: uniqueImages,
    extractedText: cleanText($('body').text())?.slice(0, 100_000) ?? '',
  };
}

const safeDataUrl = (contentType: string, bytes: Uint8Array) =>
  `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;

function sanitizeCss(css: string): { css: string; partial: boolean } {
  let partial = false;
  const withoutImports = css.replace(/@import[^;]+;/gi, () => {
    partial = true;
    return '';
  });
  const sanitized = withoutImports.replace(
    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
    (_whole, _quote, value: string) => {
      const trimmed = value.trim();
      if (/^data:(image\/(avif|gif|jpeg|png|webp)|font\/)/i.test(trimmed))
        return `url(${trimmed})`;
      partial = true;
      return 'none';
    },
  );
  return { css: sanitized.replace(/<\/style/gi, '<\\/style'), partial };
}

function sanitizedDocument(
  html: string,
  pageUrl: string,
): { $: cheerio.CheerioAPI; partial: boolean } {
  const $ = cheerio.load(html);
  let partial = false;
  const dynamicScripts = $('script').filter(
    (_index, script) =>
      ($(script).attr('type') ?? '').toLowerCase() !== 'application/ld+json',
  ).length;
  const dynamic =
    dynamicScripts > 0 ||
    $('iframe, video, audio, object, embed, canvas, source, svg').length > 0;
  if (dynamic) partial = true;
  $(
    'script, noscript, iframe, video, audio, object, embed, canvas, source, svg, base, form',
  ).remove();
  $(
    'meta[http-equiv], meta[property^="og:"], meta[name^="twitter:"], link:not([rel~="stylesheet"])',
  ).remove();
  $('style').each((_index, style) => {
    const css = sanitizeCss($(style).text());
    partial ||= css.partial;
    $(style).text(css.css);
  });
  $('*').each((_index, element) => {
    const attributes = 'attribs' in element ? element.attribs : undefined;
    for (const attribute of Object.keys(attributes ?? {})) {
      const value = $(element).attr(attribute) ?? '';
      const lower = attribute.toLowerCase();
      if (lower.startsWith('on') || lower === 'srcdoc') {
        $(element).removeAttr(attribute);
      } else if (
        ['href', 'src', 'action', 'poster', 'xlink:href'].includes(lower)
      ) {
        try {
          const absolute = new URL(value, pageUrl);
          if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
            $(element).removeAttr(attribute);
          }
        } catch {
          $(element).removeAttr(attribute);
        }
      } else if (lower === 'style' && /url\(|expression\s*\(/i.test(value)) {
        $(element).removeAttr(attribute);
        partial = true;
      }
    }
  });
  return { $, partial };
}

export function sanitizeArchiveHtml(html: string, pageUrl: string) {
  const document = sanitizedDocument(html, pageUrl);
  return { html: document.$.html(), partial: document.partial };
}

function removeRemainingRemoteLoads($: cheerio.CheerioAPI): boolean {
  let partial = false;
  $('[srcset]').each((_index, element) => {
    $(element).removeAttr('srcset');
    partial = true;
  });
  $('[src], [background]').each((_index, element) => {
    const source = $(element).attr('src');
    if (source && source.startsWith('data:') && element.tagName === 'img') {
      return;
    }
    $(element).removeAttr('src');
    $(element).removeAttr('background');
    partial = true;
  });
  return partial;
}

async function embedImages(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  itemId: string,
  fetcher: ArchiveFetcher,
): Promise<{
  attachments: LikeAttachment[];
  embeddedUrls: Set<string>;
  partial: boolean;
}> {
  const attachments: LikeAttachment[] = [];
  const embeddedUrls = new Set<string>();
  let partial = false;
  const imageElements = $('img[src]').toArray().slice(0, MAX_IMAGES);
  for (const [index, image] of imageElements.entries()) {
    const source = $(image).attr('src');
    if (!source) continue;
    try {
      const remote = await fetcher(new URL(source, pageUrl).toString(), {
        maxBytes: IMAGE_MAX_BYTES,
        accept: (contentType) =>
          isImage(contentType) && IMAGE_TYPES.has(contentType),
      });
      const attachment = await saveAttachment({
        itemId,
        role: 'image',
        filename: `archive-image-${index + 1}.${remote.contentType.split('/')[1] ?? 'bin'}`,
        contentType: remote.contentType,
        data: remote.body,
      });
      attachments.push(attachment);
      embeddedUrls.add(new URL(source, pageUrl).toString());
      $(image).attr('src', safeDataUrl(remote.contentType, remote.body));
      $(image).removeAttr('srcset');
    } catch {
      partial = true;
      $(image).remove();
    }
  }
  $('img[src]').each((_index, image) => {
    if (!$(image).attr('src')?.startsWith('data:')) {
      partial = true;
      $(image).remove();
    }
  });
  return { attachments, embeddedUrls, partial };
}

async function embedMetadataImages(
  $: cheerio.CheerioAPI,
  imageUrls: string[],
  itemId: string,
  fetcher: ArchiveFetcher,
  alreadyEmbedded: Set<string>,
  slots: number,
): Promise<{ attachments: LikeAttachment[]; partial: boolean }> {
  const attachments: LikeAttachment[] = [];
  let partial = false;
  for (const [index, imageUrl] of imageUrls
    .filter((url) => !alreadyEmbedded.has(url))
    .slice(0, Math.max(0, slots))
    .entries()) {
    try {
      const remote = await fetcher(imageUrl, {
        maxBytes: IMAGE_MAX_BYTES,
        accept: (contentType) =>
          isImage(contentType) && IMAGE_TYPES.has(contentType),
      });
      const attachment = await saveAttachment({
        itemId,
        role: 'image',
        filename: `archive-metadata-image-${index + 1}.${remote.contentType.split('/')[1] ?? 'bin'}`,
        contentType: remote.contentType,
        data: remote.body,
      });
      attachments.push(attachment);
      alreadyEmbedded.add(imageUrl);
      $('body').prepend(
        `<figure data-likes-archive-preview="metadata"><img src="${safeDataUrl(remote.contentType, remote.body)}" alt=""></figure>`,
      );
    } catch {
      partial = true;
    }
  }
  return { attachments, partial };
}

async function embedStylesheets(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  fetcher: ArchiveFetcher,
): Promise<boolean> {
  let partial = false;
  const links = $('link[rel~="stylesheet"][href]').toArray();
  for (const [index, link] of links.entries()) {
    if (index >= MAX_STYLESHEETS) {
      $(link).remove();
      partial = true;
      continue;
    }
    try {
      const source = $(link).attr('href');
      if (!source) throw new Error('missing stylesheet');
      const remote = await fetcher(new URL(source, pageUrl).toString(), {
        maxBytes: CSS_MAX_BYTES,
        accept: (contentType) => contentType === 'text/css',
      });
      const css = sanitizeCss(new TextDecoder().decode(remote.body));
      partial ||= css.partial;
      $(link).replaceWith(`<style>${css.css}</style>`);
    } catch {
      $(link).remove();
      partial = true;
    }
  }
  return partial;
}

/** Archive a page as one self-contained, static HTML attachment. */
export async function archiveLike(
  item: LikedItem,
  fetcher: ArchiveFetcher = fetchPublicUrl,
): Promise<ArchiveLikeResult> {
  if (!item.url) return { patch: { archiveStatus: 'none' } };
  try {
    const remote = await fetcher(item.url, {
      maxBytes: PAGE_MAX_BYTES,
      accept: isHtml,
    });
    const sourceHtml = new TextDecoder().decode(remote.body);
    const metadata = extractArchiveMetadata(sourceHtml, remote.url);
    const document = sanitizedDocument(sourceHtml, remote.url);
    const images = await embedImages(document.$, remote.url, item.id, fetcher);
    const metadataImages = await embedMetadataImages(
      document.$,
      metadata.imageUrls,
      item.id,
      fetcher,
      images.embeddedUrls,
      MAX_IMAGES - images.attachments.length,
    );
    const stylesPartial = await embedStylesheets(
      document.$,
      remote.url,
      fetcher,
    );
    const remainingLoadsPartial = removeRemainingRemoteLoads(document.$);
    document
      .$('head')
      .prepend(
        `<meta http-equiv="Content-Security-Policy" content="${ARCHIVE_CSP}">`,
      );
    const staticHtml = `<!doctype html>\n${document.$.html()}`;
    const archive = await saveAttachment({
      itemId: item.id,
      role: 'archive',
      filename: `archive-${item.id}.html`,
      contentType: 'text/html; charset=utf-8',
      data: new TextEncoder().encode(staticHtml),
    });
    const partial =
      document.partial ||
      images.partial ||
      metadataImages.partial ||
      stylesPartial ||
      remainingLoadsPartial;
    return {
      patch: {
        archiveStatus: partial ? 'partial' : 'complete',
        title: metadata.title,
        description: metadata.description,
        brand: metadata.brand,
        extractedText: metadata.extractedText,
        attachments: [
          ...item.attachments,
          ...images.attachments,
          ...metadataImages.attachments,
          archive,
        ],
      },
      ...(partial
        ? {
            error:
              'Archive saved with unavailable assets or dynamic content removed.',
          }
        : {}),
    };
  } catch {
    return {
      patch: { archiveStatus: 'failed' },
      error:
        'Could not archive this page. The original link was saved and can be retried.',
    };
  }
}
