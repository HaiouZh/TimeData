import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { addMilestones, listTrackMilestones } from "../../../lib/trackMilestones.js";
import { MilestoneRow } from "./MilestoneRow.js";
import { SegmentProgressBar } from "./SegmentProgressBar.js";

export function MilestonePanel(props: {
  trackId: string;
  readOnly?: boolean;
  onError: (message: string) => void;
}): React.JSX.Element {
  const { trackId, readOnly, onError } = props;
  const list = useLiveQuery(() => listTrackMilestones(trackId), [trackId], []) ?? [];
  const [skeletonDraft, setSkeletonDraft] = useState("");
  const [addOneDraft, setAddOneDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreateSkeleton(): Promise<void> {
    const lines = skeletonDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await addMilestones(trackId, lines);
      setSkeletonDraft("");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddOne(): Promise<void> {
    const title = addOneDraft.trim();
    if (!title) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await addMilestones(trackId, [title]);
      setAddOneDraft("");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div data-testid="milestone-panel" className="flex flex-col gap-3">
      <SegmentProgressBar milestones={list} size="full" />
      {list.length === 0 && !readOnly && (
        <div data-testid="milestone-skeleton-creator" className="flex flex-col gap-2">
          <textarea
            aria-label="骨架输入"
            data-testid="milestone-skeleton-textarea"
            placeholder={"一行一段，例：\n调研\n打样\n上线"}
            value={skeletonDraft}
            onChange={(e) => setSkeletonDraft(e.target.value)}
            rows={4}
            className="w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            data-testid="milestone-skeleton-submit"
            onClick={() => void handleCreateSkeleton()}
            disabled={isSubmitting}
            className="self-start rounded-ctl bg-accent px-4 py-1.5 td-text-label text-accent-contrast disabled:opacity-50"
          >
            立骨架
          </button>
        </div>
      )}
      {list.length > 0 && (
        <>
          <div data-testid="milestone-list" className="flex flex-col">
            {list.map((m, index) => {
              const prevId = index > 0 ? list[index - 1].id : null;
              const nextNextId = index + 2 < list.length ? list[index + 2].id : null;
              const isFirst = index === 0;
              const isLast = index === list.length - 1;
              return (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  prevId={prevId}
                  nextNextId={nextNextId}
                  isFirst={isFirst}
                  isLast={isLast}
                  readOnly={readOnly}
                  onError={onError}
                />
              );
            })}
          </div>
          {!readOnly && (
            <div data-testid="milestone-add-one" className="flex items-center gap-2">
              <input
                aria-label="加一段"
                data-testid="milestone-add-input"
                value={addOneDraft}
                onChange={(e) => setAddOneDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddOne();
                }}
                placeholder="输入段标题"
                className="flex-1 rounded-ctl border border-border bg-surface-elevated px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                data-testid="milestone-add-submit"
                onClick={() => void handleAddOne()}
                disabled={isSubmitting}
                className="rounded-ctl bg-accent px-3 py-1.5 td-text-label text-accent-contrast disabled:opacity-50"
              >
                ＋ 加一段
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
