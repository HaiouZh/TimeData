import { type FormEvent, useState } from "react";
import type { UserStepMode } from "../../lib/tracks.js";

export interface StepDraft {
  content: string;
  mode: UserStepMode;
  tags: string[];
}

const MODES: { value: UserStepMode; label: string }[] = [
  { value: "open", label: "开始做这段" },
  { value: "instant", label: "记一个点" },
];

const INSTANT_TAGS = ["决策", "批注", "提醒"];

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
}: {
  onSubmit: (draft: StepDraft) => void;
  disabled?: boolean;
  statusTags?: readonly string[];
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<UserStepMode>("open");
  const [tag, setTag] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState("");
  const normalizedStatusTags = uniqueTags(statusTags);
  const normalizedInstantTags = uniqueTags(INSTANT_TAGS);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    const trimmedCustomTag = customTag.trim();
    onSubmit({ content: trimmed, mode, tags: tag ? [tag] : trimmedCustomTag ? [trimmedCustomTag] : [] });
    setContent("");
    setTag(null);
    setCustomTag("");
  }

  function toggle(next: string): void {
    setTag((current) => (current === next ? null : next));
    setCustomTag("");
  }

  return (
    <form onSubmit={submit} className="mb-3 rounded-card border border-border bg-surface p-3">
      <div className="mb-2 inline-flex rounded-ctl bg-surface-elevated p-0.5">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={mode === item.value}
            onClick={() => setMode(item.value)}
            className={`rounded-ctl px-3 py-1 text-sm transition ${
              mode === item.value ? "bg-accent text-page" : "text-ink-2 hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={mode === "open" ? "现在开始做的这段..." : "记一笔决策 / 批注 / 提醒..."}
        aria-label="步骤内容"
        rows={2}
        disabled={disabled}
        className="min-h-16 w-full resize-none rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm leading-6 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {normalizedStatusTags.length > 0 && (
          <>
            <span className="text-xs text-ink-3">状态/交棒</span>
            {normalizedStatusTags.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={tag === preset}
                onClick={() => toggle(preset)}
                className={`rounded-pill px-2.5 py-0.5 text-xs transition ${
                  tag === preset ? "bg-accent-soft text-accent" : "bg-surface-hover text-ink-2 hover:text-ink"
                }`}
              >
                #{preset}
              </button>
            ))}
          </>
        )}
        <span className="text-xs text-ink-3">记一笔</span>
        {normalizedInstantTags.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={tag === preset}
            onClick={() => toggle(preset)}
            className={`rounded-pill px-2.5 py-0.5 text-xs transition ${
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
          className="min-h-8 w-28 rounded-ctl border border-border bg-surface-elevated px-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={disabled || content.trim().length === 0}
          className="ml-auto rounded-ctl bg-accent px-3 py-1.5 text-sm text-page disabled:bg-surface-hover disabled:text-ink-3"
        >
          加入这一步
        </button>
      </div>
    </form>
  );
}
