# ADR 0037：有游标的无 pending 同步直接增量 pull，status 预查只留给无游标设备

- 状态：已采纳（2026-10-10）
- 关联：不修订 [ADR 0012](0012-sync-ledger-and-domain-registry.md)（no-op 判据仍是「无待上传且读数不落后于云端 `latestSeq`」，只是 `latestSeq` 改由 pull 响应提供）；机制见 evergreen [sync](../evergreen/sync.md#sync-overall-flow)

## 决策

1. `regularSync()` 在本地无待上传、且同步游标 `> 0` 时，**不再先发 `GET /api/sync/status`**，直接发 `sinceSeq = 游标` 的增量 pull。首批响应 `latestSeq === 游标` 即 no-op（服务器返回空批），更高则同一次请求里把变更拉回落库。
2. 账本倒退检查（服务器 `latestSeq` < 本地游标 → 报「同步账本异常」）随之搬到增量 pull 的首批：落库、推游标之前就拦下（`syncPullSinceSeq({ ledgerGuard: true })`）。
3. **游标为 0（新设备 / 重置后）保留 status 预查**：那时直接 pull 等于 `sinceSeq=0` 的全量拉取，要验 TOTP；服务器为空时 status 一次即可判 no-op，不打扰用户。
4. 打开会话的网络细分（`open_session.net`）改取本次打开首个同步读请求（status 或 pull，发起最早者），不再只认 status。

## 理由

- status 在这条路上只有两个用途——用 `latestSeq` 判 no-op、用 `serverTime` 记时钟偏差——增量 pull 的响应两样都带，服务端零改动。
- 两步串行是纯网络代价：服务端处理 status / pull 各只需毫秒级，2026-10 安卓回前台实测 status 约 1.0 s、pull 约 0.5 s，有新数据的那部分打开（约四分之一）因此多付一个往返。直接 pull 把它降到一个；无新数据的打开仍是一个往返，不变慢。
- 代价：服务端每次回前台多写一条 `pull_returned` 审计行（status 不写）；报告里 status 段在新构建上变稀，按构建分组对比时以 pull 段与整体 `syncMs` 为准。
