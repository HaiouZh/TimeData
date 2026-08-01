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
      `网络请求失败：无法连接 ${url}。请确认手机能打开服务器 HTTPS 地址、服务器证书有效，并且 API 地址只填写域名根地址（例如 https://timedata.yanzhou.icu，不要带 /api）。自托管时还需确认服务端 ALLOWED_ORIGINS 已包含 https://localhost。`,
    timeout: (timeoutMs: number, url: string): string => `网络请求超时（${timeoutMs}ms）：${url}`,
    invalidJson: (url: string, snippet: string): string => `API 返回的 JSON 无法解析：${url} - ${snippet}`,
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
    overlapBlockedBody: "这段时间会把已有记录切成两段，请先手动调整原记录后再保存。",
    overlapWarnTitle: "时间段与已有记录重叠",
    overlapWarnBody: (count: number): string =>
      `这段时间与 ${count} 条已有记录重叠。保存后会自动裁剪或删除被覆盖的记录，是否继续？`,
  },

  /** TOTP 两步锁（设置页 + 危险操作弹码对话框） */
  totp: {
    sectionTitle: "两步验证锁（TOTP）",
    sectionIntro: "启用后，导出、重置、全量推送与备份删除等危险操作需要动态验证码。",
    statusEnabled: "两步锁已启用",
    statusDisabled: "两步锁未启用",
    enableButton: "启用两步锁",
    scanHint: "同一二维码请同时扫进至少两处：手机验证器 + 电脑验证器/密码管理器。",
    secretLabel: "密钥（无法扫码时手动输入）",
    recoveryCodesLabel: "恢复码",
    recoveryCodesOnce: "恢复码只显示这一次，请存入密码管理器。",
    recoveryCodesLost: "忘了全部？登录服务器删除 TOTP 配置可重置——见运维文档。",
    confirmInputLabel: "输入验证器中的 6 位动态码以完成绑定",
    confirmButton: "确认绑定",
    confirmFailed: "验证码错误，绑定失败，请重试。",
    setupFailed: "两步锁初始化失败",
    statusLoadFailed: "两步锁状态加载失败",
    disableButton: "停用两步锁",
    disableInputLabel: "输入动态码或恢复码以停用",
    disableConfirmButton: "确认停用",
    disableFailed: "验证码错误，停用失败，请重试。",
    // —— 危险操作弹码对话框 ——
    promptTitle: "需要动态验证码",
    promptPlaceholder: "6 位动态码或恢复码",
    promptRetry: "验证码错误，请重新输入。",
    promptCancel: "取消",
  },

  /** 陌生来源提醒（服务端数据洞察页） */
  newIpAlert: {
    title: "检测到陌生来源",
    hint: "以下来源（按运营商 + 城市划范围）首次使用带凭证的令牌访问服务器。同一范围内换 IP 不再重复提醒。若不是你本人或已授权的设备，请立即更换令牌。",
    acknowledge: "知道了",
    rowBadge: "新来源",
    /** 归属地库未就绪时的提示。缺哪个库决定收敛退化到哪一档，所以分开说。 */
    geoipMissingBoth: "归属地库未就绪：两个 GeoLite2 库都没读到，暂时显示不出地址，来源只能按 IP 网段粗略归并（同一运营商跨网段换 IP 仍会重复提醒）。",
    geoipMissingCity: "归属地库不完整：缺 GeoLite2-City，能看到运营商但看不到地址；来源只能按运营商整体归并——同一运营商在任何城市换 IP 都不再提醒，提醒范围比两库齐全时宽得多。",
    geoipMissingAsn: "归属地库不完整：缺 GeoLite2-ASN，能看到地址但认不出运营商，来源只能按 IP 网段粗略归并。",
    geoipMissingChinaTable: "中国归属地表未就绪：中国 IP 只能显示国家、看不到省市，来源无法按省市细分。该表随镜像发布，出现此提示说明构建或镜像有问题。",
    geoipHowTo: "把 GeoLite2-City.mmdb 与 GeoLite2-ASN.mmdb 放进服务器 data/geoip/ 后重启容器即可。",
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
