import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActionToastBar } from "../components/ui/ActionToastBar.tsx";
import CircularTimeline from "../components/CircularTimeline.tsx";
import DateNav from "../components/DateNav.tsx";
import SyncIndicator from "../components/SyncIndicator.tsx";
import Timeline from "../components/Timeline.tsx";
import { useActionToast } from "../hooks/useActionToast.ts";
import { useEntries, useEntryMutations } from "../hooks/useEntries.ts";
import { useMidnightTick } from "../hooks/useMidnightTick.ts";
import { getMergeOvernightEnabled } from "../lib/overnightDisplaySetting.ts";
import { punchNow } from "../lib/punch.ts";
import { buildTimeSlots, formatTime, getDateString, isValidDateString } from "../lib/time.ts";

export default function TimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [, setMidnightTick] = useState(0);
  useMidnightTick(() => setMidnightTick((value) => value + 1));
  const now = new Date();
  const today = getDateString(now);
  const queryDate = searchParams.get("date");
  const normalizedQueryDate =
    queryDate && isValidDateString(queryDate) ? (queryDate > today ? today : queryDate) : today;
  const [date, setDate] = useState(normalizedQueryDate);
  const { entries, previousEntry } = useEntries(date);
  const { deleteEntry } = useEntryMutations();
  const mergeOvernight = getMergeOvernightEnabled();
  const navigate = useNavigate();
  const slots = useMemo(
    () => buildTimeSlots(entries, date, 0, { previousEntry, mergeOvernight, now }),
    [date, entries, mergeOvernight, now, previousEntry],
  );
  const { toast, showToast, clearToast } = useActionToast();

  useEffect(() => {
    setDate(normalizedQueryDate);
  }, [normalizedQueryDate]);

  function handleDateChange(nextDate: string) {
    clearToast();
    setDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
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

  return (
    <>
      <DateNav date={date} onDateChange={handleDateChange} />
      <CircularTimeline
        date={date}
        slots={slots}
        now={now}
        onPunch={() => void handlePunch()}
        overlay={<SyncIndicator />}
      />
      <ActionToastBar toast={toast} onDismiss={clearToast} ariaLabel="打点反馈" className="mx-4 mt-2" />
      <Timeline
        slots={slots}
        onGapClick={(startTime, endTime) =>
          navigate(
            `/entries/new?date=${encodeURIComponent(date)}&start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}`,
          )
        }
        onEntryClick={(entry) => navigate(`/entries/${entry.id}/edit`)}
      />
    </>
  );
}
