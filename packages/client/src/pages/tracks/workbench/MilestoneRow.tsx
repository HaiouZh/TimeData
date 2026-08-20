import type { TrackMilestone } from "@timedata/shared";
import { useState } from "react";
import { Checkbox } from "../../../components/ui/Checkbox.js";
import {
  dropMilestone,
  insertMilestoneAt,
  moveMilestone,
  setMilestoneStatus,
  unlinkMilestoneTask,
  updateMilestoneTitle,
} from "../../../lib/trackMilestones.js";

export function MilestoneRow(props: {
  milestone: TrackMilestone;
  prevId: string | null;
  nextNextId: string | null;
  isLast: boolean;
  isFirst: boolean;
  readOnly?: boolean;
  onError: (message: string) => void;
}): React.JSX.Element {
  const { milestone, prevId, nextNextId, isLast, isFirst, readOnly, onError } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(milestone.title);
  const [showInsert, setShowInsert] = useState(false);
  const [insertTitle, setInsertTitle] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [dropNote, setDropNote] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const isDropped = milestone.status === "dropped";

  async function handleToggle(): Promise<void> {
    const nextStatus = milestone.status === "done" ? "pending" : "done";
    try {
      await setMilestoneStatus(milestone.id, nextStatus as TrackMilestone["status"]);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function startEdit(): void {
    if (readOnly || isDropped) return;
    setDraft(milestone.title);
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditing(false);
    setDraft(milestone.title);
  }

  async function saveEdit(): Promise<void> {
    const trimmed = draft.trim();
    if (!trimmed) {
      onError("里程碑标题不能为空");
      return;
    }
    try {
      await updateMilestoneTitle(milestone.id, trimmed);
      setEditing(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleMoveUp(): Promise<void> {
    if (isFirst) return;
    try {
      await moveMilestone(milestone.id, prevId);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleMoveDown(): Promise<void> {
    if (isLast) return;
    try {
      await moveMilestone(milestone.id, nextNextId);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleInsert(): Promise<void> {
    const title = insertTitle.trim();
    if (!title) return;
    try {
      await insertMilestoneAt(milestone.trackId, title, milestone.id);
      setInsertTitle("");
      setShowInsert(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDrop(): Promise<void> {
    const note = dropNote.trim();
    try {
      if (note) await dropMilestone(milestone.id, note);
      else await dropMilestone(milestone.id);
      setDropNote("");
      setShowDrop(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleUnlink(): Promise<void> {
    try {
      await unlinkMilestoneTask(milestone.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRestore(): Promise<void> {
    try {
      await setMilestoneStatus(milestone.id, "pending");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div
      data-testid="milestone-row"
      data-id={milestone.id}
      className="flex items-start gap-2 border-b border-border py-2"
    >
      {!isDropped && (
        <span data-testid="milestone-checkbox-host">
          <Checkbox
            checked={milestone.status === "done"}
            onChange={() => void handleToggle()}
            ariaLabel={milestone.status === "done" ? "取消完成" : "标记完成"}
            disabled={Boolean(readOnly)}
            dense
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {isDropped ? (
          <span data-testid="milestone-title" className="block line-through td-text-body text-ink-3">
            {milestone.title}
          </span>
        ) : editing ? (
          <input
            data-testid="milestone-title-input"
            aria-label="编辑标题"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            onBlur={() => cancelEdit()}
            className="w-full rounded-ctl border border-border bg-surface-elevated px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
        ) : readOnly ? (
          <span data-testid="milestone-title" className="block td-text-body text-ink">
            {milestone.title}
          </span>
        ) : (
          <button
            type="button"
            data-testid="milestone-title"
            onClick={startEdit}
            className="block text-left td-text-body text-ink hover:text-accent"
          >
            {milestone.title}
          </button>
        )}
        {isDropped && milestone.note != null && (
          <div data-testid="milestone-note" className="mt-1 td-text-caption text-ink-3">
            {milestone.note}
          </div>
        )}
        {!isDropped && milestone.taskId != null && (
          <span
            data-testid="milestone-task-chip"
            className="mt-1 inline-flex rounded-pill bg-surface-elevated px-2 py-0.5 td-text-caption text-ink-2"
          >
            任务
          </span>
        )}
        {!readOnly && !isDropped && showInsert && (
          <div className="mt-2 flex items-center gap-2">
            <input
              aria-label="插入标题"
              data-testid="milestone-insert-input"
              value={insertTitle}
              onChange={(e) => setInsertTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInsert();
                if (e.key === "Escape") setShowInsert(false);
              }}
              placeholder="新段标题"
              className="flex-1 rounded-ctl border border-border bg-surface-elevated px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => void handleInsert()}
              className="rounded-ctl bg-accent px-3 py-1.5 td-text-label text-white"
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => setShowInsert(false)}
              className="rounded-ctl border border-border px-3 py-1.5 td-text-label text-ink-2"
            >
              取消
            </button>
          </div>
        )}
        {!readOnly && !isDropped && showDrop && (
          <div className="mt-2 flex items-center gap-2">
            <input
              aria-label="砍掉备注"
              data-testid="milestone-drop-note-input"
              value={dropNote}
              onChange={(e) => setDropNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleDrop();
                if (e.key === "Escape") setShowDrop(false);
              }}
              placeholder="备注（可选）"
              className="flex-1 rounded-ctl border border-border bg-surface-elevated px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => void handleDrop()}
              className="rounded-ctl bg-danger px-3 py-1.5 td-text-label text-white"
            >
              确认砍掉
            </button>
            <button
              type="button"
              onClick={() => setShowDrop(false)}
              className="rounded-ctl border border-border px-3 py-1.5 td-text-label text-ink-2"
            >
              取消
            </button>
          </div>
        )}
      </div>
      {!readOnly && (
        <div data-testid="milestone-menu" className="relative shrink-0">
          <button
            type="button"
            aria-label="操作菜单"
            data-testid="milestone-menu-trigger"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-ctl px-2 py-1 td-text-body text-ink-2 hover:text-ink"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              data-testid="milestone-menu-content"
              className="absolute right-0 z-10 mt-1 flex min-w-[160px] flex-col gap-1 rounded-ctl border border-border bg-surface p-2 shadow"
            >
              {isDropped ? (
                <button
                  type="button"
                  onClick={() => void handleRestore()}
                  className="rounded-ctl px-3 py-1.5 text-left td-text-label text-ink hover:bg-surface-elevated"
                >
                  恢复为待办
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => void handleMoveUp()}
                    className="rounded-ctl px-3 py-1.5 text-left td-text-label text-ink hover:bg-surface-elevated disabled:opacity-40"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => void handleMoveDown()}
                    className="rounded-ctl px-3 py-1.5 text-left td-text-label text-ink hover:bg-surface-elevated disabled:opacity-40"
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInsert((v) => !v)}
                    className="rounded-ctl px-3 py-1.5 text-left td-text-label text-ink hover:bg-surface-elevated"
                  >
                    在此段前加塞
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDrop((v) => !v)}
                    className="rounded-ctl px-3 py-1.5 text-left td-text-label text-ink hover:bg-surface-elevated"
                  >
                    砍掉留痕
                  </button>
                  {milestone.taskId != null && (
                    <button
                      type="button"
                      onClick={() => void handleUnlink()}
                      className="rounded-ctl px-3 py-1.5 text-left td-text-label text-ink hover:bg-surface-elevated"
                    >
                      解挂任务
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
