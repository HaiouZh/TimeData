import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";

export function NewGoalComposer({ onCreate }: { onCreate: (input: { title: string; kind: "project" | "theme" }) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"project" | "theme">("project");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate({ title: trimmed, kind });
    setTitle("");
  }

  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="新建目标..."
          aria-label="新建目标标题"
          className="min-w-0 flex-1 rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          aria-label="新建目标"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-2 hover:text-accent"
        >
          <Icon icon={Plus} size={18} />
        </button>
      </div>
      <SegmentedControl
        ariaLabel="目标类型"
        value={kind}
        onChange={setKind}
        options={[
          { value: "project", label: "项目" },
          { value: "theme", label: "主题" },
        ]}
      />
    </form>
  );
}
