import { ArrowUp } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { useCallback, useMemo, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type { GravitySurfacedMap, TodoGravitySettings } from "../../lib/tasks/gravity.js";
import { pickGravityReviewBatch } from "../../lib/tasks/gravity.js";
import { markGravityTasksSurfaced, readGravitySurfacedMap } from "../../lib/tasks/gravityReviewStorage.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TaskList } from "./TaskList.js";

interface GravityReviewSectionProps {
  sunkenTasks: Task[];
  settings: TodoGravitySettings;
  surfaced: GravitySurfacedMap;
  now?: Date;
  onSurfacedChange: (surfaced: GravitySurfacedMap) => void;
  onBump: (task: Task) => void | Promise<void>;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToToday: (task: Task) => void;
  onToInbox: (task: Task) => void;
  onAfterChildWrite?: () => void;
}

export function GravityReviewSection({
  sunkenTasks,
  settings,
  surfaced,
  now = new Date(),
  onSurfacedChange,
  onBump,
  ...rowHandlers
}: GravityReviewSectionProps) {
  const [batch, setBatch] = useState<Task[]>([]);
  const [pickedThisBatch, setPickedThisBatch] = useState<Set<string>>(() => new Set());
  const remainingPicks = Math.max(0, settings.pickN - pickedThisBatch.size);

  const drawBatch = useCallback(
    (excludeIds: ReadonlySet<string> = new Set(), pickedIds: ReadonlySet<string> = new Set()) => {
      const currentSurfaced = { ...surfaced, ...readGravitySurfacedMap() };
      const candidates = sunkenTasks.filter((task) => !excludeIds.has(task.id));
      const nextBatch = pickGravityReviewBatch(candidates, currentSurfaced, { now, drawM: settings.drawM });
      setBatch(nextBatch);
      setPickedThisBatch(new Set(pickedIds));
      if (nextBatch.length === 0) return;

      const nextSurfaced = markGravityTasksSurfaced(nextBatch.map((task) => task.id), now);
      onSurfacedChange(nextSurfaced);
    },
    [now, onSurfacedChange, settings.drawM, sunkenTasks, surfaced],
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
