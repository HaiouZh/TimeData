import type { TrackStep } from "@timedata/shared";
import { useState } from "react";
import { currentStepId, orderedTimeline } from "../../lib/tracksView.js";
import { TrackStepRow } from "./TrackStepRow.js";

// 长轨道中段折叠：保留最近若干步（含当前步，恒在顶部）与最早几步，其余按需展开（TK-17）。
const MAX_VISIBLE = 25;
const HEAD_COUNT = 12;
const TAIL_COUNT = 3;

export function TrackTimeline({ steps, now = new Date() }: { steps: TrackStep[]; now?: Date }) {
  const [showAll, setShowAll] = useState(false);
  if (steps.length === 0) {
    return <p className="rounded-card bg-surface px-3 py-6 td-text-body text-center text-ink-3">尚无步骤</p>;
  }
  const currentId = currentStepId(steps);
  const ordered = orderedTimeline(steps);
  const folded = !showAll && ordered.length > MAX_VISIBLE;
  const head = folded ? ordered.slice(0, HEAD_COUNT) : ordered;
  const tail = folded ? ordered.slice(ordered.length - TAIL_COUNT) : [];
  const hiddenCount = folded ? ordered.length - HEAD_COUNT - TAIL_COUNT : 0;

  return (
    <ol className="flex flex-col gap-2" aria-label="轨道时间线">
      {head.map((step) => (
        <TrackStepRow key={step.id} step={step} isCurrent={step.id === currentId} now={now} />
      ))}
      {folded && (
        <li>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full rounded-card border border-border bg-surface px-3 py-2 td-text-caption text-ink-2 hover:border-accent hover:text-accent"
          >
            显示其余 {hiddenCount} 步
          </button>
        </li>
      )}
      {tail.map((step) => (
        <TrackStepRow key={step.id} step={step} isCurrent={step.id === currentId} now={now} />
      ))}
    </ol>
  );
}
