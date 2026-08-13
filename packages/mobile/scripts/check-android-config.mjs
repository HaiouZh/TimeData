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
// 没有任何约束力（曾被误当成两平台的双倍避让护栏，真机上安卓照样双倍）。避让正确性现在由网页层
// 实测承担（useKeyboardHeight 读 visualViewport 的遮挡量，插件高度只兜底）；这条棘轮留着是防配置
// 漂移改掉 iOS 行为。见 docs/evergreen/design-language/invariants.md 第 12 条。
if (!/Keyboard:\s*\{\s*resize:\s*(?:KeyboardResize\.None|["']none["'])/.test(capacitorConfig)) {
  throw new Error(
    "[android-config] capacitor.config.ts 的 plugins.Keyboard.resize 必须为 none（KeyboardResize.None）——" +
      "JS 键盘避让依赖它，改动见 docs/evergreen/design-language/invariants.md 第 12 条",
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
