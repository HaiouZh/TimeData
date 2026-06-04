export interface DividerOffset {
  label: string;
  offsetTop: number;
}

export function pickCurrentDateLabel(dividers: DividerOffset[], scrollTop: number): string | null {
  let current: string | null = null;
  for (const divider of dividers) {
    if (divider.offsetTop <= scrollTop + 1) {
      current = divider.label;
    } else {
      break;
    }
  }
  return current ?? dividers[0]?.label ?? null;
}
