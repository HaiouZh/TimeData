---
type: evergreen
title: 文档组织规则 · 检查与闭环
covers:
contracts:
  - scripts/check-evergreen-docs.mjs
last-reviewed: 2026-08-21
---

# 文档组织规则 · 检查与闭环

> [返回文档组织规则](../_docs-guide.md)。本文说明文档检查脚本和 CI 闭环；写作规则见母文档，拆分与体量规则见 [拆分与体量](splitting.md)。

## 1. 检查脚本闭环

`scripts/check-evergreen-docs.mjs` 的 mode 让文档体系自洽：

| 命令 | 守什么 | 失败条件 |
|---|---|---|
| `check:docs:strict --since=<base>` | 改了契约点就同步对应文档 | 改动命中文档 `contracts`，而该文档没有一起改**且** `last-reviewed` 不是今天。日期恰为今天视同已复查——同日多批时前一批合并已把日期刷成今天，后一批再刷是 no-op、文档进不了 diff，reviewed 的事实只剩日期能表达。`covers` 不触发 strict |
| `check:docs:coverage --since=<base>` | 新源码必须有文档认领 | 新增文件落在 `COVERAGE_ROOTS` 下却不匹配任何 covers，且不属于测试、`.d.ts`、mock、夹具、story 或 `src/test/` 这类测试基建目录豁免 |
| `check:docs:size` | frontmatter 有效、单文档别膨胀到该拆 | frontmatter 形状错误、`covers`/`contracts` 双空、字符数超 hard cap、covers 数超基线，或基线漏项、保留已删除文档；另守 `AGENTS.md` 的入口体量闸（9000 字符——入口每次会话全文进 agent context，超闸的出路是机制沉 evergreen、细则沉 skill、入口留一句规则 + 指针，不是压缩措辞）。拆分处置见 [拆分与体量](splitting.md) |
| `check:docs:links` | 互链和指针不指向消失目标 | 链接源（`docs/evergreen` + `docs/adr` 全部文档，外加 `AGENTS.md` / `README.md`）里的 Markdown `.md` 链接不存在；目标 `.md#id` 缺独立 `<a id="..."></a>` 显式锚点；独立锚点行畸形；锚点 ID 重复 |
| `check:docs:stale` | `last-reviewed` 不过期 | **不失败,只列清单**——缺字段或超过 180 天的文档会被打印,但退出码始终为 0(脚本 help 里这一 mode 标的就是 warn)。它是给人看的复查提醒,不是闸;真要拦住过期文档需要另加机制 |

links 不校验同页 fragment、Markdown 标题自动锚点或 prose `§x.y`；拆分后这类引用按 [拆分与体量](splitting.md) 的四类手动扫描。锚点名必须是严格配对的 `<a id="..."></a>`，避免同名目标和格式畸形让链接看似有效却无稳定落点。**锚点 ID 要求全局唯一**：`findDuplicateAnchors` 拿一张跨全部长期文档的表判重，同一份文档内重复也照报——所以 ID 用 `<文档 slug>-<节号>` 前缀，不要只写 `s2`。

`COVERAGE_ROOTS` 是**硬编码的四个源根**（`packages/{client,server,shared,cli}/src/`），不是 `packages/*/src/**` 通配。当前 `desktop` / `mobile` 两个 package 没有 `src/` 目录，所以两种写法恰好等价；**将来任一个建了 `src/`，coverage 不会自动纳入它**，要手动改脚本的 `COVERAGE_ROOTS`。

新增 coverage 豁免前必须打开目标文件确认它只是测试基建 / mock / fixture / 类型声明等辅助面，或纯转发 shim / 通用技术 helper，且没有 grep 不出来的契约、状态机、不变量或跨模块联动。逐文件判定出的 helper 只用精确路径豁免，不能加目录通配；否则要由 evergreen `covers` 明确认领。

锚点有两种合法落点，都由 links 守：**独占一行时上一行必须留空**；**列表条目内嵌在内容行首**（`8. <a id="x"></a>正文`）。配对锚点不满足 CommonMark HTML block 的起始条件（开标签后跟的是闭标签而非空白），只能走行内 HTML——紧贴上一行正文会被并进上一段，锚点落到上一节，跳转差一节而 diff 看不出来。列表里也不能改用空行隔开：那会把一个列表切成两段 `<ol>`。

size 对 frontmatter 的 `covers:`、`contracts:` 要求 YAML 列表：冒号后必须留空再换行列 `- item`。`[]`、行尾注释或其他字符会把它解析为标量并报 `bad-type`。纯纵切文档可以 `covers:` 空、以 `contracts` 作为唯一闸；双空是 no-gate 失败。hard cap、soft cap 和 covers baseline 的详情见 [拆分与体量](splitting.md)。

脚本会在「要动 evergreen 文档」时打印母文档 §0 的内核摘要：strict / coverage 失败时跟随错误打印；改动集含 evergreen 正文（ADR 除外）时不论成功失败均打印自查提醒。摘要由 `EVERGREEN_RULES_SUMMARY` 维护；母文档 §0 内核变化时必须同步它。

## 2. 本地与 CI

CI 对非 bot PR 运行 `pnpm check:docs:strict --since=<base>` 与 `pnpm check:docs:coverage --since=<base>`；dependabot / renovate PR 运行 warn `pnpm check:docs --since=<base>`。`pnpm check:docs:size` 与 `pnpm check:docs:links` 在 CI 都跑；`pnpm check:docs:stale` 不在 CI。开发时 `pnpm check:docs` 是本地 warn 入口，帮助发现可能受影响文档；它不替代 CI 的 strict。`pnpm check:docs:stale` 是本地单独检查复查日期，`pnpm check:docs:size`、`:links` 可在文档重组后立即运行。

带改动集的模式必须给可靠 base。无参时脚本使用 `--since=HEAD`；提交干净后 diff 为空，会出现假通过。因此自测一律显式使用 `--since=main`，例如：

```powershell
pnpm check:docs:strict --since=main
pnpm check:docs:coverage --since=main
```

本机收工或合并前的 `pnpm gate` 串行执行 strict、size、coverage、links，并额外运行本地 `pnpm check:roadmap`；它是 docs_local 不入 Git 时唯一的 roadmap 程序检查。gate 不运行 warn 或 stale；日常的小改动可先跑聚焦检查，但 gate 仍是收工前的完整证据。
