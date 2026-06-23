import { type FormEvent, useEffect, useState } from "react";
import type { Goal } from "@timedata/shared";
import { ConfirmSheet } from "../../components/ui/ConfirmSheet.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { Sheet } from "../../components/ui/Sheet.js";

const KIND_OPTIONS: Array<{ value: Goal["kind"]; label: string }> = [
  { value: "project", label: "项目" },
  { value: "theme", label: "主题" },
];

export interface GoalEditPatch {
  title: string;
  note: string | null;
  kind: Goal["kind"];
}

export interface GoalEditSheetProps {
  open: boolean;
  goal: Goal;
  onSave: (patch: GoalEditPatch) => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function GoalEditSheet({
  open,
  goal,
  onSave,
  onToggleArchive,
  onDelete,
  onClose,
}: GoalEditSheetProps) {
  const [title, setTitle] = useState(goal.title);
  const [note, setNote] = useState(goal.note ?? "");
  const [kind, setKind] = useState<Goal["kind"]>(goal.kind);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(goal.title);
    setNote(goal.note ?? "");
    setKind(goal.kind);
    setTitleError(null);
    setConfirmingDelete(false);
  }, [goal.kind, goal.note, goal.title, open]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError("目标标题不能为空");
      return;
    }

    const trimmedNote = note.trim();
    setTitleError(null);
    onSave({
      title: trimmedTitle,
      note: trimmedNote ? trimmedNote : null,
      kind,
    });
  }

  function changeTitle(value: string): void {
    setTitle(value);
    if (titleError && value.trim()) setTitleError(null);
  }

  function confirmDelete(): void {
    setConfirmingDelete(false);
    onDelete();
  }

  const archiveLabel = goal.status === "archived" ? "恢复目标" : "归档目标";

  return (
    <>
      <Sheet open={open} onClose={onClose} title="目标设置">
        <form onSubmit={submit} className="space-y-4 px-4 pb-4">
          <label className="block space-y-1">
            <span className="text-xs text-ink-3">标题</span>
            <input
              type="text"
              value={title}
              onChange={(event) => changeTitle(event.target.value)}
              aria-label="目标标题"
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? "goal-edit-title-error" : undefined}
              className="w-full rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          {titleError && (
            <p id="goal-edit-title-error" className="-mt-3 text-xs text-danger">
              {titleError}
            </p>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-ink-3">备注</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label="目标备注"
              rows={4}
              placeholder="备注"
              className="w-full resize-none rounded-ctl border border-border bg-surface px-3 py-2 text-sm leading-6 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <div className="space-y-1">
            <p className="text-xs text-ink-3">类型</p>
            <SegmentedControl ariaLabel="目标类型" value={kind} options={KIND_OPTIONS} onChange={setKind} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onToggleArchive}
                className="min-h-11 rounded-ctl border border-border px-4 text-sm text-ink"
              >
                {archiveLabel}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="min-h-11 rounded-ctl border border-danger/40 px-4 text-sm text-danger"
              >
                删除目标
              </button>
            </div>
            <button type="submit" className="min-h-11 rounded-ctl bg-accent px-4 text-sm text-page">
              保存目标
            </button>
          </div>
        </form>
      </Sheet>
      <ConfirmSheet
        open={open && confirmingDelete}
        title="删除目标"
        body="目标会被删除，任务和轨道会保留。"
        confirmLabel="删除目标"
        cancelLabel="取消"
        danger
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
