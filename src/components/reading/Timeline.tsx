import {
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { UNCLUSTERED_ID, type ClusterInfo } from './clusters';
import { formatCount, formatMonth, formatWeek, parseWeek } from './format';
import type { ReadingTimeline } from './types';

interface TimelineProps {
  timeline: ReadingTimeline;
  /** Biggest first; also the stacking order, bottom up */
  clusters: ClusterInfo[];
  highlight: string | null;
  width: number;
}

interface Series {
  cluster: ClusterInfo;
  values: number[];
}

const MARGIN = { top: 12, right: 4, bottom: 26, left: 34 };
const MIN_TICK_GAP_PX = 44;

/** 1, 2 or 5 × a power of ten, so axis ticks land on round numbers */
const niceStep = (raw: number) => {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
};

const buildSeries = (
  timeline: ReadingTimeline,
  clusters: ClusterInfo[],
): Series[] => {
  const known = new Set(clusters.map((c) => c.id));
  const n = timeline.weeks.length;
  const valuesFor = (cluster: ClusterInfo) => {
    if (cluster.id !== UNCLUSTERED_ID) {
      return Array.from(
        { length: n },
        (_, i) => timeline.byCluster[cluster.id]?.[i] ?? 0,
      );
    }
    // Any rows the graph has no cluster for are drawn together, in grey
    const loose = Object.entries(timeline.byCluster).filter(
      ([id]) => !known.has(id) || id === UNCLUSTERED_ID,
    );
    return Array.from({ length: n }, (_, i) =>
      loose.reduce((sum, [, values]) => sum + (values[i] ?? 0), 0),
    );
  };
  return clusters
    .map((cluster) => ({ cluster, values: valuesFor(cluster) }))
    .filter((s) => s.values.some((v) => v > 0));
};

const Timeline = ({ timeline, clusters, highlight, width }: TimelineProps) => {
  const [active, setActive] = useState<number | null>(null);
  const weeks = timeline.weeks;
  const height = width < 640 ? 190 : 230;
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const chart = useMemo(() => {
    const series = buildSeries(timeline, clusters);
    const n = weeks.length;
    const totals = Array.from({ length: n }, (_, i) =>
      series.reduce((sum, s) => sum + s.values[i], 0),
    );
    const step = niceStep(Math.max(...totals, 1) / 4);
    const yMax = Math.max(
      step,
      Math.ceil(Math.max(...totals, 1) / step) * step,
    );
    const x = (i: number) =>
      MARGIN.left + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
    const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;

    // Stack bottom-up: each series sits on the running total below it
    const base = new Array<number>(n).fill(0);
    const layers = series.map((s) => {
      const lower = base.slice();
      const upper = lower.map((v, i) => v + s.values[i]);
      upper.forEach((v, i) => (base[i] = v));
      const top = upper.map((v, i) => `${x(i)},${y(v)}`);
      const bottom = lower.map((v, i) => `${x(i)},${y(v)}`).reverse();
      return {
        series: s,
        area: `M${top.join('L')}L${bottom.join('L')}Z`,
        edge: `M${top.join('L')}`,
      };
    });

    const yTicks: number[] = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    // A tick at the first week of each month, thinned out when crowded
    const xTicks: { i: number; label: string }[] = [];
    let lastX = -Infinity;
    weeks.forEach((week, i) => {
      const date = parseWeek(week);
      const prev = i > 0 ? parseWeek(weeks[i - 1]) : null;
      if (prev && prev.getUTCMonth() === date.getUTCMonth()) return;
      if (!prev && date.getUTCDate() > 7) return;
      if (x(i) - lastX < MIN_TICK_GAP_PX || x(i) > width - 14) return;
      lastX = x(i);
      xTicks.push({
        i,
        label:
          date.getUTCMonth() === 0
            ? String(date.getUTCFullYear())
            : formatMonth(date),
      });
    });

    return { series, layers, x, y, yTicks, xTicks };
  }, [timeline, clusters, weeks, plotW, plotH, width]);

  if (weeks.length === 0 || chart.series.length === 0) {
    return <p className="reading-note">No saves in the last year yet.</p>;
  }

  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - MARGIN.left;
    const i = Math.round((px / plotW) * (weeks.length - 1));
    return Math.min(Math.max(i, 0), weeks.length - 1);
  };

  const handleKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = weeks.length - 1;
    const current = active ?? last;
    const next =
      e.key === 'ArrowLeft'
        ? current - 1
        : e.key === 'ArrowRight'
          ? current + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(Math.max(next, 0), last));
  };

  const activeX = active === null ? 0 : chart.x(active);
  const flip = activeX > width * 0.6;
  const rows =
    active === null
      ? []
      : chart.series
          .map((s) => ({ cluster: s.cluster, value: s.values[active] }))
          .filter((row) => row.value > 0)
          .reverse();

  return (
    <div className="timeline" style={{ height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        tabIndex={0}
        role="img"
        aria-label={`Documents saved per week by cluster, ${formatWeek(weeks[0])} to ${formatWeek(weeks[weeks.length - 1])}. Use the arrow keys to step through the weeks.`}
        onPointerMove={(e) => setActive(indexAt(e))}
        onPointerDown={(e) => setActive(indexAt(e))}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') setActive(null);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setActive((a) => a ?? weeks.length - 1)}
        onBlur={() => setActive(null)}
      >
        <g className="timeline-grid">
          {chart.yTicks.map((v) => (
            <g key={v}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={chart.y(v)}
                y2={chart.y(v)}
                className={v === 0 ? 'is-baseline' : undefined}
              />
              <text x={MARGIN.left - 8} y={chart.y(v)} dy="0.32em">
                {formatCount(v)}
              </text>
            </g>
          ))}
          {chart.xTicks.map(({ i, label }) => (
            <text
              key={i}
              x={chart.x(i)}
              y={height - 8}
              className="timeline-month"
            >
              {label}
            </text>
          ))}
        </g>
        <g className="timeline-layers">
          {chart.layers.map(({ series, area }) => (
            <path
              key={series.cluster.id}
              d={area}
              fill={series.cluster.color}
              className={
                highlight && highlight !== series.cluster.id
                  ? 'is-dim'
                  : undefined
              }
            />
          ))}
          {/* Surface-coloured seams keep neighbouring layers apart */}
          {chart.layers.map(({ series, edge }) => (
            <path key={series.cluster.id} d={edge} className="timeline-seam" />
          ))}
        </g>
        {active !== null && (
          <line
            className="timeline-crosshair"
            x1={activeX}
            x2={activeX}
            y1={MARGIN.top}
            y2={height - MARGIN.bottom}
          />
        )}
      </svg>
      {active !== null && (
        <div
          className="reading-tooltip timeline-tooltip"
          role="status"
          style={{
            left: flip ? activeX - 12 : activeX + 12,
            top: MARGIN.top,
            transform: flip ? 'translateX(-100%)' : undefined,
          }}
        >
          <div className="reading-tooltip-title">
            Week of {formatWeek(weeks[active])}
          </div>
          {rows.length === 0 ? (
            <div className="reading-tooltip-text">Nothing saved</div>
          ) : (
            <ul className="timeline-tooltip-rows">
              {rows.map(({ cluster, value }) => (
                <li
                  key={cluster.id}
                  className={
                    highlight && highlight !== cluster.id ? 'is-dim' : undefined
                  }
                >
                  <span
                    className="reading-line-key"
                    style={{ background: cluster.color }}
                  />
                  <strong>{formatCount(value)}</strong>
                  <span>{cluster.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default Timeline;
