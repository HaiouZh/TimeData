import { OUTLINE_PATH_LENGTH, subtaskOutlineDashes } from "../../lib/tasks/subtaskOutline.js";

/**
 * 子任务分段进度描边：贴着复选框圆角方形轮廓画（20px 盒、rounded-ctl 8px），
 * 纯装饰层不参与点击；与 meta 行 m/n 胶囊双重编码。宿主需将 Checkbox 置为 frameless。
 */
export function SubtaskOutline({ total, done }: { total: number; done: number }) {
  const dashes = subtaskOutlineDashes(total, done);
  if (dashes == null) return null;
  const rectProps = {
    x: 1,
    y: 1,
    width: 18,
    height: 18,
    rx: 7,
    fill: "none",
    strokeWidth: 2,
    pathLength: OUTLINE_PATH_LENGTH,
    strokeDashoffset: dashes.offset,
  } as const;
  return (
    <svg
      data-testid="subtask-outline"
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2"
    >
      <rect {...rectProps} className="stroke-border" strokeDasharray={dashes.track} />
      {dashes.done != null && <rect {...rectProps} className="stroke-accent" strokeDasharray={dashes.done} />}
    </svg>
  );
}
