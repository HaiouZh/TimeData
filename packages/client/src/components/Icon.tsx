import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";

export type { IconWeight };

export interface IconProps {
  /** 一个 Phosphor 图标组件，如 `MagnifyingGlass`。 */
  icon: PhosphorIcon;
  size?: number;
  weight?: IconWeight;
  /** 提供则作 aria-label + role=img（语义图标/图标按钮）；不提供则 aria-hidden（装饰）。 */
  label?: string;
  className?: string;
}

/**
 * ≤16px 的密集/小图标默认降到 regular，避免 light 细线在深底小尺寸发虚；
 * 否则默认 light（配霞鹭文楷书卷体）。显式传 weight 时以传入为准。
 */
export function resolveIconWeight(size: number, weight?: IconWeight): IconWeight {
  if (weight) return weight;
  return size <= 16 ? "regular" : "light";
}

export function Icon({ icon: Glyph, size = 18, weight, label, className }: IconProps) {
  return (
    <Glyph
      size={size}
      weight={resolveIconWeight(size, weight)}
      className={className}
      aria-label={label}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}
