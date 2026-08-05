import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);

export const sharedPackages = [
  "@capacitor/app",
  "@capacitor/app-launcher",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/filesystem",
  "@capacitor/haptics",
  "@capacitor/keyboard",
  "@capacitor/share",
];

/**
 * sharedPackages 里**不需要**独立原生注册的包，每条必须写明理由——多一条豁免就是松一格闸。
 * 其余包一律要求在两份生成的 Gradle 文件里都有对应子工程。
 */
export const nativeRegistrationExemptions = new Map([
  ["@capacitor/core", "纯 JS 桥；原生侧随 @capacitor/android 的 :capacitor-android 一起进包，没有独立 Gradle 子工程"],
]);

/** `@capacitor/app-launcher` → `capacitor-app-launcher`（cap sync 生成的 Gradle 子工程名）。 */
export function gradleModuleName(pkgName) {
  return `capacitor-${pkgName.replace(/^@capacitor\//, "")}`;
}

function includedModules(settingsGradle) {
  return new Set([...settingsGradle.matchAll(/^\s*include\s+['"]:([^'"]+)['"]/gm)].map((m) => m[1]));
}

function implementedModules(buildGradle) {
  return new Set([...buildGradle.matchAll(/implementation\s+project\(['"]:([^'"]+)['"]\)/g)].map((m) => m[1]));
}

/**
 * 清单 ⊆ Gradle 注册。缺注册的插件在 JS 侧照常 import、照常调用，Capacitor 只会返回
 * 「插件未实现」——业务代码普遍把它当预期路径兜住，于是整层功能静默空转（触感就这么漏了一整轮）。
 * 版本号一致挡不住这种漏，故单列一条。
 */
export function findUnregisteredPlugins({ settingsGradle, buildGradle }, packages = sharedPackages) {
  const included = includedModules(settingsGradle);
  const implemented = implementedModules(buildGradle);
  const missing = [];
  for (const name of packages) {
    if (nativeRegistrationExemptions.has(name)) continue;
    const module = gradleModuleName(name);
    const files = [];
    if (!included.has(module)) files.push("android/capacitor.settings.gradle");
    if (!implemented.has(module)) files.push("android/app/capacitor.build.gradle");
    if (files.length > 0) missing.push({ name, module, files });
  }
  return missing;
}

export function formatUnregisteredError(missing) {
  const lines = missing.map(({ name, module, files }) => `  - ${name}（:${module}）缺于 ${files.join("、")}`);
  return [
    "[capacitor-versions] 以下 Capacitor 插件已登记在共享清单，但 Android 原生工程没注册：",
    ...lines,
    "修法：pnpm --filter @timedata/mobile android:sync 重新生成这两份 Gradle 文件，并把生成的改动一起提交。",
    "（Gradle 文件是 cap sync 生成的，不要手工编辑。）",
  ].join("\n");
}

function main() {
  const clientPkg = JSON.parse(readFileSync(new URL("packages/client/package.json", root), "utf8"));
  const mobilePkg = JSON.parse(readFileSync(new URL("packages/mobile/package.json", root), "utf8"));

  for (const name of sharedPackages) {
    const clientVersion = clientPkg.dependencies[name];
    const mobileVersion = mobilePkg.dependencies[name];
    if (!clientVersion || !mobileVersion) {
      throw new Error(`${name} must exist in both client and mobile package.json`);
    }
    if (!clientVersion.startsWith("^7.") || !mobileVersion.startsWith("^7.")) {
      throw new Error(
        `${name} must use Capacitor v7 in both packages; got client=${clientVersion}, mobile=${mobileVersion}`,
      );
    }
  }

  for (const name of ["@capacitor/android", "@capacitor/cli"]) {
    const version = mobilePkg.dependencies[name] || mobilePkg.devDependencies[name];
    if (!version?.startsWith("^7.")) {
      throw new Error(`${name} must use Capacitor v7; got ${version}`);
    }
  }

  const missing = findUnregisteredPlugins({
    settingsGradle: readFileSync(new URL("packages/mobile/android/capacitor.settings.gradle", root), "utf8"),
    buildGradle: readFileSync(new URL("packages/mobile/android/app/capacitor.build.gradle", root), "utf8"),
  });
  if (missing.length > 0) {
    throw new Error(formatUnregisteredError(missing));
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
