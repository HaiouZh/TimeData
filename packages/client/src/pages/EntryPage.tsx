import { isUtcIso, localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import EntryForm from "../components/EntryForm.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import {
  findOverlappingEntries,
  mergeIntoAdjacentEntry,
  planEntryOverlapAdjustments,
  saveEntryWithOverlapAdjustments,
  useAdjacentEntries,
  useEntry,
  useEntryMutations,
  useLatestEntryEndTimeBefore,
} from "../hooks/useEntries.ts";
import { messages } from "../lib/messages.ts";
import { getDateString, isFutureLocalDateTime, toLocalDateTimeString } from "../lib/time.ts";

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

interface EntryPageProps {
  refreshKey?: number;
}

export default function EntryPage({ refreshKey = 0 }: EntryPageProps) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const existingEntry = useEntry(id);
  const { deleteEntry } = useEntryMutations();
  const { syncAfterWrite } = useSyncContext();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prevEntry: adjacentPrev, nextEntry: adjacentNext } = useAdjacentEntries(existingEntry);

  const isEdit = Boolean(id);
  const now = new Date();
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
  }, [end, clampedQueryStart, clampedQueryEnd, prevEndLocal, refreshKey]);

  if (isEdit && existingEntry === undefined) {
    return <div className="p-6 text-center text-slate-500">正在加载记录...</div>;
  }

  if (isEdit && !existingEntry) {
    return (
      <div className="p-6 space-y-4 text-center">
        <p className="text-slate-400">没有找到这条记录。</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg bg-slate-800 text-sm">
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
    if (isFutureLocalDateTime(nextEndTime)) {
      return { ok: false, error: "不能记录尚未发生的时间" };
    }

    const utcStart = localDateTimeToUtc(nextStartTime);
    const utcEnd = localDateTimeToUtc(nextEndTime);

    const overlaps = await findOverlappingEntries(utcStart, utcEnd, existingEntry?.id);
    let overlapPlan: Extract<ReturnType<typeof planEntryOverlapAdjustments>, { ok: true }> | null = null;

    if (overlaps.length > 0) {
      const plan = planEntryOverlapAdjustments(overlaps, utcStart, utcEnd);

      if (!plan.ok) {
        await confirm({
          title: messages.entry.overlapBlockedTitle,
          body: messages.entry.overlapBlockedBody,
          confirmLabel: messages.dialog.ok,
          cancelLabel: messages.dialog.back,
        });
        return { ok: true };
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

    syncAfterWrite();
    navigate(timelinePathForDate(utcToLocalDateTime(utcStart).slice(0, 10)), { replace: true });
    return { ok: true };
  }

  async function handleDelete() {
    if (!existingEntry) return;
    const date = utcToLocalDateTime(existingEntry.startTime).slice(0, 10);
    await deleteEntry(existingEntry.id);
    syncAfterWrite();
    navigate(timelinePathForDate(date), { replace: true });
  }

  async function handleMergeUp() {
    if (!existingEntry || !adjacentPrev) return;
    const confirmed = await confirm({
      title: "向上合并",
      body: `将当前记录的时间并入上一段记录（${utcToLocalDateTime(adjacentPrev.startTime).slice(11, 16)}–${utcToLocalDateTime(existingEntry.endTime).slice(11, 16)}），当前记录将被删除。`,
      confirmLabel: "确认合并",
      cancelLabel: "取消",
      danger: false,
    });
    if (!confirmed) return;
    const date = utcToLocalDateTime(existingEntry.startTime).slice(0, 10);
    await mergeIntoAdjacentEntry(existingEntry, "up", adjacentPrev);
    syncAfterWrite();
    navigate(timelinePathForDate(date), { replace: true });
  }

  async function handleMergeDown() {
    if (!existingEntry || !adjacentNext) return;
    const confirmed = await confirm({
      title: "向下合并",
      body: `将当前记录的时间并入下一段记录（${utcToLocalDateTime(existingEntry.startTime).slice(11, 16)}–${utcToLocalDateTime(adjacentNext.endTime).slice(11, 16)}），当前记录将被删除。`,
      confirmLabel: "确认合并",
      cancelLabel: "取消",
      danger: false,
    });
    if (!confirmed) return;
    const date = utcToLocalDateTime(existingEntry.startTime).slice(0, 10);
    await mergeIntoAdjacentEntry(existingEntry, "down", adjacentNext);
    syncAfterWrite();
    navigate(timelinePathForDate(date), { replace: true });
  }

  return (
    <div className="min-h-full bg-slate-950">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-2 backdrop-blur">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm text-slate-300">
          返回
        </button>
        <h1 className="text-lg font-medium">{existingEntry ? "编辑记录" : "新增记录"}</h1>
      </header>
      <main className="p-3">
        <EntryForm
          startTime={startTime}
          endTime={endTime}
          existingEntry={existingEntry}
          adjacentPrev={existingEntry ? adjacentPrev : null}
          adjacentNext={existingEntry ? adjacentNext : null}
          onSave={handleSave}
          onDelete={existingEntry ? handleDelete : undefined}
          onMergeUp={existingEntry && adjacentPrev ? handleMergeUp : undefined}
          onMergeDown={existingEntry && adjacentNext ? handleMergeDown : undefined}
          onCancel={() => navigate(-1)}
        />
      </main>
      {confirmDialog}
    </div>
  );
}
