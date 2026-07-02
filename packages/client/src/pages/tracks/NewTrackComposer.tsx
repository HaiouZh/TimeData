import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Icon } from "../../components/Icon.js";

export function NewTrackComposer({ onCreate }: { onCreate: (title: string) => Promise<void> | void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(null);
        }}
        placeholder="新建轨道..."
        aria-label="新建轨道标题"
        className="min-w-0 flex-1 rounded-ctl border border-border bg-surface px-3 py-2 td-text-body text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
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
