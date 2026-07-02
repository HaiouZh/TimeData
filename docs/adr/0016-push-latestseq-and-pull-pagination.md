# ADR 0016：push 回执带 latestSeq 免回声 pull 与 pull 分页

- 状态：已采纳（2026-07-02）
- 关联：延续 [ADR 0012](./0012-sync-ledger-and-domain-registry.md) 的账本模型；本次为纯增量可选字段，**不**触发 ADR 0012 的 server/client 同版本硬约束
- 设计来源：本地 spec `docs_local/specs/2026-07-02-同步体验提速-metaspec.md` §S3（2026-07-02 用户拍板"核心+分页"）

## 决策

1. **push 回执带 `latestSeq` + `appliedCount`（纯增量可选字段）**：`/api/sync/push` 响应新增 `latestSeq`（apply 后账本最新号）与 `appliedCount`（本次 push 实际记账数 = apply 事务前后 `getLatestSeq()` 之差，不依赖 resolver 内部 applied 语义）。rejected 的 409 响应同样带这两个字段（`appliedCount: 0`）。
2. **写后无插队跳过回声 pull**：客户端 push 后判定 `latestSeq − baseSeq === appliedCount`（代数上等价"push 落地前服务端 latestSeq 恰好等于客户端游标"，即区间 `[baseSeq+1 .. latestSeq]` 全部由本次 push 产生、无别的设备插队），成立**且** push 全干净（`rejected === 0 && conflicts === 0 && issues.length === 0`）**且** 三个 seq 字段均非 null 时，直接 `setLastSyncedSeq(latestSeq)` 推进游标、跳过回声 pull——写后仅 push 一个请求。任一条件不满足（含旧服务端无字段、`baseSeq` 为 null 即从未同步）回退现行为照旧 pull。
3. **pull 支持 `limit` 分批**：`/api/sync/pull` 请求可带 `limit`，响应带 `nextSinceSeq`/`hasMore`。客户端 `fetchPullBatches`（`engine.ts`）逐批 apply，**逐批**把游标推进到本批最后 change 的 `nextSinceSeq`（**绝不**中途跳到 `latestSeq`），批间 `yieldToMainThread()`（`setTimeout(0)`）让出主线程；`PULL_PAGE_LIMIT = 500`，日常量小单批等价现状，长离线积压才分批。游标推进逻辑只在 `fetchPullBatches` 一处，`syncPull`（repair 跳过策略）与 `syncPullSinceSeq`（conflict 检测）各以回调注入自己的 apply 逻辑。

## 理由

- **回声 pull 多是白跑**：安静环境写一条数据，push 后的回声 pull 拉回的正是自己刚推上去的东西——S0 埋点确认它占写后链路一半的往返。账本已有 `sync_seq` 单调号，服务端返回 `latestSeq`/`appliedCount` 即可让客户端零成本判定"这段区间全是我推的"。
- **判定天然安全（宁多拉不跳账）**：`appliedCount` 取自服务端 apply 事务前后 `getLatestSeq()` 差，是本次 push 真实记账数（`applyAll` 是 better-sqlite3 同步事务，中途不让出，前后差恒等于本批记账数，并发 push 只会抬高 before → 等式失败 → 回退 pull）。push 含 conflict/rejected 时无条件 pull 是双保险。跳过后推进游标到 `latestSeq`，自己 push 触发的 SSE 回声 bump 被现成 `shouldPullForBump` 挡掉，白捡。
- **分页防长离线卡 UI**：一台设备久未打开积压大量 change，一次性拉全部会阻塞主线程。分批 + 批间让出让首屏先可交互；逐批推进游标使中途失败可断点续传、不漏批（`nextSinceSeq` 按 seq id 前进、不管某条 change 是否被 `readRecord` 过滤成 null，故过滤不卡游标）。

## 后果

- 写后同步网络请求：无插队时从 push + pull 两个降到仅 push 一个；有插队/冲突仍两个，正确性不变。
- `SyncPushResponse.latestSeq/appliedCount`、`SyncPullRequest.limit`、`SyncPullResponse.nextSinceSeq/hasMore` 均为可选字段：旧客户端忽略、新客户端对旧服务端回退现行为，不触发 ADR 0012 的同版本硬约束（区别于 ADR 0012 里 `sinceSeq` 那种破坏性收窄——旧 APK 对新 server 的 pull 行为不变）。
- pull 游标推进语义从"整轮结束推到 latestSeq"变为"逐批推到 nextSinceSeq、末批 `advanceSeqCursor` 收尾到 latestSeq"，`advanceSeqCursor` 只在 `latestSeq > current` 时前进的幂等特性保证收尾不倒退、不重复跳号。

## 明确不做

- **不砍 push 的分类依赖回声（metaspec §S3 改动3）**：现状每 push 一条 time_entry 会附带其分类（`categoryDependencyChangesForEntry`）保证引用完整性，这让 `sync_seq` 随之增长（账本膨胀）。本期**不做**"只在服务端确缺时才带"——它与提速目标正交（判断"缺不缺"要么多一次往返、要么在客户端维护服务端镜像 = 新的不一致来源），且有漏推导致引用对不上的风险。账本膨胀是独立的"账本卫生"问题，真做时应走**服务端反馈缺失依赖**的方案（push 时服务端告知缺哪些依赖、客户端按需补），而非客户端猜；何况服务端已有备份滑窗控体积（见 backup.md），膨胀不紧迫。
- 不做 push+pull 合一端点：S3 后写后已仅 1 请求，无必要。
