import { CaretRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { fetchDiary } from "../../lib/diary/diaryApi.js";
import { addDays, formatMonthDay } from "../../lib/time.js";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; content: string }
  | { kind: "error" };

function LookbackEntry({ date, label, epoch }: { date: string; label: string; epoch: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  // 每次渲染同步赋值：异步回调靠它读“当前最新世代”，而不是发起时冻结的闭包值。
  const epochRef = useRef(epoch);
  epochRef.current = epoch;

  // 世代变了（外层日期换了）→ 收起并丢弃已拉到的内容，避免把上一个日期的正文留在屏幕上。
  useEffect(() => {
    setOpen(false);
    setState({ kind: "idle" });
  }, [epoch]);

  async function load() {
    const epochAtRequest = epochRef.current;
    setState({ kind: "loading" });
    try {
      const doc = await fetchDiary(date);
      if (epochRef.current !== epochAtRequest) return; // 日期已变，这份响应作废
      setState({ kind: "loaded", content: doc.content });
    } catch {
      if (epochRef.current !== epochAtRequest) return;
      setState({ kind: "error" });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // 只在首次展开时请求；已加载过就不再重复拉。
    if (next && state.kind === "idle") void load();
  }

  return (
    <div className="rounded-xl">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-2 text-left td-text-label font-medium text-ink-2"
      >
        <span
          className={`inline-flex text-ink-3 transition-transform duration-150${open ? " rotate-90" : ""}`}
        >
          <Icon icon={CaretRight} size={14} />
        </span>
        <span className="flex-1">{label}</span>
      </button>
      {open && (
        <div className="mt-1 px-2 pb-1">
          {state.kind === "loading" && <p className="td-text-caption text-ink-3">读取中…</p>}
          {state.kind === "error" && (
            <button
              type="button"
              onClick={() => void load()}
              className="td-text-caption text-danger underline underline-offset-2"
            >
              读取失败 · 重试
            </button>
          )}
          {state.kind === "loaded" &&
            (state.content.trim() === "" ? (
              <p className="td-text-caption text-ink-3">这天没写日记</p>
            ) : (
              <p className="whitespace-pre-wrap td-text-caption text-ink-2">{state.content}</p>
            ))}
        </div>
      )}
    </div>
  );
}

export function DiaryRefLookback({ date }: { date: string }) {
  // 单调递增世代号：日期字符串比较在 A→B→A 序列下会失效（ABA），必须用只增不减的计数。
  const epochRef = useRef(0);
  const lastDateRef = useRef(date);
  if (lastDateRef.current !== date) {
    lastDateRef.current = date;
    epochRef.current += 1;
  }
  const epoch = epochRef.current;

  const yesterday = addDays(date, -1);
  const lastWeek = addDays(date, -7);

  return (
    <div className="space-y-0.5">
      <LookbackEntry date={yesterday} label={`昨天 ${formatMonthDay(yesterday)}`} epoch={epoch} />
      <LookbackEntry date={lastWeek} label={`上周今日 ${formatMonthDay(lastWeek)}`} epoch={epoch} />
    </div>
  );
}
