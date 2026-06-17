import type { Recurrence } from "@timedata/shared";
import { useMemo } from "react";
import { AnchoredPopover } from "../../components/ui/AnchoredPopover.js";
import type { RecurrenceChoice } from "../../lib/tasks/recurrencePresets.js";
import { RecurrencePresetList } from "./RecurrencePresetList.js";

interface RecurrencePopoverProps {
  anchorEl: HTMLElement;
  current: Recurrence | null;
  scheduledAt: string | null;
  anchor: string;
  onChoose: (choice: RecurrenceChoice) => void;
  onCustom: () => void;
  onClose: () => void;
}

export function RecurrencePopover({
  anchorEl,
  current,
  scheduledAt,
  anchor,
  onChoose,
  onCustom,
  onClose,
}: RecurrencePopoverProps) {
  const anchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);
  return (
    <AnchoredPopover
      open
      anchorRef={anchorRef}
      onClose={onClose}
      ariaLabel="重复与时间"
      z={65}
      className="max-h-[calc(100vh-1rem)] w-60 overflow-y-auto overflow-x-hidden"
    >
      <RecurrencePresetList
        current={current}
        scheduledAt={scheduledAt}
        anchor={anchor}
        onChoose={onChoose}
        onCustom={onCustom}
      />
    </AnchoredPopover>
  );
}
