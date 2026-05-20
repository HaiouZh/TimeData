import { useEffect, useMemo, useRef } from "react";
import { formatDuration, resolveClockRangeAroundEndDate } from "../lib/time.ts";

interface DateTimeValue {
  date: string;
  hour: string;
  minute: string;
}

interface TimeRangeWheelPickerProps {
  start: DateTimeValue;
  end: DateTimeValue;
  error?: string;
  now?: Date;
  onStartChange: (value: DateTimeValue) => void;
  onEndChange: (value: DateTimeValue) => void;
}

interface WheelProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
const REPEAT_COUNT = 11;
const ITEM_HEIGHT = 34;

function formatRangeDuration(start: DateTimeValue, end: DateTimeValue, now?: Date): string {
  const range = resolveClockRangeAroundEndDate(end.date, start.hour, start.minute, end.hour, end.minute, now);
  return formatDuration(range.startTime, range.endTime);
}

export function wheelScrollTopForIndex(index: number): number {
  return index * ITEM_HEIGHT;
}

export function wheelIndexFromScrollTop(scrollTop: number): number {
  return Math.round(scrollTop / ITEM_HEIGHT);
}

function Wheel({ value, options, onChange }: WheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const normalizedValue = options.includes(value) ? value : options[0];
  const allOptions = useMemo(() => Array.from({ length: REPEAT_COUNT }, () => options).flat(), [options]);
  const middleSetStart = Math.floor(REPEAT_COUNT / 2) * options.length;

  useEffect(() => {
    const selectedIndex = options.indexOf(normalizedValue);
    const container = containerRef.current;
    if (!container || selectedIndex < 0) return;

    const targetIndex = middleSetStart + selectedIndex;
    const targetTop = wheelScrollTopForIndex(targetIndex);

    if (Math.abs(container.scrollTop - targetTop) > ITEM_HEIGHT / 2) {
      container.scrollTop = targetTop;
    }
  }, [middleSetStart, normalizedValue, options]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, []);

  function settle() {
    const container = containerRef.current;
    if (!container) return;

    const rawIndex = wheelIndexFromScrollTop(container.scrollTop);
    const optionIndex = ((rawIndex % options.length) + options.length) % options.length;
    const next = options[optionIndex];
    const normalizedIndex = middleSetStart + optionIndex;

    container.scrollTo({ top: wheelScrollTopForIndex(normalizedIndex), behavior: "smooth" });

    if (next !== normalizedValue) {
      onChange(next);
    }
  }

  function handleScroll() {
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(settle, 70);
  }

  return (
    <div className="relative h-[102px] overflow-hidden rounded-lg bg-slate-950">
      <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-[34px] -translate-y-1/2 rounded-md border border-blue-400/60 bg-blue-400/10" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-slate-950 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-slate-950 to-transparent" />
      <div
        ref={containerRef}
        role="listbox"
        onScroll={handleScroll}
        className="wheel-scroll h-full overflow-y-auto snap-y snap-mandatory py-[34px] overscroll-contain"
      >
        {allOptions.map((option, index) => {
          const selected = option === normalizedValue;
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              key={`${option}-${index}`}
              onClick={() => onChange(option)}
              className={`block h-[34px] w-full snap-center text-center text-base tabular-nums transition-colors ${
                selected ? "font-semibold text-slate-50" : "text-slate-500"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeGroup({
  label,
  value,
  onChange,
}: { label: string; value: DateTimeValue; onChange: (value: DateTimeValue) => void }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-center text-xs font-medium text-slate-400">{label}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <Wheel value={value.hour} options={HOURS} onChange={(hour) => onChange({ ...value, hour })} />
        <span className="text-lg font-semibold text-slate-500">:</span>
        <Wheel value={value.minute} options={MINUTES} onChange={(minute) => onChange({ ...value, minute })} />
      </div>
    </div>
  );
}

export default function TimeRangeWheelPicker({
  start,
  end,
  error,
  now,
  onStartChange,
  onEndChange,
}: TimeRangeWheelPickerProps) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3 space-y-3">
      <div
        className={`rounded-xl px-3 py-2 text-center ${error ? "bg-red-950/50 text-red-300" : "bg-slate-950 text-slate-100"}`}
      >
        <div className="text-xs text-slate-500">本次记录时长</div>
        <div className="text-lg font-semibold">{error || formatRangeDuration(start, end, now)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TimeGroup label="开始" value={start} onChange={onStartChange} />
        <TimeGroup label="结束" value={end} onChange={onEndChange} />
      </div>
    </div>
  );
}

export type { DateTimeValue };
