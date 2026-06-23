import type { TrackStep } from "@timedata/shared";
import { formatStepDuration, stepSourceText } from "../../lib/tracksView.js";
import { RefChip } from "./RefChip.js";

function rowClass(isCurrent: boolean): string {
  if (isCurrent) return "border-accent bg-accent-soft shadow-elev1";
  return "border-border bg-surface";
}

export function TrackStepRow({
  step,
  isCurrent,
  now,
}: {
  step: TrackStep;
  isCurrent: boolean;
  now: Date;
}) {
  const open = step.endedAt === null;
  const duration = formatStepDuration(step.startedAt, step.endedAt, now);
  const durationLabel = open ? `进行中 · 已历时${duration}` : `历时${duration}`;

  return (
    <li
      data-current={isCurrent ? "true" : "false"}
      className={`rounded-card border p-3 transition ${rowClass(isCurrent)}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span data-source={step.source} className="rounded-pill bg-surface-elevated px-2 py-0.5 text-ink-2">
          {stepSourceText(step)}
        </span>
        <span>{durationLabel}</span>
      </div>
      {step.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{step.content}</p>}
      {(step.tags.length > 0 || step.refs.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {step.tags.map((tag) => (
            <span key={tag} className="rounded-pill bg-surface-hover px-2 py-0.5 text-xs text-ink-2">
              #{tag}
            </span>
          ))}
          {step.refs.map((refItem) => (
            <RefChip key={`${refItem.kind}:${refItem.id}`} refItem={refItem} />
          ))}
        </div>
      )}
    </li>
  );
}
