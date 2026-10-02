import { useEffect, useMemo, useState } from 'react';

import './reading.css';

import ClusterLegend from './ClusterLegend';
import { buildClusters, clusterIdOf } from './clusters';
import { formatDate, plural } from './format';
import { computeLayout, mapHeight } from './layout';
import TagIndex from './TagIndex';
import TagMap from './TagMap';
import TagPanel from './TagPanel';
import Timeline from './Timeline';
import type { ReadingGraph } from './types';
import useElementWidth from './useElementWidth';

type GraphState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; graph: ReadingGraph };

const isGraph = (value: unknown): value is ReadingGraph => {
  if (typeof value !== 'object' || value === null) return false;
  const graph = value as ReadingGraph;
  return (
    Array.isArray(graph.tags) &&
    Array.isArray(graph.edges) &&
    Array.isArray(graph.clusters) &&
    typeof graph.timeline === 'object' &&
    graph.timeline !== null &&
    Array.isArray(graph.timeline.weeks)
  );
};

const ReadingPage = () => {
  const [state, setState] = useState<GraphState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mainRef, width] = useElementWidth<HTMLElement>();

  useEffect(() => {
    document.title = 'nimo / reading';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/reading-graph', { signal: controller.signal })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok || !isGraph(data)) throw new Error('Bad response');
        setState({ status: 'ready', graph: data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Reading graph error:', error);
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  // Esc closes the panel first, then clears the cluster highlight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else setHighlight(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  const graph = state.status === 'ready' ? state.graph : null;
  const clusters = useMemo(() => (graph ? buildClusters(graph) : []), [graph]);
  const clusterById = useMemo(
    () => new Map(clusters.map((c) => [c.id, c])),
    [clusters],
  );
  const layout = useMemo(
    () =>
      graph && graph.tags.length > 0 && width > 0
        ? computeLayout(graph.tags, graph.edges, clusters, width)
        : null,
    [graph, clusters, width],
  );

  const selectedTag =
    (selected && graph?.tags.find((t) => t.name === selected)) || null;

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  const toggleHighlight = (id: string) =>
    setHighlight((current) => (current === id ? null : id));

  // Before the first weekly run there's nothing to count yet
  const stats =
    graph && graph.tags.length > 0
      ? [
          plural(graph.documents, 'document'),
          plural(graph.tags.length, 'tag'),
          plural(graph.clusters.length, 'cluster'),
          formatDate(graph.generatedAt) &&
            `updated ${formatDate(graph.generatedAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : state.status === 'loading'
        ? 'loading…'
        : '';

  const placeholderHeight = width > 0 ? mapHeight(width) : 440;

  return (
    <div className="reading">
      <header className="reading-header">
        <h1 className="reading-title">
          <a href="/">nimo</a>
          <span className="reading-title-sep" aria-hidden="true">
            /
          </span>
          reading
        </h1>
        <p className="reading-stats">{stats}</p>
      </header>

      <div className="reading-body">
        <main ref={mainRef} className="reading-main">
          {state.status === 'loading' && (
            <div
              className="reading-state"
              style={{ minHeight: placeholderHeight }}
            >
              <p className="is-loading">Loading the map…</p>
            </div>
          )}

          {state.status === 'error' && (
            <div
              className="reading-state"
              style={{ minHeight: placeholderHeight }}
            >
              <p>Couldn't load the map.</p>
              <button type="button" className="reading-button" onClick={retry}>
                Try again
              </button>
            </div>
          )}

          {graph && graph.tags.length === 0 && (
            <div
              className="reading-state"
              style={{ minHeight: placeholderHeight }}
            >
              <p>The map is being built - check back after Sunday</p>
            </div>
          )}

          {graph && graph.tags.length > 0 && (
            <>
              <ClusterLegend
                clusters={clusters}
                active={highlight}
                onToggle={toggleHighlight}
              />
              {layout ? (
                <TagMap
                  layout={layout}
                  clusters={clusterById}
                  selected={selected}
                  highlight={highlight}
                  onSelect={setSelected}
                />
              ) : (
                <div style={{ height: placeholderHeight }} />
              )}
              <p className="reading-caption">
                Each circle is a tag, sized by its documents; lines join tags
                that share documents.{' '}
                <span className="reading-hint-pointer">
                  Hover for a definition, click to open a tag.
                </span>
                <span className="reading-hint-touch">
                  Tap a tag to open it.
                </span>
              </p>

              {width > 0 && graph.timeline.weeks.length > 0 && (
                <section className="reading-section">
                  <h2 className="reading-heading">topics over time</h2>
                  <p className="reading-sub">
                    Documents saved each week, by cluster. A document with tags
                    in two clusters counts in both.
                  </p>
                  <Timeline
                    timeline={graph.timeline}
                    clusters={clusters}
                    highlight={highlight}
                    width={width}
                  />
                </section>
              )}

              <TagIndex
                tags={graph.tags}
                clusters={clusters}
                selected={selected}
                onSelect={setSelected}
              />
            </>
          )}
        </main>

        <TagPanel
          tag={selectedTag}
          cluster={
            selectedTag
              ? clusterById.get(clusterIdOf(selectedTag.cluster, clusterById))
              : undefined
          }
          onClose={() => setSelected(null)}
        />
      </div>
    </div>
  );
};

export default ReadingPage;
