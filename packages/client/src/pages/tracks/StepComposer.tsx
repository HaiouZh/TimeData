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

const PRESET_TAGS = ["决策", "批注", "提醒"];

export function StepComposer({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (draft: StepDraft) => void;
  disabled?: boolean;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<UserStepMode>("open");
  const [tag, setTag] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSubmit({ content: trimmed, mode, tags: tag ? [tag] : [] });
    setContent("");
    setTag(null);
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
        {PRESET_TAGS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={tag === preset}
            onClick={() => setTag((current) => (current === preset ? null : preset))}
            className={`rounded-pill px-2.5 py-0.5 text-xs transition ${
              tag === preset ? "bg-accent-soft text-accent" : "bg-surface-hover text-ink-2 hover:text-ink"
            }`}
          >
            #{preset}
          </button>
        ))}
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
