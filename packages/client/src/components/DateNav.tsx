import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { addDays, formatMonthDay, formatWeekday, getDateString } from "../lib/time.ts";
import { Icon } from "./Icon.js";
import { DateField } from "./ui/DateField.js";

interface DateNavProps {
  date: string;
  onDateChange: (date: string) => void;
  onSearch?: () => void;
  /**
   * 本页窄屏另有横滑切日时传 true：左右箭头改为只在宽屏出现，窄屏把那 72px 让给内容
   * （桌面没有横滑，所以宽屏一定保留）。**没有横滑的页面绝不能传**——日记页就没有，
   * 传了会让它窄屏只剩「点日期开月历」一条切日路径。
   */
  narrowSwipeSwitchesDate?: boolean;
}

const ARROW_BASE =
  "hotarea-md rounded-ctl leading-none text-ink-3 transition-colors hover:bg-surface-hover hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3";
const ARROW_WIDE_ONLY = " hidden sm:inline-flex sm:items-center sm:justify-center";

export default function DateNav({ date, onDateChange, onSearch, narrowSwipeSwitchesDate }: DateNavProps) {
  const today = getDateString(new Date());
  const isToday = date === today;
  const weekday = formatWeekday(date);
  const arrowClass = narrowSwipeSwitchesDate ? ARROW_BASE + ARROW_WIDE_ONLY : ARROW_BASE;

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
        <button onClick={() => onDateChange(addDays(date, -1))} className={arrowClass} aria-label="前一天">
          <Icon icon={CaretLeft} size={18} />
        </button>
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
