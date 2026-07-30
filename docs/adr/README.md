---
type: adr
status: living
---

# ADR 索引

> 架构决策记录一览。**一条决策一个文件，正文不可改写**——决策变了就写新 ADR 并在"关系"列注明修订关系，旧文保留为历史。
> 新增 ADR = 建 `NNNN-<slug>.md` + 在下表**追加一行**。行级信息只写标题/日期/状态/一句话，细节看原文。

| # | 标题 | 日期 | 一句话 | 关系 |
|---|---|---|---|---|
| [0001](0001-cli-as-only-write-path.md) | CLI 是 AI/脚本唯一写入路径 | 2026-05-08 | 数据写入只走 CLI 网关，不让 AI 直接碰 DB | 被 [0011](0011-server-api-as-write-boundary.md) 修订 |
| [0002](0002-sync-not-equal-backup.md) | Sync 与 Backup 是两件事 | 2026-05-08 | 同步是多设备一致性，备份是时间点快照，不互相替代 | 被 [0012](0012-sync-ledger-and-domain-registry.md)、[0015](0015-remove-client-auto-snapshots.md) 部分修订 |
| [0003](0003-backup-format-versioning.md) | Backup JSON 带版本号 | 2026-05-08 | 备份格式是 `timedata.backup.v1`，导入按版本分派 | |
| [0004](0004-time-format-utc.md) | 时间字段统一 UTC ISO | 2026-05-13 | 存储层只存 UTC ISO，本地口径在展示层换算 | |
| [0005](0005-cli-surface-expansion-deferred.md) | CLI 命令面扩展暂缓 | 2026-05-13 | 不为一次性需求加命令，先看是否走既有面 | 延续 [0001](0001-cli-as-only-write-path.md) |
| [0006](0006-sync-tombstone-retention.md) | 墓碑保留必须看 watermark | 2026-05-18 | `sync_tombstones` 清理要等最慢设备读数越过，否则删除丢失 | 被 [0012](0012-sync-ledger-and-domain-registry.md) 延续 |
| [0007](0007-auto-backup-and-import-naming.md) | 导入恢复的分类名一致性是特性 | 2026-05-18 | 同名分类合并而非重建，是有意行为不是 bug | 所依赖的自动备份机制已随 [0015](0015-remove-client-auto-snapshots.md) 退役 |
| [0008](0008-dexie-single-version-and-schema-cleanup.md) | Dexie 单版本化 + SyncLog 紧化 | 2026-05-18 | 客户端 schema 演进只加版本链、不改历史声明 | |
| [0009](0009-2026-05-19-review-deferred-and-out-of-scope.md) | 2026-05-19 审查的推迟与不排期项 | 2026-05-19 | 一次审查里明确"不做"的清单，防止反复重提 | |
| [0010](0010-quick-notes-independent-data-domain.md) | QuickNote 是独立数据域 | 2026-06-01 | 速记不挂任务，自成同步域 | |
| [0011](0011-server-api-as-write-boundary.md) | 写入边界放宽为服务端受控 API | 2026-06-03 | 写入权威从"CLI 唯一"改为服务端 API 校验边界 | 修订 [0001](0001-cli-as-only-write-path.md) |
| [0012](0012-sync-ledger-and-domain-registry.md) | 同步收敛为账本模型 + 域登记簿 | 2026-06-13 | 服务器 `sync_seq` 是唯一权威序列，pull 只认 `sinceSeq`；加域只登记一行 | 修订 [0002](0002-sync-not-equal-backup.md)，延续 [0006](0006-sync-tombstone-retention.md)/[0011](0011-server-api-as-write-boundary.md) |
| [0013](0013-capability-token-tiers.md) | 能力令牌分层 | 2026-06-16 | master token 全权，agent token 只开少数预定义动作 | 延续 [0011](0011-server-api-as-write-boundary.md) |
| [0014](0014-task-tags-vs-fields.md) | tags 与结构化字段的边界 | 2026-06-16 | 承重信号进字段，轻量语义标记走 tags | 正文含已退役的 `turn`（2026-06-20 M2），保留为历史 |
| [0015](0015-remove-client-auto-snapshots.md) | 退役设备端自动快照 | 2026-07-02 | 删 autoBackups 整层，危险操作改如实警示 | 修订 [0002](0002-sync-not-equal-backup.md)/[0007](0007-auto-backup-and-import-naming.md) |
| [0016](0016-push-latestseq-and-pull-pagination.md) | push 回执带 latestSeq + pull 分页 | 2026-07-02 | 写后无插队则跳过回声 pull；pull 支持 limit 分批 | 纯增量，不触 [0012](0012-sync-ledger-and-domain-registry.md) 同版本约束 |
| [0017](0017-sync-stale-guard.md) | 冲突按时间戳线性化（staleGuard） | 2026-07-04 | 服务端拒绝过期来包，终结"谁后到谁赢整行覆盖" | |
| [0018](0018-tasks-completion-op.md) | tasks 完成语义用 op 授权写入 | 2026-07-04 | 勾选走显式 op，旧快照的 `done` 不再回翻 | 补 [0017](0017-sync-stale-guard.md) 的 LWW 整行漏洞 |
| [0019](0019-destructive-sync-operations-preserve-ledger.md) | 破坏性同步操作保留只增账本 | 2026-07-10 | force-push / reset 不清账本，删除差异照常传播 | 延续 [0012](0012-sync-ledger-and-domain-registry.md) |
| [0020](0020-sync-push-request-idempotency.md) | push requestId 幂等与响应回放 | 2026-07-23 | 弱网对冲重放同一 requestId 回放首发响应，不重复记账 | |
| [0021](0021-sse-bump-carries-changes.md) | SSE bump 携带增量数据 | 2026-07-23 | push 造成的 changes 搭 bump 车直推，收端免一轮 pull；超限即退化 | 延续 [0012](0012-sync-ledger-and-domain-registry.md)，背景见 [0020](0020-sync-push-request-idempotency.md) |
| [0022](0022-diary-list-marker-strict-markdown.md) | 日记列表识别钉死为 Markdown 标准 | 2026-07-27 | 形近写法（全角/无空格）一律普通文本，否决识别放宽与提示机制 | |
| [0023](0023-diary-editor-remount-on-width-breakpoint.md) | 日记编辑器跨宽窄断点重挂，知情不修 | 2026-07-26 | 1024px 断点两侧元素类型不同致重挂丢撤销栈；修法要动 APK 主场景的窄屏布局且 jsdom 验不出，风险不对称 | |
| [0024](0024-retire-health-subsystem.md) | 退役健康子系统，数据层保留 | 2026-07-29 | 佳明体征/跑步 UI 与抓取管线全删、移交独立项目 run-track；6 张表与 6 个同步域刻意留着（删域是破坏性协议变更），回溯点 tag `retire/health` | 受 [0012](0012-sync-ledger-and-domain-registry.md) 的封闭登记簿约束 |
| [0025](0025-new-ip-alert-scoped-by-asn-and-city.md) | 陌生来源提醒按「运营商+城市」收敛，不再按精确 IP | 2026-07-30 | 动态 IP 与 VPN 出口下按精确 IP 去重永远确认不完；改按 ASN+城市收敛并显示 GeoLite2 中文归属地，删 `known_ips` 换 `known_ip_scopes`，主动降低灵敏度换「用户真的会看」 | |
| [0026](0026-content-tint-shared-palette-shape-distinguishes-type.md) | 项目与标签共用一组 tint token，类型区分靠形状不靠颜色 | 2026-07-30 | 用户内容身份色统一走 `--color-tint-1..12`（明度 60–65%，避开 accent/ok/warn）；圆点 = 项目、`#` = 标签，颜色只管同类型内区分个体；`TAG_PALETTE` 12 个裸 hex 退出 allowlist | |

## 按主题速查

- **同步内核**：0012（账本+登记簿）→ 0006（墓碑）、0016（免回声+分页）、0017（staleGuard）、0018（完成 op）、0019（破坏性操作）、0020（push 幂等）、0021（bump 带数据）
- **写入边界与鉴权**：0001 → 0011 → 0013、0005、0025（陌生来源收敛）
- **备份**：0002、0003、0007、0015
- **数据建模**：0004（UTC）、0008（Dexie 版本链）、0010（QuickNote 域）、0014（tags vs 字段）
- **日记编辑器**：0022（列表识别口径）、0023（跨断点重挂）
- **设计语言**：0026（用户内容身份色共用 tint 色板 + 形状分型）
- **范围决策**：0005、0009、0024（健康子系统退役）
