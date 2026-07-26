---
type: evergreen
title: 部署 · iOS 未签名 IPA
covers:
  - .github/workflows/ios-ipa.yml
  - packages/mobile/scripts/ios/**
contracts:
  - .github/workflows/ios-ipa.yml
last-reviewed: 2026-07-26
---

# 部署 · iOS 未签名 IPA

> [deployment](../deployment.md) 的 iOS 发布子文档：CI 现场生成 iOS 原生工程、产出**未签名** IPA、键盘工具条补丁、SideStore 装机与数据边界。
> 不讲 Android 签名与 Gradle（见 [deployment/android-apk](android-apk.md)），也不讲服务器镜像与自更新（见 [deployment](../deployment.md)）。

## 承上启下

- **上游**：`main` 的 GitHub Actions macOS runner、`packages/mobile` 的 Capacitor 配置与 client 的 mobile 构建产物。
- **下游**：`TimeData-unsigned.ipa` artifact、`ios-<buildNumber>` GitHub Release、用户手机上的 SideStore / AltStore。
- **契约**：iOS Release **不打 `--latest`**；`packages/mobile/ios/` 永不入库。
- **邻居**：[deployment/android-apk](android-apk.md)（同一套 Capacitor 配置的 Android 侧）、[security](../security.md)（HTTPS-only 边界同样适用）。

## 1. 为什么原生工程不进仓库

`packages/mobile/ios/` 在 `.gitignore` 里，每次构建由 workflow 现场 `cap add ios` 生成。理由：iOS 工程只有 macOS 能改，仓库里放一份没人维护的 `.xcodeproj` 只会烂掉；`@capacitor/ios` 也只在 CI 现装（版本从 `packages/mobile/package.json` 的 `@capacitor/core` 读出，保证两者同版），本地 `package.json` 与 lockfile 因此不含它。

代价：iOS 侧的原生定制不能靠"改工程文件后提交"，只能表达成 `packages/mobile/scripts/ios/patch-ios.rb` 里的补丁步骤——这是本目录存在的唯一原因。

## 2. 构建链路

`ios-ipa.yml` 跑在 `macos-15` runner 上，触发方式为 `workflow_dispatch` 或 client / mobile / shared 变更推 main。步骤顺序（顺序本身是契约，错位会静默产出没打补丁的包）：

1. **算 build number**：`yymmddNN`（Asia/Shanghai 日期 + 当日序号，数已有 `ios-<日期>*` tag）。与 Android 同理靠 workflow 级 `concurrency`（`ios-ipa-release`，排队不取消）防重号。
2. `pnpm install --frozen-lockfile` → `pnpm --filter @timedata/mobile add @capacitor/ios@<core 同版本>`。
3. `build:web` 产出 client 的 mobile 构建 → `cap add ios` 生成工程。
4. `ruby scripts/ios/patch-ios.rb` 打补丁（见 §3）——**必须在 `cap add` 之后、`cap sync` 之前**。
5. `cap sync ios`（含 `pod install`）→ PlistBuddy 写 `CFBundleVersion` → `xcodebuild archive`。
6. 归档时关签名（`CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""`），因此不能用 `xcodebuild -exportArchive`（它必然要签名），改成手工把 `App.app` 塞进 `Payload/` 再 zip 成 `.ipa`。

## 3. 键盘工具条补丁

`patch-ios.rb` 做三件事：把 `scripts/ios/` 下两个 Swift 文件拷进生成的工程、用 `xcodeproj` gem 挂进 App target、把 `Main.storyboard` 的根 VC 从 `CAPBridgeViewController` 换成 `MainViewController`。storyboard 替换没匹配上时脚本直接 `abort`——Capacitor 模板改版会在这里炸出来，而不是产出一个悄悄没打上补丁的包。

`KeyboardAccessoryRemover` 改的是私有类 `WKContentView` 的 `inputAccessoryView` 实现，让它返回 `nil`，去掉键盘上方系统强加的 ▲▼/完成 工具条。**刻意不走"取 `webView.scrollView` 的子视图实例再 `object_setClass`"那条路**：该子视图懒创建，页面加载完成前拿不到，时机稍早就静默失效——而失效的表现和"补丁没生效"完全一样，很难查。改类的做法与 WebView 实例的创建时机无关。

替换 IMP 时先试 `class_addMethod`：成功说明 `WKContentView` 自己没实现该方法（继承自 `UIResponder`），新增的覆盖只作用于它；失败才 `method_setImplementation` 改它自己那份。两条路都不会误伤 `UIResponder` 的全局实现。

去不掉的是输入法自带的候选词条——那是输入法本体的一部分，原生应用同样去不掉。

## 4. Release 契约：不标 latest

iOS Release 发布到 `ios-<buildNumber>` tag，`gh release create` **不带 `--latest`**。这条是硬约束：设置页的「APK 更新」入口读的是仓库的 latest Release，iOS 包一旦标成 latest，Android 用户的应用内更新就会指向一个装不了的 `.ipa`。改 iOS 发布步骤时必须保住这一点。

产物同时上传为 workflow artifact（`timedata-unsigned-ipa`），Release 发布失败时仍可从 run 页面取包；发布步骤对 GitHub API 临时超时做最多 3 次重试，与 Android 侧同构。

## 5. 装机与数据边界

IPA 未签名，不能直接安装。手机上用 SideStore（推荐，可离机自行续签）或 AltStore 导入，安装时用你自己的 Apple ID 签名。免费 Apple ID 的签名 **7 天到期**，到期重签即可，应用数据不丢；同时最多 3 个自签应用。付费开发者账号（$99/年）才能走 TestFlight / App Store。

**原生壳与 Safari 里的 PWA 不同源**：Capacitor iOS 默认 `capacitor://localhost`，Safari PWA 是站点自己的 https 源，两者的 IndexedDB 互不可见。装上原生壳后是一份空数据，要靠服务器同步把数据拉下来——首次进入先在设置里填 API 地址与 Token。同一台设备上两个入口各存各的，别指望互通。

## 6. 排错

- **`cap add ios` 或 `pod install` 失败**：多半是 runner 的 Xcode / CocoaPods 版本与 Capacitor 7 模板不匹配，先看 runner 镜像的 Xcode 版本。
- **storyboard patch did not match**：Capacitor 升级换了模板布局，按新模板改 `patch-ios.rb` 的替换串。
- **包能装但键盘工具条还在**：先确认 `Patch iOS project` 步骤真跑过且 App target 里有两个 Swift 文件；再确认 storyboard 的 `customClass` 已是 `MainViewController`。
- **签名 7 天到期后打不开**：SideStore 重签即可，不需要重装、不丢数据。
