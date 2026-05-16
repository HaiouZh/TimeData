/**
 * Centralised user-facing strings.
 *
 * All client-side toast / dialog / error copy SHOULD live here so a future i18n
 * pass can swap implementations to a `t(key, params)` lookup without touching
 * call sites. For now everything is Simplified Chinese to match the default
 * project locale documented in CLAUDE.md.
 */
export const messages = {
  /** Network / API */
  network: {
    fetchFailed: (url: string): string =>
      `网络请求失败：无法连接 ${url}。请确认手机能打开服务器 HTTPS 地址、服务器证书有效，并且 API 地址只填写域名根地址（例如 https://timedata.yanzhou.icu，不要带 /api）。`,
    timeout: (timeoutMs: number, url: string): string => `网络请求超时（${timeoutMs}ms）：${url}`,
  },

  /** Sync flow */
  sync: {
    failed: "同步失败",
    forceReplaceFailed: "强制替换失败",
    diagnosticsFailed: "同步诊断失败",
    forcePushPrepareFailed: "全量推送准备失败",
    forcePushFailed: "全量推送失败",
    conflictResolutionFailed: "冲突处理失败",
  },

  /** Entry editing */
  entry: {
    overlapBlockedTitle: "无法保存",
    overlapBlockedBody: "这段时间会把已有记录切成两段，请先手动调整原记录后再保存。",
    overlapWarnTitle: "时间段与已有记录重叠",
    overlapWarnBody: (count: number): string =>
      `这段时间与 ${count} 条已有记录重叠。保存后会自动裁剪或删除被覆盖的记录，是否继续？`,
  },

  /** Confirm dialog generic labels */
  dialog: {
    confirm: "确认",
    cancel: "取消",
    ok: "知道了",
    back: "返回",
    continueSave: "继续保存",
  },
} as const;

export type Messages = typeof messages;
