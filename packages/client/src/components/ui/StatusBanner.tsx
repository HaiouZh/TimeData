import type { CSSProperties, ReactNode } from "react";

export type StatusTone = "info" | "ok" | "warn" | "danger";

export interface StatusBannerProps {
  tone: StatusTone;
  children: ReactNode;
  /** bar = 贴边横条（方角 + 仅下边框），给日记页顶部那两条；缺省 card = 圆角卡片。 */
  variant?: "card" | "bar";
  /** 右侧动作区（日记冲突条的「刷新重载 / 保留我的」）。有 actions 时才套 flex 布局。 */
  actions?: ReactNode;
  /** 调用方定位/收缩用（速记 fixed、画布 absolute、日记 shrink-0）。 */
  className?: string;
  /**
   * 内联样式透传。速记页两条浮条要靠它算 bottom：`--bottom-offset` 自定义属性 +
   * `bottom: calc(…px + var(--safe-bottom))`，这两个值随键盘/底栏实时变，写不进 className。
   */
  style?: CSSProperties;
  /** 无障碍语义透传。缺省不设——现有 18 处都没有 role，无条件加会改变播报行为。 */
  role?: "alert" | "status";
}

/**
 * 允许透传 `data-*`：既有页面用它当测试钩子定位（如 `data-connect-sheet-error`，
 * `GoalGraphEditor.test.tsx` 靠它取节点）。不开这个口，迁移就只能去改那条测试——那是放水。
 * 模板字面量索引签名，不用 any，类型仍然收得住。
 */
type DataAttributes = { [key: `data-${string}`]: string | undefined };

const TONE_CLASSES: Record<StatusTone, string> = {
  info: "border-border bg-surface/95 text-ink-2",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

const VARIANT_CLASSES: Record<"card" | "bar", string> = {
  card: "rounded-card border px-3 py-2",
  bar: "border-b px-4 py-2",
};

export function StatusBanner({
  tone,
  children,
  variant = "card",
  actions,
  className,
  role,
  style,
  ...dataAttrs
}: StatusBannerProps & DataAttributes) {
  return (
    <div
      // 展开放在 data-tone 之前：调用方不得覆盖 data-tone，19 处迁移的断言都挂在它上面。
      {...dataAttrs}
      data-tone={tone}
      role={role}
      style={style}
      className={`${VARIANT_CLASSES[variant]} td-text-body ${TONE_CLASSES[tone]}${className ? ` ${className}` : ""}`}
    >
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1">{children}</span>
          {actions}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
