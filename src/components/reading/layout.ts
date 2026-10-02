import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

import { clusterIdOf, type ClusterInfo } from './clusters';
import type { ReadingEdge, ReadingTag } from './types';

export interface MapNode extends SimulationNodeDatum {
  name: string;
  documents: number;
  clusterId: string;
  definition: string | null;
  r: number;
  x: number;
  y: number;
}

export interface MapLink {
  source: MapNode;
  target: MapNode;
  weight: number;
}

export interface Neighbour {
  node: MapNode;
  weight: number;
}

export interface MapLayout {
  width: number;
  height: number;
  /** Biggest first, so small tags are drawn on top */
  nodes: MapNode[];
  byName: Map<string, MapNode>;
  /** The edges drawn at rest: each tag's strongest few */
  links: MapLink[];
  /** Every edge, per tag, strongest first */
  neighbours: Map<string, Neighbour[]>;
  maxWeight: number;
  fontSize: number;
}

export interface PlacedLabel {
  name: string;
  x: number;
  y: number;
}

/**
 * Tuned on a 380-tag, 1,200-edge fixture: ~100ms on a laptop with no
 * overlapping circles (300 ticks and two collide passes took ~300ms for the
 * same result)
 */
const TICKS = 200;
/** Collisions only matter once the clusters have formed */
const COLLIDE_FROM_TICK = 100;
const EDGE_PAD = 8;
/** Roboto Mono advances exactly 0.6em per character */
const MONO_ADVANCE = 0.6;

export const isCompact = (width: number) => width < 640;

/** Taller than wide on phones, landscape on desktop */
export const mapHeight = (width: number) =>
  isCompact(width)
    ? Math.round(Math.min(Math.max(width * 1.2, 380), 560))
    : Math.round(Math.min(Math.max(width * 0.6, 440), 700));

/** How many labels the map shows at rest: about one per 22,000 px² */
export const restingLabelCount = (layout: MapLayout) =>
  Math.max(6, Math.round((layout.width * layout.height) / 22000));

/** Strongest edges per tag kept at rest; fewer when the map is crowded */
const backboneSize = (nodeCount: number) => (nodeCount > 220 ? 2 : 3);

/**
 * Orders clusters so the ones that share the most documents sit next to each
 * other on the ring, which keeps cross-cluster edges short.
 */
const ringOrder = (ids: string[], links: MapLink[]) => {
  const affinity = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const link of links) {
    const a = link.source.clusterId;
    const b = link.target.clusterId;
    if (a !== b) affinity.set(key(a, b), (affinity.get(key(a, b)) ?? 0) + 1);
  }
  const order = ids.slice(0, 1);
  const rest = new Set(ids.slice(1));
  while (rest.size > 0) {
    const last = order[order.length - 1];
    let best = '';
    let bestScore = -1;
    for (const id of rest) {
      const score = affinity.get(key(last, id)) ?? 0;
      if (score > bestScore) [best, bestScore] = [id, score];
    }
    order.push(best);
    rest.delete(best);
  }
  return order;
};

export const computeLayout = (
  tags: ReadingTag[],
  edges: ReadingEdge[],
  clusters: ClusterInfo[],
  width: number,
): MapLayout => {
  const height = mapHeight(width);
  const compact = isCompact(width);
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  // Radius ∝ sqrt(documents), scaled so the circles cover ~18% of the map
  const maxDocs = Math.max(1, ...tags.map((t) => t.documents));
  const sumDocs = Math.max(
    1,
    tags.reduce((sum, t) => sum + Math.max(t.documents, 1), 0),
  );
  const rMax = Math.min(Math.max(Math.sqrt(width * height) / 24, 12), 34);
  const rMin = compact ? 2.5 : 3;
  const k = Math.min(
    rMax / Math.sqrt(maxDocs),
    Math.sqrt((0.18 * width * height) / (Math.PI * sumDocs)),
  );

  const nodes: MapNode[] = tags.map((tag) => ({
    name: tag.name,
    documents: tag.documents,
    clusterId: clusterIdOf(tag.cluster, clusterById),
    definition: tag.definition,
    r: Math.max(rMin, k * Math.sqrt(Math.max(tag.documents, 1))),
    x: width / 2,
    y: height / 2,
  }));
  const byName = new Map(nodes.map((n) => [n.name, n]));

  // Every edge, per tag, strongest first
  const neighbours = new Map<string, Neighbour[]>(
    nodes.map((n) => [n.name, []]),
  );
  const allLinks: MapLink[] = [];
  let maxWeight = 1;
  const seen = new Set<string>();
  for (const edge of edges) {
    const source = byName.get(edge.source);
    const target = byName.get(edge.target);
    if (!source || !target || source === target) continue;
    const pair =
      source.name < target.name
        ? `${source.name}\u0000${target.name}`
        : `${target.name}\u0000${source.name}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    allLinks.push({ source, target, weight: edge.weight });
    neighbours.get(source.name)?.push({ node: target, weight: edge.weight });
    neighbours.get(target.name)?.push({ node: source, weight: edge.weight });
    maxWeight = Math.max(maxWeight, edge.weight);
  }
  for (const list of neighbours.values()) {
    list.sort(
      (a, b) => b.weight - a.weight || b.node.documents - a.node.documents,
    );
  }

  // At rest, draw only each tag's strongest few edges
  const keep = backboneSize(nodes.length);
  const kept = new Set<MapLink>();
  const linkFor = new Map<string, MapLink>();
  for (const link of allLinks) {
    linkFor.set(`${link.source.name}\u0000${link.target.name}`, link);
    linkFor.set(`${link.target.name}\u0000${link.source.name}`, link);
  }
  for (const [name, list] of neighbours) {
    for (const { node } of list.slice(0, keep)) {
      const link = linkFor.get(`${name}\u0000${node.name}`);
      if (link) kept.add(link);
    }
  }
  const links = [...kept];

  // Each cluster gets an anchor: the biggest in the middle, the rest on a ring
  const present = clusters
    .map((c) => c.id)
    .filter((id) => nodes.some((n) => n.clusterId === id));
  const anchors = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  const centred = present.length >= 5 ? present.slice(0, 1) : [];
  const ring = ringOrder(present.slice(centred.length), allLinks);
  for (const id of centred) anchors.set(id, { x: cx, y: cy });
  const spread = present.length === 1 ? 0 : 1;
  ring.forEach((id, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
    anchors.set(id, {
      x: cx + Math.cos(angle) * width * 0.31 * spread,
      y: cy + Math.sin(angle) * height * 0.3 * spread,
    });
  });

  // Start each tag near its anchor (deterministic spiral), so the layout is
  // the same on every load and settles quickly
  const avgR =
    nodes.reduce((sum, n) => sum + n.r, 0) / Math.max(nodes.length, 1);
  const placed = new Map<string, number>();
  for (const node of [...nodes].sort((a, b) => b.r - a.r)) {
    const anchor = anchors.get(node.clusterId) ?? { x: cx, y: cy };
    const i = placed.get(node.clusterId) ?? 0;
    placed.set(node.clusterId, i + 1);
    const radius = avgR * 1.8 * Math.sqrt(i);
    const angle = i * 2.399963;
    node.x = anchor.x + Math.cos(angle) * radius;
    node.y = anchor.y + Math.sin(angle) * radius;
  }

  const simLinks: (SimulationLinkDatum<MapNode> & { weight: number })[] =
    links.map((l) => ({
      source: l.source,
      target: l.target,
      weight: l.weight,
    }));
  const anchorOf = (n: MapNode) => anchors.get(n.clusterId) ?? { x: cx, y: cy };
  const sameCluster = (l: SimulationLinkDatum<MapNode>) =>
    (l.source as MapNode).clusterId === (l.target as MapNode).clusterId;

  const simulation = forceSimulation(nodes)
    .stop()
    .alphaDecay(1 - Math.pow(0.001, 1 / TICKS))
    .force(
      'link',
      forceLink(simLinks)
        .distance((l) => (l.source as MapNode).r + (l.target as MapNode).r + 16)
        .strength(
          (l) =>
            (sameCluster(l) ? 0.3 : 0.05) *
            (0.4 + (0.6 * l.weight) / maxWeight),
        ),
    )
    .force(
      'charge',
      forceManyBody<MapNode>()
        .strength((n) => -6 - n.r * 1.8)
        .distanceMax(Math.min(width, height) * 0.5)
        // Coarser Barnes-Hut approximation; the layout looks the same
        .theta(1.2),
    )
    .force('x', forceX<MapNode>((n) => anchorOf(n).x).strength(0.08))
    .force('y', forceY<MapNode>((n) => anchorOf(n).y).strength(0.08));

  // Run it to rest before painting, keeping every circle inside the box
  const clamp = () => {
    for (const n of nodes) {
      n.x = Math.min(Math.max(n.x, n.r + EDGE_PAD), width - n.r - EDGE_PAD);
      n.y = Math.min(
        Math.max(n.y, n.r + EDGE_PAD),
        height - n.r - EDGE_PAD - 12,
      );
    }
  };
  const collide = forceCollide<MapNode>((n) => n.r + 2 + n.r * 0.15).strength(
    0.9,
  );
  for (let i = 0; i < TICKS; i++) {
    if (i === COLLIDE_FROM_TICK) simulation.force('collide', collide);
    simulation.tick();
    clamp();
  }

  // Stretch the settled layout to fill the box (radii stay as they are, so
  // spreading out can't create overlaps)
  const minX = Math.min(...nodes.map((n) => n.x - n.r));
  const maxX = Math.max(...nodes.map((n) => n.x + n.r));
  const minY = Math.min(...nodes.map((n) => n.y - n.r));
  const maxY = Math.max(...nodes.map((n) => n.y + n.r));
  const sx = (width - 2 * EDGE_PAD) / Math.max(maxX - minX, 1);
  const sy = (height - 2 * EDGE_PAD - 12) / Math.max(maxY - minY, 1);
  if (nodes.length > 1 && (sx > 1 || sy > 1)) {
    const scaleX = Math.min(Math.max(sx, 1), 1.5);
    const scaleY = Math.min(Math.max(sy, 1), 1.5);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    for (const n of nodes) {
      n.x = cx + (n.x - midX) * scaleX;
      n.y = cy - 6 + (n.y - midY) * scaleY;
    }
    clamp();
  }

  return {
    width,
    height,
    nodes: [...nodes].sort((a, b) => b.r - a.r),
    byName,
    links,
    neighbours,
    maxWeight,
    fontSize: compact ? 10 : 11,
  };
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxesOverlap = (a: Box, b: Box) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

const boxHitsCircle = (box: Box, node: MapNode) => {
  const nx = Math.min(Math.max(node.x, box.x0), box.x1);
  const ny = Math.min(Math.max(node.y, box.y0), box.y1);
  return Math.hypot(node.x - nx, node.y - ny) < node.r + 1;
};

/**
 * Greedy label placement. Candidates go in priority order; each tries below,
 * above, right and left of its circle and takes the first spot that covers
 * neither another label nor a visible circle. The first `required` labels
 * may sit over circles when nothing is free; the rest are skipped.
 */
export const placeLabels = (
  candidates: MapNode[],
  layout: MapLayout,
  {
    max,
    required = 0,
    obstacles = layout.nodes,
  }: { max: number; required?: number; obstacles?: MapNode[] },
): PlacedLabel[] => {
  const { fontSize, width, height } = layout;
  const placed: PlacedLabel[] = [];
  const boxes: Box[] = [];
  candidates.forEach((node, rank) => {
    if (placed.length >= max) return;
    const w = node.name.length * fontSize * MONO_ADVANCE + 4;
    const gap = node.r + 4;
    const spots = [
      { x: node.x, y: node.y + node.r + fontSize + 1 },
      { x: node.x, y: node.y - node.r - 4 },
      { x: node.x + gap + w / 2, y: node.y + fontSize * 0.35 },
      { x: node.x - gap - w / 2, y: node.y + fontSize * 0.35 },
    ]
      .map(({ x, y }) => {
        const cx = Math.min(Math.max(x, w / 2 + 2), width - w / 2 - 2);
        const box = {
          x0: cx - w / 2,
          y0: y - fontSize,
          x1: cx + w / 2,
          y1: y + 2,
        };
        return { x: cx, y, box };
      })
      .filter(
        ({ box }) =>
          box.y0 >= 0 &&
          box.y1 <= height &&
          !boxes.some((b) => boxesOverlap(box, b)),
      );
    const clear = spots.find(
      ({ box }) => !obstacles.some((o) => o !== node && boxHitsCircle(box, o)),
    );
    const spot = clear ?? (rank < required ? spots[0] : undefined);
    if (!spot) return;
    boxes.push(spot.box);
    placed.push({ name: node.name, x: spot.x, y: spot.y });
  });
  return placed;
};

/** The circle under (or within a few px of) a point */
export const nodeAt = (
  layout: MapLayout,
  x: number,
  y: number,
  slop: number,
): MapNode | null => {
  let best: MapNode | null = null;
  let bestGap = slop;
  for (const node of layout.nodes) {
    const gap = Math.hypot(node.x - x, node.y - y) - node.r;
    // Inside a circle counts as a direct hit; prefer the smallest one on top
    const score = gap <= 0 ? gap - 1000 + node.r : gap;
    if (score < bestGap) [best, bestGap] = [node, score];
  }
  return best;
};
