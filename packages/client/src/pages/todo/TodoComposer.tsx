import { MagnifyingGlass, Tag, X } from "@phosphor-icons/react";
import { type FormEvent, type MutableRefObject, type Ref, useCallback, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { KeyboardDock } from "../../components/KeyboardDock.js";
import { focusOnPointerDown } from "../../lib/fastFocus.js";
import { useTodoDefaultDestination } from "../../lib/settings/todoDefaultDestinationSetting.js";
import { addTask } from "../../lib/tasks.js";
import { TagFilterPanel } from "./TagFilterPanel.js";

export interface TodoComposerProps {
  tags: { tag: string; count: number }[];
  composerText: string;
  onComposerTextChange: (v: string) => void;
  filterOpen: boolean;
  onToggleFilterOpen: () => void;
  includeTags: string[];
  excludeTags: string[];
  tagMode: "and" | "or";
  notMode: boolean;
  onToggleTag: (tag: string) => void;
  onToggleMode: () => void;
  onToggleNotMode: () => void;
  onClear: () => void;
  hiddenByScroll: boolean;
  formRef?: Ref<HTMLFormElement>;
}

export function TodoComposer({
  tags,
  composerText,
  onComposerTextChange,
  filterOpen,
  onToggleFilterOpen,
  includeTags,
  excludeTags,
  tagMode,
  notMode,
  onToggleTag,
  onToggleMode,
  onToggleNotMode,
  onClear,
  hiddenByScroll,
  formRef,
}: TodoComposerProps) {
  const destination = useTodoDefaultDestination();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 定位/抬升/运动全在 KeyboardDock；这里只把外部量高用的 formRef 接到驻坞元素上。
  const setFormRef = useCallback(
    (el: HTMLElement | null) => {
      const form = el as HTMLFormElement | null;
      if (typeof formRef === "function") formRef(form);
      else if (formRef) (formRef as MutableRefObject<HTMLFormElement | null>).current = form;
    },
    [formRef],
  );

  const hasTags = tags.length > 0;
  const searching = !filterOpen && composerText.trim() !== "";

  async function submit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addTask({ title: composerText, toInbox: destination === "inbox", tags: includeTags });
      onComposerTextChange("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const leftButton = filterOpen ? (
    <button
      type="button"
      aria-label="收起标签筛选"
      onClick={onToggleFilterOpen}
      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-border bg-accent text-page"
    >
      <Icon icon={Tag} size={18} />
    </button>
  ) : searching ? (
    <button
      type="button"
      aria-label="搜索中"
      title="按标题实时搜索中"
      disabled
      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-border bg-surface text-ink-2"
    >
      <Icon icon={MagnifyingGlass} size={18} />
    </button>
  ) : (
    <button
      type="button"
      aria-label="展开标签筛选"
      disabled={!hasTags}
      onClick={onToggleFilterOpen}
      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-border bg-surface text-ink-2 hover:text-ink disabled:opacity-40"
    >
      <Icon icon={Tag} size={18} />
    </button>
  );

  return (
    <KeyboardDock
      as="form"
      dockRef={setFormRef}
      onSubmit={submit}
      hiddenByScroll={hiddenByScroll}
      // 实心底：backdrop-blur 与 transform 位移动画同帧是移动端掉帧经典组合（TG 输入条也是
      // 实心的）。定位 / 抬升 / 运动曲线 / zIndex 全在 KeyboardDock，这里只有内容外观。
      className="border-t border-border bg-page p-2 sm:p-3"
    >
      <div className="mx-auto w-full max-w-2xl space-y-2 lg:max-w-none">
        <div className="flex items-start gap-2">
          {leftButton}
          {filterOpen ? (
            <TagFilterPanel
              tags={tags}
              includeTags={includeTags}
              excludeTags={excludeTags}
              tagMode={tagMode}
              notMode={notMode}
              onToggleTag={onToggleTag}
              onToggleMode={onToggleMode}
              onToggleNotMode={onToggleNotMode}
              onClear={onClear}
            />
          ) : (
            <>
              <div className="relative min-w-0 flex-1">
                <input
                  value={composerText}
                  onChange={(event) => onComposerTextChange(event.currentTarget.value)}
                  onPointerDown={focusOnPointerDown}
                  placeholder="做什么？怎样算做完…"
                  className="min-h-11 w-full rounded-ctl border border-border bg-surface px-3 pr-9 text-ink outline-none focus:border-accent"
                />
                {composerText && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => onComposerTextChange("")}
                    className="absolute inset-y-0 right-1 my-auto flex h-7 w-7 items-center justify-center rounded-ctl text-ink-3 hover:text-ink"
                  >
                    <Icon icon={X} size={16} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={saving || !composerText.trim()}
                className="min-h-11 shrink-0 rounded-ctl bg-accent px-4 td-text-label font-medium text-page disabled:opacity-60"
              >
                添加
              </button>
            </>
          )}
        </div>
        {error && <p className="td-text-label text-danger">{error}</p>}
      </div>
    </KeyboardDock>
  );
}
