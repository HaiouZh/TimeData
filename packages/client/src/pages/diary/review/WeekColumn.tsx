import { Link } from "react-router";
import type { DiaryBatchEntry } from "../../../lib/diary/diaryApi.js";
import { formatMonthDay, formatWeekday } from "../../../lib/time.js";
import DiaryMarkdown from "./DiaryMarkdown.js";
import ReviewCard from "./ReviewCard.js";

interface WeekColumnProps {
  title: string;
  weekKey: string;
  weekEntry: DiaryBatchEntry | undefined;
  weeklyConfigured: boolean;
  days: string[];
  entries: Record<string, DiaryBatchEntry>;
  liveToday: string;
  /** 请求进行中：周记区与日卡都显示加载态，别用「未配置 / 无内容」误报结论。 */
  loading: boolean;
}

export default function WeekColumn({
  title,
  weekKey,
  weekEntry,
  weeklyConfigured,
  days,
  entries,
  liveToday,
  loading,
}: WeekColumnProps) {
  const weekExists = Boolean(weekEntry?.exists);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="td-text-caption font-medium text-ink-2">{title}</h2>
      <div className="rounded-ctl border border-border bg-surface px-3 py-2">
        {loading ? (
          <p className="td-text-caption text-ink-3">加载中…</p>
        ) : !weeklyConfigured ? (
          <p className="td-text-caption text-ink-3">
            未配置周记路径模板，去{" "}
            <Link to="/settings/diary" className="text-accent-ink underline">
              设置 · 日记
            </Link>{" "}
            配置一个吧
          </p>
        ) : weekExists ? (
          <DiaryMarkdown content={weekEntry?.content ?? ""} />
        ) : (
          <p className="td-text-caption text-ink-3">无本周周记</p>
        )}
      </div>
      <div className="flex flex-col gap-3" data-week-key={weekKey}>
        {days.map((date) => (
          <ReviewCard
            key={date}
            date={date}
            label={`${formatMonthDay(date)}${formatWeekday(date)}`}
            entry={entries[date]}
            loading={loading}
            future={date > liveToday}
          />
        ))}
      </div>
    </div>
  );
}
