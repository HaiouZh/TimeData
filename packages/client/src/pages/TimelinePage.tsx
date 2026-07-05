import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActionToastBar } from "../components/ui/ActionToastBar.tsx";
import CircularTimeline, { type RingSelectionTarget } from "../components/CircularTimeline.tsx";
import DateNav from "../components/DateNav.tsx";
import SyncIndicator from "../components/SyncIndicator.tsx";
import Timeline from "../components/Timeline.tsx";
import { useActionToast } from "../hooks/useActionToast.ts";
import { useEntries, useEntryMutations } from "../hooks/useEntries.ts";
import { useNowMinute } from "../hooks/useNowMinute.ts";
import { getMergeOvernightEnabled } from "../lib/overnightDisplaySetting.ts";
import { punchNow } from "../lib/punch.ts";
import { addDays, buildTimeSlots, formatTime, getDateString, isValidDateString } from "../lib/time.ts";

const SWIPE_MIN_PX = 60;

export default function TimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useNowMinute();
  const today = getDateString(now);
  const queryDate = searchParams.get("date");
  const normalizedQueryDate =
    queryDate && isValidDateString(queryDate) ? (queryDate > today ? today : queryDate) : today;
  const date = normalizedQueryDate;
  const { entries, previousEntry } = useEntries(date);
  const { deleteEntry } = useEntryMutations();
  const mergeOvernight = getMergeOvernightEnabled();
  const navigate = useNavigate();
  const [ringSelection, setRingSelection] = useState<RingSelectionTarget | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const slots = useMemo(
    () => buildTimeSlots(entries, date, 0, { previousEntry, mergeOvernight, now }),
    [date, entries, mergeOvernight, now, previousEntry],
  );
  const { toast, showToast, clearToast } = useActionToast();

  function handleDateChange(nextDate: string) {
    clearToast();
    setRingSelection(null);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
  }

  function handleSwipeDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    if ((event.target as Element).closest('[data-swipe-exempt="true"]')) return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function handleSwipeUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId || event.pointerType !== "touch") return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy) * 2) return;
    if (dx > 0) {
      handleDateChange(addDays(date, -1));
    } else if (date !== today) {
      handleDateChange(addDays(date, 1));
    }
  }

  async function handlePunch() {
    try {
      const result = await punchNow();
      if (!result.ok) {
        showToast(
          result.reason === "no_range"
            ? { message: "距上次记录还没有时间" }
            : {
                message: "请先在设置 · 记录偏好选择打点分类",
                actions: [{ label: "去设置", onClick: () => navigate("/settings/insights") }],
              },
        );
        return;
      }
      const { entry } = result;
      showToast({
        message: `已打点 ${formatTime(entry.startTime)}–${formatTime(entry.endTime)}`,
        actions: [{ label: "撤销", onClick: () => void handleUndoPunch(entry.id) }],
      });
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "打点失败" });
    }
  }

  async function handleUndoPunch(entryId: string) {
    await deleteEntry(entryId);
    clearToast();
  }

  function gapEntryUrl(startTime: string, endTime: string): string {
    return `/entries/new?date=${encodeURIComponent(date)}&start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}`;
  }

  function handleCenterAction(target: RingSelectionTarget) {
    if (target.type === "entry") {
      navigate(`/entries/${target.entryId}/edit`);
      return;
    }
    navigate(gapEntryUrl(target.startTime, target.endTime));
  }

  return (
    <div
      data-testid="swipe-area"
      onPointerDown={handleSwipeDown}
      onPointerUp={handleSwipeUp}
      onPointerCancel={() => {
        swipeStartRef.current = null;
      }}
    >
      <DateNav date={date} onDateChange={handleDateChange} />
      <div data-swipe-exempt="true">
        <CircularTimeline
          date={date}
          slots={slots}
          now={now}
          onSelectionChange={setRingSelection}
          onPunch={() => void handlePunch()}
          onCenterAction={handleCenterAction}
          overlay={<SyncIndicator />}
        />
      </div>
      <ActionToastBar toast={toast} onDismiss={clearToast} ariaLabel="打点反馈" className="mx-4 mt-2" />
      <Timeline
        slots={slots}
        onGapClick={(startTime, endTime) => navigate(gapEntryUrl(startTime, endTime))}
        onEntryClick={(entry) => navigate(`/entries/${entry.id}/edit`)}
        highlight={ringSelection}
      />
    </div>
  );
}
