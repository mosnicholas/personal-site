// Shapes returned by /api/reading-graph (keep in sync with the API)

export interface ReadingCluster {
  id: string;
  label: string;
  tags: number;
  documents: number;
}

export interface ReadingTag {
  name: string;
  documents: number;
  cluster: string | null;
  definition: string | null;
}

export interface ReadingEdge {
  /** Tag names */
  source: string;
  target: string;
  /** Documents the two tags share (>= 2) */
  weight: number;
}

export interface ReadingTimeline {
  /** Monday dates, 'YYYY-MM-DD', oldest first (up to 52) */
  weeks: string[];
  /** byCluster[clusterId][i] = documents saved in weeks[i] with a tag in that cluster */
  byCluster: Record<string, number[]>;
}

/** GET /api/reading-graph */
export interface ReadingGraph {
  generatedAt: string;
  documents: number;
  clusters: ReadingCluster[];
  tags: ReadingTag[];
  edges: ReadingEdge[];
  timeline: ReadingTimeline;
}

export interface TagDocument {
  title: string;
  author: string | null;
  site: string | null;
  url: string;
  saved: string;
}

/** GET /api/reading-graph?tag=<name> */
export interface TagDetail {
  tag: ReadingTag & { brief: string | null };
  /** Newest first, up to 200 */
  documents: TagDocument[];
}
