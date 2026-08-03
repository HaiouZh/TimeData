---
type: evergreen
title: 部署 · Windows 桌面壳
covers:
  - packages/desktop/**
  - scripts/desktop-version.mjs
contracts:
  - packages/desktop/src-tauri/tauri.conf.json
  - .github/workflows/mobile-release.yml
last-reviewed: 2026-08-03
---

# 部署 · Windows 桌面壳

> [deployment](../deployment.md) 的 Windows 发布子文档：Tauri 壳的构成、托盘与关窗语义、开机自启判定、NSIS 安装包发布链路、桌面壳的数据边界。
> 不讲 Android 签名与 Gradle（见 [deployment/android-apk](android-apk.md)）、iOS 原生补丁（见 [deployment/ios-ipa](ios-ipa.md)），也不讲服务器镜像与自更新（见 [deployment](../deployment.md)）。

## 承上启下

- **上游**：`main` 的 GitHub Actions windows runner、`packages/client` 的 `mode=mobile` 构建产物、Windows 自带的 WebView2 运行时。
- **下游**：`TimeData-Setup.exe` artifact、`v<code>` GitHub Release（与 Android / iOS 共用）、用户机器上的 `%LOCALAPPDATA%\TimeData`。
- **契约**：`--latest` 只由 `android` job 打，`windows` job 不碰；桌面壳吃 `mode=mobile` 产物，不吃默认构建；应用 identifier 为 `icu.yanzhou.timedata`。
- **邻居**：[deployment/android-apk](android-apk.md) / [deployment/ios-ipa](ios-ipa.md)（同一条发布链路的另两个平台）、[sync](../sync.md)（桌面壳作为又一个同步客户端）。

## 1. 壳的构成

`packages/desktop` 是 Tauri v2 工程，Rust 侧只做壳：窗口、托盘、关窗拦截、开机自启，不含业务逻辑。前端不单独构建：`tauri.conf.json` 的 `frontendDist` 指向 `../../client/dist`，`beforeBuildCommand` 与 `beforeDevCommand` 都调 `pnpm --filter @timedata/client build:mobile`，吃的是与 Android / iOS 壳同一份产物。

`mode=mobile` 产物不注册 service worker。桌面壳因此不经过网页端 `AppUpdateProvider` 在 `window.focus` 上的版本检查与 `hardRefresh`（注销 service worker、清空 Cache Storage、reload）——常驻壳被热键唤起即得焦点，该链路会在唤起瞬间清缓存并重载页面。选型依据见 [ADR 0029](../../adr/0029-desktop-shell-embeds-frontend.md)。

Rust 侧的可判定逻辑集中在 `packages/desktop/src-tauri/src/shell.rs`，全为纯函数（关窗行为、托盘动作路由、启动是否显示窗口、开机自启判定），`main.rs` 只做装配与系统调用。

## 2. 窗口与托盘

主窗口在 `tauri.conf.json` 里 `visible: true`，手动启动即可见。关窗语义是壳「常驻」的全部依据：

- 窗口的 `CloseRequested` 被拦截（`api.prevent_close()`）后隐藏窗口，进程不退。
- 真退出只有一条路：托盘菜单的「退出」先置 `QUITTING` 标记再 `app.exit(0)`，此时 `CloseRequested` 放行。
- 托盘图标左键单击等价于菜单里的「打开 TimeData」；托盘菜单项 id 为 `show` 与 `quit`。

## 3. 开机自启

自启由 `tauri-plugin-autostart` 注册，注册值带 `--hidden` 参数。启动时 `should_show_on_startup` 读命令行：带 `--hidden`（开机被系统拉起）则主窗口启动即隐藏，不带（手动双击）则正常显示。

标记文件 `%APPDATA%\icu.yanzhou.timedata\autostart-initialized` 存**上次注册时的可执行文件路径**。`resolve_autostart_action` 据此判定：**启动项只要不是「已注册到当前这个 exe」，就重新注册并改写标记**。三种情形归一到同一动作——首次运行、可执行文件换了位置（构建产物 → 安装版、重装到别处）、启动项被外部清掉。

NSIS 安装新版本时先卸载旧版本，会一并清掉启动项。该情形与「用户在 Windows 系统设置里关掉自启」在系统层面无法区分，判定取前者：自启在下次启动时恢复。因此**此刻在 Windows 任务管理器 / 系统设置里关闭自启不具持久性**。

## 4. 构建与发布

`windows` job 跑在 `windows-latest` runner 上，与 `android` / `ios` 同为 `needs: prepare` 的平台 job，先到先上架。`workflow_dispatch` 的 `platform` 选项含 `windows`，`both` 含全部三个平台；`push` 触发经 `packages/desktop/**` 与 `scripts/desktop-version.mjs` 两条 paths 命中。

版本号有一道转换：发布链路的版本码是 8 位数字 `YYMMDDNN`，Tauri 的 `version` 必须是合法 semver。`scripts/desktop-version.mjs` 的 `codeToSemver` 把它转成 `YY.MMDD.NN`（各段去前导零，`26080301` → `26.803.1`），三级都单调递增。转换结果经 `tauri build --config` 注入，`tauri.conf.json` 里的 `version` 字段不参与发布。

产物是 NSIS 安装包，`bundle.targets` 恰好为 `["nsis"]`。bundler 输出名带版本号，发布前统一改名为 `TimeData-Setup.exe`。安装包不做代码签名，SmartScreen 会拦一次。安装位置是 `%LOCALAPPDATA%\TimeData`，开始菜单快捷方式为 `TimeData.lnk`。

`windows` job 不执行 `gh release edit --latest`——latest 归属规则见 [deployment/ios-ipa](ios-ipa.md) §4。

## 5. 数据边界

Tauri 用独立的 WebView2 用户数据目录，与 Edge / Chrome 的 profile 不互通。桌面壳因此是本机上又一份独立的 IndexedDB，与浏览器里访问同一站点的数据互不可见，两者只能通过服务器同步汇合——与 Capacitor 壳和 PWA 的关系同构（见 [deployment/ios-ipa](ios-ipa.md) §5）。首次启动是空数据，需在设置里填 API 地址与 Token。

同一个 Tauri 应用内的多个窗口共享同一个 WebView2 用户数据目录，因此共用同一份 IndexedDB。

## 6. 配置闸

`packages/desktop/scripts/check-desktop-config.mjs` 随 `pnpm --filter @timedata/desktop test` 运行，对 `tauri.conf.json` 做快照断言：`frontendDist` 为 `../../client/dist`、两个 before 命令都调 `build:mobile`、`identifier` 为 `icu.yanzhou.timedata`、`bundle.targets` 恰好 `["nsis"]`、主窗口 `visible` 为 `true`。这些字段配错时构建不一定报错，产出的却是空壳、旧产物或注册了 service worker 的包。

## 7. 排错

- **开机自启指向了旧路径**：标记文件与启动项不同步。删除 `%APPDATA%\icu.yanzhou.timedata\autostart-initialized` 后重新运行一次即可重建。
- **窗口关不掉 / 关了进程还在**：这是设计语义（§2），托盘菜单「退出」才是唯一退出口。
- **开始菜单里看不到条目**：快捷方式在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\TimeData.lnk`，Windows 开始菜单列表存在索引延迟，搜索能直接命中。
- **NSIS 打包步骤找不到产物**：`bundle.targets` 被改动时 bundler 会产出到别的子目录，`Rename installer` 步骤据 `*-setup.exe` 匹配。
- **桌面版看不到浏览器里记的数据**：不是故障，见 §5。
