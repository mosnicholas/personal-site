import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type {
  LikeAttachment,
  LikeInput,
  LikedItem,
} from '../../shared/likes.js';
import { getAnthropic } from './anthropic.js';
import { archiveLike } from './likes-archive.js';
import { readAttachment } from './likes-store.js';
import { tracedCall } from './traces.js';

const ENRICHMENT_MODEL = 'claude-haiku-4-5';
const IMPORT_MODEL = 'claude-haiku-4-5';
export const IMPORT_CHUNK_CHARS = 6_000;
const MAX_VISION_BYTES = 5 * 1024 * 1024;

type LikesAiClient = Pick<Anthropic, 'messages'>;

let resolveAiClient: () => LikesAiClient = getAnthropic;
let loadAttachment: typeof readAttachment = readAttachment;

/** Test-only seam: production always uses the configured Anthropic client and private storage. */
export function setLikesEnrichmentTestDependencies(dependencies?: {
  client?: LikesAiClient;
  readAttachment?: typeof readAttachment;
}) {
  resolveAiClient = dependencies?.client
    ? () => dependencies.client!
    : getAnthropic;
  loadAttachment = dependencies?.readAttachment ?? readAttachment;
}

const enrichmentSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2_000).optional(),
  brand: z.string().trim().min(1).max(160).optional(),
  extractedText: z.string().max(100_000).optional(),
  identification: z
    .enum(['confirmed', 'suggested', 'unknown'])
    .default('unknown'),
});

const splitNotesSchema = z.object({
  complete: z.literal(true),
  items: z
    .array(
      z.object({
        // Do not trim: this must stay byte-for-byte identical to the source.
        excerpt: z
          .string()
          .min(1)
          .max(20_000)
          .refine((value) => value.trim().length > 0),
        title: z.string().trim().min(1).max(300).optional(),
        category: z.string().trim().min(1).max(80).optional(),
        tags: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
      }),
    )
    .min(1),
});

const outputText = (response: Anthropic.Message) => {
  if (
    response.stop_reason === 'refusal' ||
    response.stop_reason === 'max_tokens'
  ) {
    throw new Error('The model did not finish the requested extraction');
  }
  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  if (!text) throw new Error('The model returned no structured result');
  return text;
};

function makeEnrichmentRequest(
  subject: Record<string, unknown>,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: ENRICHMENT_MODEL,
    max_tokens: 1_200,
    system:
      'Classify a private personal save. Preserve the user wording: make suggestions only, do not invent facts, and use identification "suggested" unless the supplied evidence itself confirms it. Return JSON only.',
    messages: [{ role: 'user', content: JSON.stringify(subject) }],
    output_config: {
      format: zodOutputFormat(enrichmentSchema),
    },
  };
}

async function runEnrichment(
  subjectId: string,
  request: Anthropic.MessageCreateParamsNonStreaming,
  traceRequest: unknown = request,
) {
  return tracedCall(
    {
      kind: 'likes_enrichment',
      subjectId,
      model: ENRICHMENT_MODEL,
      request: traceRequest,
    },
    () =>
      resolveAiClient().messages.create(request, {
        timeout: 60000,
        maxRetries: 0,
      }),
    (response) => enrichmentSchema.parse(JSON.parse(outputText(response))),
  );
}

const classify = (subjectId: string, subject: Record<string, unknown>) =>
  runEnrichment(subjectId, makeEnrichmentRequest(subject));

function mergePatch(
  archive: Awaited<ReturnType<typeof archiveLike>>['patch'],
  classification: z.infer<typeof enrichmentSchema> | undefined,
  error: string | undefined,
  failed = false,
  photo = false,
): Partial<LikedItem> {
  return {
    ...archive,
    ...(classification
      ? {
          category: classification.category,
          tags: [
            ...new Set(classification.tags.map((tag) => tag.toLowerCase())),
          ],
          title: classification.title ?? archive.title,
          description: classification.description ?? archive.description,
          brand: classification.brand ?? archive.brand,
          extractedText: classification.extractedText ?? archive.extractedText,
          identification:
            photo && classification.identification !== 'unknown'
              ? 'suggested'
              : classification.identification,
        }
      : { identification: 'unknown' as const }),
    error: error ?? null,
    ...(failed ? { status: 'failed' as const } : {}),
  };
}

/** Keep LLM traces replayable without copying the private image bytes into Postgres. */
export function redactPhotoTraceRequest(
  request: Anthropic.MessageCreateParamsNonStreaming,
  attachment: LikeAttachment,
) {
  const safeRequest = Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== 'messages'),
  );
  const originalContent = request.messages[0]?.content;
  const text = Array.isArray(originalContent)
    ? originalContent
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    : (originalContent ?? '');
  return {
    ...safeRequest,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'private_attachment',
              attachmentId: attachment.id,
              sha256: attachment.sha256,
              contentType: attachment.contentType,
            },
          },
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  };
}

async function enrichPhoto(item: LikedItem): Promise<Partial<LikedItem>> {
  const original = item.attachments.find(
    (attachment) => attachment.role === 'original',
  );
  if (!original) {
    return {
      identification: 'unknown',
      error: 'No original photo is available for identification.',
      status: 'failed',
    };
  }
  try {
    const { attachment, data } = await loadAttachment(original.id);
    const mediaType = attachment.contentType.split(';', 1)[0]!.toLowerCase();
    if (!mediaType.startsWith('image/') || data.byteLength > MAX_VISION_BYTES) {
      return {
        identification: 'unknown',
        error: 'The original photo is not a supported size for identification.',
        status: 'failed',
      };
    }
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: ENRICHMENT_MODEL,
      max_tokens: 1_200,
      system:
        'Classify this private photo for a personal saves database. Transcribe visible label text exactly as extractedText without correcting it. Preserve user wording. Product identification is a suggestion, never a confirmation based only on model inference. Return JSON only.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as
                  'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: Buffer.from(data).toString('base64'),
              },
            },
            {
              type: 'text',
              text: JSON.stringify({
                note: item.note,
                originalText: item.originalText,
              }),
            },
          ],
        },
      ],
      output_config: {
        format: zodOutputFormat(enrichmentSchema),
      },
    };
    const classification = await runEnrichment(
      item.id,
      request,
      redactPhotoTraceRequest(request, attachment),
    );
    return mergePatch(
      { archiveStatus: 'none' },
      classification,
      undefined,
      false,
      true,
    );
  } catch {
    return {
      identification: 'unknown',
      error:
        'Could not identify the original photo. It was saved and can be retried.',
      status: 'failed',
    };
  }
}

/**
 * Return only worker-owned enrichment suggestions. The store owner preserves
 * submitted title, category, note, and tags when applying this patch.
 */
export async function enrichLike(item: LikedItem): Promise<Partial<LikedItem>> {
  if (item.kind === 'photo') return enrichPhoto(item);
  const archive = item.url
    ? await archiveLike(item)
    : { patch: { archiveStatus: 'none' as const } };
  try {
    const classification = await classify(item.id, {
      url: item.url,
      originalText: item.originalText,
      note: item.note,
      metadata: {
        title: archive.patch.title,
        description: archive.patch.description,
        brand: archive.patch.brand,
      },
      extractedText: archive.patch.extractedText?.slice(0, 20_000),
    });
    return mergePatch(
      archive.patch,
      classification,
      archive.error,
      archive.patch.archiveStatus === 'failed',
    );
  } catch {
    return mergePatch(
      archive.patch,
      undefined,
      archive.error ??
        'Saved without enrichment; retry when the service is available.',
      true,
    );
  }
}

function splitNotesRequest(
  chunk: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: IMPORT_MODEL,
    max_tokens: 8_192,
    system:
      'Split the supplied notes into every distinct saveable item. For each item, excerpt must be an exact, non-empty verbatim substring of the source. Do not normalize, paraphrase, truncate, or omit any item. Together the excerpts must cover every non-whitespace character, including headings, bullet markers, and punctuation; keep contextual headings with nearby items. If a complete result will not fit, refuse rather than return a partial result. Return JSON only.',
    messages: [{ role: 'user', content: chunk }],
    output_config: {
      format: zodOutputFormat(splitNotesSchema),
    },
  };
}

export function assertSourceCoverage(chunk: string, excerpts: string[]) {
  const covered = new Uint8Array(chunk.length);
  for (const excerpt of excerpts) {
    let offset = 0;
    while (offset < chunk.length) {
      const found = chunk.indexOf(excerpt, offset);
      if (found < 0) break;
      covered.fill(1, found, found + excerpt.length);
      offset = found + Math.max(1, excerpt.length);
    }
  }
  for (let index = 0; index < chunk.length; index += 1) {
    if (!covered[index] && !/\s/.test(chunk[index]!)) {
      throw new Error(
        'Import response did not cover the complete source chunk',
      );
    }
  }
}

function urlsInExcerpt(excerpt: string): string[] {
  const candidates = excerpt.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const urls: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate.replace(/[),.;!?\]}]+$/g, '');
    try {
      const url = new URL(clean);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
      ) {
        urls.push(url.toString());
      }
    } catch {
      // This remains part of the exact original note when it is not a valid URL.
    }
  }
  return [...new Set(urls)];
}

function importedInputs(
  item: z.infer<typeof splitNotesSchema>['items'][number],
): LikeInput[] {
  const base = {
    text: item.excerpt,
    title: item.title,
    category: item.category,
    tags: [...new Set(item.tags.map((tag) => tag.toLowerCase()))],
    source: 'import',
  };
  const urls = urlsInExcerpt(item.excerpt);
  if (!urls.length) return [{ ...base, kind: 'note' }];
  return urls.map((url) => ({
    ...base,
    kind: 'link' as const,
    url,
    // Keep the surrounding rationale with every extracted link source.
    note: item.excerpt.trim() === url ? undefined : item.excerpt,
  }));
}

/** Parse one job-owned bounded import segment without accepting a partial response. */
export async function splitNotes(
  text: string,
  subjectId: string,
): Promise<LikeInput[]> {
  if (!text.trim()) return [];
  if (text.length > IMPORT_CHUNK_CHARS) {
    throw new Error('Import chunk exceeded its safety limit');
  }
  const inputs: LikeInput[] = [];
  const request = splitNotesRequest(text);
  const parsed = await tracedCall(
    { kind: 'likes_import', subjectId, model: IMPORT_MODEL, request },
    () =>
      resolveAiClient().messages.create(request, {
        timeout: 60000,
        maxRetries: 0,
      }),
    (response) => splitNotesSchema.parse(JSON.parse(outputText(response))),
  );
  assertSourceCoverage(
    text,
    parsed.items.map((item) => item.excerpt),
  );
  for (const item of parsed.items) {
    if (!text.includes(item.excerpt)) {
      throw new Error(
        'Import response contained text that does not exactly match the source',
      );
    }
    inputs.push(...importedInputs(item));
  }
  return inputs;
}
