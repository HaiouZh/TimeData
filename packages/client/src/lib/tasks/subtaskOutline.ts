import { subtaskProgress } from "./subtasks.js";

/**
 * 子任务分段进度描边的 dasharray 几何：描边贴着复选框圆角方形轮廓走（贴边、非外扩），
 * 组件用 SVG <rect rx> + pathLength 归一化到 100，段与缺口全靠 stroke-dasharray。
 * 分段留空缺口（露行底色即分割，用户定稿：缺口要一眼可辨）；total > 12 退化连续百分比。
 * 20px 复选框周长约 66px，1 单位≈0.66px：gap 3~6 单位 ≈ 2~4px 实距。
 */
export const OUTLINE_PATH_LENGTH = 100;
const CONTINUOUS_THRESHOLD = 12;

export interface OutlineDashes {
  /** 灰轨 dasharray（全部段） */
  track: string;
  /** 点亮层 dasharray（前 done 段 + 截断），0 完成为 null */
  done: string | null;
  /** 两层共用 stroke-dashoffset，让缺口居中在段边界 */
  offset: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function subtaskOutlineDashes(total: number, done: number): OutlineDashes | null {
  const ratio = subtaskProgress(done, total);
  if (ratio == null) return null;
  const clamped = Math.round(ratio * total);
  if (total > CONTINUOUS_THRESHOLD) {
    return {
      track: `${OUTLINE_PATH_LENGTH} 0`,
      done: clamped === 0 ? null : `${r2(ratio * OUTLINE_PATH_LENGTH)} ${OUTLINE_PATH_LENGTH}`,
      offset: 0,
    };
  }
  const unit = OUTLINE_PATH_LENGTH / total;
  const gap = r2(Math.min(6, Math.max(3, unit * 0.25)));
  // seg 不四舍五入：保证 (seg + gap) * total === 100 精确成立（gap 已取整，seg 吸收余数）
  const seg = unit - gap;
  const pair = `${seg} ${gap}`;
  return {
    track: pair,
    done: clamped === 0 ? null : `${Array.from({ length: clamped }, () => pair).join(" ")} 0 ${OUTLINE_PATH_LENGTH}`,
    // 负 offset 让缺口跨段边界居中（含路径起点）；正 offset 会把首段推过路径起点，
    // done 层（图案总长 > pathLength、不回卷）点不亮跨起点部分，全完成时描边露灰缝。
    offset: r2(-gap / 2),
  };
}
