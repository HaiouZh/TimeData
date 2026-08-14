---
type: evergreen
title: 部署 · Windows NSIS 安装包
covers:
  - .github/workflows/mobile-release.yml
  - scripts/desktop-version.mjs
contracts:
  - .github/workflows/mobile-release.yml
  - packages/desktop/src-tauri/tauri.conf.json
last-reviewed: 2026-08-14
---

# 部署 · Windows NSIS 安装包

> [deployment](../deployment.md) 的 Windows 发布子文档：`windows` job、版本码 semver 转换、NSIS 安装包与装机侧排错。
> 不讲壳的机制——窗口托盘、开机自启、速记浮窗、热键打点、数据边界、配置闸都在 [desktop](../desktop.md) 主题；Android 签名与 Gradle 见 [deployment/android-apk](android-apk.md)，iOS 原生补丁见 [deployment/ios-ipa](ios-ipa.md)，服务器镜像与自更新见 [deployment](../deployment.md)。

## 承上启下

- **上游**：`main` 的 GitHub Actions windows runner、`packages/client` 的 `mode=mobile` 构建产物（壳如何消费它见 [desktop](../desktop.md) §1）。
- **下游**：`TimeData-Setup.exe` artifact、`v<code>` GitHub Release（与 Android / iOS 共用）、用户机器上的 `%LOCALAPPDATA%\TimeData`。
- **契约**：`--latest` 只由 `android` job 打，`windows` job 不碰；`bundle.targets` 恰好 `["nsis"]`；发布版本经 `tauri build --config` 注入，`tauri.conf.json` 里的 `version` 字段不参与发布。
- **邻居**：[deployment/android-apk](android-apk.md) / [deployment/ios-ipa](ios-ipa.md)（同一条发布链路的另两个平台）、[desktop](../desktop.md)（壳机制主题）。

## 1. 构建与发布

`windows` job 跑在 `windows-latest` runner 上，与 `android` / `ios` 同为 `needs: prepare` 的平台 job，先到先上架。`workflow_dispatch` 的 `platform` 选项含 `windows`，`both` 含全部三个平台。**`push` 触发不区分平台**：`mobile-release` 的 push paths 是三个壳共用的一大串（`packages/{client,mobile,desktop,shared}/**`、根 `package.json` / lockfile / workspace / tsconfig、各版本与图标脚本、workflow 自身），且 push 时 `inputs.platform` 为空串、`prepare` 显式把它当 `both`——**改 client 或 shared 照样会跑 Windows job**，不是只有 `packages/desktop/**` 与 `scripts/desktop-version.mjs` 两条路径才触发。想让 Windows 只随 desktop 变更发布，得改 workflow 的 paths 或 prepare 判定，光改文档不解决。

版本号有一道转换：发布链路的版本码是 8 位数字 `YYMMDDNN`，Tauri 的 `version` 必须是合法 semver。`scripts/desktop-version.mjs` 的 `codeToSemver` 把它转成 `YY.MMDD.NN`（各段去前导零，`26080301` → `26.803.1`），三级都单调递增。转换结果经 `tauri build --config` 注入，`tauri.conf.json` 里的 `version` 字段不参与发布。

产物是 NSIS 安装包，`bundle.targets` 恰好为 `["nsis"]`（该快照由 [desktop](../desktop.md) §7 的配置闸守着）。bundler 输出名带版本号，发布前统一改名为 `TimeData-Setup.exe`。安装包不做代码签名，SmartScreen 会拦一次。安装位置是 `%LOCALAPPDATA%\TimeData`，开始菜单快捷方式为 `TimeData.lnk`。

`windows` job 不执行 `gh release edit --latest`——latest 归属规则见 [deployment/ios-ipa](ios-ipa.md#deployment-ios-ipa-s4)。

NSIS 安装新版本时先卸载旧版本，会一并清掉自启注册项；壳下次启动会按 [desktop](../desktop.md) §3 的判定自愈（用户在应用设置里显式关过的除外）。

## 2. 装机侧排错

- **开始菜单里看不到条目**：快捷方式在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\TimeData.lnk`，Windows 开始菜单列表存在索引延迟，搜索能直接命中。
- **NSIS 打包步骤找不到产物**：`bundle.targets` 被改动时 bundler 会产出到别的子目录，`Rename installer` 步骤据 `*-setup.exe` 匹配。

装好之后的运行时排错（连不上服务器、自启、热键、打点、数据不同步）见 [desktop](../desktop.md) §8。
