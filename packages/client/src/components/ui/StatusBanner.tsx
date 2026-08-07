import type { ReactNode } from "react";

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
  /** 无障碍语义透传。缺省不设——现有 18 处都没有 role，无条件加会改变播报行为。 */
  role?: "alert" | "status";
}

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

export function StatusBanner({ tone, children, variant = "card", actions, className, role }: StatusBannerProps) {
  return (
    <div
      data-tone={tone}
      role={role}
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
