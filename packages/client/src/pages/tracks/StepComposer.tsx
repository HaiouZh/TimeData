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
  onSubmit: (draft: StepDraft) => Promise<void> | void;
  disabled?: boolean;
  statusTags?: readonly string[];
  surface?: "card" | "inline";
  submitLabel?: string;
}) {
  const [content, setContent] = useState("");
  // 看板信号单选、检索标签多选，三组并存不再互斥清空（TK-14）。
  const [signal, setSignal] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const normalizedStatusTags = uniqueTags(statusTags);
  const normalizedCommonTags = uniqueTags(COMMON_TAGS);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || disabled || submitting) return;
    const custom = customTag.trim();
    const mergedTags = uniqueTags([...(signal ? [signal] : []), ...tags, ...(custom ? [custom] : [])]);
    setSubmitting(true);
    try {
      // 写入成功后才清空草稿；失败保留原文并 inline 报错（TK-01）。
      await onSubmit({ content: trimmed, mode: "open", tags: mergedTags });
      setContent("");
      setSignal(null);
      setTags([]);
      setCustomTag("");
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "写入失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSignal(next: string): void {
    setSignal((current) => (current === next ? null : next));
  }

  function toggleTag(next: string): void {
    setTags((current) => (current.includes(next) ? current.filter((item) => item !== next) : [...current, next]));
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
        onChange={(event) => {
          setContent(event.target.value);
          if (error) setError(null);
        }}
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
                aria-pressed={signal === preset}
                onClick={() => toggleSignal(preset)}
                className={`rounded-pill px-2.5 py-0.5 td-text-caption transition ${
                  signal === preset ? "bg-accent-soft text-accent" : "bg-surface-hover text-ink-2 hover:text-ink"
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
            aria-pressed={tags.includes(preset)}
            onClick={() => toggleTag(preset)}
            className={`rounded-pill px-2.5 py-0.5 td-text-caption transition ${
              tags.includes(preset) ? "bg-accent-soft text-accent" : "bg-surface-hover text-ink-2 hover:text-ink"
            }`}
          >
            #{preset}
          </button>
        ))}
        <input
          value={customTag}
          onChange={(event) => setCustomTag(event.target.value)}
          placeholder="自定义标签"
          aria-label="自定义步骤标签"
          disabled={disabled}
          className="min-h-8 w-28 rounded-ctl border border-border bg-surface-elevated px-2 td-text-caption text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={disabled || submitting || content.trim().length === 0}
          className="ml-auto rounded-ctl bg-accent px-3 py-1.5 td-text-label text-page disabled:bg-surface-hover disabled:text-ink-3"
        >
          {submitLabel}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 td-text-caption text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
