import type { TrackStep } from "@timedata/shared";
import { PencilSimple, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Icon } from "../../components/Icon.js";
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
  highlighted = false,
  onEdit,
  onDelete,
}: {
  step: TrackStep;
  isCurrent: boolean;
  now: Date;
  highlighted?: boolean;
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const open = step.endedAt === null;
  const duration = formatStepDuration(step.startedAt, step.endedAt, now);
  const durationLabel = open ? `进行中 · 已历时${duration}` : `历时${duration}`;
  // 瞬时/短历时的闭合步（<1 分钟）不值得单独展示历时——通常是回填/补记，显示「历时0分钟」反而是噪音。
  const isNegligibleDuration =
    !open && new Date(step.endedAt as string).getTime() - new Date(step.startedAt).getTime() < 60_000;
  // 步骤的「最后动静」时刻：开口步取开始，闭合步取结束。
  const activityAt = step.endedAt ?? step.startedAt;
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.content);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const canFold = !isCurrent && step.content.length > LONG_CONTENT_CHARS;
  const collapsed = canFold && !expanded && !editing;
  const canEdit = step.source === "user" && onEdit !== undefined;
  const canDelete = step.source === "user" && onDelete !== undefined;

  async function saveEdit(): Promise<void> {
    if (!onEdit) return;
    await onEdit(step.id, draft);
    setEditing(false);
    setConfirmingDelete(false);
  }

  async function deleteStep(): Promise<void> {
    if (!onDelete) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    await onDelete(step.id);
  }

  return (
    <li
      id={`step-${step.id}`}
      data-current={isCurrent ? "true" : "false"}
      className={`rounded-card border p-3 transition ${rowClass(isCurrent)}${highlighted ? " ring-1 ring-accent" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 td-text-caption text-ink-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {step.source !== "user" && (
            <span data-source={step.source} className="rounded-pill bg-surface-elevated px-2 py-0.5 text-ink-2">
              {stepSourceText(step)}
            </span>
          )}
          {!isNegligibleDuration && <span className="td-duration">{durationLabel}</span>}
          <span data-testid="step-relative-time" title={formatAppDateTime(activityAt)}>
            {formatRelativeTime(activityAt, now)}
          </span>
          {step.editedAt && (
            <span className="td-text-caption text-ink-3" title={formatAppDateTime(step.editedAt)}>
              已编辑
            </span>
          )}
        </div>
        {(canEdit || canDelete) && (
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && (
              <button
                type="button"
                aria-label="编辑步骤"
                onClick={() => {
                  setDraft(step.content);
                  setEditing(true);
                  setConfirmingDelete(false);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-ctl bg-surface-elevated text-ink-2 hover:text-accent"
              >
                <Icon icon={PencilSimple} size={15} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                aria-label={confirmingDelete ? "确认删除步骤" : "删除步骤"}
                onClick={() => void deleteStep()}
                className={`inline-flex h-7 items-center justify-center rounded-ctl bg-surface-elevated px-2 text-ink-2 hover:text-danger ${
                  confirmingDelete ? "td-text-caption text-danger" : "w-7"
                }`}
              >
                {confirmingDelete ? "确认删除" : <Icon icon={X} size={15} />}
              </button>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="编辑步骤内容"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            className="w-full resize-y rounded-ctl border border-border bg-surface-elevated px-3 py-2 td-text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(step.content);
                setEditing(false);
              }}
              className="rounded-ctl border border-border px-3 py-1.5 td-text-label text-ink-2 hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              className="rounded-ctl bg-accent px-3 py-1.5 td-text-label text-page"
            >
              保存
            </button>
          </div>
        </div>
      ) : step.content ? (
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
      ) : null}
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
