# ADR 0015：退役设备端自动快照（autoBackups）

- 状态：已采纳（2026-07-02）
- 关联：修订 [ADR 0002](./0002-sync-not-equal-backup.md) 的客户端备份分层、[ADR 0007](./0007-auto-backup-and-import-naming.md) 的自动备份命名（该机制整体退役）；延续 [ADR 0008](./0008-dexie-single-version-and-schema-cleanup.md) 的 Dexie 版本演进约定
- 设计来源：本地 spec `docs_local/specs/2026-07-02-同步体验提速-metaspec.md` §1（2026-07-02 用户拍板）

## 决策

1. **客户端自动滚动备份整层退役**：删除 `packages/client/src/backup/autoBackup.ts` 模块（`createAutoBackup` / `listAutoBackups`）、同步主链的 `beforeMutating` 备份注入点、`forceReplace` / `forcePushToServer` 前的本地快照、`/settings/data/backup-history` 展示恢复页，以及分类 mutation 对历史快照的级联 patch（`useCategories.ts`）。
2. **Dexie v15 物理删表**：`db.version(15).stores({ ..., autoBackups: null })`，老设备按版本链升级时自动清掉 IndexedDB 存量快照；v1–v14 历史声明不动。
3. **危险操作文案改为如实警示**：强制替换（云端覆盖本地）不再声称"会先自动备份"，改为明确警告"本地未同步的改动将丢失"；强制推送（本地覆盖云端）方向的安全网是服务端 `sync_force_push` 受保护备份。

## 理由

- **它串行阻塞在同步主链上**：每轮需要同步的 `regularSync` 都先全量读取并序列化 `categories` + `timeEntries` + `tasks` 三张表再落 IndexedDB，纯 pull 也不例外——是"同步体验提速"工程（S1 链路瘦身）实测确认的主链耗时项之一。
- **恢复价值已被服务端备份覆盖**：服务端已有每日 `auto_daily` 定时备份 + 危险路径（seq 冲突、重叠删除、force-push、手动）受保护备份（见 backup.md §6）；设备端这层只快照三张表、不落磁盘、清浏览器数据即消失，冗余且保护面更窄。
- **维护成本外溢**：分类每次 rename/调色/归档/排序都要在事务里级联 patch 全部历史快照，写入路径和测试面都被这层放大。

## 后果

- 强制替换（云端覆盖本地）前不再有本地快照；本地未同步改动的丢失风险由确认弹窗如实警示，用户可先手动导出 Backup JSON。
- 数据恢复能力 = 手动导出的 Backup JSON + 服务端备份（每日 + 危险路径受保护 + 手动）。
- 同步分段计时的 `backup` 阶段随之退役（`SyncPhaseName` 收窄）；存量 localStorage 计时数据带旧阶段键仍被宽容解析。

## 明确不做

- 不提供"恢复历史快照"的替代 UI——需要回滚时走服务端备份或手动导出文件。
- 不在强制替换前自动触发文件下载（保持操作轻量；用户可自行先导出）。
