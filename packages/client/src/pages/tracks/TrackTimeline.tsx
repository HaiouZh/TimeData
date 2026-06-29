import type { TrackStep } from "@timedata/shared";
import { currentStepId, orderedTimeline } from "../../lib/tracksView.js";
import { TrackStepRow } from "./TrackStepRow.js";

export function TrackTimeline({ steps, now = new Date() }: { steps: TrackStep[]; now?: Date }) {
  if (steps.length === 0) {
    return <p className="rounded-card bg-surface px-3 py-6 td-text-body text-center text-ink-3">尚无步骤</p>;
  }
  const currentId = currentStepId(steps);
  return (
    <ol className="flex flex-col gap-2" aria-label="轨道时间线">
      {orderedTimeline(steps).map((step) => (
        <TrackStepRow key={step.id} step={step} isCurrent={step.id === currentId} now={now} />
      ))}
    </ol>
  );
}
