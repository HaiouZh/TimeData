import { ArrowUp } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { useCallback, useMemo, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type { GravitySurfacedMap, TodoGravitySettings } from "../../lib/tasks/gravity.js";
import { pickGravityReviewBatch } from "../../lib/tasks/gravity.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TaskList } from "./TaskList.js";

interface GravityReviewSectionProps {
  sunkenTasks: Task[];
  settings: TodoGravitySettings;
  surfaced: GravitySurfacedMap;
  now?: Date;
  onMarkSurfaced: (ids: string[], now: Date) => Promise<GravitySurfacedMap> | GravitySurfacedMap;
  onBump: (task: Task) => void | Promise<void>;
  /** 被任一 active 目标引用的 task id 集合：命中的翻牌行也渲染「已有去处」竖条。 */
  goalLinkedIds?: ReadonlySet<string>;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToToday: (task: Task) => void;
  onToInbox: (task: Task) => void;
}

export function GravityReviewSection({
  sunkenTasks,
  settings,
  surfaced,
  now = new Date(),
  onMarkSurfaced,
  onBump,
  goalLinkedIds,
  ...rowHandlers
}: GravityReviewSectionProps) {
  const [batch, setBatch] = useState<Task[]>([]);
  const [pickedThisBatch, setPickedThisBatch] = useState<Set<string>>(() => new Set());
  // 本会话已展示过的牌，防止 settings 回流慢时「再翻几张」抽回刚展示过的任务。
  const [sessionSurfacedMap, setSessionSurfacedMap] = useState<GravitySurfacedMap>({});
  const remainingPicks = Math.max(0, settings.pickN - pickedThisBatch.size);

  const effectiveSurfaced = useMemo(() => ({ ...surfaced, ...sessionSurfacedMap }), [surfaced, sessionSurfacedMap]);

  const drawBatch = useCallback(
    (excludeIds: ReadonlySet<string> = new Set(), pickedIds: ReadonlySet<string> = new Set()) => {
      const candidates = sunkenTasks.filter((task) => !excludeIds.has(task.id));
      const nextBatch = pickGravityReviewBatch(candidates, effectiveSurfaced, { now, drawM: settings.drawM });
      setBatch(nextBatch);
      setPickedThisBatch(new Set(pickedIds));
      if (nextBatch.length === 0) return;

      const ids = nextBatch.map((task) => task.id);
      const optimistic = Object.fromEntries(ids.map((id) => [id, now.toISOString()]));
      setSessionSurfacedMap((prev) => ({ ...prev, ...optimistic }));
      void Promise.resolve(onMarkSurfaced(ids, now)).then(
        (stored) => {
          if (stored) setSessionSurfacedMap((prev) => ({ ...prev, ...stored }));
        },
        () => {
          // settings 写失败不阻塞 UI；最坏以后重复一次。
        },
      );
    },
    [effectiveSurfaced, now, onMarkSurfaced, settings.drawM, sunkenTasks],
  );

  const extraAction = useMemo(
    () => (task: Task) => {
      const picked = pickedThisBatch.has(task.id);
      const disabled = !picked && remainingPicks <= 0;
      return (
        <button
          type="button"
          aria-label={`顶一下 ${task.title}`}
          disabled={disabled || picked}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled || picked) return;
            const nextPicked = new Set([...pickedThisBatch, task.id]);
            setPickedThisBatch(nextPicked);
            void Promise.resolve(onBump(task)).then(() => {
              drawBatch(nextPicked, nextPicked.size >= settings.pickN ? new Set() : nextPicked);
            });
          }}
          className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-accent disabled:opacity-40"
        >
          <Icon icon={ArrowUp} size={16} />
        </button>
      );
    },
    [drawBatch, onBump, pickedThisBatch, remainingPicks, settings.pickN],
  );

  if (sunkenTasks.length === 0) return null;

  return (
    <section data-section="todo-gravity-review">
      <CollapsibleSection
        title={`水下 ${sunkenTasks.length} 条 · 给你备了 ${Math.min(settings.drawM, sunkenTasks.length)} 张`}
        count={remainingPicks}
        defaultOpen={false}
        onToggle={(open) => {
          if (open && batch.length === 0) drawBatch();
        }}
      >
        {batch.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">水下暂时没有可翻的任务</p>
        ) : (
          <div className="rounded-card bg-surface p-1.5">
            <TaskList
              pool="inbox"
              tasks={batch}
              extraAction={extraAction}
              childrenModeOverride="static"
              goalLinkedIds={goalLinkedIds}
              {...rowHandlers}
            />
            <button
              type="button"
              className="mt-1 w-full rounded-ctl px-3 py-1.5 text-xs text-ink-3 hover:bg-surface-elevated"
              onClick={() => drawBatch()}
            >
              再翻几张
            </button>
          </div>
        )}
      </CollapsibleSection>
    </section>
  );
}