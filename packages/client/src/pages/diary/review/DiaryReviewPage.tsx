import { ArrowLeft, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Icon } from "../../../components/Icon.js";
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
} from "../../../lib/diary/reviewPrefs.js";
import { addDays, formatMonthDay, formatWeekday, getDateString } from "../../../lib/time.js";
import { useIsWideScreen } from "../../../lib/useIsWideScreen.js";
import ReviewCard from "./ReviewCard.js";
import WeekColumn from "./WeekColumn.js";

const CARD_MIN_HEIGHT = 160;

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
  const yearRange = getReviewYearRange();

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
    // biome-ignore lint: yearRange 来自 localStorage，非响应式 state，不需要作为依赖跟踪
  }, [mode, anchor, retryNonce]);

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

  function toggleLayoutB() {
    const next: ReviewLayoutB = layoutB === "grid" ? "list" : "grid";
    setLayoutB(next);
    setReviewLayoutB(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      <header className="sticky top-0 z-[var(--z-dropdown)] shrink-0 border-b border-border bg-page/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            aria-label="返回"
            onClick={handleBack}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink"
          >
            <Icon icon={ArrowLeft} size={16} />
          </button>
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
          <input
            type="date"
            aria-label="选择日期"
            value={anchor}
            max={liveToday}
            onChange={(event) => {
              if (event.target.value) goToDate(event.target.value);
            }}
            className="rounded-ctl border border-border bg-surface px-2 py-1 td-text-caption text-ink"
          />
          <button
            type="button"
            aria-label="上一段"
            onClick={() => step(-1)}
            className="flex size-8 items-center justify-center rounded-full text-ink-2 transition hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={CaretLeft} size={16} />
          </button>
          <button
            type="button"
            aria-label="下一段"
            onClick={() => step(1)}
            className="flex size-8 items-center justify-center rounded-full text-ink-2 transition hover:bg-surface-hover hover:text-ink"
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

      {error ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-danger/40 bg-danger-soft px-4 py-2 td-text-body text-danger">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-xl border border-danger/40 bg-surface px-3 py-1 td-text-body font-medium text-danger"
          >
            重试
          </button>
        </div>
      ) : (
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
                      minHeight={CARD_MIN_HEIGHT}
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
                    minHeight={CARD_MIN_HEIGHT}
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
                  minHeight={CARD_MIN_HEIGHT}
                />
              ))}
            </div>
          )}
          {mode === "C" && (() => {
            const { lastWeek, thisWeek } = modeCDates(anchor);
            return (
              <div className={wide ? "grid grid-cols-[1fr_auto_1fr]" : "grid grid-cols-1"}>
                {wide && (
                  <WeekColumn
                    title="上周"
                    weekKey={lastWeek.key}
                    weekEntry={batch?.weeks[lastWeek.key]}
                    weeklyConfigured={batch?.weeklyConfigured ?? false}
                    days={lastWeek.days}
                    entries={batch?.dates ?? {}}
                    liveToday={liveToday}
                  />
                )}
                {wide && <div className="mx-1 w-px bg-border" />}
                <WeekColumn
                  title="本周"
                  weekKey={thisWeek.key}
                  weekEntry={batch?.weeks[thisWeek.key]}
                  weeklyConfigured={batch?.weeklyConfigured ?? false}
                  days={thisWeek.days}
                  entries={batch?.dates ?? {}}
                  liveToday={liveToday}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
