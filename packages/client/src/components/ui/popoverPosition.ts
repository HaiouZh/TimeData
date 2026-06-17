export interface PopoverAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverPosition {
  left: number;
  top: number;
}

export const POPOVER_GAP = 6;

export function computePopoverPosition(
  anchor: PopoverAnchorRect,
  popover: PopoverSize,
  viewport: PopoverSize,
  gap = POPOVER_GAP,
): PopoverPosition {
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - popover.height - gap;
  const fitsBelow = belowTop + popover.height <= viewport.height - gap;

  const minLeft = gap;
  const maxLeft = Math.max(minLeft, viewport.width - popover.width - gap);

  return {
    left: Math.min(maxLeft, Math.max(minLeft, anchor.left)),
    top: fitsBelow ? belowTop : Math.max(gap, aboveTop),
  };
}
