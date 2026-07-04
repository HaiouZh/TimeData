# 0017 同步冲突按时间戳线性化（staleGuard）

## 状态

已采纳（2026-07-04）

## 背景

服务端原冲突语义为“谁后到服务器谁赢，整行覆盖”：`applyLwwChange` 不比较来包时间戳，`analyzePushBaseSeq` 探测到重叠也只拍备份不拦截。离线旧设备上线可静默顶掉新数据，ToDo 勾选是最高频受害字段之一。

## 决策

1. `applyChange` 增加 opt-in 的 `staleGuard`：来包时间戳 `<=` 服务器现存行 `updated_at` 或 tombstone `deleted_at` 时拒收，返回 `stale_change_rejected`；拒收不占 `sync_seq`。
2. 守卫只对冲突记录生效：push 路由按 `analyzePushBaseSeq().overlappingRecords` 启用；`unknown_base` 则全量保守启用。不无条件全比的原因是服务器分配的 `updated_at` 恒晚于客户端编辑时间，无条件比较会误拒同设备快速连续编辑。
3. 客户端对 `stale_change_rejected` 放弃本地主张：标对应 `syncLog.synced=1`、放入 `pushIssues`，由 echo pull 落地服务器版本。不放弃会死循环：pending 永挡 pull、push 永被拒。
4. 客户端记录本地与服务器时间差；偏差超过 60 秒在设置页告警，提示用户校准系统时间。

## 后果

- “离线旧设备顶新数据”被堵死；被拒改动进设置页同步问题列表，救援靠受保护备份。
- “后发编辑带旧字段整行赢”（例如后拖排序翻掉勾选）仍存在，由 P2 的 tasks 完成语义意图化解决，见 `docs_local/specs/2026-07-04-同步冲突按时间戳线性化-design.md`。
- 部署顺序应先客户端后服务端：旧客户端没有防死循环补丁，违序会空转重推，但不会丢服务器数据。
