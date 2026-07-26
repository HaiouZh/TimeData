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
  // 这个 effect 同时是把 state 从 loading 拉出来的**唯一**出口：下面守卫的拒绝分支是裸 return、
  // 不写任何 state，而 toggle() 只在 state.kind === "idle" 时才重发请求。一旦这个 effect 不来
  //（比如以后有人给它加条件、或把 epoch 依赖改窄），这块会永久停在「读取中…」，用户反复点也不重发。
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

export function DiaryRefLookback({ date, isToday }: { date: string; isToday: boolean }) {
  // 单调递增世代号：日期字符串比较在 A→B→A 序列下会失效（ABA），必须用只增不减的计数。
  //
  // 注意这是**渲染期的累积型副作用**：react-router 7 把导航 setState 包进 startTransition，
  // 渲染可被中断丢弃重试，而 ref 不随渲染丢弃回滚——这一句会多跑，epoch 可能在日期没变时跳 2，
  // 于是回看块自己收起并丢掉已加载的正文。区别在幂等性：`lastDateRef.current = date` 这种**赋值**
  // 重跑几次结果一样（幂等），`+= 1` 这种**累积**重跑就多加（不幂等）。
  // 后来人别在渲染期再加累积型副作用；要加请挪进 effect 或 useSyncExternalStore。
  const epochRef = useRef(0);
  const lastDateRef = useRef(date);
  if (lastDateRef.current !== date) {
    lastDateRef.current = date;
    epochRef.current += 1;
  }
  const epoch = epochRef.current;

  const yesterday = addDays(date, -1);
  const lastWeek = addDays(date, -7);

  // 看历史日期时不能说「昨天 / 上周今日」——上半区标题已经写着「7月20日」，再说「7月19日是昨天」
  // 就是同屏两句互相矛盾的话。数据口径本来就是相对 date 的（§5.2），错的只是措辞，改成不带
  // 绝对时间断言的相对说法。
  const prevDayLabel = isToday ? "昨天" : "前一天";
  const prevWeekLabel = isToday ? "上周今日" : "前七天";

  return (
    <div className="space-y-0.5">
      <LookbackEntry date={yesterday} label={`${prevDayLabel} ${formatMonthDay(yesterday)}`} epoch={epoch} />
      <LookbackEntry date={lastWeek} label={`${prevWeekLabel} ${formatMonthDay(lastWeek)}`} epoch={epoch} />
    </div>
  );
}
