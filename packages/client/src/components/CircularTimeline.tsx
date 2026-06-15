import { type TimeEntry, isUtcIso, utcToLocalDateTime } from "@timedata/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCategories } from "../hooks/useCategories.ts";
import type { TimeSlot } from "../lib/time.ts";
import { formatDuration, formatTimelineTimeRange, getDateString, toLocalDateTimeString } from "../lib/time.ts";

interface CircularTimelineProps {
  date: string;
  slots: TimeSlot[];
  onEntryOpen?: (entry: TimeEntry) => void;
  onGapOpen?: (startTime: string, endTime: string) => void;
  onPunch?: () => void;
  overlay?: ReactNode;
  now?: Date;
}

type Selection = { type: "gap"; startTime: string; endTime: string } | { type: "entry"; entry: TimeEntry };

const SIZE = 240;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 104;
const INNER_RADIUS = 62;
const RADIUS = (OUTER_RADIUS + INNER_RADIUS) / 2;
// 小时数字移到环带之外，落进圆环与方形之间原有的内边距里：环带（含刻度）保持干净。
const LABEL_RADIUS = 113;
const ARROW_TIP_RADIUS = INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * 0.25;
const ARROW_BASE_RADIUS = INNER_RADIUS - 4;
const ARROW_HALF_WIDTH_DEG = 6;
const DAY_MINUTES = 24 * 60;
const TICK_INDICES = Array.from({ length: 144 }, (_, index) => index);

function minutesFromClock(value: string): number {
  const hours = Number(value.slice(11, 13));
  const minutes = Number(value.slice(14, 16));
  return hours * 60 + minutes;
}

function toAppLocalDateTime(value: string): string {
  return isUtcIso(value) ? utcToLocalDateTime(value) : value;
}

function compareDatePart(value: string, date: string): -1 | 0 | 1 {
  const valueDate = value.slice(0, 10);
  if (valueDate < date) return -1;
  if (valueDate > date) return 1;
  return 0;
}

function minuteOnDate(date: string, value: string): number {
  const localValue = toAppLocalDateTime(value);
  const comparison = compareDatePart(localValue, date);
  if (comparison < 0) return 0;
  if (comparison > 0) return DAY_MINUTES;
  return minutesFromClock(localValue);
}

export function clampSlotToDayMinutes(
  date: string,
  startTime: string,
  endTime: string,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(DAY_MINUTES, minuteOnDate(date, startTime)));
  const end = Math.max(start, Math.min(DAY_MINUTES, minuteOnDate(date, endTime)));
  return { start, end };
}

export function chooseInitialSelection(slots: TimeSlot[]): Selection | null {
  const lastGap = slots.filter((slot) => slot.kind === "gap").at(-1);
  if (lastGap) return { type: "gap", startTime: lastGap.startTime, endTime: lastGap.endTime };

  const lastEntry = slots.filter((slot) => slot.kind === "entry" && slot.entry).at(-1)?.entry;
  if (lastEntry) return { type: "entry", entry: lastEntry };

  return null;
}

function angleFromMinutes(minutes: number): number {
  return (minutes / DAY_MINUTES) * 360;
}

function polarToCartesian(angle: number, radius = RADIUS) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(radians),
    y: CENTER + radius * Math.sin(radians),
  };
}

function cartesianToMinutes(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): number | null {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const scale = rect.width / SIZE;
  if (distance < INNER_RADIUS * scale - 6 || distance > OUTER_RADIUS * scale + 8) return null;

  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (angle < 0) angle += 360;
  if (angle >= 360) angle -= 360;
  return (angle / 360) * DAY_MINUTES;
}

function findSlotAtMinutes(slots: TimeSlot[], date: string, minutes: number): TimeSlot | null {
  for (const slot of slots) {
    if (slot.kind === "future") continue;
    const { start, end } = clampSlotToDayMinutes(date, slot.startTime, slot.endTime);
    if (minutes >= start && minutes < end) return slot;
  }
  return null;
}

export function describeRingSegment(startMinutes: number, endMinutes: number): string {
  const span = endMinutes - startMinutes;
  if (span >= DAY_MINUTES) {
    const midpoint = startMinutes + DAY_MINUTES / 2;
    return [describeRingSegment(startMinutes, midpoint), describeRingSegment(midpoint, endMinutes)].join(" ");
  }

  const startAngle = angleFromMinutes(startMinutes);
  const endAngle = angleFromMinutes(endMinutes);
  const outerStart = polarToCartesian(startAngle, OUTER_RADIUS);
  const outerEnd = polarToCartesian(endAngle, OUTER_RADIUS);
  const innerEnd = polarToCartesian(endAngle, INNER_RADIUS);
  const innerStart = polarToCartesian(startAngle, INNER_RADIUS);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    "M",
    outerStart.x,
    outerStart.y,
    "A",
    OUTER_RADIUS,
    OUTER_RADIUS,
    0,
    largeArcFlag,
    1,
    outerEnd.x,
    outerEnd.y,
    "L",
    innerEnd.x,
    innerEnd.y,
    "A",
    INNER_RADIUS,
    INNER_RADIUS,
    0,
    largeArcFlag,
    0,
    innerStart.x,
    innerStart.y,
    "Z",
  ].join(" ");
}

function selectionKey(selection: Selection | null): string {
  if (!selection) return "none";
  if (selection.type === "entry") return `entry:${selection.entry.id}`;
  return `gap:${selection.startTime}:${selection.endTime}`;
}

export default function CircularTimeline({ date, slots, onPunch, overlay, now }: CircularTimelineProps) {
  const { getCategoryColor, getCategoryPath } = useCategories();
  const initialSelection = useMemo(() => chooseInitialSelection(slots), [slots]);
  const [selection, setSelection] = useState<Selection | null>(initialSelection);
  const [dragMinutes, setDragMinutes] = useState<number | null>(null);

  function selectFromPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = cartesianToMinutes(event.clientX, event.clientY, rect);
    if (minutes === null) return;
    setDragMinutes(minutes);
    const slot = findSlotAtMinutes(slots, date, minutes);
    if (!slot) return;
    setSelection(
      slot.entry
        ? { type: "entry", entry: slot.entry }
        : { type: "gap", startTime: slot.startTime, endTime: slot.endTime },
    );
  }

  useEffect(() => {
    setSelection(initialSelection);
    setDragMinutes(null);
  }, [initialSelection]);

  const selectedRange = selection
    ? selection.type === "entry"
      ? { startTime: selection.entry.startTime, endTime: selection.entry.endTime }
      : { startTime: selection.startTime, endTime: selection.endTime }
    : null;
  const selectedMinutes = selectedRange
    ? clampSlotToDayMinutes(date, selectedRange.startTime, selectedRange.endTime)
    : null;
  const selectedColor = selection?.type === "entry" ? getCategoryColor(selection.entry.categoryId) : "rgb(100 116 139)";
  const centerTitle =
    selection?.type === "entry"
      ? getCategoryPath(selection.entry.categoryId)
      : selection?.type === "gap"
        ? "待记录"
        : "没有时间段";
  const centerDuration = selectedRange ? formatDuration(selectedRange.startTime, selectedRange.endTime) : "";
  const centerRange = selectedRange ? formatTimelineTimeRange(selectedRange.startTime, selectedRange.endTime) : "";

  const currentSelectionKey = selectionKey(selection);

  return (
    <section className="px-4 pt-4">
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-3">
        <div className="flex justify-center">
          <div className="relative aspect-square w-full max-w-[372px]">
            {overlay}
            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="w-full h-full"
              style={{ touchAction: "none" }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                selectFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  selectFromPointer(event);
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            >
              <path d={describeRingSegment(0, DAY_MINUTES)} fill="rgb(51 65 85)" />
              {slots.map((slot, index) => {
                const { start, end } = clampSlotToDayMinutes(date, slot.startTime, slot.endTime);
                if (end <= start) return null;
                const key = slot.entry ? `entry:${slot.entry.id}` : `${slot.kind}:${slot.startTime}:${slot.endTime}:${index}`;
                const slotKey = slot.entry ? `entry:${slot.entry.id}` : `${slot.kind}:${slot.startTime}:${slot.endTime}`;
                const selected = currentSelectionKey === slotKey;
                let fill: string;
                if (slot.kind === "entry" && slot.entry) {
                  fill = getCategoryColor(slot.entry.categoryId);
                } else if (slot.kind === "future") {
                  fill = "rgb(24 32 48)";
                } else {
                  fill = "rgb(100 116 139)";
                }
                // 有选中段时，把其余可选段压暗，让选中段相对提亮；future 自身已足够克制，不再压。
                const dimmed = selection !== null && !selected && slot.kind !== "future";
                return (
                  <path
                    key={key}
                    d={describeRingSegment(start, end)}
                    data-segment-type={slot.kind}
                    data-segment-selected={selected ? "true" : "false"}
                    fill={fill}
                    opacity={dimmed ? 0.45 : 1}
                    className={slot.kind === "future" ? "" : "cursor-pointer"}
                    onClick={undefined}
                  />
                );
              })}
              {TICK_INDICES.map((tick) => {
                const angle = (tick / TICK_INDICES.length) * 360;
                const isHour = tick % 6 === 0;
                const isHalf = !isHour && tick % 3 === 0;
                const tier = isHour ? "hour" : isHalf ? "half" : "micro";
                const length = isHour ? 8 : isHalf ? 5 : 3;
                const strokeWidth = isHour ? 1.5 : isHalf ? 1 : 0.6;
                const opacity = isHour ? 0.85 : isHalf ? 0.6 : 0.35;
                const outer = polarToCartesian(angle, OUTER_RADIUS - 2);
                const inner = polarToCartesian(angle, OUTER_RADIUS - 2 - length);
                return (
                  <line
                    key={`tick-${tick}`}
                    x1={outer.x}
                    y1={outer.y}
                    x2={inner.x}
                    y2={inner.y}
                    stroke="rgb(248 250 252)"
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                    data-tick-tier={tier}
                    pointerEvents="none"
                  />
                );
              })}
              {Array.from({ length: 24 }, (_, index) => index).map((hour) => {
                const angle = (hour / 24) * 360;
                const label = polarToCartesian(angle, LABEL_RADIUS);
                const isAnchor = hour === 0 || hour === 6 || hour === 12 || hour === 18;
                return (
                  <text
                    key={`hour-${hour}`}
                    x={label.x}
                    y={label.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={isAnchor ? "fill-slate-100 text-[10px] font-semibold" : "fill-slate-400 text-[9px]"}
                    style={{ paintOrder: "stroke" }}
                    stroke="rgb(15 23 42)"
                    strokeWidth="1"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  >
                    {hour}
                  </text>
                );
              })}
              {selectedMinutes &&
                selectedMinutes.end > selectedMinutes.start &&
                (() => {
                  const startAngle = angleFromMinutes(selectedMinutes.start);
                  const endAngle = angleFromMinutes(selectedMinutes.end);
                  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
                  const outerStart = polarToCartesian(startAngle, OUTER_RADIUS);
                  const outerEnd = polarToCartesian(endAngle, OUTER_RADIUS);
                  const innerEnd = polarToCartesian(endAngle, INNER_RADIUS);
                  const innerStart = polarToCartesian(startAngle, INNER_RADIUS);
                  const outlinePath = [
                    "M",
                    outerStart.x,
                    outerStart.y,
                    "A",
                    OUTER_RADIUS,
                    OUTER_RADIUS,
                    0,
                    largeArcFlag,
                    1,
                    outerEnd.x,
                    outerEnd.y,
                    "L",
                    innerEnd.x,
                    innerEnd.y,
                    "A",
                    INNER_RADIUS,
                    INNER_RADIUS,
                    0,
                    largeArcFlag,
                    0,
                    innerStart.x,
                    innerStart.y,
                    "Z",
                  ].join(" ");
                  return (
                    <path
                      d={outlinePath}
                      fill="none"
                      stroke={selectedColor}
                      strokeWidth="2"
                      opacity="1"
                      pointerEvents="none"
                    />
                  );
                })()}
              {(() => {
                const arrowMinutes =
                  dragMinutes !== null
                    ? dragMinutes
                    : selectedMinutes && selectedMinutes.end > selectedMinutes.start
                      ? (selectedMinutes.start + selectedMinutes.end) / 2
                      : null;
                if (arrowMinutes === null) return null;
                const angle = angleFromMinutes(arrowMinutes);
                const tip = polarToCartesian(angle, ARROW_TIP_RADIUS);
                const baseLeft = polarToCartesian(angle - ARROW_HALF_WIDTH_DEG, ARROW_BASE_RADIUS);
                const baseRight = polarToCartesian(angle + ARROW_HALF_WIDTH_DEG, ARROW_BASE_RADIUS);
                return (
                  <polygon
                    data-ring-indicator="true"
                    points={`${tip.x},${tip.y} ${baseLeft.x},${baseLeft.y} ${baseRight.x},${baseRight.y}`}
                    fill={selectedColor}
                    stroke="rgb(15 23 42)"
                    strokeWidth="1"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                );
              })()}
              {(() => {
                // 仅在“今天”的视图里，于当前时刻画一根细表针，明确“此刻”落在哪。
                const localNow = now ?? new Date();
                if (getDateString(localNow) !== date) return null;
                const nowMinutes = minutesFromClock(toLocalDateTimeString(localNow));
                const angle = angleFromMinutes(nowMinutes);
                const handOuter = polarToCartesian(angle, OUTER_RADIUS + 3);
                const handInner = polarToCartesian(angle, INNER_RADIUS - 3);
                return (
                  <g data-now-indicator="true" pointerEvents="none">
                    <line
                      x1={handInner.x}
                      y1={handInner.y}
                      x2={handOuter.x}
                      y2={handOuter.y}
                      stroke="rgb(248 113 113)"
                      strokeWidth="1.5"
                    />
                    <circle cx={handOuter.x} cy={handOuter.y} r="2.4" fill="rgb(248 113 113)" />
                  </g>
                );
              })()}
            </svg>
            <button
              type="button"
              onClick={() => onPunch?.()}
              className="absolute inset-0 m-auto flex aspect-square w-[48%] flex-col items-center justify-center gap-0.5 rounded-full px-3 text-center ring-1 ring-inset ring-white/10 transition hover:ring-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:scale-95"
              style={{ containerType: "inline-size" }}
              aria-label="打点（记录到现在）"
            >
              <span className="text-[8cqw] leading-none text-white/85">{centerRange}</span>
              <span className="line-clamp-2 text-[13cqw] font-medium leading-tight text-white">{centerTitle}</span>
              <span className="text-[17cqw] font-semibold leading-none text-white">{centerDuration}</span>
            </button>
          </div>
        </div>
        {slots.length === 0 && <p className="mt-2 text-center text-xs text-slate-500">今天还没有可显示的时间段。</p>}
      </div>
    </section>
  );
}
