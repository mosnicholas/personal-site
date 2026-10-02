import { useMemo, useState, type PointerEvent, type MouseEvent } from 'react';

import type { ClusterInfo } from './clusters';
import { plural } from './format';
import {
  nodeAt,
  placeLabels,
  restingLabelCount,
  type MapLayout,
  type MapNode,
} from './layout';

/** A hub tag can share documents with most of the map; light up only its closest ties */
const MAX_FOCUS_NEIGHBOURS = 20;
const HOVER_SLOP_PX = 6;
/** The biggest tags keep their label at rest even when it has to cover a circle */
const REQUIRED_RESTING_LABELS = 5;
const TAP_SLOP_PX = 14;
/** Matches the bottom-sheet breakpoint in reading.css */
const SHEET_QUERY = '(max-width: 640px)';

interface TagMapProps {
  layout: MapLayout;
  clusters: Map<string, ClusterInfo>;
  selected: string | null;
  /** Cluster id highlighted from the legend */
  highlight: string | null;
  onSelect: (name: string | null) => void;
}

const pointIn = (
  e: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>,
) => {
  const rect = e.currentTarget.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top] as const;
};

/**
 * On phones the panel is a bottom sheet covering most of the screen; scroll
 * the tapped circle into the strip above it so its neighbours stay in view.
 */
const revealAboveSheet = (svg: SVGSVGElement, node: MapNode) => {
  if (!window.matchMedia(SHEET_QUERY).matches) return;
  const nodeTop = svg.getBoundingClientRect().top + node.y;
  const target = window.innerHeight * 0.17;
  if (Math.abs(nodeTop - target) < window.innerHeight * 0.1) return;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({
    top: nodeTop - target,
    behavior: smooth ? 'smooth' : 'auto',
  });
};

const TagMap = ({
  layout,
  clusters,
  selected,
  highlight,
  onSelect,
}: TagMapProps) => {
  const [hovered, setHovered] = useState<string | null>(null);

  const colorOf = (node: MapNode) =>
    clusters.get(node.clusterId)?.color ?? '#6b7280';

  const focus = hovered ?? selected;
  const focusNode = focus ? (layout.byName.get(focus) ?? null) : null;
  const focusNeighbours = useMemo(
    () =>
      focusNode
        ? (layout.neighbours.get(focusNode.name) ?? []).slice(
            0,
            MAX_FOCUS_NEIGHBOURS,
          )
        : [],
    [layout, focusNode],
  );

  // Tags shown at full strength; everything else is dimmed
  const lit = useMemo(() => {
    if (focusNode) {
      // The selected tag stays visible while hovering others
      return new Set([
        focusNode.name,
        ...(selected ? [selected] : []),
        ...focusNeighbours.map((n) => n.node.name),
      ]);
    }
    if (highlight) {
      return new Set(
        layout.nodes
          .filter((n) => n.clusterId === highlight)
          .map((n) => n.name),
      );
    }
    return null;
  }, [layout, focusNode, focusNeighbours, highlight, selected]);

  const labels = useMemo(() => {
    const resting = restingLabelCount(layout);
    if (focusNode) {
      const selectedNode =
        selected && selected !== focusNode.name
          ? layout.byName.get(selected)
          : undefined;
      const pinned = selectedNode ? [focusNode, selectedNode] : [focusNode];
      // The selected tag can also be a neighbour of the hovered one
      const candidates = [
        ...pinned,
        ...focusNeighbours
          .map((n) => n.node)
          .filter((node) => !pinned.includes(node)),
      ];
      return placeLabels(candidates, layout, {
        max: MAX_FOCUS_NEIGHBOURS + 2,
        required: pinned.length,
        obstacles: candidates,
      });
    }
    if (highlight) {
      const members = layout.nodes.filter((n) => n.clusterId === highlight);
      return placeLabels(members, layout, {
        max: resting,
        required: 3,
        obstacles: members,
      });
    }
    return placeLabels(layout.nodes, layout, {
      max: resting,
      required: REQUIRED_RESTING_LABELS,
    });
  }, [layout, focusNode, focusNeighbours, highlight, selected]);

  const restingEdges = useMemo(
    () =>
      layout.links.map((link) => {
        const t = link.weight / layout.maxWeight;
        const inHighlight =
          !highlight ||
          (link.source.clusterId === highlight &&
            link.target.clusterId === highlight);
        return (
          <line
            key={`${link.source.name}\u0000${link.target.name}`}
            x1={link.source.x}
            y1={link.source.y}
            x2={link.target.x}
            y2={link.target.y}
            strokeWidth={0.6 + 1.6 * t}
            strokeOpacity={0.14 + 0.32 * t}
            className={inHighlight ? undefined : 'is-dim'}
          />
        );
      }),
    [layout, highlight],
  );

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return;
    const [x, y] = pointIn(e);
    setHovered(nodeAt(layout, x, y, HOVER_SLOP_PX)?.name ?? null);
  };

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    const [x, y] = pointIn(e);
    const node = nodeAt(layout, x, y, TAP_SLOP_PX);
    onSelect(node ? node.name : null);
    if (node) revealAboveSheet(e.currentTarget, node);
  };

  const hoveredNode = hovered ? layout.byName.get(hovered) : undefined;

  return (
    <div className="tag-map" style={{ height: layout.height }}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`Map of ${layout.nodes.length} tags. Circles are sized by documents and linked when tags share documents. Every tag is also listed under "All tags".`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHovered(null)}
        onClick={handleClick}
        style={{ cursor: hoveredNode ? 'pointer' : undefined }}
      >
        <g className={`tag-map-edges${focusNode ? ' is-faded' : ''}`}>
          {restingEdges}
        </g>
        {focusNode && (
          <g className="tag-map-focus-edges">
            {focusNeighbours.map(({ node, weight }) => {
              const t = weight / layout.maxWeight;
              return (
                <line
                  key={node.name}
                  x1={focusNode.x}
                  y1={focusNode.y}
                  x2={node.x}
                  y2={node.y}
                  strokeWidth={0.8 + 2.2 * t}
                  strokeOpacity={0.35 + 0.5 * t}
                />
              );
            })}
          </g>
        )}
        <g className="tag-map-nodes">
          {layout.nodes.map((node) => {
            const classes = [
              lit && !lit.has(node.name) ? 'is-dim' : '',
              node.name === selected ? 'is-selected' : '',
              node.name === hovered ? 'is-hovered' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <circle
                key={node.name}
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={colorOf(node)}
                className={classes || undefined}
              />
            );
          })}
        </g>
        <g
          className="tag-map-labels"
          style={{ fontSize: layout.fontSize }}
          aria-hidden="true"
        >
          {labels.map((label) => (
            <text
              key={label.name}
              x={label.x}
              y={label.y}
              className={label.name === focus ? 'is-focus' : undefined}
            >
              {label.name}
            </text>
          ))}
        </g>
      </svg>
      {/* The selected tag is already in the panel */}
      {hoveredNode && hoveredNode.name !== selected && (
        <MapTooltip
          node={hoveredNode}
          layout={layout}
          cluster={clusters.get(hoveredNode.clusterId)}
        />
      )}
    </div>
  );
};

const MapTooltip = ({
  node,
  layout,
  cluster,
}: {
  node: MapNode;
  layout: MapLayout;
  cluster: ClusterInfo | undefined;
}) => {
  const flipX = node.x > layout.width * 0.6;
  const flipY = node.y > layout.height * 0.6;
  const gap = node.r + 10;
  return (
    <div
      className="reading-tooltip tag-map-tooltip"
      role="status"
      style={{
        left: flipX ? node.x - gap : node.x + gap,
        top: flipY ? node.y + 12 : node.y - 12,
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
      }}
    >
      <div className="reading-tooltip-title">{node.name}</div>
      <div className="reading-tooltip-meta">
        <strong>{plural(node.documents, 'document')}</strong>
        {cluster && (
          <span className="reading-tooltip-cluster">
            <span
              className="reading-swatch"
              style={{ background: cluster.color }}
            />
            {cluster.label}
          </span>
        )}
      </div>
      {node.definition && (
        <p className="reading-tooltip-text">{node.definition}</p>
      )}
    </div>
  );
};

export default TagMap;
