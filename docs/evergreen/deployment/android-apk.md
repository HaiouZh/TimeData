---
type: evergreen
title: 部署 · Android APK 发布
covers:
  - .github/workflows/android-apk.yml
  - packages/mobile/capacitor.config.ts
  - packages/mobile/package.json
  - packages/mobile/scripts/**
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
last-reviewed: 2026-07-04
---

<!-- 复核 2026-07-04（依赖升级收 dependabot）：packages/mobile 的 @capacitor/android|core|cli 由 ^7.6.5 升 ^7.6.7（patch）；发布流程、签名与 Gradle 配置不变。 -->
<!-- 复核 2026-07-04（CI 自动化升级）：workflow 内 setup-java v4→v5、setup-android v3→v4、upload-artifact v4→v7（清 Node 20 弃用告警）；构建步骤与签名流程不变。 -->

# 部署 · Android APK 发布

> [deployment](../deployment.md) 的 Android 发布子文档：签名 release APK workflow、release keystore、Capacitor / Gradle 版本、安全配置、APK 更新入口与移动端排错。
> 不讲服务器镜像、自更新或 Docker 数据卷；这些仍在 [deployment](../deployment.md)。

## 承上启下

- **上游**：`main` 分支的 GitHub Actions、GitHub Secrets、`packages/mobile` 构建脚本与 Capacitor Android 工程。
- **下游**：`app-release.apk` artifact、`android-<versionCode>` GitHub Release、设置页「APK 更新」入口。
- **契约**：APK 只包含构建时的 client/mobile 代码；服务器镜像由 [deployment](../deployment.md) 的 `build.yml` 流程发布。生产移动端必须 HTTPS-only，安全边界也见 [security](../security.md)。
- **邻居**：[development](../development.md)（本地 mobile 构建命令）、[deployment](../deployment.md)（服务器部署与自更新）、[backup](../backup.md)（从 debug 签名包迁移到 release 前的备份要求）。

## 1. GitHub Actions 发布 APK

`android-apk.yml` 发布的是 `app-release.apk`，不是 debug APK。workflow 需要以下 GitHub Secrets：

| Secret | 用途 |
|---|---|
| `TIMEDATA_RELEASE_KEYSTORE_BASE64` | release keystore 文件的 base64 内容 |
| `TIMEDATA_RELEASE_STORE_PASSWORD` | keystore 密码 |
| `TIMEDATA_RELEASE_KEY_ALIAS` | key alias |
| `TIMEDATA_RELEASE_KEY_PASSWORD` | key 密码 |

versionCode 为 8 位 `yymmddNN`：北京时间（Asia/Shanghai）日期 + 当日序号（数已有 `android-<日期>*` tag 数 +1）。序号靠 workflow 级 `concurrency`（`android-apk-release` 组，排队不取消）串行化保证不重号。**格式收窄为 8 位是客户端约束**：已分发 APK 的 `mobileUpdate.ts` 用 `\d{8,9}` 解析 release tag（更早的版本只认 `\d{8}`），改动版本号位数前必须先确认所有在用设备都带着能解析新格式的客户端。

workflow 会先检查 `TIMEDATA_RELEASE_KEYSTORE_BASE64` 是否已配置，缺失时在 `Decode release keystore` 步骤明确失败；配置存在后把 keystore 解码到 `packages/mobile/android/timedata-release.keystore`，通过 `ORG_GRADLE_PROJECT_*` 传给 Gradle，并把同一个 versionCode 传给 Gradle 与 Vite（`TIMEDATA_ANDROID_VERSION_CODE`），然后运行 `pnpm build:mobile:release-apk`。构建步骤之后固定执行 `Cleanup release keystore`（`if: always()`），在上传 artifact 或发布 Release 前删除 workspace 内的 `packages/mobile/android/timedata-release.keystore`，即使前面的构建失败也会清理。`packages/mobile` 的 release APK 构建和 `pnpm build:mobile:release-apk` 始终保持一致，文档里的构建步骤以这个脚本为准。产物路径是：

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

构建完成后，workflow 先上传 APK artifact，再用 `gh release` 创建或更新 `android-<versionCode>` GitHub Release，并对 GitHub Release API 的临时超时做最多 3 次重试。Release 发布失败不代表 APK 编译失败；排查时先看 `Build signed release APK` 和 `Upload release APK` 两步是否成功，再看 `Publish latest release APK release` 的 GitHub API 错误。

设置页的「APK 更新」读取最新 GitHub Release；发现新版本时打开该 Release 里的 APK asset 下载链接。Android 原生环境优先通过 `@capacitor/app-launcher` 把 APK 直链交给系统 URL 处理，失败时再 fallback 到 `@capacitor/browser` / Web `window.open`。Android 仍会要求用户确认安装，首次从旧 debug 签名包迁移到 release 签名包时不能覆盖安装，需要先备份数据、卸载旧包，再安装 release 包；后续 release 包之间可以覆盖安装。

## 2. Capacitor / Gradle 契约

Capacitor 7 版本的 Android 构建要求：Node 22+、pnpm 11、Java 21、Android SDK Platform 35 / Build-tools 35.0.0、Gradle 8.11.1、Android Gradle Plugin 8.7.2。`packages/mobile/android/variables.gradle` 中 `minSdkVersion = 24`，因此 APK 支持 Android 7.0（API 24）及以上设备；CI 的 `android-apk.yml` 也按这些版本安装 pnpm、Java 与 Android SDK。

Android 端依赖的 Capacitor 插件清单：`@capacitor/app`（返回键）、`@capacitor/app-launcher`（把 APK 下载直链交给系统处理）、`@capacitor/browser`（外链浏览器 fallback）、`@capacitor/filesystem` + `@capacitor/share`（备份导出落盘和分享）。新增或升级这些插件后必须重跑 `pnpm --filter @timedata/mobile android:sync`，让 `packages/mobile/android/capacitor.settings.gradle` 与 `packages/mobile/android/app/capacitor.build.gradle` 同步注册原生插件，否则原生工程拿不到新插件。

Android 生产 Manifest 显式设置 `android:usesCleartextTraffic="false"`，并且 `packages/mobile/capacitor.config.ts` 保持 `server.cleartext: false`、`android.allowMixedContent: false`。App 内服务器配置在原生 Android 环境会拒绝保存 `http://` API 地址；自托管服务器需要先通过 Caddy / Nginx / Tunnel 等方式暴露 HTTPS，再在 App 中填写 `https://` 地址。`pnpm --filter @timedata/mobile test` 会静态检查这些安全配置，避免 release APK 默认允许 HTTP 明文流量或混合内容。

Android 壳入口是 `packages/mobile/android/app/src/main/java/app/timedata/mobile/MainActivity.java`。Activity 启动时关闭 decor 自动适配，并在根内容视图上显式应用 `systemBars` + `displayCutout` 的 inset padding，让 Capacitor WebView 避开状态栏、导航栏和刘海区域，避免 APK 在全面屏设备上把页面顶部绘制到通知栏下面。

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

要把 keystore 注入 GitHub Actions，做一次 `base64 -w0 timedata-release.keystore` 拿到单行字符串，存进 `TIMEDATA_RELEASE_KEYSTORE_BASE64` secret；再分别把密码、alias、密码存进对应 secret。**绝不要**把 keystore 提交进仓库；丢失后所有用户都需要卸载重装。

## 4. 移动端排错

APK 只包含构建时的 client/mobile 代码；自托管服务器镜像由 `build.yml` 另行发布和自更新。生产移动端构建禁止 cleartext：`packages/mobile/capacitor.config.ts` 固定 `androidScheme: "https"`、`cleartext: false`、`allowMixedContent: false`，正式同步必须使用 HTTPS。

客户端新增 API 调用后，最新 APK 可能要求服务器也更新到对应版本。排查移动端“连不上服务器”时按顺序确认：`/api/health` 是否可访问、API 地址是否只填域名根、Token 是否正确、反向代理 HTTPS 是否正常、带鉴权的 `/api/sync/status` 是否存在。`/api/health` 正常但 `/api/sync/status` 404 通常表示服务器镜像旧于 APK。
