import { Sheet } from "../../components/ui/Sheet.js";
import { useIsCoarsePointer } from "../../lib/useIsCoarsePointer.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import type { GoalAction } from "./goalGraphActions.js";
import type { GoalGraphNode } from "../../lib/goalGraphModel.js";

function actionLabel(action: GoalAction, node: GoalGraphNode): string {
  return `${action.label} ${node.title}`;
}

function actionClass(action: GoalAction): string {
  if (action.tone === "danger") return "border-danger/40 text-danger";
  if (action.tone === "primary") return "border-accent bg-accent text-page";
  return "border-border text-ink";
}

export function GoalGalaxyActionBar({
  node,
  actions,
  onAction,
  onClose,
}: {
  node: GoalGraphNode | null;
  actions: GoalAction[];
  onAction: (action: GoalAction) => void;
  onClose: () => void;
}) {
  const wide = useIsWideScreen();
  const coarse = useIsCoarsePointer();
  if (!node) return null;

  const buttons = actions.map((action) => (
    <button
      key={action.id}
      type="button"
      aria-label={actionLabel(action, node)}
      onClick={() => onAction(action)}
      className={`min-h-11 rounded-ctl border px-3 text-sm ${actionClass(action)}`}
    >
      {action.label}
    </button>
  ));

  if (wide && !coarse) {
    return (
      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 rounded-card border border-border bg-surface-elevated p-2 shadow-elev1">
        {buttons}
      </div>
    );
  }

  return (
    <Sheet open={actions.length > 0} onClose={onClose} title={node.title}>
      <div className="grid gap-2 px-4 pb-4">{buttons}</div>
    </Sheet>
  );
}
