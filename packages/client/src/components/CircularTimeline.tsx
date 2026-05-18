import { type TimeEntry, isUtcIso, utcToLocalDateTime } from "@timedata/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useCategories } from "../hooks/useCategories.ts";
import type { TimeSlot } from "../lib/time.ts";
import { formatDuration, formatTimelineTimeRange } from "../lib/time.ts";

interface CircularTimelineProps {
  date: string;
  slots: TimeSlot[];
  onEntryOpen: (entry: TimeEntry) => void;
  onGapOpen: (startTime: string, endTime: string) => void;
  overlay?: ReactNode;
}

type Selection = { type: "gap"; startTime: string; endTime: string } | { type: "entry"; entry: TimeEntry };

const SIZE = 240;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 104;
const INNER_RADIUS = 72;
const RADIUS = (OUTER_RADIUS + INNER_RADIUS) / 2;
const CENTER_RADIUS = 56;
const TICK_OUTER_OFFSET = 4;
const TICK_INNER_OFFSET = 4;
const LABEL_RADIUS = RADIUS;
const INDICATOR_RADIUS = OUTER_RADIUS + 10;
const DAY_MINUTES = 24 * 60;

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
  const lastGap = slots.filter((slot) => !slot.entry).at(-1);
  if (lastGap) return { type: "gap", startTime: lastGap.startTime, endTime: lastGap.endTime };

  const lastEntry = slots.filter((slot) => slot.entry).at(-1)?.entry;
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

export default function CircularTimeline({ date, slots, onEntryOpen, onGapOpen, overlay }: CircularTimelineProps) {
  const { getCategoryColor, getCategoryPath } = useCategories();
  const initialSelection = useMemo(() => chooseInitialSelection(slots), [slots]);
  const [selection, setSelection] = useState<Selection | null>(initialSelection);

  useEffect(() => {
    setSelection(initialSelection);
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

  function handleCenterClick() {
    if (!selection) return;
    if (selection.type === "entry") {
      onEntryOpen(selection.entry);
    } else {
      onGapOpen(selection.startTime, selection.endTime);
    }
  }

  const currentSelectionKey = selectionKey(selection);

  return (
    <section className="px-4 pt-4">
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-slate-300">今日时间分布</h2>
          <span className="text-xs text-slate-500">点击圆环选择时间段</span>
        </div>
        <div className="flex justify-center">
          <div className="relative w-[240px] h-[240px]">
            {overlay}
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full">
              <path d={describeRingSegment(0, DAY_MINUTES)} fill="rgb(51 65 85)" />
              {slots.map((slot, index) => {
                const { start, end } = clampSlotToDayMinutes(date, slot.startTime, slot.endTime);
                if (end <= start) return null;
                const key = slot.entry ? `entry:${slot.entry.id}` : `gap:${slot.startTime}:${slot.endTime}:${index}`;
                const slotKey = slot.entry ? `entry:${slot.entry.id}` : `gap:${slot.startTime}:${slot.endTime}`;
                const selected = currentSelectionKey === slotKey;
                const color = slot.entry ? getCategoryColor(slot.entry.categoryId) : "rgb(71 85 105)";
                const nextSelection: Selection = slot.entry
                  ? { type: "entry", entry: slot.entry }
                  : { type: "gap", startTime: slot.startTime, endTime: slot.endTime };

                return (
                  <path
                    key={key}
                    d={describeRingSegment(start, end)}
                    fill={color}
                    opacity={slot.entry ? 1 : selected ? 0.32 : 0.08}
                    className="cursor-pointer"
                    data-segment-type={slot.entry ? "entry" : "gap"}
                    data-segment-selected={selected ? "true" : "false"}
                    onClick={() => setSelection(nextSelection)}
                  />
                );
              })}
              {Array.from({ length: 12 }, (_, index) => index * 2).map((hour) => {
                const angle = (hour / 24) * 360;
                const tickOuter = polarToCartesian(angle, OUTER_RADIUS - TICK_OUTER_OFFSET);
                const tickInner = polarToCartesian(angle, INNER_RADIUS + TICK_INNER_OFFSET);
                const label = polarToCartesian(angle, LABEL_RADIUS);
                return (
                  <g key={hour}>
                    <line
                      x1={tickOuter.x}
                      y1={tickOuter.y}
                      x2={tickInner.x}
                      y2={tickInner.y}
                      stroke="rgba(248, 250, 252, 0.55)"
                      strokeWidth="1"
                      pointerEvents="none"
                    />
                    <text
                      x={label.x}
                      y={label.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-slate-100/85 text-[9px]"
                      style={{ paintOrder: "stroke" }}
                      stroke="rgb(15 23 42)"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      pointerEvents="none"
                      data-tick-placement="inner"
                    >
                      {hour}
                    </text>
                  </g>
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
                  const midpoint = (selectedMinutes.start + selectedMinutes.end) / 2;
                  const midAngle = angleFromMinutes(midpoint);
                  const arrowTip = polarToCartesian(midAngle, OUTER_RADIUS + 2);
                  const arrowLeft = polarToCartesian(midAngle - 3, INDICATOR_RADIUS);
                  const arrowRight = polarToCartesian(midAngle + 3, INDICATOR_RADIUS);
                  return (
                    <g data-ring-indicator="true" pointerEvents="none">
                      <path d={outlinePath} fill="none" stroke={selectedColor} strokeWidth="1.5" opacity="0.95" />
                      <polygon
                        points={`${arrowTip.x},${arrowTip.y} ${arrowLeft.x},${arrowLeft.y} ${arrowRight.x},${arrowRight.y}`}
                        fill={selectedColor}
                        stroke="rgb(15 23 42)"
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })()}
              <circle cx={CENTER} cy={CENTER} r={CENTER_RADIUS} fill={selectedColor} opacity="0.92" />
            </svg>
            <button
              type="button"
              onClick={handleCenterClick}
              className="absolute inset-0 m-auto flex h-[112px] w-[112px] flex-col items-center justify-center rounded-full text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
              aria-label={selection?.type === "entry" ? "编辑选中记录" : "新增选中空档记录"}
            >
              <span className="max-w-[92px] truncate text-xs text-white/85">{centerTitle}</span>
              <span className="text-base font-semibold text-white">{centerDuration}</span>
              <span className="text-[10px] text-white/85">{centerRange}</span>
            </button>
          </div>
        </div>
        {slots.length === 0 && <p className="mt-2 text-center text-xs text-slate-500">今天还没有可显示的时间段。</p>}
      </div>
    </section>
  );
}
