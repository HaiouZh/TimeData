import { useEffect, useState } from "react";
import { fetchDiary } from "../../lib/diary/diaryApi.js";
import { addDays, formatMonthDay } from "../../lib/time.js";
import { DiaryRefDoneTasks } from "./DiaryRefDoneTasks.js";
import { DiaryRefGuide } from "./DiaryRefGuide.js";
import { DiaryRefPunches } from "./DiaryRefPunches.js";
import { DiaryRefQuickNotes } from "./DiaryRefQuickNotes.js";
import { RefBlock } from "./DiaryReferencePanel.js";

type ActiveBlock = "punches" | "tasks" | "notes" | "yesterday" | "lastweek" | "guide";
/** 展开区最大高度：手机竖屏约小半屏，正文始终留在首屏（design §6.4）。常量内联 style 形制同 ReviewCard。 */
const ACTIVE_MAX_HEIGHT = "45dvh";

type LookState = { kind: "loading" } | { kind: "error" } | { kind: "loaded"; content: string };

/** 窄屏回看单块：chip 打开即挂载即请求（chip 本身就是展开动作，不再要块内第二次点击）。
 *  切日期时整个容器随 DiaryPage 的 loading 三元卸载重挂，天然作废在途响应；cancelled 兜组件自身卸载。 */
function MobileLookback({ date }: { date: string }) {
  const [state, setState] = useState<LookState>({ kind: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchDiary(date).then(
      (doc) => {
        if (!cancelled) setState({ kind: "loaded", content: doc.content });
      },
      () => {
        if (!cancelled) setState({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [date, retryNonce]);
  if (state.kind === "loading") return <p className="px-2 py-1 td-text-caption text-ink-3">读取中…</p>;
  if (state.kind === "error")
    return (
      <button
        type="button"
        onClick={() => setRetryNonce((n) => n + 1)}
        className="px-2 py-1 td-text-caption text-danger underline underline-offset-2"
      >
        读取失败 · 重试
      </button>
    );
  return state.content.trim() === "" ? (
    <p className="px-2 py-1 td-text-caption text-ink-3">这天没写日记</p>
  ) : (
    <p className="whitespace-pre-wrap px-2 py-1 td-text-caption text-ink-2">{state.content}</p>
  );
}

export function DiaryMobileRefBar({
  date,
  isToday,
  guideItems,
}: {
  date: string;
  isToday: boolean;
  guideItems: string[];
}) {
  const [active, setActive] = useState<ActiveBlock | null>(null);
  const yesterday = addDays(date, -1);
  const lastWeek = addDays(date, -7);
  const chips: { key: ActiveBlock; label: string }[] = [
    { key: "punches", label: "打点" },
    { key: "tasks", label: "待办" },
    { key: "notes", label: "速记" },
    { key: "yesterday", label: `${isToday ? "昨天" : "前一天"} ${formatMonthDay(yesterday)}` },
    { key: "lastweek", label: `${isToday ? "上周" : "前七天"} ${formatMonthDay(lastWeek)}` },
    ...(guideItems.length > 0 ? [{ key: "guide" as const, label: "引导" }] : []),
  ];
  return (
    <div className="shrink-0 border-b border-border bg-surface">
      <div className="flex gap-2 overflow-x-auto px-4 py-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-expanded={active === chip.key}
            onClick={() => setActive(active === chip.key ? null : chip.key)}
            className={`shrink-0 rounded-pill border px-3 py-1 td-text-caption transition ${
              active === chip.key ? "border-accent bg-accent-soft text-accent-ink" : "border-border bg-surface text-ink-2"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {active && (
        <div
          className="overflow-y-auto border-t border-border px-1 pb-2"
          style={{ maxHeight: ACTIVE_MAX_HEIGHT }}
          data-testid="diary-mobile-ref-active"
        >
          {active === "punches" && (
            <RefBlock label="打点">
              <DiaryRefPunches date={date} />
            </RefBlock>
          )}
          {active === "tasks" && (
            <RefBlock label="完成的待办">
              <DiaryRefDoneTasks date={date} />
            </RefBlock>
          )}
          {active === "notes" && (
            <RefBlock label="速记">
              <DiaryRefQuickNotes date={date} />
            </RefBlock>
          )}
          {active === "yesterday" && (
            <RefBlock label="回看">
              <MobileLookback date={yesterday} />
            </RefBlock>
          )}
          {active === "lastweek" && (
            <RefBlock label="回看">
              <MobileLookback date={lastWeek} />
            </RefBlock>
          )}
          {active === "guide" && (
            <RefBlock label="引导">
              <DiaryRefGuide items={guideItems} />
            </RefBlock>
          )}
        </div>
      )}
    </div>
  );
}
