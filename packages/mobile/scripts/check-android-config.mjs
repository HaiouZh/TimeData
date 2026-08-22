import { readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const capacitorConfig = readFileSync(new URL("../capacitor.config.ts", import.meta.url), "utf8");

if (/android:usesCleartextTraffic="true"/.test(manifest)) {
  throw new Error("Production AndroidManifest.xml must not allow cleartext traffic.");
}

if (!/android:usesCleartextTraffic="false"/.test(manifest)) {
  throw new Error("Production AndroidManifest.xml must explicitly disable cleartext traffic.");
}

if (!/cleartext:\s*false/.test(capacitorConfig)) {
  throw new Error("Capacitor config must keep server.cleartext false for production.");
}

if (!/allowMixedContent:\s*false/.test(capacitorConfig)) {
  throw new Error("Capacitor config must keep android.allowMixedContent false.");
}

// resize:none 让 **iOS** 的 webview 不因键盘弹起自己 reflow。**这条只有 iOS 端插件读**——Android 端
// KeyboardPlugin.java 只读 resizeOnFullScreen、setResizeMode 是 unimplemented()，本断言对安卓行为
// 没有任何约束力（曾被误当成两平台的双倍避让护栏，真机上安卓照样双倍）。两平台键盘让位分工：
// iOS = webview 不动 + 网页层 JS 避让（useKeyboardHeight）；Android = 壳层让位（下方 adjustResize
// + MainActivity ime inset 两条棘轮），壳让位后 useKeyboardHeight 实测归零、JS 不再叠加。
// 见 docs/evergreen/design-language/invariants.md 第 12 条。
if (!/Keyboard:\s*\{\s*resize:\s*(?:KeyboardResize\.None|["']none["'])/.test(capacitorConfig)) {
  throw new Error(
    "[android-config] capacitor.config.ts 的 plugins.Keyboard.resize 必须为 none（KeyboardResize.None）——" +
      "iOS 的 JS 键盘避让依赖它，改动见 docs/evergreen/design-language/invariants.md 第 12 条",
  );
}

// Android 键盘让位走 overlay 模型（与 iOS resize:none 同一套）：壳完全不动、键盘盖在 WebView 上，
// 输入条由网页层按插件高度用 transform 抬起。manifest 仍必须声明 adjustResize——它禁掉系统
// adjustPan（pan 会平移整个窗口，visualViewport 无感、网页层再抬一次 = 双倍避让，速记页输入条
// 飞到顶上）；edge-to-edge（setDecorFitsSystemWindows(false)）下 adjustResize 本身不缩任何 view，
// 正是 overlay 需要的「壳不动」。
if (!/android:name="\.MainActivity"[\s\S]{0,400}?android:windowSoftInputMode="adjustResize"/.test(manifest)) {
  throw new Error(
    "[android-config] AndroidManifest.xml 的 MainActivity 必须声明 android:windowSoftInputMode=\"adjustResize\"——" +
      "缺失时系统落 adjustPan，窗口被平移后与网页层避让叠成双倍（键盘弹起输入条飞到屏幕顶）",
  );
}
const mainActivityText = readFileSync(
  new URL("../android/app/src/main/java/app/timedata/mobile/MainActivity.java", import.meta.url),
  "utf8",
);
// overlay 模型的另一半：MainActivity **不许消费 ime inset**。两条被淘汰的老路都实测过：
// 一次性 setPadding = 键盘动画期间露窗口背景白框（WebView 底边先缩、键盘后到）；逐帧 setPadding
// 被 @capacitor/keyboard 在 decorView 上的 DISPATCH_MODE_STOP 动画回调拦停、根本不触发，
// 且 WebView 内容异步重画、缩的每一帧底部都先空后画。回退任何一条都会把白框带回来。
if (/WindowInsetsCompat\.Type\.ime\(\)/.test(mainActivityText)) {
  throw new Error(
    "[android-config] MainActivity.java 不许消费 WindowInsetsCompat.Type.ime()——键盘让位走 overlay 模型" +
      "（壳不动 + 网页层 transform 抬升），壳侧任何 ime padding 都会带回「键盘动画期白框」，" +
      "见 docs/evergreen/android.md §键盘让位",
  );
}

// === Manifest snapshot ===
const manifestText = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const requiredManifestPredicates = [
  { regex: /android:allowBackup="false"/, message: "AndroidManifest 必须 allowBackup=false（B7）" },
  { regex: /android:fullBackupContent="false"/, message: "AndroidManifest 必须 fullBackupContent=false（B7）" },
  { regex: /<provider[\s\S]+?android:name="androidx\.core\.content\.FileProvider"/, message: "FileProvider 必须存在" },
];
for (const { regex, message } of requiredManifestPredicates) {
  if (!regex.test(manifestText)) throw new Error(`[android-config] ${message}`);
}

// === file_paths.xml snapshot ===
const filePathsText = readFileSync(new URL("../android/app/src/main/res/xml/file_paths.xml", import.meta.url), "utf8");
if (/<external-path/.test(filePathsText)) {
  throw new Error("[android-config] file_paths.xml 不应再暴露 external-path（B8）");
}
if (!/<files-path[^>]+name="documents"/.test(filePathsText)) {
  throw new Error("[android-config] file_paths.xml 必须包含 files-path documents 路径");
}

// === variables.gradle snapshot ===
const varsText = readFileSync(new URL("../android/variables.gradle", import.meta.url), "utf8");
if (!/compileSdkVersion = 35/.test(varsText)) {
  throw new Error("[android-config] compileSdkVersion 必须为 35");
}
if (!/targetSdkVersion = 35/.test(varsText)) {
  throw new Error("[android-config] targetSdkVersion 必须为 35");
}

// === gradle.properties snapshot ===
const propsText = readFileSync(new URL("../android/gradle.properties", import.meta.url), "utf8");
if (!/org\.gradle\.jvmargs=-Xmx(?:[4-9]|[1-9]\d)\d*m/.test(propsText)) {
  throw new Error("[android-config] gradle JVM 内存应至少 4096m");
}

console.log("[android-config] snapshot checks passed");
