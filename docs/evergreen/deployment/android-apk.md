---
type: evergreen
title: 部署 · Android APK 发布
covers:
  - .github/workflows/mobile-release.yml
  - packages/mobile/capacitor.config.ts
  - packages/mobile/package.json
  - packages/mobile/scripts/*.mjs
  - packages/mobile/android/build.gradle
  - packages/mobile/android/app/build.gradle
  - packages/mobile/android/app/capacitor.build.gradle
  - packages/mobile/android/app/proguard-rules.pro
  - packages/mobile/android/settings.gradle
  - packages/mobile/android/gradle.properties
  - packages/mobile/android/variables.gradle
  - packages/mobile/android/capacitor.settings.gradle
  - packages/mobile/android/app/src/main/AndroidManifest.xml
  - packages/mobile/android/app/src/main/java/app/timedata/mobile/MainActivity.java
  - scripts/mobile-version.mjs
contracts:
  - .github/workflows/mobile-release.yml
  - packages/mobile/capacitor.config.ts
last-reviewed: 2026-08-02
---

# 部署 · Android APK 发布

> [deployment](../deployment.md) 的 Android 发布子文档：签名 release APK workflow、release keystore、Capacitor / Gradle 版本、安全配置、APK 更新入口与移动端排错。
> 不讲服务器镜像、自更新或 Docker 数据卷；这些仍在 [deployment](../deployment.md)。iOS 侧（未签名 IPA、CI 现场生成原生工程）见 [deployment/ios-ipa](ios-ipa.md)，Windows 侧（Tauri 壳、NSIS 安装包）见 [deployment/windows-desktop](windows-desktop.md)。

## 承上启下

- **上游**：`main` 分支的 GitHub Actions、GitHub Secrets、`packages/mobile` 构建脚本与 Capacitor Android 工程。
- **下游**：`app-release.apk` artifact、`v<versionCode>` GitHub Release（与 iOS 共用）、设置页「APK 更新」入口。
- **契约**：APK 只包含构建时的 client/mobile 代码；服务器镜像由 [deployment](../deployment.md) 的 `build.yml` 流程发布。生产移动端必须 HTTPS-only，安全边界也见 [security](../security.md)。
- **邻居**：[development](../development.md)（本地 mobile 构建命令）、[deployment](../deployment.md)（服务器部署与自更新）、[backup](../backup.md)（从 debug 签名包迁移到 release 前的备份要求）。

## 1. GitHub Actions 发布 APK

`mobile-release.yml` 的 `android` job 发布的是 `app-release.apk`，不是 debug APK。workflow 需要以下 GitHub Secrets：

| Secret | 用途 |
|---|---|
| `TIMEDATA_RELEASE_KEYSTORE_BASE64` | release keystore 文件的 base64 内容 |
| `TIMEDATA_RELEASE_STORE_PASSWORD` | keystore 密码 |
| `TIMEDATA_RELEASE_KEY_ALIAS` | key alias |
| `TIMEDATA_RELEASE_KEY_PASSWORD` | key 密码 |

版本号由 `prepare` job 单点计算（`scripts/mobile-version.mjs`）：tag 为 `v` + 8 位数字，数字部分 = `yymmdd`（Asia/Shanghai）+ 两位当日序号。序号规则：**取 `v<日期>*` 与 `android-<日期>*` 两种 tag 中的最大序号 +1**——切换期两种前缀并存，只数一种会让新号退到已发布版本之下（客户端 `Number` 比较后判定「没有新版本」，所有人收不到更新）；取最大而非计数——中途删过 tag 时计数会算出已被占用的号。序号上限 99，超过直接报错退出（`printf "%02d" 100` 会吐出 9 位版本号）。**8 位是硬约束，不可涨位**：已分发 APK 的 `mobileUpdate.ts` 用 `\d{8,9}` 解析 release tag（更早的版本只认 `\d{8}`），位数一变它们就解析失败。`prepare` 同时输出 `source_ref`：新发版为 `$GITHUB_SHA`，补包模式为 `refs/tags/<tag>`；`android` / `ios` / `windows` 三个平台 job 的 checkout 都消费它——补包用原版本源码构建，而不是运行分支 HEAD。

latest 规则：`prepare` 创建 Release 时显式 `--latest=false`（`gh` 的 `--latest` 默认是 `automatic`，非 semver tag 按创建时间自动成为 latest——不显式关掉的话 prepare 一创建就把 latest 从上一个带 APK 的 Release 抢走），**`android` job 上传 APK 成功后由 `Mark release as latest` 步骤 `gh release edit --latest` 落位**——该步骤带 `if: ${{ inputs.tag == '' }}`，补包（`inputs.tag` 非空）时整个跳过，iOS 与 Windows 侧都不碰。详见 [deployment/ios-ipa](ios-ipa.md) §4。

workflow 会先检查 `TIMEDATA_RELEASE_KEYSTORE_BASE64` 是否已配置，缺失时在 `Decode release keystore` 步骤明确失败；配置存在后把 keystore 解码到 `packages/mobile/android/timedata-release.keystore`，通过 `ORG_GRADLE_PROJECT_*` 传给 Gradle，并把同一个 versionCode 传给 Gradle 与 Vite（`TIMEDATA_ANDROID_VERSION_CODE`），然后运行 `pnpm build:mobile:release-apk`。构建步骤之后固定执行 `Cleanup release keystore`（`if: always()`），在上传 artifact 或发布 Release 前删除 workspace 内的 `packages/mobile/android/timedata-release.keystore`，即使前面的构建失败也会清理。`packages/mobile` 的 release APK 构建和 `pnpm build:mobile:release-apk` 始终保持一致，文档里的构建步骤以这个脚本为准。产物路径是：

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

构建完成后，workflow 先上传 APK artifact，再用 `gh release` 上传到 `v<versionCode>` GitHub Release（Release 本体由 `prepare` 创建，含三个平台的装机说明），并对 GitHub Release API 的临时超时做最多 3 次重试。Release 上传失败不代表 APK 编译失败；排查时先看 `Build signed release APK` 和 `Upload release APK` 两步是否成功，再看 `Publish APK to release` 的 GitHub API 错误。

设置页的「APK 更新」拉 `GET /releases?per_page=30`（列表按创建时间倒序），取第一个 tag 能解析出 Android versionCode 且带 `.apk` 资产的 Release，发现新版本时打开它的下载链接。**仍不能改用 `/releases/latest`**：`latest` 只由带 APK 的发布步骤打，指向的 Release 必然有 `.apk`，但客户端继续扫列表是为了兼容历史遗留的 `android-*` / `ios-*` Release（`ios-*` tag 解析不出 versionCode、`android-*` 资产结构是旧的）——合并前「iOS 顶掉 latest」的成因已消失，扫列表的理由不再是躲 latest。Android 原生环境优先通过 `@capacitor/app-launcher` 把 APK 直链交给系统 URL 处理，失败时再 fallback 到 `@capacitor/browser` / Web `window.open`。Android 仍会要求用户确认安装，首次从旧 debug 签名包迁移到 release 签名包时不能覆盖安装，需要先备份数据、卸载旧包，再安装 release 包；后续 release 包之间可以覆盖安装。

## 2. Capacitor / Gradle 契约

Capacitor 7 版本的 Android 构建要求：Node 22+、pnpm 11、Java 21、Android SDK Platform 35 / Build-tools 35.0.0、Gradle 8.11.1、Android Gradle Plugin 8.7.2。`packages/mobile/android/variables.gradle` 中 `minSdkVersion = 24`，因此 APK 支持 Android 7.0（API 24）及以上设备；CI 的 `mobile-release.yml` 也按这些版本安装 pnpm、Java 与 Android SDK。

Android 端依赖的 Capacitor 插件清单：`@capacitor/app`（返回键）、`@capacitor/app-launcher`（把 APK 下载直链交给系统处理）、`@capacitor/browser`（外链浏览器 fallback）、`@capacitor/filesystem` + `@capacitor/share`（备份导出落盘和分享）、`@capacitor/keyboard`（软键盘事件桥接，见 [design-language](../design-language.md) §4 第 12 条）。新增或升级这些插件后必须重跑 `pnpm --filter @timedata/mobile android:sync`，让 `packages/mobile/android/capacitor.settings.gradle` 与 `packages/mobile/android/app/capacitor.build.gradle` 同步注册原生插件，否则原生工程拿不到新插件。`packages/mobile/package.json` 与 `packages/mobile/scripts/check-capacitor-versions.mjs` 的 `sharedPackages` 登记同一份插件清单，闸住 client / mobile 两侧版本不对齐。

Android 生产 Manifest 显式设置 `android:usesCleartextTraffic="false"`，并且 `packages/mobile/capacitor.config.ts` 保持 `server.cleartext: false`、`android.allowMixedContent: false`。App 内服务器配置在原生 Android 环境会拒绝保存 `http://` API 地址；自托管服务器需要先通过 Caddy / Nginx / Tunnel 等方式暴露 HTTPS，再在 App 中填写 `https://` 地址。`pnpm --filter @timedata/mobile test` 会静态检查这些安全配置，避免 release APK 默认允许 HTTP 明文流量或混合内容。

同步客户端不启用 `CapacitorHttp` 的全局 fetch/XHR patch。仅 Android 回前台时，`/api/sync/status` 与增量 `/api/sync/pull` 可由 client 显式调用 Capacitor 7 内置 `CapacitorHttp`；它使用系统 `HttpURLConnection`，不经过浏览器 CORS 预检，但仍受设备 DNS、VPN、代理、TLS 与服务器 HTTPS 链路影响，也没有逐请求取消能力。push、SSE、force-push、健康诊断、管理/日记/备份继续走 WebView `fetch`，所以部署仍需把 `https://localhost` 放入 `ALLOWED_ORIGINS`；原生路径不是放宽 CORS 或 cleartext 的理由。该内置能力无需新增 npm 依赖、Manifest 权限或原生插件注册。

`packages/mobile/capacitor.config.ts` 是两个平台共用的：`android` 段与 `server` 段归本文档，`ios` 段（背景色）与 iOS 构建链路归 [deployment/ios-ipa](ios-ipa.md)。`server.androidScheme` 只作用于 Android；iOS 走 Capacitor 默认的 `capacitor://localhost`，两个壳的本地库不同源。`android.backgroundColor` 与 `ios.backgroundColor` 均为 `#0e1320`（= client `--color-page`），原生背景露出时（启动瞬间、旋转过渡、滚动越界回弹）与网页底色一致。`plugins.Keyboard.resize` 同样两平台共用，值为 `none`（webview 不因键盘 reflow）——该配置项与网页层键盘避让机制的关系讲在 [deployment/ios-ipa](ios-ipa.md) §3.3。

Android 壳入口是 `packages/mobile/android/app/src/main/java/app/timedata/mobile/MainActivity.java`。Activity 启动时关闭 decor 自动适配，并在根内容视图上显式应用 `systemBars` + `displayCutout` 的 inset padding，让 Capacitor WebView 避开状态栏、导航栏和刘海区域，避免 APK 在全面屏设备上把页面顶部绘制到通知栏下面。**该原生 padding 是 Android 壳唯一的让位机制**：edge-to-edge 下 WebView 的 `env(safe-area-inset-*)` 会照常报非零值、与原生 padding 叠加成双倍留白，故 client 在 Android 壳把 `<html data-platform="android">` 标记置上，CSS 随之把网页层 `--safe-*` 安全区变量全部清零（机制见 [design-language](../design-language.md) §1 / §4 第 11 条），iOS / 桌面 / PWA 仍走 `env()` 值。

## 3. 本地生成 release keystore

CI 用的 keystore 是一次性生成，长期复用。本地需要时可以用 JDK 自带的 `keytool`：

```bash
keytool -genkeypair -v \
  -keystore timedata-release.keystore \
  -alias timedata-release \
  -keyalg RSA -keysize 2048 -validity 36500 \
  -storetype JKS
```

生成后把 keystore 移到 `packages/mobile/android/timedata-release.keystore`（已在 `.gitignore`），并把以下变量传给 Gradle：

```bash
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_FILE=../timedata-release.keystore \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_PASSWORD=... \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_ALIAS=timedata-release \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_PASSWORD=... \
pnpm build:mobile:release-apk
```

要把 keystore 注入 GitHub Actions，做一次 `base64 -w0 timedata-release.keystore` 拿到单行字符串，存进 `TIMEDATA_RELEASE_KEYSTORE_BASE64` secret；再分别把密码、alias、密码存进对应 secret。keystore **不进仓库**；丢失后所有用户都需要卸载重装。

## 4. 移动端排错

APK 只包含构建时的 client/mobile 代码；自托管服务器镜像由 `build.yml` 另行发布和自更新。生产移动端构建禁止 cleartext：`packages/mobile/capacitor.config.ts` 固定 `androidScheme: "https"`、`cleartext: false`、`allowMixedContent: false`，正式同步必须使用 HTTPS。

客户端新增 API 调用后，最新 APK 可能要求服务器也更新到对应版本。排查移动端“连不上服务器”时按顺序确认：`/api/health` 是否可访问、API 地址是否只填域名根、Token 是否正确、反向代理 HTTPS 是否正常、带鉴权的 `/api/sync/status` 是否存在。`/api/health` 正常但 `/api/sync/status` 404 通常表示服务器镜像旧于 APK。
