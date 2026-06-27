import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { addDays, formatMonthDay, formatWeekday, getDateString } from "../lib/time.ts";
import { Icon } from "./Icon.js";

interface DateNavProps {
  date: string;
  onDateChange: (date: string) => void;
}

const arrowClass =
  "rounded-lg px-4 py-2.5 text-lg leading-none text-ink-3 transition-colors hover:bg-surface-hover hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3";

export default function DateNav({ date, onDateChange }: DateNavProps) {
  const today = getDateString(new Date());
  const isToday = date === today;
  const weekday = formatWeekday(date);

  return (
    <div className="flex items-center justify-between bg-surface px-2 py-2">
      <button onClick={() => onDateChange(addDays(date, -1))} className={arrowClass} aria-label="前一天">
        <Icon icon={CaretLeft} size={18} />
      </button>
      <div className="relative rounded-lg px-2 py-1 text-center focus-within:ring-2 focus-within:ring-accent">
        <span className="td-time text-lg font-medium text-ink">{formatMonthDay(date)}</span>
        <span className="ml-2 text-sm text-ink-2">{isToday ? "今天" : weekday}</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(event) => {
            if (event.target.value) onDateChange(event.target.value);
          }}
          onClick={(event) => {
            // 桌面端点击文本区不会自动弹出，主动调起；移动端原生聚焦已会弹出。
            const input = event.currentTarget;
            if (typeof input.showPicker === "function") {
              try {
                input.showPicker();
              } catch {
                // 需用户手势或环境不支持时忽略，回退到原生聚焦行为
              }
            }
          }}
          aria-label="选择日期"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <button onClick={() => onDateChange(addDays(date, 1))} className={arrowClass} disabled={isToday} aria-label="后一天">
        <Icon icon={CaretRight} size={18} />
      </button>
    </div>
  );
}
