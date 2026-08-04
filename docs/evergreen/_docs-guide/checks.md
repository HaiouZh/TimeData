---
type: evergreen
title: 文档组织规则 · 检查与闭环
covers:
contracts:
  - scripts/check-evergreen-docs.mjs
last-reviewed: 2026-08-04
---

# 文档组织规则 · 检查与闭环

> [返回文档组织规则](../_docs-guide.md)。本文说明文档检查脚本和 CI 闭环；写作规则见母文档，拆分与体量规则见 [拆分与体量](splitting.md)。

## 1. 检查脚本闭环

`scripts/check-evergreen-docs.mjs` 的 mode 让文档体系自洽：

| 命令 | 守什么 | 失败条件 |
|---|---|---|
| `check:docs:strict --since=<base>` | 改了契约点就同步对应文档 | 改动命中文档 `contracts`，而该文档没有一起改。`covers` 不触发 strict |
| `check:docs:coverage --since=<base>` | 新源码必须有文档认领 | 新增 `packages/*/src/**` 不匹配任何 covers，且不属于测试、`.d.ts`、mock、夹具或 story 豁免 |
| `check:docs:size` | frontmatter 有效、单文档别膨胀到该拆 | frontmatter 形状错误、`covers`/`contracts` 双空、字符数超 hard cap、covers 数超基线，或基线漏项、保留已删除文档。拆分处置见 [拆分与体量](splitting.md) |
| `check:docs:links` | 互链和指针不指向消失目标 | evergreen 以及 `AGENTS.md` / `README.md` 指向 evergreen、ADR 的 Markdown `.md` 链接不存在；目标 `.md#id` 缺独立 `<a id="..."></a>` 显式锚点；独立锚点行畸形；不同文档重名锚点 |
| `check:docs:stale` | `last-reviewed` 不过期 | 缺字段或超过 180 天 |

links 不校验同页 fragment、Markdown 标题自动锚点或 prose `§x.y`；拆分后这类引用按 [拆分与体量](splitting.md) 的四类手动扫描。锚点名必须是严格配对的 `<a id="..."></a>`，避免同名目标和格式畸形让链接看似有效却无稳定落点。

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
