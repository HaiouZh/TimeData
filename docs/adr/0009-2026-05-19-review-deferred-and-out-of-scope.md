---
type: adr
status: accepted
date: 2026-05-19
---

# ADR 0009 — 2026-05-19 审查中的推迟项与不排期项

## 状态

Accepted。

## 背景

2026-05-19 三方审查（`docs_local/2026-05-19审查报告/`）整合到 `final-v3.md` 后，共得到 P1 / P2 / P3 / P4 四类条目：

- P1 + P2 全部纳入本轮实施（Plan 01-08）。
- P3 选做：3.1 timingSafeEqual、3.2 rate limit token hash、3.11 Gradle JVM、3.12 Dependabot —— 已在 Plan 01 / Plan 02 落地。
- P3 其余 8 项 + P4 全部 16 项 —— 不纳入实施，**本 ADR 沉淀理由**，作为后续重复审查时直接关闭的依据。

ADR 0007（C1 / C2 / D5）+ AGENT.md “项目定位边界”小节是 2026-05-18 已有的同类基线；本 ADR 在它们之上为 2026-05-19 新出现的具体条目补理由。

## 决策

### 一、P3 推迟项（不做，但承认是真实可改进点）

| 条目 | 内容 | 不做的理由 |
|---|---|---|
| 3.3 | vitest coverage 配置（不设阈值） | 不设阈值的 coverage 报告对单人项目价值边际低：CI 不会因此 fail，本地跑很少。若未来 TimeData 进入多人开发，再启用。 |
| 3.4 | 拆分 `packages/client/src/sync/engine.ts` | 该文件测试覆盖较完备，拆分有回归风险。保留为单文件，直到出现具体可读性痛点（例如新增大段同步逻辑时再拆）。 |
| 3.5 | 拆分 `packages/shared/src/types.ts` | Plan 03 已经把 Admin 部分拆出到 `admin-schemas.ts`。剩余核心 Category / TimeEntry / Sync 类型联动紧，拆分收益小。 |
| 3.6 | server `applyCategoryChange` CTE 优化 | 当前 N+1 在分类数 < 50 量级下无感知。数据规模触发再做：> 200 个分类且删除耗时 > 100ms 时启动。 |
| 3.7 | Dexie 复合索引 | 当前 entry 数 < 1 万条无感知。数据规模触发再做：> 5 万条且页面切换有顿挫时启动。 |
| 3.8 | client React.lazy 代码分割 | PWA 首次加载缓存后无影响；个人工具不存在“百万首屏请求”压力。 |
| 3.9 | CircularTimeline 几何函数提取 | 290 行内尚可管，是可测试性问题而非性能问题。首次出现需要为几何 bug 加单测时再拆。 |
| 3.10 | client ARIA 无障碍标签 | 单人工具，使用者已知键盘操作模式。 |

这些条目都**不应**在未来审查中再次被列入 P1 / P2 / P3 选做。如审查者认为状态变化（数据规模到达触发线、新增协作者等），请先在本 ADR 追加“重评估”段，再启动实施。

### 二、P4 不排期项（按项目定位边界明确排除）

依据 AGENT.md “项目定位边界”小节：单人自托管 + 本地优先 + 内网部署。下表条目在该模型下风险/收益不成比例，不纳入排期。

| 条目 | 项目定位下不做的理由 |
|---|---|
| rate limit 持久化 / 多实例共享 | 单实例部署，rate limit 内存即可。 |
| Docker socket 挂载替代方案 | 自更新设计所需；替代方案会让部署复杂度跃升数倍，且仍在自身信任链内。 |
| Token 改 httpOnly cookie | Bearer token 在 localStorage，XSS 风险存在；但单人自托管 + 内网部署下 XSS 触发面极窄；cookie 切换还会破坏 CLI 调用模式。 |
| force-push token 持久化 | TTL 5min；重启服务端后 token 自然失效，重新 `prepare` 即可——这是边界保护的副作用，不是 bug。 |
| timezone 配置化 | TimeData 设计就是 Asia/Shanghai 单时区工具；多时区会让“同一天 3:00 显示在哪”语义模糊。 |
| i18n / Web Vitals / Sentry | 个人工具，不为通用产品指标增加维护面。 |
| iOS 支持 | 项目定位 Android 壳；iOS 涉及苹果开发者证书 / TestFlight 流程，工时不在范围。 |
| mobile R8/ProGuard minify | PWA 壳，原生代码极少；minify 收益微小，且引入崩溃栈 obfuscation 调试负担。 |
| CSP headers | 代码注释已说明：SPA 的 inline styles 与 Vite chunk 让默认 CSP 必然冲突；要做需要 per-environment 配置，工时不在本轮范围。 |
| Windows token 文件 ACL | 本机部署，文件系统已经是 user-scope。 |
| `regularSyncInFlight` 跨 tab 锁 | 个人工具，多 tab 并发同步发生概率近 0；若发生，server 端 commit hash 会让一方落败重 pull。 |
| `syncPullRecent(7)` 硬编码 | 已有 seq cursor 主路径；这是完全冷启动兜底的退化窗口。 |
| client 同步幂等键 | server 已有 `(tableName, recordId, timestamp)` 级去重；client 再加一层无收益。 |
| evergreen 文档维护成本收敛 | 高质量文档是项目优点，不为“维护成本”压缩内容。 |
| `/api/version` 端点无认证 | 暴露 git sha 是预期行为（用于 CLI / 客户端版本协商）。 |
| Docker 备份未加密 | 单机文件系统权限隔离已足够；加密会破坏用户从外部解压 backup zip 查看分类名的预期。 |

## 后果

**正面**：

- 审查者下次再提同样问题时，可直接引用本 ADR 关闭，不再重排期。
- 把项目定位边界从 AGENT.md 的抽象描述具化到 2026-05-19 这批具体条目。
- 与 ADR 0007 形成同类基线，连续保留判断依据。

**负面 / 成本**：

- 若产品定位扩展（多用户 / SaaS / 多设备同步并发写），上表中“项目定位下不做”项需要重新评估。
- 推迟项若长期未触发条件，可能在多次审查中反复出现并被本 ADR 拒绝——这是预期。

## 后续审查的免疫力

未来 AI 或人审查若再次提出本 ADR 列出的同类问题，应：

1. 引用本 ADR 关闭，不重新列入排期。
2. 若审查者认为前提变化（如分类数到达 200 / entries 到达 5 万 / 部署模型变更），先在本 ADR 追加“重评估”段说明触发条件，再启动新实施 plan。
3. AGENT.md “项目定位边界”小节与本 ADR 组合使用：抽象边界 + 具体条目对照。

## 链接

- 三方审查：`docs_local/2026-05-19审查报告/{ccgpt,ccopus,ocglm}-v3.md`、`final-v3.md`
- 白话决策：`docs_local/2026-05-19审查报告/白话审批版.md`
- 实施 plan：`docs_local/2026-05-19审查报告/00-总实施计划.md` ~ `08-Mobile与依赖升级.md`
- 完成记录：`docs_local/2026-05-19审查报告/实施完成记录.md`
- 前序基线：[`ADR 0007`](./0007-auto-backup-and-import-naming.md)、AGENT.md “项目定位边界”小节
