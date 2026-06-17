import type { Task } from "@timedata/shared";
import { Bell, Circle } from "@phosphor-icons/react";
import { type ComponentProps, useEffect, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { turnBuckets } from "../../lib/tasks/turnTags.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TaskRow } from "./TaskRow.js";

export interface AttentionQueueProps {
  tasks: Task[];
  rowHandlers: Omit<ComponentProps<typeof TaskRow>, "task" | "pool">;
  onTurnChange: (task: Task, turn: Task["turn"]) => void;
  now?: Date;
}

function elapsedLabel(turnAt: string | null, now: Date): string {
  if (!turnAt) return "";
  const ms = now.getTime() - new Date(turnAt).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `已跑 ${mins} 分`;
  const hrs = Math.floor(mins / 60);
  return `已跑 ${hrs} 时 ${mins % 60} 分`;
}

export function AttentionQueue({ tasks, rowHandlers, onTurnChange, now }: AttentionQueueProps) {
  const [tick, setTick] = useState(0);
  const current = now ?? new Date();
  const buckets = turnBuckets(tasks, current);
  const hasContent = buckets.me.length > 0 || buckets.running.length > 0 || buckets.parked.length > 0;

  useEffect(() => {
    if (now || !hasContent) return; // 测试注入 now 时不挂 interval；空队列不挂
    const id = window.setInterval(() => setTick((v) => v + 1), 60000);
    return () => window.clearInterval(id);
  }, [now, hasContent]);

  if (!hasContent) return null;
  // tick 仅用于触发重渲染，读取即消费
  void tick;

  return (
    <section className="mb-4 space-y-3" data-testid="attention-queue">
      {buckets.me.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-ink-2">
            <Icon icon={Bell} size={14} />
            <span>等我处理 ({buckets.me.length})</span>
          </div>
          <div className="rounded-card bg-surface p-1.5">
            {buckets.me.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                pool="today"
                {...rowHandlers}
                onTurnChange={onTurnChange}
                turnBadgeInteractive
              />
            ))}
          </div>
        </div>
      )}
      {buckets.running.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-ink-3">
            <Icon icon={Circle} size={10} weight="fill" className="text-warn" />
            <span>在跑 ({buckets.running.length})</span>
          </div>
          <div className="rounded-card bg-surface p-1.5 opacity-70">
            {buckets.running.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-ink-2">
                <span className="break-words">{t.title}</span>
                <span className="shrink-0 text-xs text-ink-3">{elapsedLabel(t.turnAt, current)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {buckets.parked.length > 0 && (
        <CollapsibleSection title="搁置" count={buckets.parked.length}>
          <div className="rounded-card bg-surface p-1.5">
            {buckets.parked.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                pool="today"
                {...rowHandlers}
                onTurnChange={onTurnChange}
                turnBadgeInteractive
              />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </section>
  );
}
