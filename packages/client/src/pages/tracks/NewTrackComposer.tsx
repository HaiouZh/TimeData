import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Icon } from "../../components/Icon.js";

export function NewTrackComposer({ onCreate }: { onCreate: (title: string) => void }) {
  const [title, setTitle] = useState("");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setTitle("");
  }

  return (
    <form onSubmit={submit} className="mb-3 flex items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="新建轨道..."
        aria-label="新建轨道标题"
        className="min-w-0 flex-1 rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <button
        type="submit"
        aria-label="新建轨道"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-2 hover:text-accent"
      >
        <Icon icon={Plus} size={18} />
      </button>
    </form>
  );
}
