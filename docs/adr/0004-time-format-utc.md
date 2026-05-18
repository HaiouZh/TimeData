---
type: adr
status: accepted
date: 2026-05-13
---

# ADR 0004 — 时间字段统一为 UTC ISO

## 状态

Accepted。本文只记录决策；实际落地必须遵守本文的分阶段门控。历史设计和实施过程文档保存在本地-only 的 `docs_local/`。

## 背景

TimeData 当前混用了两套时间字符串格式：

- `Category.createdAt/updatedAt`、`TimeEntry.createdAt/updatedAt`、`SyncChange.timestamp` 使用 `new Date().toISOString()`，是带 `Z` 的 UTC ISO 字符串。
- `TimeEntry.startTime/endTime` 由客户端和 CLI 按本地日期时间拼接，例如 `2026-05-13T15:00:00`，不带时区后缀。
- 服务端同步日志和 tombstone 使用 SQLite 当前时间，语义上也是 UTC。

这种混用已经成为跨端契约风险：

1. 同步、时间轴和服务端校验多处依赖字符串字典序比较。只要同一个集合里同时出现 `2026-05-13T07:00:00.000Z` 和 `2026-05-13T15:00:00`，字典序就不再等价于真实时间顺序。
2. `isFutureLocalDateTime`、服务端 `nowLocalString` 等函数假设输入是本地时间字符串；UTC 字符串进入这些路径会被误判。
3. `Asia/Shanghai` 在客户端、服务端同步校验、服务端 CLI entry service、后台洞察等位置分散实现，无法集中审计。
4. Backup v1 没有声明 `timeEntries.startTime/endTime` 的时区语义；如果直接改字段含义，会破坏旧备份兼容性。

项目红线 #6 已明确：目标是一律 UTC，但单方面改一端会破坏字典序比较。因此这不是普通重构，而是需要 ADR、设计、阶段门控、备份格式升级和一次性数据迁移的契约变更。

## 决策

**所有跨端存储与传输的时间字符串字段最终统一为带 `Z` 的 UTC ISO 字符串。**

目标示例：

```text
2026-05-13T07:00:00.000Z
```

具体规则：

1. `TimeEntry.startTime/endTime` 迁移为 UTC ISO 后，客户端 Dexie、服务端 SQLite、Backup JSON、同步 payload、force-push payload 都存同一种格式。
2. `Category.createdAt/updatedAt`、`TimeEntry.createdAt/updatedAt`、`SyncChange.timestamp` 保持 UTC ISO，不降级为本地字符串。
3. 展示层按 `APP_TIME_ZONE = "Asia/Shanghai"` 转回用户可读的本地时间；本地时区字符串只允许作为 UI 输入/显示边界的临时值，不再作为持久化格式。
4. Backup JSON 升到 `timedata.backup.v2`，显式声明 `timeFormat: "utc"`；读取 v1 时按 `Asia/Shanghai` 解析旧本地字符串并转换到 v2 内部表示。
5. Dexie 升到 v3，通过 upgrade 把本地 `timeEntries.startTime/endTime` 从旧本地字符串转换为 UTC ISO。
6. SQLite 不改 schema 字符串；按红线 #6 的约束，通过一次性迁移脚本转换已有 `time_entries.start_time/end_time` 的值，并在迁移前创建受保护服务端备份。
7. CLI 继续接收用户输入的 `YYYY-MM-DD` + `HH:mm`；转换为 UTC ISO 的职责在 server API 边界内完成，CLI 不直接推断数据库格式。

## 分阶段门控

本决策必须分阶段落地，每阶段独立 PR 和独立验证：

1. **阶段 0：ADR + 设计 + 实施计划**。只写文档，不写运行代码。
2. **阶段 1：shared 引入 brand/格式工具**。新增 `UtcIsoString` / `LocalDateTimeString` 和格式校验工具，但不改变任何现有字段类型或数据。
3. **阶段 2：server 抽公共时区工具**。把分散的 `Asia/Shanghai` 转换逻辑集中到 `packages/server/src/lib/timezone.ts`，不改变数据格式。
4. **阶段 3：实际数据迁移**。Dexie v3、SQLite 一次性迁移、Backup v2、client/server/CLI 写入路径同时切到 UTC。阶段 3 是不可逆迁移点，必须先完成 staging 预演和真机回归。
5. **阶段 4：删除兼容期并强类型化**。稳定观察 1–3 个月后，把共享类型收紧为 `UtcIsoString`，删除旧格式写入路径。

阶段 3 之前禁止把 `TimeEntry.startTime/endTime` 的某一端单独改成 UTC。

## 理由

1. **统一排序语义**：UTC ISO 的字典序与时间顺序一致，能让同步 cursor、时间轴排序、overlap 判断、后台筛选继续使用简单比较。
2. **跨端一致**：Web、Android 壳、CLI、server、备份文件都共享同一字段语义，不再依赖“当前用户都在上海时区”这类隐含假设。
3. **降低迁移歧义**：Backup v2 的 `timeFormat: "utc"` 明确说明文件语义；v1→v2 转换也有确定入口。
4. **保持 server 权威校验**：用户输入仍可以是本地日期时间，但最终合法性、未来时间、重叠、分类存在性都由 server 以 UTC 语义判定。
5. **符合既有红线**：不改 SQLite schema 字符串、不绕过 CLI/server 写入路径、不把 Backup 当 Sync、不破坏 v1 备份读取。

## 替代方案为什么被否

**继续混用格式**：短期不用迁移，但每个新功能都要记住“哪些字段是本地、哪些字段是 UTC”，且字典序 bug 会越来越隐蔽。这个成本会反复出现在同步、备份、统计和 UI 显示里。

**只把客户端新写入切到 UTC，旧数据保留本地格式**：会立刻在 Dexie、同步队列、时间轴排序和 overlap 检查里制造混合格式，正是红线 #6 明确禁止的风险。

**只在展示层修补**：展示层可以把本地字符串格式化得更好，但无法解决同步、校验、备份和服务端脚本对字段语义的分歧。

**改 SQLite 列类型或 schema 字符串**：已部署实例不会重建表；项目当前迁移机制不支持原地改已有列含义。应使用一次性数据迁移脚本转换值，而不是假装 schema 修改会生效。

**把 CLI 改成直接发送 UTC 并保持 server 不变**：CLI 不是唯一写入端，Web 同步和 force-push 仍会产生旧格式；并且 server 是权威校验边界，格式切换必须在 server 侧统一落地。

## 后果

**正面**：

- `TimeEntry` 的真实时间语义跨 client/server/cli/backup 统一。
- 字符串比较重新安全，便于同步增量、overlap 和时间轴逻辑继续演进。
- Backup 格式演进有明确版本边界，旧备份仍可读。
- 后续可以用 TypeScript brand 类型收紧契约，减少新旧格式误传。

**负面 / 成本**：

- 阶段 3 是高风险数据迁移，需要 staging 预演、受保护备份、真机 UI 回归和观察期。
- 迁移期会同时存在 v1/v2 备份读取、Dexie v2/v3、服务端旧库/新库等兼容路径，测试矩阵增大。
- 展示层不能再靠 `slice(11, 16)` 直接取时钟，必须统一走时区格式化工具。
- CLI 与 server API 的列表/创建语义要重新审计，确保用户输入的本地日期仍得到符合直觉的结果。

## 合规要求

- 符合红线 #1：AI/脚本仍只能通过 CLI 或 server API 写数据，不能直接改 SQLite、IndexedDB 或备份文件。
- 符合红线 #2：Sync 与 Backup 仍独立；迁移脚本创建的服务端备份只是迁移安全网，不改变用户 Backup JSON 的语义。
- 符合红线 #3 / ADR 0003：Backup 格式变更必须升到 v2，并保留 v1 兼容读。
- 符合红线 #4：时间合法性、重叠、分类存在性等最终判定仍在 server。
- 符合红线 #6：不原地修改 SQLite schema 字符串，改字段含义走一次性迁移代码。
- 符合同步兜底红线：普通同步、启动同步、APK 更新后不得自动触发全量覆盖或自动迁移云端；服务端 UTC 迁移必须是人工执行的受控操作。

## 实现入口

- 共享契约：`packages/shared/src/types.ts`、`packages/shared/src/index.ts`
- 客户端时间工具：`packages/client/src/lib/time.ts`
- 客户端 Dexie：`packages/client/src/db/index.ts`
- 客户端记录写入：`packages/client/src/hooks/useEntries.ts`、`packages/client/src/components/EntryForm.tsx`
- 客户端 Backup：`packages/client/src/backup/schema.ts`、`packages/client/src/backup/validateBackup.ts`、`packages/client/src/backup/exportBackup.ts`、`packages/client/src/backup/importBackup.ts`
- 客户端同步：`packages/client/src/sync/engine.ts`
- 服务端同步校验：`packages/server/src/sync/validation.ts`
- 服务端 CLI entry API：`packages/server/src/lib/entry-service.ts`
- 服务端 force-push：`packages/server/src/routes/sync.ts`
- 服务端后台洞察：`packages/server/src/routes/admin.ts`
- 服务端备份：`packages/server/src/sync/backup.ts`
- CLI 输入校验：`packages/cli/src/lib/validation.ts`、`packages/cli/src/commands/log.ts`、`packages/cli/src/commands/list.ts`

## 链接

- 历史设计和实施过程文档已迁入本地-only 的 `docs_local/`，公开仓库只保留本 ADR 与长期文档结论。
- 数据模型长期文档：[`docs/evergreen/data-model.md`](../evergreen/data-model.md)
- Backup 版本 ADR：[`docs/adr/0003-backup-format-versioning.md`](0003-backup-format-versioning.md)

## 2026-05-18 修订

`isUtcIso` 与 server `validateEntryShape` 统一调用 `UtcIsoStringSchema`，严格只接受 `YYYY-MM-DDTHH:mm:ss.sssZ` 形式。
存量数据格式不变（client 一直用 `Date.prototype.toISOString()` 产出）。
