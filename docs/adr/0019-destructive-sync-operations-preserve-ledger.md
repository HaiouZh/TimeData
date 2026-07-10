# ADR 0019：破坏性同步操作保留只增账本并传播差异

## 状态

已采纳（2026-07-10）

## 背景

普通增量同步以服务端 `sync_seq` 为权威只增账本，设备只保存一个 `sinceSeq`。旧 force-push、data reset 与 UTC reset 会清空或重建账本/墓碑，但它们只覆盖部分业务域，导致旧游标设备看不到删除、非覆盖域脱离账本，甚至因服务端序号回退而永久 no-op。

## 决策

1. `sync_seq` 与全域 tombstone 对所有写入口都是只增历史，force-push/reset 不得清空重编号。
2. force-push 保持现有五域公开载荷，将快照与服务器现状计算成 create/update/delete changes，在单事务内经正常 resolver 应用；非覆盖域业务行、seq 和 tombstone 原样保留。
3. 分类删除复用服务端级联，一次根 change 负责后代分类与关联 entries；根 delete seq 先写，使分页客户端先识别整树影响。
4. 客户端 force-push 只确认同一快照事务捕获的五域 pending 日志 ID；请求期间新日志和非覆盖域日志保留。
5. data reset / UTC reset 删除全部登记域，为每条旧记录写 tombstone + delete seq，再重建默认分类并写 create/update seq。
6. 破坏性操作先创建受保护 server backup；备份完成后若 `latestSeq` 与备份前不同则 409 重试，文件 I/O 不放进长 SQLite transaction。

## 后果

- 旧设备可沿原游标增量收到 force-push/reset 的删除和重建，不需要账本 epoch 才能完成当前语义。
- 非覆盖域不会因五域 force-push 丢账或丢墓碑。
- force-push/reset 会产生较多 seq 与 tombstone，这是低频冷路径的可接受成本；普通写后同步的请求数、防抖、快进判定和热路径扫描均不变。
- 若未来要做真正全域“新数据世代”或服务器恢复任意旧备份，仍应引入 `ledgerEpoch/datasetGeneration`；本 ADR 不把裸 seq 扩展成公开 epoch 契约。
