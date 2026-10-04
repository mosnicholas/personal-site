export type LikeKind = 'link' | 'note' | 'photo';
export type JobStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type ArchiveStatus =
  'none' | 'pending' | 'complete' | 'partial' | 'failed';
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
export interface LikesSettings {
  digestEnabled: boolean;
  digestCount: number;
}
