import { type FormEvent, useState } from "react";
import type { UserStepMode } from "../../lib/tracks.js";

export interface StepDraft {
  content: string;
  mode: UserStepMode;
  tags: string[];
}

const COMMON_TAGS = ["决策", "批注", "提醒"];

function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function StepComposer({
  onSubmit,
  disabled = false,
  statusTags = [],
  surface = "card",
  submitLabel = "加入这一步",
}: {
  onSubmit: (draft: StepDraft) => void;
  disabled?: boolean;
  statusTags?: readonly string[];
  surface?: "card" | "inline";
  submitLabel?: string;
}) {
  const [content, setContent] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState("");
  const normalizedStatusTags = uniqueTags(statusTags);
  const normalizedCommonTags = uniqueTags(COMMON_TAGS);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    const trimmedCustomTag = customTag.trim();
    onSubmit({ content: trimmed, mode: "open", tags: tag ? [tag] : trimmedCustomTag ? [trimmedCustomTag] : [] });
    setContent("");
    setTag(null);
    setCustomTag("");
  }

  function toggle(next: string): void {
    setTag((current) => (current === next ? null : next));
    setCustomTag("");
  }

  const formClass =
    surface === "card"
      ? "mb-3 rounded-card border border-border bg-surface p-3"
      : "border-t border-border bg-surface px-3 py-3";

  return (
    <form onSubmit={submit} className={formClass}>
      <div className="mb-2 td-text-caption font-medium text-ink-3">写一步</div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="写下这一步的进展、结论或需要接手的事..."
        aria-label="步骤内容"
        rows={2}
        disabled={disabled}
        className="min-h-16 w-full resize-none rounded-ctl border border-border bg-surface-elevated px-3 py-2 td-text-body text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {normalizedStatusTags.length > 0 && (
          <>
            <span className="td-text-caption text-ink-3">看板信号</span>
            {normalizedStatusTags.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={tag === preset}
                onClick={() => toggle(preset)}
                className={`rounded-pill px-2.5 py-0.5 td-text-caption transition ${
                  tag === preset ? "bg-accent-soft text-accent" : "bg-surface-hover text-ink-2 hover:text-ink"
                }`}
              >
                #{preset}
              </button>
            ))}
          </>
        )}
        <span className="td-text-caption text-ink-3">常用标签</span>
        {normalizedCommonTags.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={tag === preset}
            onClick={() => toggle(preset)}
            className={`rounded-pill px-2.5 py-0.5 td-text-caption transition ${
              tag === preset ? "bg-accent-soft text-accent" : "bg-surface-hover text-ink-2 hover:text-ink"
            }`}
          >
            #{preset}
          </button>
        ))}
        <input
          value={customTag}
          onChange={(event) => {
            setCustomTag(event.target.value);
            if (event.target.value.trim()) setTag(null);
          }}
          placeholder="自定义标签"
          aria-label="自定义步骤标签"
          disabled={disabled}
          className="min-h-8 w-28 rounded-ctl border border-border bg-surface-elevated px-2 td-text-caption text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={disabled || content.trim().length === 0}
          className="ml-auto rounded-ctl bg-accent px-3 py-1.5 td-text-label text-page disabled:bg-surface-hover disabled:text-ink-3"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
