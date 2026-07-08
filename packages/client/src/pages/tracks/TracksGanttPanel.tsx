import type { Track, TrackStep } from "@timedata/shared";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { formatAppDateTime, formatRelativeTime } from "../../lib/time.js";
import {
  autoFitWindow,
  axisTicks,
  concurrencyStats,
  earliestSegmentDayMs,
  ganttLanes,
  laneNowStatus,
  type LaneNowStatus,
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
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { useAgentExecTags } from "../../lib/settings/trackAgentExecTagsSetting.js";
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

  const agentExecTags = useAgentExecTags();
  // 等待信号约定 = 第一个配置的看板信号（与导航 badge 的「待我处理」约定同源）。
  const actionTags = useTrackActionTags();
  const waitingTags = useMemo(() => (actionTags.length > 0 ? [actionTags[0]] : []), [actionTags]);
  const lanes = useMemo(
    () => ganttLanes(tracks, stepsByTrack, nowMs, agentExecTags, waitingTags),
    [tracks, stepsByTrack, nowMs, agentExecTags, waitingTags],
  );
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

  // 现状栏靠右停靠：宽度 = 面板右缘 − 指针横坐标。
  function applyNameWidth(clientX: number): void {
    const right = nameColRef.current?.getBoundingClientRect().right;
    if (right === undefined) return;
    setNameWidth(clampNameWidth(right - clientX));
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
                      // 等待段（带等待信号）：空心条，长度=接力空档；等待是持续状态，不参与陈旧截断。
                      const waiting = seg.waiting === true;
                      // 陈旧开口步：实头只画到 staleSinceMs，之后到此刻是半透明虚线尾迹（"口没闭但很久没动静"）。
                      const stale = !waiting && seg.kind === "running" && seg.staleSinceMs != null;
                      const headSeg = stale ? { ...seg, endMs: seg.staleSinceMs as number } : seg;
                      const shape = segmentShape(headSeg, win, plotWidth);
                      const common = {
                        "data-testid": "gantt-seg",
                        "data-kind": seg.kind,
                        "data-step": seg.stepId,
                        "data-waiting": waiting ? "true" : undefined,
                        fill: waiting ? "transparent" : SOURCE_FILL[seg.source],
                        stroke: waiting ? SOURCE_FILL[seg.source] : undefined,
                        strokeWidth: waiting ? 1.5 : undefined,
                        className: "cursor-pointer",
                        onClick: () => navigate(`/tracks/${lane.track.id}#step-${seg.stepId}`),
                        onMouseEnter: (event: ReactMouseEvent) => hoverSeg(lane, seg, event),
                        onMouseLeave: () => setHover(null),
                      };
                      const head =
                        shape.shape === "rect" ? (
                          <rect
                            key={seg.stepId}
                            {...common}
                            x={shape.x}
                            y={barY}
                            width={shape.width}
                            height={BAR_HEIGHT}
                            rx={2}
                            opacity={seg.kind === "running" && !waiting ? 0.9 : 1}
                          />
                        ) : (
                          <circle key={seg.stepId} {...common} cx={shape.cx} cy={y + LANE_HEIGHT / 2} r={DOT_RADIUS} />
                        );
                      if (!stale) return head;
                      return (
                        <g key={seg.stepId}>
                          {head}
                          <line
                            data-testid="gantt-stale-tail"
                            x1={timeToX(win, plotWidth, seg.staleSinceMs as number)}
                            x2={timeToX(win, plotWidth, seg.endMs)}
                            y1={y + LANE_HEIGHT / 2}
                            y2={y + LANE_HEIGHT / 2}
                            stroke={SOURCE_FILL[seg.source]}
                            strokeWidth={1.5}
                            strokeDasharray="2 4"
                            opacity={0.55}
                            pointerEvents="none"
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {nowInWindow && (
                <line
                  data-testid="gantt-now-line"
                  x1={Math.min(timeToX(win, plotWidth, nowMs), plotWidth - 1)}
                  x2={Math.min(timeToX(win, plotWidth, nowMs), plotWidth - 1)}
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
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整现状栏宽度"
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
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? step : -step;
              setNameWidth((w) => {
                const next = clampNameWidth(w + delta);
                saveNameWidth(next);
                return next;
              });
            }
          }}
        >
          <div className="my-1 w-px rounded-pill bg-border transition-colors group-hover:bg-accent" />
        </div>
        <div ref={nameColRef} className="shrink-0 border-l border-border" style={{ width: nameWidth }}>
          <div className="h-5" />
          {lanes.map((lane) => {
            const status = laneNowStatus(lane, nowMs);
            const laneSource = lane.segments.at(-1)?.source ?? "user";
            return (
              <button
                key={lane.track.id}
                type="button"
                onClick={() => navigate(`/tracks/${lane.track.id}`)}
                className="flex h-7 w-full items-center gap-1.5 px-2 text-left td-text-caption leading-7 text-ink-2 hover:text-accent"
                title={lane.track.title}
              >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill" style={statusDotStyle(status, laneSource)} />
                <span className="min-w-0 flex-1 truncate">{lane.track.title}</span>
                <span data-testid="gantt-now-status" data-kind={status.kind} className="td-num shrink-0 text-ink-3">
                  {statusLabel(status, nowDate)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// 现状点：进行中=实心执行者色 / 等接手=空心描边 / 刚动过=半透明 / 开着没动静=空心弱化 / 停着=灰。
function statusDotStyle(status: LaneNowStatus, source: "user" | "agent"): CSSProperties {
  const fill = SOURCE_FILL[source];
  if (status.kind === "running") return { background: fill };
  if (status.kind === "waiting") return { border: `1.5px solid ${fill}`, background: "transparent" };
  if (status.kind === "recent") return { background: fill, opacity: 0.45 };
  if (status.kind === "stale-open")
    return { border: `1.5px solid ${fill}`, background: "transparent", opacity: 0.5 };
  return { background: "var(--color-ink-3)", opacity: 0.5 };
}

function statusLabel(status: LaneNowStatus, now: Date): string {
  if (status.kind === "running") return `已${formatStepDuration(new Date(status.sinceMs).toISOString(), null, now)}`;
  if (status.kind === "waiting") return `已等${formatStepDuration(new Date(status.sinceMs).toISOString(), null, now)}`;
  if (status.kind === "recent") return formatRelativeTime(new Date(status.sinceMs).toISOString(), now);
  if (status.kind === "stale-open")
    return `${formatStepDuration(new Date(status.sinceMs).toISOString(), null, now)}没动静`;
  return status.sinceMs === null ? "—" : formatRelativeTime(new Date(status.sinceMs).toISOString(), now);
}
