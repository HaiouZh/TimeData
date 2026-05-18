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
