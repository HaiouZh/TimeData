import { isValidDateString } from "../time.ts";

export interface DiaryDateInput {
  /** URL 上 ?date= 的原值；无参为 null。不做 trim（见测试里那条边界的理由）。 */
  param: string | null;
  /** 实时今天，来自 getDateString(useNowMinute())，固定 Asia/Shanghai。 */
  liveToday: string;
  /**
   * 跟随模式的日期锚 = 进入跟随模式那一刻的今天。
   * 它只在「（重新）进入跟随模式」时前进，绝不随 liveToday 自动前进——
   * 自动前进 = 跨零点把用户正在写的正文换到新文件，spec §5 明确否决。
   */
  followAnchor: string;
}

export interface DiaryDateView {
  /** 当前加载/展示/存盘的日期。存盘日期跟着它走。 */
  date: string;
  /** true = 跟随模式（URL 无有效 ?date=）。只有跟随模式才可能出跨天提示。 */
  following: boolean;
  /** true = 该出跨天提示条。显式日期模式下恒为 false。 */
  rolledOver: boolean;
  /** true = URL 上的 ?date= 是冗余/无效的，页面应 setSearchParams({}, { replace: true }) 归一掉。 */
  clearParam: boolean;
}

/**
 * 日记页「当前是哪一天」的唯一裁决点。
 *
 * 事实源是 URL：有合法的过去日期 = 用户自己选的补写目标（显式模式，永不提示）；
 * 没有 = 跟随模式，展示 followAnchor，实时今天越过它就出提示条等用户点。
 *
 * 为什么不用一个 `following: boolean` state 表达模式：state 活不过刷新。
 * 用户 23:59 打开、PWA 被系统杀掉、00:05 冷启动回到 /diary（无参）——
 * URL 方案自动回到跟随模式且锚 = 新今天，state 方案会丢。
 */
export function resolveDiaryDate({ param, liveToday, followAnchor }: DiaryDateInput): DiaryDateView {
  // 跟随模式下锚点晚于今天只可能是设备时钟回拨；钳到今天，且不提示（提示语义是"往前走到今天"）。
  const anchor = followAnchor > liveToday ? liveToday : followAnchor;
  const follow: DiaryDateView = {
    date: anchor,
    following: true,
    rolledOver: liveToday > anchor,
    clearParam: param !== null,
  };

  if (param === null) return follow;
  if (!isValidDateString(param)) return follow;
  // 未来日期钳到今天（与 TimelinePage 的钳法一致），钳完等价于跟随模式。
  if (param >= liveToday) return follow;

  return { date: param, following: false, rolledOver: false, clearParam: false };
}
