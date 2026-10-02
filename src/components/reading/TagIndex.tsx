import { useMemo } from 'react';

import { clusterIdOf, type ClusterInfo } from './clusters';
import { formatCount } from './format';
import type { ReadingTag } from './types';

interface TagIndexProps {
  tags: ReadingTag[];
  clusters: ClusterInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
}

/**
 * Every tag as a plain list, grouped by cluster: the keyboard and
 * small-screen way into the same panel the map opens.
 */
const TagIndex = ({ tags, clusters, selected, onSelect }: TagIndexProps) => {
  const groups = useMemo(() => {
    const byId = new Map(clusters.map((c) => [c.id, c]));
    return clusters
      .map((cluster) => ({
        cluster,
        tags: tags
          .filter((t) => clusterIdOf(t.cluster, byId) === cluster.id)
          .sort(
            (a, b) => b.documents - a.documents || a.name.localeCompare(b.name),
          ),
      }))
      .filter((g) => g.tags.length > 0);
  }, [tags, clusters]);

  return (
    <details className="tag-index">
      <summary>
        <span className="reading-heading">all tags</span>
        <span className="tag-index-total">{formatCount(tags.length)}</span>
      </summary>
      <div className="tag-index-groups">
        {groups.map(({ cluster, tags: groupTags }) => (
          <section key={cluster.id} className="tag-index-group">
            <h3>
              <span
                className="reading-swatch"
                style={{ background: cluster.color }}
              />
              {cluster.label}
            </h3>
            <ul>
              {groupTags.map((tag) => (
                <li key={tag.name}>
                  <button
                    type="button"
                    aria-current={tag.name === selected ? 'true' : undefined}
                    onClick={() => onSelect(tag.name)}
                  >
                    {tag.name}
                    <span>{formatCount(tag.documents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
};

export default TagIndex;
