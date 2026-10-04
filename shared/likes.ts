export type LikeKind = 'link' | 'note' | 'photo';
export type JobStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type ArchiveStatus =
  'none' | 'pending' | 'complete' | 'partial' | 'failed';
export interface LikeWebSource {
  url: string;
  title: string;
  excerpt: string;
}
export interface LikeWebLookup {
  status: 'none' | 'matched' | 'ambiguous' | 'no-match' | 'failed';
  sources: LikeWebSource[];
  checkedAt: string | null;
  archiveAttachmentId?: string;
  imageAttachmentIds?: string[];
}
export interface LikeInput {
  kind?: LikeKind;
  url?: string;
  text?: string;
  title?: string;
  note?: string;
  category?: string;
  tags?: string[];
  attachmentIds?: string[];
  source?: string;
}
export interface LikeAttachment {
  id: string;
  itemId: string | null;
  role: 'original' | 'image' | 'archive' | 'screenshot';
  filename: string;
  contentType: string;
  bytes: number;
  sha256: string;
  url: string;
}
export interface LikedItem {
  id: string;
  kind: LikeKind;
  url: string | null;
  originalText: string;
  title: string;
  note: string;
  category: string;
  tags: string[];
  description: string;
  brand: string | null;
  extractedText: string;
  identification: 'confirmed' | 'suggested' | 'unknown';
  webLookup: LikeWebLookup;
  status: JobStatus;
  archiveStatus: ArchiveStatus;
  error: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastShownAt: string | null;
  snoozedUntil: string | null;
  dismissed: boolean;
  attachments: LikeAttachment[];
}
export interface ImportBatch {
  id: string;
  status: JobStatus;
  created: number;
  duplicates: number;
  error: string | null;
  createdAt: string;
}
/** Prefer the original upload, then images belonging to the current archive. */
export function primaryLikeImage(item: LikedItem): LikeAttachment | undefined {
  const original = item.attachments.find(
    (asset) =>
      asset.role === 'original' && asset.contentType.startsWith('image/'),
  );
  if (original) return original;
  const imageIds = item.webLookup?.imageAttachmentIds;
  if (imageIds) {
    return item.attachments.find(
      (asset) =>
        imageIds.includes(asset.id) && asset.contentType.startsWith('image/'),
    );
  }
  if (
    item.kind === 'note' &&
    item.webLookup &&
    item.webLookup.status !== 'none'
  )
    return undefined;
  return [...item.attachments]
    .reverse()
    .find((asset) => asset.contentType.startsWith('image/'));
}
export interface LikesSettings {
  digestEnabled: boolean;
  digestCount: number;
}
