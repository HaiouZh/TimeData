import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CircularTimeline from "../components/CircularTimeline.tsx";
import DateNav from "../components/DateNav.tsx";
import SyncIndicator from "../components/SyncIndicator.tsx";
import Timeline from "../components/Timeline.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useEntries } from "../hooks/useEntries.ts";
import { useMidnightTick } from "../hooks/useMidnightTick.ts";
import { getMergeOvernightEnabled } from "../lib/overnightDisplaySetting.ts";
import { buildTimeSlots, getDateString } from "../lib/time.ts";

interface TimelinePageProps {
  refreshKey?: number;
}

export default function TimelinePage({ refreshKey = 0 }: TimelinePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [midnightTick, setMidnightTick] = useState(0);
  useMidnightTick(() => setMidnightTick((value) => value + 1));
  const now = useMemo(() => new Date(), [refreshKey, midnightTick]);
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
  const { syncIfStale } = useSyncContext();

  useEffect(() => {
    void syncIfStale();
  }, [syncIfStale]);

  useEffect(() => {
    setDate(normalizedQueryDate);
  }, [normalizedQueryDate]);

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
  }

  return (
    <>
      <DateNav date={date} onDateChange={handleDateChange} />
      <CircularTimeline
        date={date}
        slots={slots}
        onEntryOpen={(entry) => navigate(`/entries/${entry.id}/edit`)}
        onGapOpen={(startTime, endTime) =>
          navigate(`/entries/new?start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}`)
        }
        overlay={<SyncIndicator />}
      />
      <Timeline
        slots={slots}
        onGapClick={(startTime, endTime) =>
          navigate(`/entries/new?start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}`)
        }
        onEntryClick={(entry) => navigate(`/entries/${entry.id}/edit`)}
      />
    </>
  );
}
