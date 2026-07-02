import { isUtcIso, localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import EntryForm from "../components/EntryForm.tsx";
import { useAppResumeRefresh } from "../hooks/useAppResumeRefresh.ts";
import { useConfirm } from "../hooks/useConfirm.tsx";
import {
  findOverlappingEntries,
  planEntryOverlapAdjustments,
  saveEntryWithOverlapAdjustments,
  useEntry,
  useEntryMutations,
  useLatestEntryEndTimeBefore,
} from "../hooks/useEntries.ts";
import { messages } from "../lib/messages.ts";
import { addDays, getDateString, isFutureLocalDateTime, rollBackOvernightRange, toLocalDateTimeString } from "../lib/time.ts";

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:00`;
}

function normalizeDateTime(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (isUtcIso(value) && Number.isFinite(new Date(value).getTime())) return utcToLocalDateTime(value);
  return null;
}

function normalizeDateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function timelinePathForDate(date: string): string {
  return date ? `/?date=${encodeURIComponent(date)}` : "/";
}

export function resolveTimelineDateAfterSave(startLocal: string, endLocal: string): string {
  const startDate = startLocal.slice(0, 10);
  const endDate = endLocal.slice(0, 10);
  const endClock = endLocal.slice(11, 16);
  if (endDate !== startDate && endClock !== "00:00") return endDate;
  return startDate;
}

export default function EntryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const existingEntry = useEntry(id);
  const { deleteEntry } = useEntryMutations();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const isEdit = Boolean(id);
  const [now, setNow] = useState(() => new Date());
  useAppResumeRefresh(() => setNow(new Date()));
  const todayStr = getDateString(now);
  const nowLocal = `${toLocalDateTimeString(now).slice(0, 16)}:00`;

  const queryDate = normalizeDateParam(searchParams.get("date"));
  const anchorDate = queryDate ?? todayStr;

  const queryStart = normalizeDateTime(searchParams.get("start"));
  const queryEnd = normalizeDateTime(searchParams.get("end"));

  // defaults.end：今天就用 now；其它日期固定到当天 23:59，避免 endDate 落到次日 00:00 把表单锚到错误的一天
  const defaultEndForDate = anchorDate === todayStr ? nowLocal : `${anchorDate}T23:59:00`;

  const clampedQueryEnd = (() => {
    if (!queryEnd) return null;
    // 历史日尾部空档的 end 是次日 00:00（界面显示 24:00）：作为合法边界透传。
    // 今天不放行，今天的一天终点仍由 now 决定。
    if (anchorDate !== todayStr && queryEnd === `${addDays(anchorDate, 1)}T00:00:00`) return queryEnd;
    const queryEndDate = queryEnd.slice(0, 10);
    if (queryEndDate === anchorDate && queryEnd <= defaultEndForDate) return queryEnd;
    return null;
  })();

  const end = clampedQueryEnd ?? defaultEndForDate;

  const clampedQueryStart = (() => {
    if (!queryStart) return null;
    if (queryStart >= end) return null;
    return queryStart;
  })();

  const shouldLookUpPreviousEntry = !existingEntry && !clampedQueryStart && !clampedQueryEnd;

  const utcEnd = localDateTimeToUtc(end);
  const prevEndUtc = useLatestEntryEndTimeBefore(shouldLookUpPreviousEntry ? utcEnd : null);
  const prevEndLocal = prevEndUtc ? utcToLocalDateTime(prevEndUtc) : null;

  const defaults = useMemo(() => {
    const fallbackStart = addMinutes(end, -60);
    if (clampedQueryStart) return { start: clampedQueryStart, end };
    if (clampedQueryEnd) return { start: fallbackStart, end };
    if (prevEndLocal && prevEndLocal < end) return { start: prevEndLocal, end };
    return { start: fallbackStart, end };
  }, [end, clampedQueryStart, clampedQueryEnd, prevEndLocal]);

  function goBack(fallbackPath: string) {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    navigate(fallbackPath, { replace: true });
  }

  if (isEdit && existingEntry === undefined) {
    return <div className="p-6 text-center text-ink-3">正在加载记录...</div>;
  }

  if (isEdit && !existingEntry) {
    return (
      <div className="p-6 space-y-4 text-center">
        <p className="text-ink-3">没有找到这条记录。</p>
        <button onClick={() => goBack("/")} className="px-4 py-2 rounded-lg bg-surface-hover text-sm">
          返回
        </button>
      </div>
    );
  }

  const startTime = existingEntry ? utcToLocalDateTime(existingEntry.startTime) : defaults.start;
  const endTime = existingEntry ? utcToLocalDateTime(existingEntry.endTime) : defaults.end;

  async function handleSave(
    categoryId: string,
    nextStartTime: string,
    nextEndTime: string,
    note: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const { startTime: startLocal, endTime: endLocal } = rollBackOvernightRange(nextStartTime, nextEndTime);

    if (isFutureLocalDateTime(endLocal)) {
      return { ok: false, error: "不能记录尚未发生的时间" };
    }

    const utcStart = localDateTimeToUtc(startLocal);
    const utcEnd = localDateTimeToUtc(endLocal);

    const overlaps = await findOverlappingEntries(utcStart, utcEnd, existingEntry?.id);
    let overlapPlan: Extract<ReturnType<typeof planEntryOverlapAdjustments>, { ok: true }> | null = null;

    if (overlaps.length > 0) {
      const plan = planEntryOverlapAdjustments(overlaps, utcStart, utcEnd);

      if (!plan.ok) {
        return { ok: false, error: messages.entry.overlapBlockedBody };
      }

      const confirmed = await confirm({
        title: messages.entry.overlapWarnTitle,
        body: messages.entry.overlapWarnBody(overlaps.length),
        confirmLabel: messages.dialog.continueSave,
        cancelLabel: messages.dialog.cancel,
        danger: true,
      });
      if (!confirmed) return { ok: true };

      overlapPlan = plan;
    }

    await saveEntryWithOverlapAdjustments({
      existingEntryId: existingEntry?.id ?? null,
      categoryId,
      startTime: utcStart,
      endTime: utcEnd,
      note: note || null,
      overlapPlan,
    });

    navigate(timelinePathForDate(resolveTimelineDateAfterSave(startLocal, endLocal)), { replace: true });
    return { ok: true };
  }

  async function handleDelete() {
    if (!existingEntry) return;
    const date = utcToLocalDateTime(existingEntry.startTime).slice(0, 10);
    await deleteEntry(existingEntry.id);
    navigate(timelinePathForDate(date), { replace: true });
  }

  const fallbackBackPath = existingEntry
    ? timelinePathForDate(utcToLocalDateTime(existingEntry.startTime).slice(0, 10))
    : timelinePathForDate(anchorDate);

  return (
    <div className="min-h-full bg-page">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-page/95 px-3 py-2 backdrop-blur">
        <button onClick={() => goBack(fallbackBackPath)} className="px-3 py-1.5 rounded-lg bg-surface-hover text-sm text-ink-2">
          返回
        </button>
        <h1 className="text-lg font-medium">{existingEntry ? "编辑记录" : "新增记录"}</h1>
      </header>
      <main className="p-3">
        <EntryForm
          startTime={startTime}
          endTime={endTime}
          existingEntry={existingEntry}
          onSave={handleSave}
          onDelete={existingEntry ? handleDelete : undefined}
          onCancel={() => goBack(fallbackBackPath)}
        />
      </main>
      {confirmDialog}
    </div>
  );
}
