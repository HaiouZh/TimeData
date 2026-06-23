import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";

export function GoalTaskComposer({ onSubmit }: { onSubmit: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setTitle("");
      inputRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mb-3 rounded-card border border-border bg-surface p-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          aria-label="快速添加目标任务"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          placeholder="给这个目标加一个任务..."
          className="min-w-0 flex-1 rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          aria-label="添加目标任务"
          disabled={saving || !title.trim()}
          className="inline-flex min-h-10 items-center justify-center rounded-ctl bg-accent px-3 text-sm text-page disabled:opacity-60"
        >
          <Icon icon={Plus} size={18} />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </form>
  );
}
