import type { TrackStep } from "@timedata/shared";
import { useState } from "react";
import { formatAppDateTime, formatRelativeTime } from "../../lib/time.js";
import { formatStepDuration, stepSourceText } from "../../lib/tracksView.js";
import { RefChip } from "./RefChip.js";

// 非当前步的长内容默认折叠，避免一条数千字的 agent 步在移动端形成一面墙（TK-17）。
const LONG_CONTENT_CHARS = 280;

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
  // 步骤的「最后动静」时刻：开口步取开始，闭合步取结束。
  const activityAt = step.endedAt ?? step.startedAt;
  const [expanded, setExpanded] = useState(false);
  const canFold = !isCurrent && step.content.length > LONG_CONTENT_CHARS;
  const collapsed = canFold && !expanded;

  return (
    <li
      data-current={isCurrent ? "true" : "false"}
      className={`rounded-card border p-3 transition ${rowClass(isCurrent)}`}
    >
      <div className="flex flex-wrap items-center gap-2 td-text-caption text-ink-3">
        <span data-source={step.source} className="rounded-pill bg-surface-elevated px-2 py-0.5 text-ink-2">
          {stepSourceText(step)}
        </span>
        <span className="td-duration">{durationLabel}</span>
        <span data-testid="step-relative-time" title={formatAppDateTime(activityAt)}>
          {formatRelativeTime(activityAt, now)}
        </span>
      </div>
      {step.content && (
        <>
          <p
            className={`mt-2 whitespace-pre-wrap break-words td-text-body text-ink ${collapsed ? "line-clamp-6" : ""}`}
          >
            {step.content}
          </p>
          {canFold && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 td-text-caption text-accent hover:underline"
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
        </>
      )}
      {(step.tags.length > 0 || step.refs.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {step.tags.map((tag) => (
            <span key={tag} className="rounded-pill bg-surface-hover px-2 py-0.5 td-text-caption text-ink-2">
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
