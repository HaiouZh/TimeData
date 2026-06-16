import { RecurrenceSchema, type Recurrence } from "@timedata/shared";
import { normalizeScheduledDate } from "../lib/tasks/placement.js";
import { Checkbox } from "./ui/Checkbox.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Switch } from "./ui/Switch.js";

interface RecurrenceEditorProps {
  value: Recurrence | null;
  onChange: (next: Recurrence | null) => void;
}

const WEEKDAYS = [
  ["周一", 1],
  ["周二", 2],
  ["周三", 3],
  ["周四", 4],
  ["周五", 5],
  ["周六", 6],
  ["周日", 7],
] as const;

function emit(onChange: (next: Recurrence | null) => void, next: Recurrence): void {
  const parsed = RecurrenceSchema.safeParse(next);
  if (parsed.success) onChange(parsed.data);
}

function setFreq(current: Recurrence, freq: Recurrence["freq"]): Recurrence {
  const base = { interval: current.interval, basis: current.basis, time: current.time };
  if (freq === "weekly") return { ...base, freq, byWeekday: [1] };
  if (freq === "monthly") return { ...base, freq, byMonthday: [1] };
  return { ...base, freq };
}

type EndMode = "never" | "count" | "until";

function endModeOf(r: Recurrence): EndMode {
  if (r.count != null) return "count";
  if (r.until != null) return "until";
  return "never";
}

function setEndMode(r: Recurrence, mode: EndMode): Recurrence {
  const { count: _c, until: _u, ...rest } = r;
  if (mode === "count") return { ...rest, count: r.count ?? 1 };
  if (mode === "until") return { ...rest, until: r.until ?? normalizeScheduledDate(new Date().toISOString().slice(0, 10)) };
  return { ...rest };
}

/** 把 UtcIso 当地零点转回 input[type=date] 用的 YYYY-MM-DD。 */
function untilToDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toggleNumber(values: number[], value: number): number[] {
  const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  return next.length > 0 ? next.sort((a, b) => a - b) : [value];
}

export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps) {
  const enabled = value !== null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex min-h-10 items-center justify-between gap-3 text-sm text-slate-100">
        <span>重复</span>
        <Switch
          ariaLabel="重复"
          checked={enabled}
          onChange={(on) => onChange(on ? { freq: "daily", interval: 1, basis: "due" } : null)}
        />
      </div>

      {value && (
        <div className="space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <div className="space-y-1 text-xs text-slate-400">
              <span>频率</span>
              <SegmentedControl
                ariaLabel="频率"
                value={value.freq}
                onChange={(freq) => emit(onChange, setFreq(value, freq as Recurrence["freq"]))}
                options={[
                  { value: "daily", label: "每天" },
                  { value: "weekly", label: "每周" },
                  { value: "monthly", label: "每月" },
                ]}
              />
            </div>
            <label className="space-y-1 text-xs text-slate-400">
              <span>间隔</span>
              <input
                type="number"
                min={1}
                value={value.interval}
                onChange={(event) => {
                  const interval = Math.max(1, Number.parseInt(event.currentTarget.value || "1", 10));
                  emit(onChange, { ...value, interval });
                }}
                className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
              />
            </label>
          </div>

          {value.freq === "weekly" && (
            <div className="grid grid-cols-4 gap-2">
              {WEEKDAYS.map(([label, weekday]) => (
                <Checkbox
                  key={weekday}
                  ariaLabel={label}
                  label={label}
                  checked={(value.byWeekday ?? []).includes(weekday)}
                  onChange={() => emit(onChange, { ...value, byWeekday: toggleNumber(value.byWeekday ?? [], weekday) })}
                  className="min-h-9 rounded-lg bg-slate-950 px-2 text-xs"
                />
              ))}
            </div>
          )}

          {value.freq === "monthly" && (
            <div className="grid max-h-36 grid-cols-4 gap-2 overflow-y-auto pr-1">
              {[...Array.from({ length: 31 }, (_, index) => index + 1), -1].map((monthday) => {
                const label = monthday === -1 ? "最后一天" : `${monthday}号`;
                return (
                  <Checkbox
                    key={monthday}
                    ariaLabel={label}
                    label={label}
                    checked={(value.byMonthday ?? []).includes(monthday)}
                    onChange={() =>
                      emit(onChange, { ...value, byMonthday: toggleNumber(value.byMonthday ?? [], monthday) })
                    }
                    className="min-h-9 rounded-lg bg-slate-950 px-2 text-xs"
                  />
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <label className="space-y-1 text-xs text-slate-400">
              <span>时间</span>
              <input
                type="time"
                value={value.time ?? ""}
                onChange={(event) => {
                  const time = event.currentTarget.value;
                  emit(onChange, time ? { ...value, time } : { ...value, time: undefined });
                }}
                className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
              />
            </label>
            <fieldset className="space-y-1 text-xs text-slate-400">
              <legend>基准</legend>
              <SegmentedControl
                ariaLabel="基准"
                value={value.basis}
                onChange={(basis) => emit(onChange, { ...value, basis: basis as Recurrence["basis"] })}
                options={[
                  { value: "due", label: "到期" },
                  { value: "completion", label: "完成" },
                ]}
              />
            </fieldset>
          </div>

          <fieldset className="space-y-2 text-xs text-slate-400">
            <legend>结束</legend>
            <SegmentedControl
              ariaLabel="结束"
              value={endModeOf(value)}
              onChange={(mode) => emit(onChange, setEndMode(value, mode as EndMode))}
              options={[
                { value: "never", label: "永不" },
                { value: "count", label: "按次数" },
                { value: "until", label: "按日期" },
              ]}
            />
            {value.count != null && (
              <input
                type="number"
                min={1}
                aria-label="重复次数"
                value={value.count}
                onChange={(event) => {
                  const count = Math.max(1, Number.parseInt(event.currentTarget.value || "1", 10));
                  emit(onChange, { ...value, count });
                }}
                className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
              />
            )}
            {value.until != null && (
              <input
                type="date"
                aria-label="截止日期"
                value={untilToDateInput(value.until)}
                onChange={(event) => {
                  const v = event.currentTarget.value;
                  if (v) emit(onChange, { ...value, until: normalizeScheduledDate(v) });
                }}
                className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
              />
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}
