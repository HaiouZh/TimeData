---
type: evergreen
title: 部署 · iOS 未签名 IPA
covers:
  - .github/workflows/mobile-release.yml
  - packages/mobile/scripts/ios/**
  - scripts/ios-app-icon.mjs
  - packages/mobile/ios-assets/**
contracts:
  - .github/workflows/mobile-release.yml
last-reviewed: 2026-08-04
---

# 部署 · iOS 未签名 IPA

> [deployment](../deployment.md) 的 iOS 发布子文档：CI 现场生成 iOS 原生工程、产出**未签名** IPA、键盘工具条与状态栏补丁、SideStore 装机与数据边界。
> 不讲 Android 签名与 Gradle（见 [deployment/android-apk](android-apk.md)），也不讲服务器镜像与自更新（见 [deployment](../deployment.md)）。

## 承上启下

- **上游**：`main` 的 GitHub Actions macOS runner、`packages/mobile` 的 Capacitor 配置与 client 的 mobile 构建产物。
- **下游**：`TimeData-unsigned.ipa` artifact、`v<code>` GitHub Release（与 Android 共用）、用户手机上的 SideStore / AltStore。
- **契约**：`--latest` 只由带 APK 的发布步骤打（`prepare` 创建时显式 `--latest=false`），iOS 侧不碰；`packages/mobile/ios/` 永不入库。
- **邻居**：[deployment/android-apk](android-apk.md)（同一套 Capacitor 配置的 Android 侧）、[security](../security.md)（HTTPS-only 边界同样适用）。

## 1. 为什么原生工程不进仓库

`packages/mobile/ios/` 在 `.gitignore` 里，每次构建由 workflow 现场 `cap add ios` 生成。理由：iOS 工程只有 macOS 能改，仓库里放一份没人维护的 `.xcodeproj` 只会烂掉；`@capacitor/ios` 也只在 CI 现装（版本从 `packages/mobile/node_modules/@capacitor/core/package.json` 读**已安装的 exact resolved version**，不用 `package.json` 里的 `^` 范围——范围解析会随 patch 漂移，模板结构也随之漂移），本地 `package.json` 与 lockfile 因此不含它。

代价：iOS 侧的原生定制不能靠"改工程文件后提交"，只能表达成 `packages/mobile/scripts/ios/patch-ios.rb` 里的补丁步骤——这是本目录存在的唯一原因。

## 2. 构建链路

`ios` job 跑在 `macos-15` runner 上，由 `mobile-release.yml` 的 `prepare` job 算好版本号后触发（版本号来自 `prepare` 输出，与 Android 共用同一个 `v<code>`）。步骤顺序（顺序本身是契约，错位会静默产出没打补丁的包）：

1. **版本号**：`prepare` job 单点计算 `yymmddNN`（Asia/Shanghai 日期 + 当日序号，跨 `v-` / `android-` 前缀取最大序号 +1），`ios` job 消费它的输出，不再自己数 tag。
2. `pnpm install --frozen-lockfile` → `pnpm --filter @timedata/mobile add @capacitor/ios@<core 同版本>`。
3. `build:web` 产出 client 的 mobile 构建 → `cap add ios` 生成工程。
4. `ruby scripts/ios/patch-ios.rb` 打补丁（见 §3）——**必须在 `cap add` 之后、`cap sync` 之前**。
5. `node scripts/ios-app-icon.mjs <appiconset 目录> packages/mobile/ios-assets/AppIcon-1024.png` 把 TimeData 图标盖进 `AppIcon.appiconset`（不硬编码目标文件名，读 `Contents.json` 声明的 filename 决定覆盖目标，模板改版即报错）——同样在 `cap add` 之后、`cap sync` 之前。
6. `cap sync ios`（含 `pod install`）→ PlistBuddy 写 `CFBundleVersion` → `xcodebuild archive`。
7. 归档时关签名（`CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""`），因此不能用 `xcodebuild -exportArchive`（它必然要签名），改成手工把 `App.app` 塞进 `Payload/` 再 zip 成 `.ipa`。

## 3. 原生补丁：键盘工具条与状态栏样式

`patch-ios.rb` 做三件事：把 `scripts/ios/` 下两个 Swift 文件拷进生成的工程、用 `xcodeproj` gem 挂进 App target、把 `Main.storyboard` 的根 VC 从 `CAPBridgeViewController` 换成 `MainViewController`。storyboard 替换没匹配上时脚本直接 `abort`——Capacitor 模板改版会在这里炸出来，而不是产出一个悄悄没打上补丁的包。

### 3.1 键盘工具条

`KeyboardAccessoryRemover` 改的是私有类 `WKContentView` 的 `inputAccessoryView` 实现，让它返回 `nil`，去掉键盘上方系统强加的 ▲▼/完成 工具条。**刻意不走"取 `webView.scrollView` 的子视图实例再 `object_setClass`"那条路**：该子视图懒创建，页面加载完成前拿不到，时机稍早就静默失效——而失效的表现和"补丁没生效"完全一样，很难查。改类的做法与 WebView 实例的创建时机无关。

替换 IMP 时先试 `class_addMethod`：成功说明 `WKContentView` 自己没实现该方法（继承自 `UIResponder`），新增的覆盖只作用于它；失败才 `method_setImplementation` 改它自己那份。两条路都不会误伤 `UIResponder` 的全局实现。

去不掉的是输入法自带的候选词条——那是输入法本体的一部分，原生应用同样去不掉。

### 3.2 状态栏样式

`MainViewController` 覆写 `preferredStatusBarStyle` 返回 `.lightContent`——app 底色 `--color-page`（#0e1320）是深色，默认黑字读不出来。它随同一个 Swift 文件走 §3 开头那三步管线，无需额外步骤；`cap add ios` 生成的 `Info.plist` 自带 `UIViewControllerBasedStatusBarAppearance=true`，状态栏样式统一由 VC 决定，不需要 plist 补丁。同批把 `capacitor.config.ts` 的 `ios.backgroundColor`（Android 侧同步）从 `#0f172a` 对齐到 `#0e1320`，消除启动 / 旋转 / 滚动越界时露出原生背景的色差带。

<a id="deployment-ios-ipa-s3-3"></a>

### 3.3 Keyboard resize 模式

`packages/mobile/capacitor.config.ts` 的 `plugins.Keyboard.resize` 设为 `KeyboardResize.None`（`@capacitor/keyboard` 插件，两平台共用配置，`capacitor.config.ts` 整体归属见 [deployment/android-apk](android-apk.md#deployment-android-apk-s2)；这条不经过**本文** §3 开头的 `patch-ios.rb` 补丁管线，是构建时随 Capacitor 配置生效的插件设置）：webview 不因键盘弹起自动 reflow。选 `none` 而不是让 webview 自己 resize，是为了与网页层 JS 计算避让保持一致——§3.1 已经移除了系统键盘工具条，贴底输入条与内容留白改由网页层读键盘高度手动抬起（键盘高度单一来源与底部避让量单一合成见 [design-language](../design-language.md#design-language-s4) 第 12 条）；若 webview 自己 reflow，会与这条 JS 避让重复叠加。

<a id="deployment-ios-ipa-s4"></a>

## 4. Release 契约：latest 只由带 APK 的发布步骤打

iOS、Android 与 Windows 共用一个 `v<code>` tag 与同一个 Release（`mobile-release.yml`：`prepare` 建 Release → `android` / `ios` / `windows` 三个平台 job 各自上传附件，先到先上架、互不等待）。latest 规则是硬约束：设置页的「APK 更新」入口读的是仓库的 latest Release，latest 一旦落到只有 `.ipa` 的 Release 上，Android 用户的应用内更新就会指向一个装不了的包（更早那批走 `/releases/latest` 的客户端首当其冲，合并前它们就被 iOS 顶掉的 latest 打坏过）。

因此：**latest 只由含 APK 的发布步骤打**——`prepare` 创建 Release 时显式 `--latest=false`（`gh` 的 `--latest` 默认是 `automatic`，非 semver tag 按创建时间自动成为 latest，不显式关掉的话 prepare 一创建就把 latest 从上一个带 APK 的 Release 抢走，Android 构建失败时更会永久停在没 APK 的 Release 上）；`android` job 上传 APK 成功后，由单独的 `Mark release as latest` 步骤 `gh release edit --latest` 落位——该步骤带 `if: ${{ inputs.tag == '' }}` 条件，补包（`inputs.tag` 非空，即 workflow_dispatch 填了 `tag` 输入）时整个跳过。**除 `android` 外的平台 job 一律不碰这个标记**——iOS 与 Windows 侧同此规矩。合并后早期走 `/releases/latest` 的客户端一并被修复——从此 latest 指向的 Release 必然带 apk。

产物同时上传为 workflow artifact（`timedata-unsigned-ipa`），Release 发布失败时仍可从 run 页面取包；发布步骤对 GitHub API 临时超时做最多 3 次重试，与 Android 侧同构。

<a id="deployment-ios-ipa-s5"></a>

## 5. 装机与数据边界

IPA 未签名，不能直接安装。手机上用 SideStore（推荐，可离机自行续签）或 AltStore 导入，安装时用你自己的 Apple ID 签名。免费 Apple ID 的签名 **7 天到期**，到期重签即可，应用数据不丢；同时最多 3 个自签应用。付费开发者账号（$99/年）才能走 TestFlight / App Store。

**原生壳与 Safari 里的 PWA 不同源**：Capacitor iOS 默认 `capacitor://localhost`，Safari PWA 是站点自己的 https 源，两者的 IndexedDB 互不可见。装上原生壳后是一份空数据，要靠服务器同步把数据拉下来——首次进入先在设置里填 API 地址与 Token。同一台设备上两个入口各存各的数据，不互通。

## 6. 排错

- **`cap add ios` 或 `pod install` 失败**：多半是 runner 的 Xcode / CocoaPods 版本与 Capacitor 7 模板不匹配，先看 runner 镜像的 Xcode 版本。
- **storyboard patch did not match**：Capacitor 升级换了模板布局，按新模板改 `patch-ios.rb` 的替换串。
- **`Contents.json 声明了多个不同的 filename`**：Capacitor 换了图标模板（如拆成多尺寸变体），按新结构调整 `scripts/ios-app-icon.mjs`。
- **包能装但键盘工具条还在**：先确认 `Patch iOS project` 步骤真跑过且 App target 里有两个 Swift 文件；再确认 storyboard 的 `customClass` 已是 `MainViewController`。
- **签名 7 天到期后打不开**：SideStore 重签即可，不需要重装、不丢数据。
