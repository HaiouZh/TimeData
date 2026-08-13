import type { TimeEntry } from "@timedata/shared";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { useEffect, useState } from "react";
import { useAdjacentEntriesForRange } from "../hooks/useEntries.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { addDays, resolveClockRangeAroundEndDate } from "../lib/time.ts";
import CategoryPicker from "./CategoryPicker.tsx";
import { Icon } from "./Icon.js";
import TimeRangeWheelPicker, { type DateTimeValue } from "./TimeRangeWheelPicker.tsx";

export type EntrySaveResult = { ok: true } | { ok: false; error: string };

interface EntryFormProps {
  startTime: string;
  endTime: string;
  existingEntry?: TimeEntry;
  onSave: (
    categoryId: string,
    startTime: string,
    endTime: string,
    note: string,
  ) => Promise<EntrySaveResult | undefined> | undefined;
  onDelete?: () => void;
  onCancel: () => void;
}

function splitDateTime(value: string): DateTimeValue {
  return {
    date: value.slice(0, 10),
    hour: value.slice(11, 13),
    minute: value.slice(14, 16),
  };
}

export function splitEndDateTime(value: string): DateTimeValue {
  const parts = splitDateTime(value);
  if (parts.hour === "00" && parts.minute === "00") {
    return { date: addDays(parts.date, -1), hour: "24", minute: "00" };
  }
  return parts;
}

// 合并会让相邻记录在保存时被并入删除，它的备注必须先进表单，否则连同记录一起消失。
function mergeNotes(current: string, incoming: string | null | undefined, position: "before" | "after"): string {
  const extra = (incoming ?? "").trim();
  if (!extra) return current;
  if (!current.trim()) return extra;
  // 相邻记录是 live query，连点两下时上一条可能还没换人，别把同一段备注并第二遍。
  if (current.includes(extra)) return current;
  return position === "before" ? `${extra}\n${current}` : `${current}\n${extra}`;
}

export default function EntryForm({
  startTime,
  endTime,
  existingEntry,
  onSave,
  onDelete,
  onCancel,
}: EntryFormProps) {
  const { parentCategories, getChildren } = useCategories();
  const [categoryId, setCategoryId] = useState(existingEntry?.categoryId || "");
  const [start, setStart] = useState<DateTimeValue>(() => splitDateTime(startTime));
  const [end, setEnd] = useState<DateTimeValue>(() => splitEndDateTime(endTime));
  const [note, setNote] = useState(existingEntry?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { startTime: nextStartTime, endTime: nextEndTime } = resolveClockRangeAroundEndDate(
    end.date,
    start.hour,
    start.minute,
    end.hour,
    end.minute,
  );

  const { prevEntry, nextEntry } = useAdjacentEntriesForRange(
    localDateTimeToUtc(nextStartTime),
    localDateTimeToUtc(nextEndTime),
    existingEntry?.id,
  );

  useEffect(() => {
    setStart(splitDateTime(startTime));
  }, [startTime]);

  useEffect(() => {
    setEnd(splitEndDateTime(endTime));
  }, [endTime]);

  useEffect(() => {
    if (existingEntry || categoryId) return;
    const firstParent = parentCategories[0];
    if (!firstParent) return;
    const firstChild = getChildren(firstParent.id)[0];
    setCategoryId(firstChild?.id || firstParent.id);
  }, [categoryId, existingEntry, getChildren, parentCategories]);

  function handleStartChange(next: DateTimeValue) {
    setStart(next);
    if (error) setError("");
  }

  function handleEndChange(next: DateTimeValue) {
    setEnd(next);
    if (error) setError("");
  }

  function handleMergeUp() {
    if (!prevEntry) return;
    setStart(splitDateTime(utcToLocalDateTime(prevEntry.startTime)));
    setCategoryId(prevEntry.categoryId);
    setNote((current) => mergeNotes(current, prevEntry.note, "before"));
    if (error) setError("");
  }

  function handleMergeDown() {
    if (!nextEntry) return;
    setEnd(splitEndDateTime(utcToLocalDateTime(nextEntry.endTime)));
    setCategoryId(nextEntry.categoryId);
    setNote((current) => mergeNotes(current, nextEntry.note, "after"));
    if (error) setError("");
  }

  async function handleSave() {
    if (!categoryId) {
      setError("请选择分类");
      return;
    }

    setError("");
    setSaving(true);
    try {
      const result = await onSave(categoryId, nextStartTime, nextEndTime, note);
      if (result && result.ok === false) {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <TimeRangeWheelPicker
        start={start}
        end={end}
        error={error}
        onStartChange={handleStartChange}
        onEndChange={handleEndChange}
      />

      <section className="space-y-2 rounded-card border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <label className="td-text-label text-ink-2">分类</label>
          {(prevEntry || nextEntry) && (
            <div className="flex gap-2">
              {prevEntry && (
                <button
                  type="button"
                  onClick={handleMergeUp}
                  className="rounded-pill bg-surface-elevated px-3 py-1 td-text-caption text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon icon={ArrowUp} size={14} />
                    <span>向上合并</span>
                  </span>
                </button>
              )}
              {nextEntry && (
                <button
                  type="button"
                  onClick={handleMergeDown}
                  className="rounded-pill bg-surface-elevated px-3 py-1 td-text-caption text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon icon={ArrowDown} size={14} />
                    <span>向下合并</span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
        <CategoryPicker onSelect={setCategoryId} selectedId={categoryId} />
      </section>

      <section className="rounded-card border border-border bg-surface p-3">
        <label className="mb-2 block td-text-label text-ink-2">备注（可选）</label>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="做了什么，或补充一点细节..."
          rows={2}
          className="w-full resize-none rounded-ctl bg-surface-elevated px-3 py-2 text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </section>

      <div className="grid grid-cols-2 gap-3 pb-4">
        <button
          onClick={onCancel}
          className="rounded-ctl bg-surface-elevated py-3 td-text-label font-medium text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!categoryId || saving}
          className="rounded-ctl bg-accent py-3 td-text-label font-medium text-page hover:bg-accent-strong disabled:opacity-40"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {onDelete && (
        <button
          onClick={onDelete}
          className="w-full rounded-ctl bg-danger/10 py-3 td-text-label font-medium text-danger hover:bg-danger/15"
        >
          删除这条记录
        </button>
      )}
    </div>
  );
}
