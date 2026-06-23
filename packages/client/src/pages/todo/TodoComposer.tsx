import { MagnifyingGlass, Tag, X } from "@phosphor-icons/react";
import { type FormEvent, type Ref, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../../contexts/BottomNavContext.tsx";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
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
  formRef,
}: TodoComposerProps) {
  const destination = useTodoDefaultDestination();
  const { syncAfterWrite } = useSyncContext();
  const { hidden } = useBottomNav();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTags = tags.length > 0;
  const searching = !filterOpen && composerText.trim() !== "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addTask({ title: composerText, toInbox: destination === "inbox", tags: includeTags });
      onComposerTextChange("");
      syncAfterWrite();
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
      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-accent text-page"
    >
      <Icon icon={Tag} size={18} />
    </button>
  ) : searching ? (
    <button
      type="button"
      aria-label="搜索中"
      title="按标题实时搜索中"
      disabled
      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ink-2"
    >
      <Icon icon={MagnifyingGlass} size={18} />
    </button>
  ) : (
    <button
      type="button"
      aria-label="展开标签筛选"
      disabled={!hasTags}
      onClick={onToggleFilterOpen}
      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ink-2 hover:text-ink disabled:opacity-40"
    >
      <Icon icon={Tag} size={18} />
    </button>
  );

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="fixed left-0 right-0 border-t border-border bg-page/95 p-2 backdrop-blur transition-transform duration-200 ease-out will-change-transform sm:p-3"
      // 下滑收起底栏时（hidden），输入框先贴底（bottom=0）再整体下移自身高度（translateY 100%）滑出视口；
      // bottom 的瞬跳发生在元素已移出屏幕外，回弹时不可见。上滑则随底栏一起归位。
      style={{
        bottom: hidden ? 0 : BOTTOM_NAV_HEIGHT_PX,
        transform: hidden ? "translateY(100%)" : "translateY(0)",
      }}
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
                  placeholder="添加任务…"
                  className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 pr-9 text-sm text-ink outline-none focus:border-accent"
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
                className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-page disabled:opacity-60"
              >
                添加
              </button>
            </>
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}
