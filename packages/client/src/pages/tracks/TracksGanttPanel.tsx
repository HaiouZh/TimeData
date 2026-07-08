import type { Track, TrackStep } from "@timedata/shared";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { formatAppDateTime } from "../../lib/time.js";
import {
  autoFitWindow,
  axisTicks,
  concurrencyStats,
  earliestSegmentDayMs,
  ganttLanes,
  panWindow,
  presetWindow,
  segmentShape,
  timeToX,
  visibleSegments,
  zoomWindow,
  type GanttLane,
  type GanttSegment,
  type GanttWindow,
} from "../../lib/tracksGantt.js";
import { formatStepDuration, stepSourceText } from "../../lib/tracksView.js";
import { clampNameWidth, loadNameWidth, NAME_WIDTH_MAX, NAME_WIDTH_MIN, saveNameWidth } from "./trackGanttPrefs.js";

const LANE_HEIGHT = 28;
const BAR_HEIGHT = 10;
const DOT_RADIUS = 3.5;
const SOURCE_FILL: Record<"user" | "agent", string> = {
  user: "var(--color-data-teal)",
  agent: "var(--color-data-purple)",
};

interface HoverInfo {
  lane: GanttLane;
  seg: GanttSegment;
  x: number;
  y: number;
}

export interface TracksGanttPanelProps {
  tracks: Track[];
  stepsByTrack: Map<string, TrackStep[]>;
  now?: Date;
}

export default function TracksGanttPanel({ tracks, stepsByTrack, now }: TracksGanttPanelProps) {
  const navigate = useNavigate();
  const [tickMs, setTickMs] = useState(() => Date.now());
  useEffect(() => {
    if (now) return;
    const timer = setInterval(() => setTickMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [now]);
  const nowMs = now ? now.getTime() : tickMs;
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);

  const lanes = useMemo(() => ganttLanes(tracks, stepsByTrack, nowMs), [tracks, stepsByTrack, nowMs]);
  const stats = useMemo(() => concurrencyStats(lanes, nowMs), [lanes, nowMs]);
  const minStartMs = useMemo(() => earliestSegmentDayMs(lanes, nowMs), [lanes, nowMs]);

  // null = 跟随 auto-fit（右缘随 now 前进）；用户一旦缩放/平移/选档则固定为显式窗口。
  const [explicitWindow, setExplicitWindow] = useState<GanttWindow | null>(null);
  const win = explicitWindow ?? autoFitWindow(lanes, nowMs);

  const plotRef = useRef<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState(600);
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setPlotWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const dragState = useRef<{ pointerId: number; lastX: number } | null>(null);

  const [nameWidth, setNameWidth] = useState(() => loadNameWidth());
  const nameColRef = useRef<HTMLDivElement | null>(null);
  const namePointerId = useRef<number | null>(null);

  function applyNameWidth(clientX: number): void {
    const left = nameColRef.current?.getBoundingClientRect().left;
    if (left === undefined) return;
    setNameWidth(clampNameWidth(clientX - left));
  }
  function finishNameDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (namePointerId.current !== event.pointerId) return;
    namePointerId.current = null;
    saveNameWidth(clampNameWidth(nameWidth));
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0.5 : (event.clientX - rect.left) / rect.width;
    const factor = event.deltaY > 0 ? 1.25 : 0.8;
    setExplicitWindow(zoomWindow(win, Math.min(1, Math.max(0, ratio)), factor, nowMs, minStartMs));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    dragState.current = { pointerId: event.pointerId, lastX: event.clientX };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaPx = event.clientX - drag.lastX;
    if (deltaPx === 0) return;
    drag.lastX = event.clientX;
    const deltaMs = -(deltaPx / plotWidth) * (win.endMs - win.startMs);
    setExplicitWindow(panWindow(win, deltaMs, nowMs, minStartMs));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function stepOf(info: HoverInfo): TrackStep | undefined {
    return (stepsByTrack.get(info.lane.track.id) ?? []).find((s) => s.id === info.seg.stepId);
  }

  function hoverSeg(lane: GanttLane, seg: GanttSegment, event: ReactMouseEvent): void {
    const host = plotRef.current?.getBoundingClientRect();
    if (!host) return;
    setHover({ lane, seg, x: event.clientX - host.left, y: event.clientY - host.top });
  }

  const height = Math.max(lanes.length, 1) * LANE_HEIGHT;
  const ticks = axisTicks(win);
  const nowInWindow = nowMs >= win.startMs && nowMs <= win.endMs;
  const hoverStep = hover ? stepOf(hover) : undefined;
  const presets = [
    { key: "today" as const, label: "今天" },
    { key: "3d" as const, label: "3天" },
    { key: "7d" as const, label: "周" },
  ];

  return (
    <section data-testid="tracks-gantt" className="flex h-full min-h-0 w-full flex-col bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span data-testid="gantt-stats" className="td-num td-text-caption text-ink-2">
          进行中 {stats.running} · 24h 活跃 {stats.active24h}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 td-text-caption text-ink-3">
          <span aria-hidden="true" className="h-2 w-2 rounded-pill" style={{ background: SOURCE_FILL.user }} />
          我
          <span aria-hidden="true" className="ml-1 h-2 w-2 rounded-pill" style={{ background: SOURCE_FILL.agent }} />
          agent
        </span>
        <span className="flex items-center gap-1">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => setExplicitWindow(presetWindow(preset.key, nowMs))}
              className="rounded-ctl border border-border px-2 py-1 td-text-caption text-ink-2 hover:border-accent hover:text-accent"
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExplicitWindow(null)}
            className="rounded-ctl border border-border px-2 py-1 td-text-caption text-ink-2 hover:border-accent hover:text-accent"
          >
            回到现在
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div ref={nameColRef} className="shrink-0" style={{ width: nameWidth }}>
          <div className="h-5" />
          {lanes.map((lane) => (
            <button
              key={lane.track.id}
              type="button"
              onClick={() => navigate(`/tracks/${lane.track.id}`)}
              className="block h-7 w-full truncate px-2 text-left td-text-caption leading-7 text-ink-2 hover:text-accent"
              title={lane.track.title}
            >
              {lane.track.title}
            </button>
          ))}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整轨道名列宽"
          aria-valuemin={NAME_WIDTH_MIN}
          aria-valuemax={NAME_WIDTH_MAX}
          aria-valuenow={Math.round(nameWidth)}
          tabIndex={0}
          className="group flex w-1.5 shrink-0 cursor-col-resize touch-none items-stretch justify-center"
          onPointerDown={(event) => {
            event.preventDefault();
            namePointerId.current = event.pointerId;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            applyNameWidth(event.clientX);
          }}
          onPointerMove={(event) => {
            if (namePointerId.current === event.pointerId) applyNameWidth(event.clientX);
          }}
          onPointerUp={finishNameDrag}
          onPointerCancel={finishNameDrag}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 32 : 12;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setNameWidth((w) => {
                const next = clampNameWidth(w - step);
                saveNameWidth(next);
                return next;
              });
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setNameWidth((w) => {
                const next = clampNameWidth(w + step);
                saveNameWidth(next);
                return next;
              });
            }
          }}
        >
          <div className="my-1 w-px rounded-pill bg-border transition-colors group-hover:bg-accent" />
        </div>
        <div ref={plotRef} className="relative min-w-0 flex-1">
          <div className="relative h-5 overflow-hidden">
            {ticks.map((tick) => (
              <span
                key={tick.tMs}
                className="td-num td-text-caption absolute top-0 -translate-x-1/2 text-ink-3"
                style={{ left: timeToX(win, plotWidth, tick.tMs) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div
            className="cursor-grab touch-none"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <svg width="100%" height={height} role="img" aria-label="轨道并发甘特">
              <defs>
                <linearGradient id="gantt-glow-user" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="var(--color-data-teal)" stopOpacity="0.35" />
                  <stop offset="1" stopColor="var(--color-data-teal)" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="gantt-glow-agent" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="var(--color-data-purple)" stopOpacity="0.35" />
                  <stop offset="1" stopColor="var(--color-data-purple)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {ticks.map((tick) => (
                <line
                  key={tick.tMs}
                  x1={timeToX(win, plotWidth, tick.tMs)}
                  x2={timeToX(win, plotWidth, tick.tMs)}
                  y1={0}
                  y2={height}
                  stroke="var(--color-border)"
                />
              ))}
              {lanes.map((lane, index) => {
                const y = index * LANE_HEIGHT;
                const barY = y + (LANE_HEIGHT - BAR_HEIGHT) / 2;
                const glowSource = lane.segments.at(-1)?.source ?? "user";
                return (
                  <g key={lane.track.id} data-testid="gantt-lane">
                    <line
                      x1={0}
                      x2={plotWidth}
                      y1={y + LANE_HEIGHT}
                      y2={y + LANE_HEIGHT}
                      stroke="var(--color-border)"
                    />
                    {lane.afterglow && (
                      <rect
                        data-testid="gantt-afterglow"
                        x={timeToX(win, plotWidth, lane.afterglow.startMs)}
                        y={barY}
                        width={Math.max(
                          0,
                          timeToX(win, plotWidth, lane.afterglow.endMs) -
                            timeToX(win, plotWidth, lane.afterglow.startMs),
                        )}
                        height={BAR_HEIGHT}
                        fill={`url(#gantt-glow-${glowSource})`}
                        pointerEvents="none"
                      />
                    )}
                    {visibleSegments(lane.segments, win).map((seg) => {
                      const shape = segmentShape(seg, win, plotWidth);
                      const common = {
                        "data-testid": "gantt-seg",
                        "data-kind": seg.kind,
                        "data-step": seg.stepId,
                        fill: SOURCE_FILL[seg.source],
                        className: "cursor-pointer",
                        onClick: () => navigate(`/tracks/${lane.track.id}#step-${seg.stepId}`),
                        onMouseEnter: (event: ReactMouseEvent) => hoverSeg(lane, seg, event),
                        onMouseLeave: () => setHover(null),
                      };
                      return shape.shape === "rect" ? (
                        <rect
                          key={seg.stepId}
                          {...common}
                          x={shape.x}
                          y={barY}
                          width={shape.width}
                          height={BAR_HEIGHT}
                          rx={2}
                          opacity={seg.kind === "running" ? 0.9 : 1}
                        />
                      ) : (
                        <circle key={seg.stepId} {...common} cx={shape.cx} cy={y + LANE_HEIGHT / 2} r={DOT_RADIUS} />
                      );
                    })}
                  </g>
                );
              })}
              {nowInWindow && (
                <line
                  data-testid="gantt-now-line"
                  x1={timeToX(win, plotWidth, nowMs)}
                  x2={timeToX(win, plotWidth, nowMs)}
                  y1={0}
                  y2={height}
                  stroke="var(--color-accent)"
                  strokeDasharray="3 3"
                />
              )}
            </svg>
          </div>
          {hover && (
            <div
              data-testid="gantt-tooltip"
              className="pointer-events-none absolute z-10 max-w-64 rounded-card border border-border bg-surface-elevated px-2.5 py-1.5 shadow-elev2"
              style={{ left: Math.min(hover.x + 8, Math.max(0, plotWidth - 200)), top: hover.y + 12 }}
            >
              <p className="td-text-caption truncate text-ink">{hover.lane.track.title}</p>
              <p className="td-text-caption text-ink-2">
                {hoverStep ? stepSourceText(hoverStep) : ""} · {formatAppDateTime(new Date(hover.seg.startMs).toISOString())} ·{" "}
                {hover.seg.kind === "running"
                  ? `进行中 · 已历时${formatStepDuration(new Date(hover.seg.startMs).toISOString(), null, nowDate)}`
                  : `历时${formatStepDuration(
                      new Date(hover.seg.startMs).toISOString(),
                      new Date(hover.seg.endMs).toISOString(),
                      nowDate,
                    )}`}
              </p>
              {hoverStep?.content && <p className="td-text-caption line-clamp-3 text-ink-2">{hoverStep.content}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
