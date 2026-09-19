import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { addDays, formatMonthDay, formatWeekday, getDateString } from "../lib/time.ts";
import { Icon } from "./Icon.js";
import { DateField } from "./ui/DateField.js";

interface DateNavProps {
  date: string;
  onDateChange: (date: string) => void;
  onSearch?: () => void;
}

/**
 * 左右箭头**在所有断点恒显**，不分宽窄屏。时间轴页一度把窄屏那份收成
 * `hidden sm:inline-flex`，理由是「本页有横滑切日兜底」——但它的圆环带着
 * `data-swipe-exempt`，手机上占屏最大的那块恰恰滑不动，横滑只剩顶部窄带和下方列表可落手。
 * 省下的 72px 也没被内容吃掉（日期那侧是 flex-1，本来就富余）。别再加回条件隐藏。
 */
const ARROW_CLASS =
  "hotarea-md rounded-ctl leading-none text-ink-3 transition-colors hover:bg-surface-hover hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3";

export default function DateNav({ date, onDateChange, onSearch }: DateNavProps) {
  const today = getDateString(new Date());
  const isToday = date === today;
  const weekday = formatWeekday(date);

  return (
    // 整条不带纵向内边距：高度由 DateField 触发钮的 min-h-11 单独决定（44px 触控底线，
    // invariants §2），再压就得牺牲可点性。原来的 py-2 是叠在这 44px 之上的净浪费。
    <div className="flex items-center bg-surface px-2">
      <div className="min-w-0 flex-1">
        <DateField
          value={date}
          max={today}
          ariaLabel="选择日期"
          onChange={(next) => {
            if (next) onDateChange(next);
          }}
          portal
          className="justify-start border-0 bg-transparent px-2 py-1 text-left shadow-none hover:bg-surface-hover"
          formatValue={(value) => (
            <>
              <span className="td-time td-text-title font-medium text-ink">{formatMonthDay(value)}</span>
              <span className="ml-2 td-text-label text-ink-2">{isToday ? "今天" : weekday}</span>
            </>
          )}
        />
      </div>
      <div className="flex shrink-0 items-center">
        {!isToday && (
          <button
            type="button"
            onClick={() => onDateChange(today)}
            className="mr-1 min-h-9 rounded-pill border border-accent bg-accent-soft px-3 td-text-caption font-medium text-accent"
          >
            回到今天
          </button>
        )}
        <button onClick={() => onDateChange(addDays(date, -1))} className={ARROW_CLASS} aria-label="前一天">
          <Icon icon={CaretLeft} size={18} />
        </button>
        <button onClick={() => onDateChange(addDays(date, 1))} className={ARROW_CLASS} disabled={isToday} aria-label="后一天">
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
