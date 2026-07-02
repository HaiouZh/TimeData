import { formatDuration, resolveClockRangeAroundEndDate } from "../lib/time.ts";
import Wheel from "./Wheel.tsx";

export { wheelIndexFromScrollTop, wheelScrollTopForIndex } from "./Wheel.tsx";

interface DateTimeValue {
  date: string;
  hour: string;
  minute: string;
}

interface TimeRangeWheelPickerProps {
  start: DateTimeValue;
  end: DateTimeValue;
  error?: string;
  onStartChange: (value: DateTimeValue) => void;
  onEndChange: (value: DateTimeValue) => void;
}

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
export const END_HOURS = [...HOURS, "24"];

export function endMinuteOptions(hour: string): string[] {
  return hour === "24" ? ["00"] : MINUTES;
}

export function normalizeEndClockChange(
  value: DateTimeValue,
  patch: Partial<Pick<DateTimeValue, "hour" | "minute">>,
): DateTimeValue {
  const next = { ...value, ...patch };
  if (next.hour === "24") next.minute = "00";
  return next;
}

function formatRangeDuration(start: DateTimeValue, end: DateTimeValue): string {
  const range = resolveClockRangeAroundEndDate(end.date, start.hour, start.minute, end.hour, end.minute);
  return formatDuration(range.startTime, range.endTime);
}

function TimeGroup({
  label,
  value,
  onChange,
  hourOptions = HOURS,
  minuteOptions = MINUTES,
}: {
  label: string;
  value: DateTimeValue;
  onChange: (value: DateTimeValue) => void;
  hourOptions?: string[];
  minuteOptions?: string[];
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-center text-xs font-medium text-ink-2">{label}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <Wheel
          ariaLabel={`${label}小时`}
          value={value.hour}
          options={hourOptions}
          onChange={(hour) => onChange({ ...value, hour })}
        />
        <span className="td-time text-lg font-semibold text-ink-3">:</span>
        <Wheel
          ariaLabel={`${label}分钟`}
          value={value.minute}
          options={minuteOptions}
          onChange={(minute) => onChange({ ...value, minute })}
        />
      </div>
    </div>
  );
}

export default function TimeRangeWheelPicker({
  start,
  end,
  error,
  onStartChange,
  onEndChange,
}: TimeRangeWheelPickerProps) {
  return (
    <div className="space-y-3 rounded-card border border-border bg-surface p-3">
      <div
        className={`rounded-xl px-3 py-2 text-center ${error ? "bg-danger-soft text-danger" : "bg-page text-ink"}`}
      >
        <div className="text-xs text-ink-3">本次记录时长</div>
        <div className={`text-lg font-semibold ${error ? "" : "td-duration"}`}>
          {error || formatRangeDuration(start, end)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TimeGroup label="开始" value={start} onChange={onStartChange} />
        <TimeGroup
          label="结束"
          value={end}
          hourOptions={END_HOURS}
          minuteOptions={endMinuteOptions(end.hour)}
          onChange={(next) => onEndChange(normalizeEndClockChange(end, next))}
        />
      </div>
    </div>
  );
}

export type { DateTimeValue };
