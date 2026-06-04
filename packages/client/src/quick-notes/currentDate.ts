export interface DividerOffset {
  label: string;
  offsetTop: number;
}

export function pickCurrentDateDivider<T extends DividerOffset>(dividers: T[], scrollTop: number): T | null {
  let current: T | null = null;
  for (const divider of dividers) {
    if (divider.offsetTop <= scrollTop + 1) {
      current = divider;
    } else {
      break;
    }
  }
  return current ?? dividers[0] ?? null;
}

export function pickCurrentDateLabel(dividers: DividerOffset[], scrollTop: number): string | null {
  return pickCurrentDateDivider(dividers, scrollTop)?.label ?? null;
}
