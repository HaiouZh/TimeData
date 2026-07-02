import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CircularTimeline from "../components/CircularTimeline.tsx";
import DateNav from "../components/DateNav.tsx";
import SyncIndicator from "../components/SyncIndicator.tsx";
import Timeline from "../components/Timeline.tsx";
import { useEntries } from "../hooks/useEntries.ts";
import { useMidnightTick } from "../hooks/useMidnightTick.ts";
import { getMergeOvernightEnabled } from "../lib/overnightDisplaySetting.ts";
import { punchNow } from "../lib/punch.ts";
import { buildTimeSlots, getDateString } from "../lib/time.ts";

export default function TimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [, setMidnightTick] = useState(0);
  useMidnightTick(() => setMidnightTick((value) => value + 1));
  const now = new Date();
  const today = getDateString(now);
  const queryDate = searchParams.get("date");
  const normalizedQueryDate = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) ? queryDate : today;
  const [date, setDate] = useState(normalizedQueryDate);
  const { entries, previousEntry } = useEntries(date);
  const mergeOvernight = getMergeOvernightEnabled();
  const navigate = useNavigate();
  const slots = useMemo(
    () => buildTimeSlots(entries, date, 0, { previousEntry, mergeOvernight, now }),
    [date, entries, mergeOvernight, now, previousEntry],
  );
  const [punchMessage, setPunchMessage] = useState<string | null>(null);

  useEffect(() => {
    setDate(normalizedQueryDate);
  }, [normalizedQueryDate]);

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
  }

  async function handlePunch() {
    const result = await punchNow();
    if (!result.ok) {
      setPunchMessage(result.reason === "no_range" ? "距上次记录还没有时间" : "请先在设置 · 记录偏好选择打点分类");
      return;
    }
    setPunchMessage(null);
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
      {punchMessage && <p className="px-4 pt-2 text-center text-xs text-warn">{punchMessage}</p>}
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
