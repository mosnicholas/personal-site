import type { ReadingGraph } from './types';

/**
 * Twelve muted hues for a black background, in a fixed order. Validated with
 * the dataviz palette checker (OKLab, Machado 2009 CVD simulation): every
 * adjacent pair stays >= 10.9 apart under protan/deutan and >= 16 under normal
 * vision (the stacked timeline only puts neighbours side by side), and the
 * first nine are >= 12 apart pairwise. Lightness alternates between two tiers,
 * which is what keeps neighbours apart for colour-blind readers. The map adds
 * spatial grouping, the legend highlight and the tooltip on top of colour.
 */
export const CLUSTER_PALETTE = [
  '#79b1f9', // blue
  '#eb9666', // orange
  '#3dc6b1', // aqua
  '#8f79ca', // violet
  '#c7696b', // brick
  '#1996c3', // cerulean
  '#b3b454', // olive
  '#d991d2', // orchid
  '#609b53', // green
  '#36c1dd', // cyan
  '#aa821e', // ochre
  '#ec8dab', // pink
] as const;

/** Tags the weekly job hasn't clustered yet */
export const UNCLUSTERED_ID = '__unclustered';
export const UNCLUSTERED_COLOR = '#6b7280';

export interface ClusterInfo {
  id: string;
  label: string;
  color: string;
  documents: number;
  tags: number;
}

/**
 * Clusters biggest first, each with a fixed colour. Colour follows the
 * cluster, so highlighting one never repaints the others. Adds a grey
 * "unclustered" entry when some tags (or timeline rows) have no cluster.
 */
export const buildClusters = (graph: ReadingGraph): ClusterInfo[] => {
  const sorted = [...graph.clusters].sort(
    (a, b) => b.documents - a.documents || a.label.localeCompare(b.label),
  );
  const clusters: ClusterInfo[] = sorted.map((cluster, i) => ({
    id: cluster.id,
    label: cluster.label,
    // More than 12 clusters would reuse hues; the weekly job is expected to stay under that
    color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
    documents: cluster.documents,
    tags: cluster.tags,
  }));

  const known = new Set(clusters.map((c) => c.id));
  const loose = graph.tags.filter((t) => !t.cluster || !known.has(t.cluster));
  const looseTimeline = Object.keys(graph.timeline.byCluster).some(
    (id) => !known.has(id),
  );
  if (loose.length > 0 || looseTimeline) {
    clusters.push({
      id: UNCLUSTERED_ID,
      label: 'unclustered',
      color: UNCLUSTERED_COLOR,
      documents: loose.reduce((sum, t) => sum + t.documents, 0),
      tags: loose.length,
    });
  }
  return clusters;
};

/** The cluster id a tag is drawn with (unknown or missing ids fall back to unclustered) */
export const clusterIdOf = (
  cluster: string | null,
  byId: Map<string, ClusterInfo>,
): string => (cluster && byId.has(cluster) ? cluster : UNCLUSTERED_ID);
