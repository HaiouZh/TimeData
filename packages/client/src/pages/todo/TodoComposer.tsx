import { type FormEvent, useMemo, useState } from "react";
import type { Recurrence } from "@timedata/shared";
import { BOTTOM_NAV_HEIGHT_PX } from "../../contexts/BottomNavContext.tsx";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { formatMonthDay, getDateString } from "../../lib/time.js";
import { addTask } from "../../lib/tasks.js";
import { normalizeScheduledDate } from "../../lib/tasks/placement.js";
import { recurrenceSummary } from "../../lib/tasks/recurrence.js";
import { recurrenceToCustomInput, type RecurrenceChoice } from "../../lib/tasks/recurrencePresets.js";
import { useTodoDefaultDestination } from "../../lib/settings/todoDefaultDestinationSetting.js";
import { CustomRecurrencePage } from "./CustomRecurrencePage.js";
import { RecurrencePresetSheet } from "./RecurrencePresetSheet.js";

const DEFAULT_RECURRENCE: Recurrence = { freq: "daily", interval: 1, basis: "due" };

export function TodoComposer() {
  const destination = useTodoDefaultDestination();
  const { syncAfterWrite } = useSyncContext();
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState<RecurrenceChoice | null>(null);
  const [overlay, setOverlay] = useState<"none" | "preset" | "custom">("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todayDate = getDateString(new Date());
  const currentRecurrence = choice?.kind === "recurrence" ? choice.recurrence : null;
  const currentScheduledAt = choice?.kind === "scheduled" ? normalizeScheduledDate(choice.date) : null;
  const repeatLabel =
    choice?.kind === "recurrence"
      ? recurrenceSummary(choice.recurrence)
      : choice?.kind === "scheduled"
        ? formatMonthDay(choice.date)
        : "重复";
  const customInitial = useMemo(
    () =>
      recurrenceToCustomInput(
        currentRecurrence ?? DEFAULT_RECURRENCE,
        choice?.kind === "recurrence" ? choice.startAt : null,
        todayDate,
      ),
    [choice, currentRecurrence, todayDate],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (choice?.kind === "recurrence") {
        await addTask({
          title,
          recurrence: choice.recurrence,
          startAt: choice.startAt,
          toInbox: destination === "inbox",
        });
      } else if (choice?.kind === "scheduled") {
        await addTask({ title, scheduledAt: normalizeScheduledDate(choice.date), toInbox: true });
      } else {
        await addTask({ title, toInbox: destination === "inbox" });
      }
      setTitle("");
      setChoice(null);
      syncAfterWrite();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="fixed left-0 right-0 max-h-[70vh] overflow-y-auto border-t border-slate-800/80 bg-slate-950/95 p-2 backdrop-blur sm:p-3"
      style={{ bottom: BOTTOM_NAV_HEIGHT_PX }}
    >
      <div className="mx-auto w-full max-w-2xl space-y-2 lg:max-w-5xl">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="添加任务…"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          <button
            type="button"
            aria-label="重复"
            onClick={() => setOverlay("preset")}
            className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm ${
              choice ? "border-sky-500/60 bg-sky-500/10 text-sky-100" : "border-slate-700 text-slate-300"
            }`}
          >
            {repeatLabel}
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="min-h-11 shrink-0 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            添加
          </button>
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
      {overlay === "preset" && (
        <RecurrencePresetSheet
          current={currentRecurrence}
          scheduledAt={currentScheduledAt}
          anchor={todayDate}
          onChoose={(next) => {
            setChoice(next.kind === "none" ? null : next);
            setOverlay("none");
          }}
          onCustom={() => setOverlay("custom")}
          onClose={() => setOverlay("none")}
        />
      )}
      {overlay === "custom" && (
        <CustomRecurrencePage
          initial={customInitial}
          onBack={() => setOverlay("preset")}
          onComplete={(recurrence, startDate) => {
            setChoice({ kind: "recurrence", recurrence, startAt: normalizeScheduledDate(startDate) });
            setOverlay("none");
          }}
        />
      )}
    </form>
  );
}
