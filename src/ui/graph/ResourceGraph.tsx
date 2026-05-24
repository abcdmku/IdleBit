import { useEffect, useMemo, useState } from "react";
import { Database, LineChart, X, Zap } from "lucide-react";
import { formatNumber } from "../format";
import type { ResourceHistoryRef, ResourceSample } from "./useResourceHistory";

interface WindowOption {
  id: string;
  label: string;
  seconds: number;
}

const WINDOW_OPTIONS: WindowOption[] = [
  { id: "1s", label: "1s", seconds: 1 },
  { id: "10s", label: "10s", seconds: 10 },
  { id: "30s", label: "30s", seconds: 30 },
  { id: "1m", label: "1m", seconds: 60 },
  { id: "3m", label: "3m", seconds: 180 },
  { id: "5m", label: "5m", seconds: 300 },
  { id: "10m", label: "10m", seconds: 600 },
  { id: "15m", label: "15m", seconds: 900 },
  { id: "30m", label: "30m", seconds: 1800 },
  { id: "1h", label: "1h", seconds: 3600 },
  { id: "3h", label: "3h", seconds: 10800 },
  { id: "6h", label: "6h", seconds: 21600 },
  { id: "12h", label: "12h", seconds: 43200 },
  { id: "24h", label: "24h", seconds: 86400 },
];

const DEFAULT_WINDOW_ID = "1m";
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 160;
const PADDING_LEFT = 44;
const PADDING_RIGHT = 44;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 22;
const PLOT_WIDTH = VIEW_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const MAX_PLOT_POINTS = 240;

const downsample = (samples: ResourceSample[]): ResourceSample[] => {
  if (samples.length <= MAX_PLOT_POINTS) return samples;
  const stride = samples.length / MAX_PLOT_POINTS;
  const out: ResourceSample[] = [];
  for (let i = 0; i < MAX_PLOT_POINTS; i++) {
    const start = Math.floor(i * stride);
    const end = Math.min(samples.length, Math.floor((i + 1) * stride));
    let creditsSum = 0;
    let dataSum = 0;
    let count = 0;
    let tMid = samples[start]?.t ?? 0;
    for (let j = start; j < end; j++) {
      creditsSum += samples[j].credits;
      dataSum += samples[j].data;
      tMid = samples[j].t;
      count++;
    }
    if (count > 0) {
      out.push({
        t: tMid,
        credits: creditsSum / count,
        data: dataSum / count,
      });
    }
  }
  return out;
};

const buildPath = (
  points: ResourceSample[],
  pick: (s: ResourceSample) => number,
  tMin: number,
  tMax: number,
  yMin: number,
  yMax: number,
): string => {
  if (points.length === 0) return "";
  const tSpan = Math.max(1, tMax - tMin);
  const ySpan = yMax - yMin === 0 ? 1 : yMax - yMin;
  const segs: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = PADDING_LEFT + ((p.t - tMin) / tSpan) * PLOT_WIDTH;
    const y = PADDING_TOP + PLOT_HEIGHT - ((pick(p) - yMin) / ySpan) * PLOT_HEIGHT;
    segs.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return segs.join(" ");
};

const niceTickValues = (min: number, max: number, count = 4): number[] => {
  if (!isFinite(min) || !isFinite(max) || max <= min) {
    return [min, max];
  }
  const step = (max - min) / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(min + step * i);
  return ticks;
};

interface ResourceGraphProps {
  history: ResourceHistoryRef;
  onClose: () => void;
}

export function ResourceGraph({ history, onClose }: ResourceGraphProps) {
  const [windowId, setWindowId] = useState<string>(DEFAULT_WINDOW_ID);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setRenderTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const selectedWindow =
    WINDOW_OPTIONS.find((w) => w.id === windowId) ?? WINDOW_OPTIONS[3];

  const plot = useMemo(() => {
    void renderTick;
    const now = Date.now();
    const cutoff = now - selectedWindow.seconds * 1000;
    const buffer = history.samples;
    const inWindow: ResourceSample[] = [];
    for (let i = buffer.length - 1; i >= 0; i--) {
      const s = buffer[i];
      if (s.t < cutoff) break;
      inWindow.push(s);
    }
    inWindow.reverse();

    if (inWindow.length === 0) {
      const last = buffer[buffer.length - 1];
      if (last) inWindow.push(last);
    }

    const sampled = downsample(inWindow);

    let creditsMin = Infinity;
    let creditsMax = -Infinity;
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const s of sampled) {
      if (s.credits < creditsMin) creditsMin = s.credits;
      if (s.credits > creditsMax) creditsMax = s.credits;
      if (s.data < dataMin) dataMin = s.data;
      if (s.data > dataMax) dataMax = s.data;
    }

    if (!isFinite(creditsMin)) {
      creditsMin = 0;
      creditsMax = 1;
    }
    if (!isFinite(dataMin)) {
      dataMin = 0;
      dataMax = 1;
    }

    if (creditsMin === creditsMax) {
      const pad = Math.max(1, Math.abs(creditsMin) * 0.05);
      creditsMin -= pad;
      creditsMax += pad;
    }
    if (dataMin === dataMax) {
      const pad = Math.max(1, Math.abs(dataMin) * 0.05);
      dataMin -= pad;
      dataMax += pad;
    }

    creditsMin = Math.min(creditsMin, 0);
    dataMin = Math.min(dataMin, 0);

    const tMin = sampled.length ? sampled[0].t : now;
    const tMax = sampled.length ? sampled[sampled.length - 1].t : now;
    const tMinEff = tMin === tMax ? tMin - selectedWindow.seconds * 1000 : tMin;

    const creditsPath = buildPath(
      sampled,
      (s) => s.credits,
      tMinEff,
      tMax,
      creditsMin,
      creditsMax,
    );
    const dataPath = buildPath(
      sampled,
      (s) => s.data,
      tMinEff,
      tMax,
      dataMin,
      dataMax,
    );

    const first = sampled[0];
    const last = sampled[sampled.length - 1];
    const creditsDelta = first && last ? last.credits - first.credits : 0;
    const dataDelta = first && last ? last.data - first.data : 0;

    return {
      sampled,
      creditsPath,
      dataPath,
      creditsMin,
      creditsMax,
      dataMin,
      dataMax,
      tMin: tMinEff,
      tMax,
      latest: last,
      creditsDelta,
      dataDelta,
    };
  }, [history, renderTick, selectedWindow.seconds]);

  const formatDelta = (value: number) => {
    if (!isFinite(value) || value === 0) return "0";
    const sign = value > 0 ? "+" : "-";
    return `${sign}${formatNumber(Math.abs(value))}`;
  };

  const creditsTicks = niceTickValues(plot.creditsMin, plot.creditsMax);
  const dataTicks = niceTickValues(plot.dataMin, plot.dataMax);

  return (
    <section className="resource-graph-panel" aria-label="Resource history graph">
      <header className="resource-graph-header">
        <LineChart size={13} />
        <span>Resources</span>
        <div className="resource-graph-legend" aria-hidden="true">
          <span className="legend credits">
            <Zap size={11} />
            <strong>{formatDelta(plot.creditsDelta)}</strong>
            <em>/{selectedWindow.label}</em>
          </span>
          <span className="legend data">
            <Database size={11} />
            <strong>{formatDelta(plot.dataDelta)}</strong>
            <em>/{selectedWindow.label}</em>
          </span>
        </div>
        <button
          type="button"
          className="resource-graph-close"
          onClick={onClose}
          aria-label="Close graph"
          title="Close graph"
        >
          <X size={13} />
        </button>
      </header>
      <div className="resource-graph-body">
        <svg
          className="resource-graph-svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label="Credits and data over time"
          preserveAspectRatio="none"
        >
          <rect
            x={PADDING_LEFT}
            y={PADDING_TOP}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            className="resource-graph-plot-bg"
          />
          {creditsTicks.map((value, i) => {
            const y =
              PADDING_TOP +
              PLOT_HEIGHT -
              ((value - plot.creditsMin) /
                Math.max(1e-9, plot.creditsMax - plot.creditsMin)) *
                PLOT_HEIGHT;
            return (
              <g key={`grid-${i}`}>
                <line
                  className="resource-graph-grid"
                  x1={PADDING_LEFT}
                  x2={PADDING_LEFT + PLOT_WIDTH}
                  y1={y}
                  y2={y}
                />
                <text
                  className="resource-graph-axis-label credits"
                  x={PADDING_LEFT - 4}
                  y={y + 3}
                  textAnchor="end"
                >
                  {formatNumber(value)}
                </text>
              </g>
            );
          })}
          {dataTicks.map((value, i) => {
            const y =
              PADDING_TOP +
              PLOT_HEIGHT -
              ((value - plot.dataMin) /
                Math.max(1e-9, plot.dataMax - plot.dataMin)) *
                PLOT_HEIGHT;
            return (
              <text
                key={`data-tick-${i}`}
                className="resource-graph-axis-label data"
                x={PADDING_LEFT + PLOT_WIDTH + 4}
                y={y + 3}
                textAnchor="start"
              >
                {formatNumber(value)}
              </text>
            );
          })}
          <path
            d={plot.creditsPath}
            className="resource-graph-line credits"
            fill="none"
          />
          <path
            d={plot.dataPath}
            className="resource-graph-line data"
            fill="none"
          />
          <line
            className="resource-graph-axis credits"
            x1={PADDING_LEFT}
            x2={PADDING_LEFT}
            y1={PADDING_TOP}
            y2={PADDING_TOP + PLOT_HEIGHT}
          />
          <line
            className="resource-graph-axis data"
            x1={PADDING_LEFT + PLOT_WIDTH}
            x2={PADDING_LEFT + PLOT_WIDTH}
            y1={PADDING_TOP}
            y2={PADDING_TOP + PLOT_HEIGHT}
          />
          <line
            className="resource-graph-axis-base"
            x1={PADDING_LEFT}
            x2={PADDING_LEFT + PLOT_WIDTH}
            y1={PADDING_TOP + PLOT_HEIGHT}
            y2={PADDING_TOP + PLOT_HEIGHT}
          />
          <text
            className="resource-graph-time-label"
            x={PADDING_LEFT}
            y={VIEW_HEIGHT - 6}
            textAnchor="start"
          >
            -{selectedWindow.label}
          </text>
          <text
            className="resource-graph-time-label"
            x={PADDING_LEFT + PLOT_WIDTH}
            y={VIEW_HEIGHT - 6}
            textAnchor="end"
          >
            now
          </text>
        </svg>
      </div>
      <div
        className="resource-graph-windows"
        role="radiogroup"
        aria-label="Time window"
      >
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === windowId}
            className={`resource-graph-window-button ${option.id === windowId ? "active" : ""}`}
            onClick={() => setWindowId(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
