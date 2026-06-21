import type { TrackStep } from "@timedata/shared";
import { formatStepDuration, isDecisionStep } from "../../lib/tracksView.js";
import { RefChip } from "./RefChip.js";

function sourceText(step: TrackStep): string {
  if (step.source === "user") return "我";
  return step.sourceLabel ?? "agent";
}

// 当前步>决策步>普通步:当前步用 accent,决策步用 warn,其余默认。全为已核实 token。
function rowClass(isCurrent: boolean, decision: boolean): string {
  if (isCurrent) return "border-accent bg-accent-soft shadow-elev1";
  if (decision) return "border-warn bg-warn-soft";
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
  const decision = isDecisionStep(step);
  const duration = formatStepDuration(step.startedAt, step.endedAt, now);
  const durationLabel = open ? `进行中 · 已历时${duration}` : `历时${duration}`;

  return (
    <li
      data-current={isCurrent ? "true" : "false"}
      data-decision={decision ? "true" : "false"}
      className={`rounded-card border p-3 transition ${rowClass(isCurrent, decision)}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span data-source={step.source} className="rounded-pill bg-surface-elevated px-2 py-0.5 text-ink-2">
          {sourceText(step)}
        </span>
        {decision && <span className="text-warn">决策步</span>}
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
