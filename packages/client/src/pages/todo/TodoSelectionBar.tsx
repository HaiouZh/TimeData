import { type CSSProperties, useState } from "react";
import { Z } from "../../lib/zLayers.js";

export interface TodoSelectionBarProps {
  selectedCount: number;
  /** 可选的已有项目组；空数组时不渲染「放进…」。 */
  projects: readonly { goalId: string; goalTitle: string }[];
  /** 底部固定条的 bottom 偏移：导航条高 + 键盘高的合成（见 TodoPage composeBottomInset）。 */
  bottomOffsetPx: number;
  onCreate: (title: string) => void;
  onAssign: (goalId: string) => void;
  onCancel: () => void;
}

/**
 * 多选态下顶替 TodoComposer 的底部操作栏。
 *
 * 命名就地输入而不是弹对话框（design §动作一 拍板）：少一次跳转，且弹窗会盖住刚选好的那几行——
 * 用户正需要看着它们确认选对了没有。
 */
export function TodoSelectionBar({
  selectedCount,
  projects,
  bottomOffsetPx,
  onCreate,
  onAssign,
  onCancel,
}: TodoSelectionBarProps) {
  const [title, setTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const trimmed = title.trim();
  const hasSelection = selectedCount > 0;
  const canCreate = hasSelection && trimmed !== "";

  function submitCreate(): void {
    if (!canCreate) return;
    onCreate(trimmed);
  }

  return (
    <div
      data-testid="todo-selection-bar"
      className="fixed inset-x-0 px-4 [bottom:var(--bottom-offset)]"
      // 与被顶替的 TodoComposer 同一个常量：同一个位置、同一个角色，就该在同一层。
      //
      // **本栏与待办页的 toast 容器同层（都是 z-backdrop=40）、且在 DOM 里排它之后 → 后绘制的本栏赢。**
      // 所以本栏（含向上展开的「放进…」列表）绝不许压到 toast 那条带上，而多选态里 toast 是唯一的
      // 失败反馈通道（两种提交失败都不退出多选、只靠它说原因），压住就等于「点了没反应」。
      // 两处各自让路，别改这个数字：页面用 composerAvoidancePx 把 toast 顶到操作栏上沿之外
      //（TodoPage 的 bottomBarHeightPx），列表则「选完即收起」（见下面 onClick）。
      // 调 z 层级只会把这两个各自自洽的决定改成互相打架的两个数字，下一个人还会撞。
      // 兜底类 [bottom:var(--bottom-offset)]：env() 未定义环境（Firefox 桌面 / 旧 WebView）里 calc
      // 整条失效、内联 bottom 被丢弃，由它还原批次前的纯数值位置（见 TodoComposer 同款注释）。
      style={
        {
          "--bottom-offset": `${bottomOffsetPx}px`,
          bottom: `calc(${bottomOffsetPx}px + var(--safe-bottom))`,
          zIndex: Z.backdrop,
        } as CSSProperties
      }
    >
      <div className="mx-auto w-full max-w-2xl">
        {pickerOpen && projects.length > 0 && (
          <ul className="mb-2 max-h-60 overflow-y-auto rounded-card border border-border-strong bg-surface py-1 shadow-elev1">
            {projects.map((project) => (
              <li key={project.goalId}>
                <button
                  type="button"
                  aria-label={`放进 ${project.goalTitle}`}
                  // 先收列表再发动作：动作已经发出，列表没有理由继续占着屏幕，
                  // 而它正盖在失败 toast 那条带上（见容器 zIndex 处的注释）。收起来 toast 才露得出来。
                  onClick={() => {
                    setPickerOpen(false);
                    onAssign(project.goalId);
                  }}
                  className="w-full px-3 py-2 text-left td-text-body text-ink hover:bg-surface-hover"
                >
                  {project.goalTitle}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2 rounded-card border border-border-strong bg-surface px-3 py-2 shadow-elev1">
          <span className="shrink-0 td-text-caption text-ink-2">已选 {selectedCount} 条</span>
          <input
            aria-label="项目名"
            value={title}
            placeholder="新项目名"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitCreate();
            }}
            className="min-w-0 flex-1 rounded-ctl bg-surface-elevated px-2 py-1 td-text-body text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            aria-label="圈成项目"
            disabled={!canCreate}
            onClick={submitCreate}
            className="shrink-0 rounded-ctl px-2 py-1 td-text-label font-medium text-accent disabled:opacity-40"
          >
            圈成项目
          </button>
          {projects.length > 0 && (
            <button
              type="button"
              aria-label="放进已有项目"
              disabled={!hasSelection}
              onClick={() => setPickerOpen((open) => !open)}
              className="shrink-0 rounded-ctl px-2 py-1 td-text-label text-ink-2 disabled:opacity-40"
            >
              放进…
            </button>
          )}
          <button
            type="button"
            aria-label="取消多选"
            onClick={onCancel}
            className="shrink-0 rounded-ctl px-2 py-1 td-text-label text-ink-3"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
