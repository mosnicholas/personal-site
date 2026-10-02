import type { ClusterInfo } from './clusters';
import { formatCount, plural } from './format';

interface ClusterLegendProps {
  clusters: ClusterInfo[];
  active: string | null;
  onToggle: (id: string) => void;
}

/** Cluster colours; clicking one highlights it on the map and the timeline */
const ClusterLegend = ({ clusters, active, onToggle }: ClusterLegendProps) => (
  <ul className="cluster-legend" aria-label="Clusters">
    {clusters.map((cluster) => (
      <li key={cluster.id}>
        <button
          type="button"
          className={`cluster-chip${active && active !== cluster.id ? ' is-muted' : ''}`}
          aria-pressed={active === cluster.id}
          title={plural(cluster.tags, 'tag')}
          onClick={() => onToggle(cluster.id)}
        >
          <span
            className="reading-swatch"
            style={{ background: cluster.color }}
          />
          {cluster.label}
          <span className="cluster-chip-count">
            {formatCount(cluster.tags)}
          </span>
        </button>
      </li>
    ))}
  </ul>
);

export default ClusterLegend;
