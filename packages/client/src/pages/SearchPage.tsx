import { CaretLeft, CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { TimeEntry } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { db } from "../db/index.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { useDebouncedValue } from "../hooks/useDebouncedValue.ts";
import { collectCategoryTreeIds } from "../lib/categoryTree.ts";
import {
  buildSearchRange,
  formatSearchRangeLabel,
  type SearchRangeMode,
  shiftSearchAnchor,
} from "../lib/entrySearch/range.ts";
import { filterSearchEntries, summarizeSearchEntries } from "../lib/entrySearch/filter.ts";
import { parseSearchUrlState, type SearchUrlState, toSearchUrlParams } from "../lib/entrySearch/urlState.ts";
import { parseSearchTerms } from "../quick-notes/searchTerms.ts";
import { formatMinutesDuration, formatTime, formatWeekday, getDateString } from "../lib/time.ts";
import { CategoryPickerSheet } from "./search/CategoryPickerSheet.js";

const SEARCH_PAGE_SIZE = 100;
const MODE_LABELS: Record<SearchRangeMode, string> = { all: "全", year: "年", month: "月", week: "周" };
const MODE_UNITS: Record<SearchRangeMode, string> = { all: "", year: "年", month: "月", week: "周" };

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getDateString(new Date());
  const state = parseSearchUrlState(searchParams, today);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(state.query.length > 0);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE_SIZE);

  const { categories, parentCategories, getChildren, getCategoryPath, getCategoryColor } = useCategories();

  // 筛选状态一律 replace 写回：push 会让改十次筛子往历史塞十条，返回键要连按十几次才出得去。
  function updateState(patch: Partial<SearchUrlState>): void {
    setSearchParams(toSearchUrlParams({ ...state, ...patch }, today), { replace: true });
    setVisibleCount(SEARCH_PAGE_SIZE);
  }

  const range = useMemo(() => buildSearchRange(state.mode, state.anchor), [state.mode, state.anchor]);
  const debouncedQuery = useDebouncedValue(state.query, 200);
  const terms = useMemo(() => parseSearchTerms(debouncedQuery), [debouncedQuery]);
  const categoryIds = useMemo(
    () => (state.categoryId ? collectCategoryTreeIds(categories, state.categoryId) : null),
    [categories, state.categoryId],
  );

  const rawEntries =
    useLiveQuery(async () => {
      if (range.startUtc === null || range.endUtc === null) return db.timeEntries.toArray();
      return db.timeEntries.where("startTime").between(range.startUtc, range.endUtc, true, false).toArray();
    }, [range.startUtc, range.endUtc]) ?? [];

  const matched = useMemo(
    () => filterSearchEntries(rawEntries, { range, categoryIds, terms }),
    [rawEntries, range, categoryIds, terms],
  );
  // 汇总永远按完整匹配集算——按当前页算的话，「显示更多」会让四个数跟着变，那就是 bug。
  const summary = useMemo(() => summarizeSearchEntries(matched), [matched]);
  const visible = matched.slice(0, visibleCount);
  const hiddenCount = matched.length - visible.length;

  const categoryLabel = state.categoryId ? getCategoryPath(state.categoryId) : "全部分类";
  const rangeLabel = formatSearchRangeLabel(state.mode, state.anchor, today);

  const groups = useMemo(() => {
    const byDate = new Map<string, TimeEntry[]>();
    for (const entry of visible) {
      const date = getDateString(new Date(entry.startTime));
      const list = byDate.get(date);
      if (list) list.push(entry);
      else byDate.set(date, [entry]);
    }
    return [...byDate.entries()];
  }, [visible]);

  return (
    <div className="min-h-full bg-page pb-6 text-ink">
      <header className="bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="grid size-11 shrink-0 place-items-center rounded-pill text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={CaretLeft} size={18} />
          </button>
          <h2 className="shrink-0 td-text-title">搜索</h2>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="ml-auto flex min-h-11 min-w-0 items-center gap-1.5 rounded-pill border border-border bg-surface-elevated px-3 td-text-body text-ink"
          >
            {state.categoryId && (
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getCategoryColor(state.categoryId) }}
              />
            )}
            <span className="truncate">{categoryLabel}</span>
          </button>
          <button
            type="button"
            aria-label={searchOpen ? "收起搜索" : "搜索备注"}
            onClick={() => {
              if (searchOpen) updateState({ query: "" });
              setSearchOpen((open) => !open);
            }}
            className="grid size-11 shrink-0 place-items-center rounded-pill text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={searchOpen ? X : MagnifyingGlass} size={18} />
          </button>
        </div>

        {searchOpen && (
          <input
            type="search"
            value={state.query}
            onChange={(event) => updateState({ query: event.target.value })}
            placeholder="搜索备注"
            aria-label="搜索备注"
            className="mt-2 min-h-11 w-full rounded-row border border-border bg-surface-elevated px-3 td-text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        )}

        {pickerOpen && (
          <div className="mt-2">
            <CategoryPickerSheet
              parentCategories={parentCategories}
              getChildren={getChildren}
              selectedId={state.categoryId}
              onSelect={(categoryId) => updateState({ categoryId })}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}
      </header>

      <section className="bg-surface px-3 pb-3">
        <div className="grid grid-cols-4 gap-1 rounded-pill border border-border bg-surface-elevated p-1">
          {(["all", "year", "month", "week"] as SearchRangeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.mode === mode}
              onClick={() => updateState({ mode })}
              className={`min-h-11 rounded-xl td-text-body font-medium transition ${
                state.mode === mode ? "bg-accent text-page" : "text-ink-2 hover:text-ink"
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          {/* all 档没有可翻的区间，两个箭头一起隐藏（linsen 同款行为）。 */}
          {state.mode !== "all" && (
            <button
              type="button"
              aria-label={`上一${MODE_UNITS[state.mode]}`}
              onClick={() => updateState({ anchor: shiftSearchAnchor(state.mode, state.anchor, -1) })}
              className="grid size-11 place-items-center rounded-pill text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              <Icon icon={CaretLeft} size={16} />
            </button>
          )}
          <span className="min-w-24 text-center td-text-body font-medium text-ink">{rangeLabel}</span>
          {state.mode !== "all" && (
            <button
              type="button"
              aria-label={`下一${MODE_UNITS[state.mode]}`}
              onClick={() => updateState({ anchor: shiftSearchAnchor(state.mode, state.anchor, 1) })}
              className="grid size-11 place-items-center rounded-pill text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              <Icon icon={CaretRight} size={16} />
            </button>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            { label: "天数", value: String(summary.dayCount) },
            { label: "时长", value: formatMinutesDuration(summary.totalMinutes) },
            { label: "日均时长", value: formatMinutesDuration(summary.avgMinutesPerDay) },
            { label: "次数", value: String(summary.entryCount) },
          ].map((cell) => (
            <div key={cell.label}>
              <dt className="td-text-caption text-ink-3">{cell.label}</dt>
              <dd className="td-num mt-0.5 td-text-title text-ink">{cell.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {matched.length === 0 ? (
        <p className="px-4 py-12 text-center td-text-body text-ink-3">这个范围里没有匹配的记录</p>
      ) : (
        <div>
          {groups.map(([date, entries]) => (
            <div key={date}>
              <h3 className="bg-page px-4 py-2 td-text-caption text-ink-3">
                {date} {formatWeekday(date)}
              </h3>
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => navigate(`/entries/${entry.id}/edit`)}
                  className="flex min-h-11 w-full items-center gap-2 border-b border-border bg-surface px-4 py-2 text-left td-text-body hover:bg-surface-hover"
                >
                  <span className="td-time shrink-0 text-ink-2">
                    {formatTime(entry.startTime)}~{formatTime(entry.endTime)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: getCategoryColor(entry.categoryId) }}
                  />
                  <span className="truncate text-ink">{getCategoryPath(entry.categoryId)}</span>
                  <span className="ml-auto shrink-0 text-ink-3">
                    {formatMinutesDuration(
                      (new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000,
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + SEARCH_PAGE_SIZE)}
              className="min-h-11 w-full py-3 text-center td-text-body text-accent"
            >
              还有 {hiddenCount} 条 · 显示更多
            </button>
          )}
        </div>
      )}
    </div>
  );
}
