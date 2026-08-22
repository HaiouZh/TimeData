import { MagnifyingGlass, Tag, X } from "@phosphor-icons/react";
import { type CSSProperties, type FormEvent, type MutableRefObject, type Ref, useCallback, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { focusOnPointerDown } from "../../lib/fastFocus.js";
import { useShellResizeGlide } from "../../lib/keyboardMotion.js";
import { useTodoDefaultDestination } from "../../lib/settings/todoDefaultDestinationSetting.js";
import { addTask } from "../../lib/tasks.js";
import { Z } from "../../lib/zLayers.js";
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
  bottomOffsetPx: number;
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
  bottomOffsetPx,
  hiddenByScroll,
  formRef,
}: TodoComposerProps) {
  const destination = useTodoDefaultDestination();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 壳缩/恢复 webview 的单帧跳变抹成滑动（安卓；见 keyboardMotion.ts）。与外部 formRef 合流。
  const glideRef = useRef<HTMLFormElement | null>(null);
  useShellResizeGlide(glideRef);
  const setFormRef = useCallback(
    (el: HTMLFormElement | null) => {
      glideRef.current = el;
      if (typeof formRef === "function") formRef(el);
      else if (formRef) (formRef as MutableRefObject<HTMLFormElement | null>).current = el;
    },
    [formRef],
  );

  const hasTags = tags.length > 0;
  const searching = !filterOpen && composerText.trim() !== "";

  async function submit(event: FormEvent<HTMLFormElement>) {
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
    <form
      ref={setFormRef}
      onSubmit={submit}
      className="fixed left-0 right-0 border-t border-border bg-page/95 p-2 backdrop-blur transition-transform duration-200 ease-out will-change-transform [bottom:var(--bottom-offset)] sm:p-3"
      // 载体分工（键盘运动波）：bottom 只装安全区、恒定不动；动态抬升（navOffset / 键盘高）走
      // transform: translateY(-抬升量)——吃上面 transition-transform 的过渡，键盘弹起/收起、底栏
      // 显隐的位移全部变成滑动（合成器线程，无重排），等效终点位置与迁移前逐值相等。
      // 下滑收起底栏时（hidden）整体下移自身高度（translateY 100%）滑出视口，回位走同一条过渡。
      // zIndex backdrop(40) 压过任务行内部交互层，低于详情抽屉/系统弹层。
      // 安全区经 var(--safe-bottom) 流入（:root 默认 env()，Android 壳清零，见 index.css）。
      // env() 未定义的环境（Firefox 桌面 bug 1505842 / 旧 WebView）里 calc 整条声明在计算值时失效、
      // 内联 bottom 被丢弃，由兜底类落回 --bottom-offset（恒 0px）；抬升在 transform 上不受影响。
      style={
        {
          "--bottom-offset": "0px",
          bottom: "calc(0px + var(--safe-bottom))",
          transform: hiddenByScroll ? "translateY(100%)" : `translateY(${-bottomOffsetPx}px)`,
          zIndex: Z.backdrop,
        } as CSSProperties
      }
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
    </form>
  );
}
