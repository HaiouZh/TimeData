---
type: adr
status: accepted
date: 2026-05-08
---

# ADR 0003 — Backup JSON 格式带版本号

## 状态

Accepted。当前格式是 `"timedata.backup.v1"`，常量见 `packages/client/src/backup/schema.ts`。

## 背景

TimeData 的 Backup JSON 是用户保留在自己机器上的数据载体——可能是几个月前导出的、几年前导出的、或者是从一个老版本 App 升级前导出的。

如果格式不带版本号、字段直接散在根对象上：

```json
{ "categories": [...], "timeEntries": [...] }
```

将来想加字段（比如把 `autoBackups` 也包进去）、改字段（比如分类支持三级）、删字段，根本没法兼容老备份——读老备份时不知道是"老格式"还是"被破坏了"。

## 决策

**Backup JSON 必须带 `format` 字段，值是 `"timedata.backup.v<n>"`。当前是 `v1`。改格式必须升版本号。**

```json
{
  "format": "timedata.backup.v1",
  "exportedAt": "...",
  "appVersion": "...",
  "device": {...},
  "categories": [...],
  "timeEntries": [...]
}
```

### 升版本号的规则

1. 在 `schema.ts` 加 `BACKUP_FORMAT_V2 = "timedata.backup.v2"` 常量与对应 TS 类型 `BackupDocumentV2`。
2. **保留** v1 的类型、常量、校验函数。
3. `validateBackup` 改成：先看 `format` 字段，分发到 v1 / v2 各自的校验。
4. `importBackup` 同上：分版本读取，必要时先把 v1 数据转成 v2 内部表示再写入。
5. `exportBackup` 永远写最新版本（v2）。
6. 文档（`evergreen/backup.md` 第 7 节）更新 v1 / v2 字段差异表。

### 不能做的事

- ❌ 原地改 v1 字段含义（比如把 `appVersion` 从 string 改成 object）。
- ❌ 在 v1 后加新必填字段。可选字段可以加，但读 v1 时要假设它不存在。
- ❌ 把 `BACKUP_FORMAT_V1` 常量删掉。

## 理由

1. **用户数据是长期资产**：用户两年后想恢复一份旧备份，App 必须还能读。
2. **版本号 = 显式契约**：明确告诉读者"这是哪一版的格式"，而不是靠"看看字段在不在"猜测。
3. **明确的降级路径**：将来 App 不再支持 v1 时，可以让 `validateBackup` 返回 `{code: 'INVALID_FORMAT', message: 'v1 格式已不再支持，请用旧版本 App 先导出 v2'}`——而不是让代码隐式失败。
4. **避免"魔法兼容"代码**：没有版本号时，代码会写成"如果有 X 字段就这样，没有就那样"。这种 if 链很快就难维护。

## 替代方案为什么被否

**用 `appVersion` 字段做版本号**：`appVersion` 是 App 的版本号（比如 `0.1.0`），它和"备份格式版本"不是一回事——可以发布 App 0.1.0 → 0.5.0 而备份格式不变。两个 versioning concern 必须分开。

**Schema migration 框架**：太重。用户备份就是个 JSON，没必要引入 migration 库。手写 v1→v2 转换函数足矣。

## 实现要点

- `BACKUP_FORMAT_V1` 常量：见 `packages/client/src/backup/schema.ts`。
- 校验：`validateBackup` 第一步就是检查 `format`，不识别立刻拒绝。
- 错误码：`INVALID_FORMAT` 是 `BackupValidationErrorCode` 之一。
- 测试：`packages/client/src/backup/validateBackup.test.ts` 已覆盖"format 字段不对就拒绝"。

## 后果

**正面**：

- 格式可演进，老备份始终能读。
- 错误信号明确（"这不是合法 v1 格式" vs "这是损坏的文件"）。

**负面 / 成本**：

- 每次升级要写 v(n-1) → v(n) 的转换 + 多一份校验代码。
- 不能"清理"旧版本代码——用户的旧文件可能任何时候出现。

## 链接

- 实现：`packages/client/src/backup/schema.ts`、`validateBackup.ts`、`importBackup.ts`
- 相关文档：[`docs/evergreen/backup.md`](../evergreen/backup.md)

## 2026-05-18 修订

- 客户端不再持有 V1 校验路径：`validateBackup` 不再单独识别 `BACKUP_FORMAT_V1`，任何非 `BACKUP_FORMAT_V2` 都直接返回 `INVALID_FORMAT`。
- 本次修订仅清理"已不再活跃的版本"的校验代码，**规则本身不变**：任何破坏性格式变更仍须升版本号且保留旧版本读取能力。
- 关联决策：[`ADR 0008`](0008-dexie-single-version-and-schema-cleanup.md) 中关于 Dexie 单版本化的论证。
