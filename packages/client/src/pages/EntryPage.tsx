import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isUtcIso, localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import EntryForm from "../components/EntryForm.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { applyEntryOverlapAdjustments, findOverlappingEntries, planEntryOverlapAdjustments, useEntry, useEntryMutations, useLatestEntryEndTimeBefore } from "../hooks/useEntries.ts";
import { messages } from "../lib/messages.ts";
import { toLocalDateTimeString } from "../lib/time.ts";

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
  const { addEntry, updateEntry, deleteEntry } = useEntryMutations();
  const { syncIfStale } = useSyncContext();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isEdit = Boolean(id);

  const nowLocal = toLocalDateTimeString(new Date()).slice(0, 16) + ":00";
  const queryEnd = normalizeDateTime(searchParams.get("end"));
  const end = queryEnd && queryEnd <= nowLocal ? queryEnd : nowLocal;
  const queryStart = normalizeDateTime(searchParams.get("start"));
  const shouldLookUpPreviousEntry = !existingEntry && !queryStart && !queryEnd;
  const utcEnd = localDateTimeToUtc(end);
  const prevEndUtc = useLatestEntryEndTimeBefore(shouldLookUpPreviousEntry ? utcEnd : null);
  const prevEndLocal = prevEndUtc ? utcToLocalDateTime(prevEndUtc) : null;

  const defaults = useMemo(() => {
    const fallbackStart = addMinutes(end, -60);
    if (queryStart && queryStart < end) return { start: queryStart, end };
    if (queryEnd && !queryStart) return { start: fallbackStart, end };
    if (prevEndLocal && prevEndLocal < end) return { start: prevEndLocal, end };
    return { start: fallbackStart, end };
  }, [end, queryStart, queryEnd, prevEndLocal, refreshKey]);

  if (isEdit && existingEntry === undefined) {
    return <div className="p-6 text-center text-slate-500">正在加载记录...</div>;
  }

  if (isEdit && !existingEntry) {
    return (
      <div className="p-6 space-y-4 text-center">
        <p className="text-slate-400">没有找到这条记录。</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg bg-slate-800 text-sm">返回</button>
      </div>
    );
  }

  const startTime = existingEntry ? utcToLocalDateTime(existingEntry.startTime) : defaults.start;
  const endTime   = existingEntry ? utcToLocalDateTime(existingEntry.endTime)   : defaults.end;

  async function handleSave(categoryId: string, nextStartTime: string, nextEndTime: string, note: string) {
    const utcStart = localDateTimeToUtc(nextStartTime);
    const utcEnd   = localDateTimeToUtc(nextEndTime);

    const overlaps = await findOverlappingEntries(utcStart, utcEnd, existingEntry?.id);
    if (overlaps.length > 0) {
      const plan = planEntryOverlapAdjustments(overlaps, utcStart, utcEnd);

      if (!plan.ok) {
        await confirm({
          title: messages.entry.overlapBlockedTitle,
          body: messages.entry.overlapBlockedBody,
          confirmLabel: messages.dialog.ok,
          cancelLabel: messages.dialog.back,
        });
        return;
      }

      const confirmed = await confirm({
        title: messages.entry.overlapWarnTitle,
        body: messages.entry.overlapWarnBody(overlaps.length),
        confirmLabel: messages.dialog.continueSave,
        cancelLabel: messages.dialog.cancel,
        danger: true,
      });
      if (!confirmed) return;

      await applyEntryOverlapAdjustments(plan);
    }

    if (existingEntry) {
      await updateEntry(existingEntry.id, { categoryId, startTime: utcStart, endTime: utcEnd, note: note || null });
    } else {
      await addEntry(categoryId, utcStart, utcEnd, note || undefined);
    }
    void syncIfStale();
    navigate(timelinePathForDate(utcToLocalDateTime(utcStart).slice(0, 10)), { replace: true });
  }

  async function handleDelete() {
    if (!existingEntry) return;
    const date = utcToLocalDateTime(existingEntry.startTime).slice(0, 10);
    await deleteEntry(existingEntry.id);
    void syncIfStale();
    navigate(timelinePathForDate(date), { replace: true });
  }

  return (
    <div className="min-h-full bg-slate-950">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-2 backdrop-blur">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm text-slate-300">返回</button>
        <h1 className="text-lg font-medium">{existingEntry ? "编辑记录" : "新增记录"}</h1>
      </header>
      <main className="p-3">
        <EntryForm
          startTime={startTime}
          endTime={endTime}
          existingEntry={existingEntry}
          onSave={handleSave}
          onDelete={existingEntry ? handleDelete : undefined}
          onCancel={() => navigate(-1)}
        />
      </main>
      {confirmDialog}
    </div>
  );
}
