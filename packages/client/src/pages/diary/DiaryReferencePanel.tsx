import type { ReactNode } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary.js";
import { formatMonthDay } from "../../lib/time.js";

import { DiaryRefDoneTasks } from "./DiaryRefDoneTasks.js";
import { DiaryRefLookback } from "./DiaryRefLookback.js";
import { DiaryRefPunches } from "./DiaryRefPunches.js";
import { DiaryRefQuickNotes } from "./DiaryRefQuickNotes.js";

export interface DiaryReferencePanelProps {
  date: string;
  isToday: boolean;
}

/**
 * 每块各围一层围栏。`useLiveQuery` 的 error 通道就是「在 render 里 throw」，不围的话最近的
 * 边界是根路由的 errorElement——它会把整个 app shell 换成「应用出错了」，而日记正文只活在
 * DiaryPage 的 React state（不进 Dexie、不进同步域），整页一掀就永久丢了。逐块围而不是整栏围一层，
 * 是为了兑现契约 15 的字面：一块挂了另外三块照常显示。
 */
function RefBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={() => <p className="px-2 py-1 td-text-caption text-danger">{label}读取失败</p>}>
      {children}
    </ErrorBoundary>
  );
}

export function DiaryReferencePanel({ date, isToday }: DiaryReferencePanelProps) {
  return (
    <div className="space-y-5 px-3 py-4" data-testid="diary-reference-panel">
      <section className="space-y-1">
        <h2 className="px-2 td-text-label font-medium text-ink-3">{isToday ? "今天" : formatMonthDay(date)}</h2>
        <RefBlock label="打点">
          <DiaryRefPunches date={date} />
        </RefBlock>
        <RefBlock label="完成的待办">
          <DiaryRefDoneTasks date={date} />
        </RefBlock>
        <RefBlock label="速记">
          <DiaryRefQuickNotes date={date} />
        </RefBlock>
      </section>
      <section className="space-y-1 border-t border-border pt-4">
        <h2 className="px-2 td-text-label font-medium text-ink-3">回看</h2>
        <RefBlock label="回看">
          <DiaryRefLookback date={date} isToday={isToday} />
        </RefBlock>
      </section>
    </div>
  );
}
