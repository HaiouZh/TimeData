import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ErrorBoundary } from "../../../components/ErrorBoundary.js";
import { Icon } from "../../../components/Icon.js";
import { DateField } from "../../../components/ui/DateField.js";
import { PageBackButton } from "../../../components/ui/PageBackButton.js";
import { useNowMinute } from "../../../hooks/useNowMinute.js";
import { type DiaryBatchResult, fetchDiaryBatch } from "../../../lib/diary/diaryApi.js";
import { resolveDiaryDate } from "../../../lib/diary/diaryDate.js";
import { modeADates, modeBDates, modeCDates } from "../../../lib/diary/reviewDates.js";
import {
  getReviewLayoutB,
  getReviewMode,
  getReviewYearRange,
  type ReviewLayoutB,
  type ReviewMode,
  setReviewLayoutB,
  setReviewMode,
  setReviewYearRange,
  YEAR_RANGE_MAX,
  YEAR_RANGE_MIN,
} from "../../../lib/diary/reviewPrefs.js";
import { addDays, formatMonthDay, formatWeekday, getDateString } from "../../../lib/time.js";
import { useIsWideScreen } from "../../../lib/useIsWideScreen.js";
import ReviewCard from "./ReviewCard.js";
import WeekColumn from "./WeekColumn.js";

const MODE_LABELS: Record<ReviewMode, string> = {
  A: "今天",
  B: "回顾",
  C: "周览",
};

function yearLabel(date: string): string {
  const [year, ...rest] = date.split("-");
  return `${year}年${Number(rest[0])}月${Number(rest[1])}日`;
}

function monthDayWeekdayLabel(date: string): string {
  return `${formatMonthDay(date)}${formatWeekday(date)}`;
}

export default function DiaryReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 与 DiaryPage handleBack 同款手法：挂载那一刻冻结，避免切 ?date= 产生的新历史条目
  // 把"无历史"误判成"有历史"。
  const landedWithoutHistoryRef = useRef(location.key === "default");
  const [searchParams, setSearchParams] = useSearchParams();
  const wide = useIsWideScreen();

  const [mode, setMode] = useState<ReviewMode>(() => getReviewMode());
  const [layoutB, setLayoutB] = useState<ReviewLayoutB>(() => getReviewLayoutB());
  // state 而非每次渲染重读 localStorage：改年数要能触发 effect 重发 batch（否则新增
  // 那几年的卡片永远停在无数据）。
  const [yearRange, setYearRange] = useState<number>(() => getReviewYearRange());

  const liveToday = getDateString(useNowMinute());
  // 回顾页只读，无跨天丢稿问题，followAnchor 直接传实时今天即可。
  const { date: anchor, clearParam } = resolveDiaryDate({
    param: searchParams.get("date"),
    liveToday,
    followAnchor: liveToday,
  });

  useEffect(() => {
    if (!clearParam) return;
    setSearchParams({}, { replace: true });
  }, [clearParam, setSearchParams]);

  const [batch, setBatch] = useState<DiaryBatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const modeA = mode === "A" ? modeADates(anchor, yearRange) : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        let dates: string[] = [];
        let weeks: string[] | undefined;
        if (mode === "A") {
          const { left, right } = modeADates(anchor, yearRange);
          dates = Array.from(new Set([...left, ...right]));
        } else if (mode === "B") {
          dates = modeBDates(anchor);
        } else {
          const { lastWeek, thisWeek } = modeCDates(anchor);
          dates = [...lastWeek.days, ...thisWeek.days];
          weeks = [lastWeek.key, thisWeek.key];
        }
        const result = await fetchDiaryBatch({ dates, weeks });
        if (cancelled) return;
        setBatch(result);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载失败");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, anchor, retryNonce, yearRange]);

  function handleModeChange(next: ReviewMode) {
    setMode(next);
    setReviewMode(next);
  }

  function goToDate(next: string) {
    if (next === liveToday) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ date: next }, { replace: true });
    }
  }

  function step(delta: number) {
    const stepDays = mode === "C" ? 7 * delta : delta;
    goToDate(addDays(anchor, stepDays));
  }

  function handleBack() {
    if (landedWithoutHistoryRef.current) navigate("/diary", { replace: true });
    else navigate(-1);
  }

  function handleRetry() {
    setRetryNonce((n) => n + 1);
  }

  function handleYearRangeChange(next: number) {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(YEAR_RANGE_MAX, Math.max(YEAR_RANGE_MIN, Math.trunc(next)));
    setYearRange(clamped);
    setReviewYearRange(clamped);
  }

  function toggleLayoutB() {
    const next: ReviewLayoutB = layoutB === "grid" ? "list" : "grid";
    setLayoutB(next);
    setReviewLayoutB(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-page/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <PageBackButton onClick={handleBack} />
          <h1 className="min-w-0 flex-1 truncate td-text-body font-medium text-ink">日记回顾</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <div className="flex items-center gap-1 rounded-pill border border-border bg-surface p-1">
            {(["A", "B", "C"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => handleModeChange(m)}
                className={`rounded-pill px-3 py-1 td-text-caption font-medium transition ${
                  mode === m ? "bg-accent text-page" : "text-ink-2 hover:text-ink"
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="w-40 shrink-0">
            <DateField
              value={anchor}
              max={liveToday}
              ariaLabel="选择日期"
              onChange={(next) => {
                if (next) goToDate(next);
              }}
              portal
              className="min-h-8 rounded-ctl bg-surface px-2 py-1 td-text-caption text-ink"
            />
          </div>
          <button
            type="button"
            aria-label="上一段"
            onClick={() => step(-1)}
            className="flex size-8 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={CaretLeft} size={16} />
          </button>
          <button
            type="button"
            aria-label="下一段"
            onClick={() => step(1)}
            className="flex size-8 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={CaretRight} size={16} />
          </button>
          {anchor !== liveToday && (
            <button
              type="button"
              onClick={() => goToDate(liveToday)}
              className="rounded-pill border border-accent bg-accent-soft px-3 py-1 td-text-caption font-medium text-accent"
            >
              回到今天
            </button>
          )}
          {mode === "A" && (
            <label className="flex items-center gap-1 rounded-pill border border-border bg-surface px-3 py-1 td-text-caption text-ink-2">
              显示年份数
              <input
                type="number"
                aria-label="显示年份数"
                min={YEAR_RANGE_MIN}
                max={YEAR_RANGE_MAX}
                value={yearRange}
                onChange={(event) => handleYearRangeChange(Number(event.target.value))}
                className="w-12 bg-transparent td-text-caption text-ink focus:outline-none"
              />
            </label>
          )}
          {mode === "B" && wide && (
            <button
              type="button"
              aria-label={layoutB === "grid" ? "切换为列表布局" : "切换为网格布局"}
              onClick={toggleLayoutB}
              className="rounded-pill border border-border bg-surface px-3 py-1 td-text-caption font-medium text-ink-2 transition hover:text-ink"
            >
              {layoutB === "grid" ? "切换为列表" : "切换为网格"}
            </button>
          )}
        </div>
      </header>

      {/* 错误条叠加在内容之上，不替换内容区：batch 失败时已有卡片继续可读。 */}
      {error && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 td-text-body text-danger">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-ctl border border-danger/40 bg-surface px-3 py-1 td-text-body font-medium text-danger"
          >
            重试
          </button>
        </div>
      )}
      {/* 单块渲染失败（畸形 markdown 等）不掀整页：内容区套 ErrorBoundary。
          key 随模式/日期/重试变化 → 边界重挂、hasError 复位，换一天就能恢复，
          否则一次异常会把内容区永久钉死在 fallback 上，只能整页刷新。 */}
      <ErrorBoundary
        key={`${mode}-${anchor}-${retryNonce}`}
        fallback={(err) => (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 td-text-body text-danger">
            <p>这段内容渲染失败：{err.message}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-ctl border border-danger/40 bg-surface px-3 py-1 td-text-body font-medium text-danger"
            >
              重试
            </button>
          </div>
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {mode === "A" && modeA && (
            <div className={wide ? "grid grid-cols-[1fr_auto_1fr]" : "grid grid-cols-1"}>
              <div className="flex flex-col gap-3">
                {wide &&
                  modeA.left.map((date) => (
                    <ReviewCard
                      key={date}
                      date={date}
                      label={yearLabel(date)}
                      entry={batch?.dates[date]}
                      loading={loading}
                    />
                  ))}
              </div>
              {wide && <div className="mx-1 w-px bg-border" />}
              <div className="flex flex-col gap-3">
                {modeA.right.map((date) => (
                  <ReviewCard
                    key={date}
                    date={date}
                    label={yearLabel(date)}
                    entry={batch?.dates[date]}
                    loading={loading}
                  />
                ))}
              </div>
            </div>
          )}
          {mode === "B" && (
            <div
              className={
                wide && layoutB === "grid" ? "grid grid-cols-3 gap-3" : "flex flex-col gap-3"
              }
            >
              {modeBDates(anchor).map((date) => (
                <ReviewCard
                  key={date}
                  date={date}
                  label={monthDayWeekdayLabel(date)}
                  entry={batch?.dates[date]}
                  loading={loading}
                />
              ))}
            </div>
          )}
          {mode === "C" && (() => {
            const { lastWeek, thisWeek } = modeCDates(anchor);
            const columns = {
              last: (
                <WeekColumn
                  title="上周"
                  weekKey={lastWeek.key}
                  weekEntry={batch?.weeks[lastWeek.key]}
                  weeklyConfigured={batch?.weeklyConfigured ?? false}
                  days={lastWeek.days}
                  entries={batch?.dates ?? {}}
                  liveToday={liveToday}
                  loading={loading}
                />
              ),
              this: (
                <WeekColumn
                  title="本周"
                  weekKey={thisWeek.key}
                  weekEntry={batch?.weeks[thisWeek.key]}
                  weeklyConfigured={batch?.weeklyConfigured ?? false}
                  days={thisWeek.days}
                  entries={batch?.dates ?? {}}
                  liveToday={liveToday}
                  loading={loading}
                />
              ),
            };
            // 宽屏：左上周 / 右本周。窄屏：单栏纵向，本周在前、上周在后——
            // spec 是「本周在前」的排序要求，不是「只留本周」（那条只写给模式 A）。
            return wide ? (
              <div className="grid grid-cols-[1fr_auto_1fr]">
                {columns.last}
                <div className="mx-1 w-px bg-border" />
                {columns.this}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {columns.this}
                {columns.last}
              </div>
            );
          })()}
        </div>
      </ErrorBoundary>
    </div>
  );
}
