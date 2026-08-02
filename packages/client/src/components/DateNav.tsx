import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { addDays, formatMonthDay, formatWeekday, getDateString } from "../lib/time.ts";
import { Icon } from "./Icon.js";
import { DateField } from "./ui/DateField.js";

interface DateNavProps {
  date: string;
  onDateChange: (date: string) => void;
  onSearch?: () => void;
}

const arrowClass =
  "hotarea-md rounded-ctl leading-none text-ink-3 transition-colors hover:bg-surface-hover hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3";

export default function DateNav({ date, onDateChange, onSearch }: DateNavProps) {
  const today = getDateString(new Date());
  const isToday = date === today;
  const weekday = formatWeekday(date);

  return (
    <div className="flex items-center justify-between bg-surface px-2 py-2">
      <button onClick={() => onDateChange(addDays(date, -1))} className={arrowClass} aria-label="前一天">
        <Icon icon={CaretLeft} size={18} />
      </button>
      <div className="min-w-0 flex-1 px-2">
        <DateField
          value={date}
          max={today}
          ariaLabel="选择日期"
          onChange={(next) => {
            if (next) onDateChange(next);
          }}
          portal
          className="justify-center border-0 bg-transparent px-2 py-1 text-center shadow-none hover:bg-surface-hover"
          formatValue={(value) => (
            <>
              <span className="td-time td-text-title font-medium text-ink">{formatMonthDay(value)}</span>
              <span className="ml-2 td-text-label text-ink-2">{isToday ? "今天" : weekday}</span>
            </>
          )}
        />
      </div>
      <div className="flex items-center">
        {!isToday && (
          <button
            type="button"
            onClick={() => onDateChange(today)}
            className="mr-1 min-h-9 rounded-pill border border-accent bg-accent-soft px-3 td-text-caption font-medium text-accent"
          >
            回到今天
          </button>
        )}
        <button onClick={() => onDateChange(addDays(date, 1))} className={arrowClass} disabled={isToday} aria-label="后一天">
          <Icon icon={CaretRight} size={18} />
        </button>
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            aria-label="搜索记录"
            className="hotarea-md rounded-ctl text-ink-3 transition-colors hover:bg-surface-hover hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon icon={MagnifyingGlass} size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
