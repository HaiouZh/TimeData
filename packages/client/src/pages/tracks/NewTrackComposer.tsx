import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Icon } from "../../components/Icon.js";

export function NewTrackComposer({ onCreate }: { onCreate: (title: string) => Promise<void> | void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      // 建轨道成功后才清空输入；失败保留标题并 inline 报错（TK-01）。
      await onCreate(trimmed);
      setTitle("");
      setError(null);
      setOpen(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="new-track-open"
        onClick={() => setOpen(true)}
        className="mb-6 flex w-full items-center gap-2 rounded-ctl border border-dashed border-border px-4 py-2 td-text-label text-ink-2 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        <Icon icon={Plus} size={16} />
        新建轨道
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(null);
        }}
        placeholder="新建轨道..."
        aria-label="新建轨道标题"
        autoFocus
        onBlur={() => {
          // 只在空的时候收回：打了一半点别处就把草稿弄没，是比"多占一行"糟得多的体验。
          if (!title.trim()) {
            setOpen(false);
            setError(null);
          }
        }}
        className="min-w-0 flex-1 rounded-ctl border border-border bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page focus-visible:border-accent"
      />
      <button
        type="submit"
        aria-label="新建轨道"
        disabled={submitting}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-2 hover:text-accent disabled:text-ink-3"
      >
        <Icon icon={Plus} size={18} />
      </button>
      {error && (
        <p role="alert" className="w-full td-text-caption text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
