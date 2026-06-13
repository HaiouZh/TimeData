# ADR 0012：同步收敛为账本模型 + 域登记簿

- 状态：已采纳（2026-06-13）
- 关联：修订 [ADR 0002](./0002-sync-not-equal-backup.md) 的同步判定细节；延续 [ADR 0006](./0006-sync-tombstone-retention.md)、[ADR 0011](./0011-server-api-as-write-boundary.md)
- 设计来源：本地 spec `docs_local/specs/2026-06-13-sync-ledger-design.md`

## 决策

1. **账本模型**：服务器 `sync_seq` 是唯一权威变更序列（只增不减）。每台设备只持有一个读数 `timedata_last_synced_seq`；普通同步的 no-op 判定 = 本地无待上传变更且读数不落后于云端 `latestSeq`。
2. **pull 只认 seq cursor**：`POST /api/sync/pull` 入参收敛为 `{ sinceSeq }`（0 或 null = 全量）。timestamp cursor（`since` / `lastSyncedAt`）、"最近 7 天"窗口、`legacy_snapshot_sync` 全量快照回退开关全部退役。
3. **域登记簿**：同步数据类型（域）登记在 `packages/shared/src/syncDomains.ts`（声明式配置：schema、排序优先级、冲突策略）与 `packages/server/src/sync/domains.ts`（可选钩子：validate / crossValidate / apply / readRecord + 通用 LWW 映射）。管线代码（validation / resolver / order / pull / status / contentHash）一律由登记簿驱动，不再按表名特判。新增纯 LWW 域只需登记配置，无需改管线。
4. **登记簿是封闭的**：加域必须改代码、过测试，与 `SyncPushReasonCode` 封闭枚举同等待遇。运行时 `SyncChangeSchema` 由登记簿生成，静态类型 `SyncChange` 在 `types.ts` 手工维护判别联合，两者同步修改。
5. **`updated_at` / `deleted_at` 由服务器在记账时分配**：客户端时钟（`change.timestamp` / `payload.updatedAt`）只作展示参考，排序权威是账本编号。时钟漂移问题从根上闭环。
6. **contentHash 降级为诊断工具**：不再参与普通同步主路径，仅保留在同步健康诊断（`getSyncHealth()`）做深度体检。

## 理由

- 个人中枢愿景需要不断新增数据域（ToDo、看板摄入、命令状态、消息）；改造前每加一个域要动十几处按表名的特判，改造后 LWW 域≈几十行。
- 账本编号天然解决"按时间戳追数据"的同毫秒丢失、时钟漂移、重放幂等等历史问题；三种 pull 问法并存是事故温床。
- 该模型与 Telegram updates（pts）同构，工程上经过大规模验证。

## 部署注意（破坏性变更）

- **旧客户端在新服务器上 pull 会得到 400**（`SyncPullRequestSchema` 收紧）。server / Web 客户端 / Android APK 必须同版本一起发布；先升级服务器再让所有设备更新 APK / 刷新 PWA。
- 设备本地残留的 `timedata_last_synced` / `timedata_legacy_snapshot_sync` key 由 `resetSyncCursors()` 顺手清理。
- **seq 回填**：seq-only pull 只通过 `sync_seq` 读数据，早于 seq 机制写入的历史行（含首次启动默认播种的分类）在 `sync_seq` 里没有记录，会对新 pull 不可见。`initializeDatabase()` 启动时调用 `backfillMissingSeq()`（`packages/server/src/db/backfillSeq.ts`）给缺 seq 的业务行补一条 `create` seq，幂等、跑一次即齐。范围不含早于 seq 机制的删除（tombstone 无对应 delete seq），那类行业务表里已不存在，属罕见边角。

## 明确不做（YAGNI，后续按需评估）

- 客户端 Dexie 表映射的登记簿化（engine pull 应用循环仍按表名分支）
- force-push `replaceServerData` 的泛化（全量特例，保持显式四表实现）
- seq 账本压缩 / 清理（个人数据量级下不值得引入数据复活风险，沿用 ADR 0006 思路）
- token 分级 / 命令白名单（命令通道立项时单独写 ADR）

## 验收

- 假域全链路测试 `packages/server/src/sync/fake-domain.e2e.test.ts`：零钩子 LWW 假域走完校验 → 排序 → 写入 → 记账 → seq 补差 → 墓碑全链路，证明"新域白捡同步"。
- 真实数据回放 `packages/server/src/__tests__/e2e/real-data-replay.test.ts`：把 `docs_local/fixtures/timedata.backup`（不进 Git）灌入管线再全量拉回，逐条对比业务字段；夹具缺失时跳过。
- 既有同步测试矩阵与 `sync-roundtrip` e2e 全部保持通过。
