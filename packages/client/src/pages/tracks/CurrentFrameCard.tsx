import { PencilSimple, X } from "@phosphor-icons/react";
import type { TrackStep } from "@timedata/shared";
import { useState } from "react";
import { Icon } from "../../components/Icon.js";
import { formatAppDateTime, formatRelativeTime } from "../../lib/time.js";
import { stepSourceText } from "../../lib/tracksView.js";
import { RefChip } from "./RefChip.js";

// 当前帧卡：详情页顶部的「存档点」——最新步全文 + 信号 + 就地编辑。
// 计时弱化：只显示「X 前」，不显示历时（历时留在折叠的历史区当辅助信息）。
export function CurrentFrameCard({
  step,
  now = new Date(),
  onEdit,
  onDelete,
}: {
  step: TrackStep;
  now?: Date;
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.content);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const activityAt = step.endedAt ?? step.startedAt;
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
    <section
      id={`step-${step.id}`}
      data-testid="current-frame-card"
      className="mb-3 rounded-card border border-accent/40 bg-surface p-4 shadow-elev1"
    >
      <div className="flex flex-wrap items-center gap-2 td-text-caption text-ink-3">
        <span className="font-medium text-ink-2">当前帧 · 第{step.seq + 1}步</span>
        {step.source !== "user" && (
          <span data-source={step.source} className="rounded-pill bg-surface-elevated px-2 py-0.5 text-ink-2">
            {stepSourceText(step)}
          </span>
        )}
        <span title={formatAppDateTime(activityAt)}>{formatRelativeTime(activityAt, now)}</span>
        {step.editedAt && <span title={formatAppDateTime(step.editedAt)}>已编辑</span>}
        {(canEdit || canDelete) && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
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
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="编辑步骤内容"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
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
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words td-text-body text-ink">{step.content || "无内容步骤"}</p>
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
    </section>
  );
}
