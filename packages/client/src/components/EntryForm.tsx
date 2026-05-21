import type { TimeEntry } from "@timedata/shared";
import { useEffect, useState } from "react";
import { useCategories } from "../hooks/useCategories.ts";
import { resolveClockRangeAroundEndDate } from "../lib/time.ts";
import CategoryPicker from "./CategoryPicker.tsx";
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
  ) => Promise<EntrySaveResult | void> | void;
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
  const [end, setEnd] = useState<DateTimeValue>(() => splitDateTime(endTime));
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

  useEffect(() => {
    setStart(splitDateTime(startTime));
  }, [startTime]);

  useEffect(() => {
    setEnd(splitDateTime(endTime));
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

      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-3 space-y-2">
        <label className="text-sm text-slate-400 block">分类</label>
        <CategoryPicker onSelect={setCategoryId} selectedId={categoryId} />
      </section>

      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
        <label className="text-sm text-slate-400 mb-2 block">备注（可选）</label>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="做了什么，或补充一点细节..."
          rows={2}
          className="w-full resize-none bg-slate-800 rounded-lg px-3 py-2 text-sm placeholder-slate-600"
        />
      </section>

      <div className="grid grid-cols-2 gap-3 pb-4">
        <button
          onClick={onCancel}
          className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-medium"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!categoryId || saving}
          className="py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {onDelete && (
        <button
          onClick={onDelete}
          className="w-full py-3 rounded-xl bg-red-950/70 hover:bg-red-950 text-sm font-medium text-red-300"
        >
          删除这条记录
        </button>
      )}
    </div>
  );
}
