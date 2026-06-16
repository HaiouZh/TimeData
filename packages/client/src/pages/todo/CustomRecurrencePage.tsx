import { useEffect, useState } from "react";
import type { Recurrence } from "@timedata/shared";
import MonthCalendar from "../../components/MonthCalendar.js";
import Wheel from "../../components/Wheel.js";
import {
  customToRecurrence,
  type CustomRecurrenceEndMode,
  type CustomRecurrenceInput,
} from "../../lib/tasks/recurrencePresets.js";

interface CustomRecurrencePageProps {
  initial: CustomRecurrenceInput;
  onComplete: (recurrence: Recurrence, startDate: string) => void;
  onBack: () => void;
}

const INTERVAL_OPTIONS = Array.from({ length: 99 }, (_, index) => String(index + 1));
const COUNT_OPTIONS = Array.from({ length: 99 }, (_, index) => String(index + 1));

const unitOptions: Array<{ value: Recurrence["freq"]; label: string }> = [
  { value: "daily", label: "天" },
  { value: "weekly", label: "周" },
  { value: "monthly", label: "月" },
];

const endModes: Array<{ value: CustomRecurrenceEndMode; label: string }> = [
  { value: "never", label: "永不" },
  { value: "count", label: "按次数" },
  { value: "until", label: "按日期" },
];

const basisOptions: Array<{ value: Recurrence["basis"]; label: string }> = [
  { value: "due", label: "按到期" },
  { value: "completion", label: "按完成" },
];

function initialKey(input: CustomRecurrenceInput): string {
  return JSON.stringify(input);
}

function segmentedClass(active: boolean): string {
  return `min-h-9 rounded-lg px-3 text-sm transition-colors ${
    active ? "bg-sky-400/20 text-sky-50" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
  }`;
}

function normalizeCount(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1;
}

export function CustomRecurrencePage({ initial, onComplete, onBack }: CustomRecurrencePageProps) {
  const [draft, setDraft] = useState<CustomRecurrenceInput>(initial);
  const [loadedInitialKey, setLoadedInitialKey] = useState(() => initialKey(initial));

  useEffect(() => {
    const nextKey = initialKey(initial);
    if (nextKey !== loadedInitialKey) {
      setDraft(initial);
      setLoadedInitialKey(nextKey);
    }
  }, [initial, loadedInitialKey]);

  function patch(next: Partial<CustomRecurrenceInput>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function setUnit(unit: Recurrence["freq"]): void {
    setDraft((current) => ({
      ...current,
      unit,
      preserveHitDays: unit === current.unit ? current.preserveHitDays : false,
      monthEnd: unit === "monthly" ? current.monthEnd : false,
    }));
  }

  function setStart(start: string): void {
    setDraft((current) => ({ ...current, start, preserveHitDays: false }));
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950 text-slate-100">
      <div className="flex min-h-14 items-center justify-between border-b border-slate-800 px-4">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="rounded-lg px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
        >
          返回
        </button>
        <h2 className="text-sm font-semibold text-slate-100">自定义重复</h2>
        <button
          type="button"
          aria-label="完成"
          onClick={() => onComplete(customToRecurrence(draft), draft.start)}
          className="rounded-lg px-2 py-1 text-sm font-medium text-sky-200 hover:bg-sky-400/10"
        >
          完成
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <section className="space-y-3">
          <div className="text-xs font-medium text-slate-500">频率</div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div>
              <div className="mb-1 text-center text-xs text-slate-500">每</div>
              <Wheel
                ariaLabel="重复间隔"
                value={String(draft.interval)}
                options={INTERVAL_OPTIONS}
                onChange={(value) => patch({ interval: normalizeCount(value) })}
              />
            </div>
            <div>
              <div className="mb-1 text-center text-xs text-slate-500">单位</div>
              <div className="grid h-[102px] grid-rows-3 rounded-lg bg-slate-900/70 p-1">
                {unitOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    onClick={() => setUnit(option.value)}
                    className={segmentedClass(draft.unit === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-xs font-medium text-slate-500">结束</div>
          <div className="grid grid-cols-3 rounded-xl bg-slate-900/70 p-1">
            {endModes.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-label={mode.label}
                onClick={() => patch({ endMode: mode.value })}
                className={segmentedClass(draft.endMode === mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {draft.endMode === "count" && (
            <Wheel
              ariaLabel="重复次数"
              value={String(draft.count ?? 1)}
              options={COUNT_OPTIONS}
              onChange={(value) => patch({ count: normalizeCount(value) })}
            />
          )}
          {draft.endMode === "until" && (
            <input
              type="date"
              aria-label="结束日期"
              value={draft.until ?? draft.start}
              onChange={(event) => patch({ until: event.currentTarget.value })}
              className="min-h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          )}
        </section>

        <section className="space-y-3">
          <div className="text-xs font-medium text-slate-500">时间</div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <button
              type="button"
              aria-label="无时间"
              onClick={() => patch({ time: undefined })}
              className={segmentedClass(!draft.time)}
            >
              无
            </button>
            <input
              type="time"
              aria-label="重复时间"
              value={draft.time ?? ""}
              onChange={(event) => patch({ time: event.currentTarget.value || undefined })}
              className="min-h-11 rounded-xl border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-xs font-medium text-slate-500">顺延基准</div>
          <div className="grid grid-cols-2 rounded-xl bg-slate-900/70 p-1">
            {basisOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                onClick={() => patch({ basis: option.value })}
                className={segmentedClass(draft.basis === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {draft.unit === "monthly" && (
          <section>
            <button
              type="button"
              aria-label="每月最后一天"
              aria-pressed={draft.monthEnd === true}
              onClick={() => patch({ monthEnd: !draft.monthEnd })}
              className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm ${
                draft.monthEnd ? "bg-sky-400/15 text-sky-50" : "bg-slate-900/80 text-slate-300"
              }`}
            >
              <span>每月最后一天</span>
              <span>{draft.monthEnd ? "✓" : ""}</span>
            </button>
          </section>
        )}

        <section className="space-y-3">
          <div className="text-xs font-medium text-slate-500">起始日期</div>
          <MonthCalendar value={draft.start} onChange={setStart} />
        </section>
      </div>
    </div>
  );
}
