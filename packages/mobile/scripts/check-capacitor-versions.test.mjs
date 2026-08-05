import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findUnregisteredPlugins,
  formatUnregisteredError,
  gradleModuleName,
  nativeRegistrationExemptions,
  sharedPackages,
} from "./check-capacitor-versions.mjs";

const readGradle = () => ({
  settingsGradle: readFileSync(new URL("../android/capacitor.settings.gradle", import.meta.url), "utf8"),
  buildGradle: readFileSync(new URL("../android/app/capacitor.build.gradle", import.meta.url), "utf8"),
});

/** 从真实 Gradle 文件里剔掉某个子工程，模拟「漏跑 android:sync」。 */
function dropModule(gradle, module) {
  const drop = (text) =>
    text
      .split(/\r?\n/)
      .filter((line) => !line.includes(`':${module}'`))
      .join("\n");
  return { settingsGradle: drop(gradle.settingsGradle), buildGradle: drop(gradle.buildGradle) };
}

test("入库的 Gradle 注册覆盖共享清单里每个插件", () => {
  assert.deepEqual(findUnregisteredPlugins(readGradle()), []);
});

test("插件从两份 Gradle 里掉出去就报错，并指名道姓 + 给修法", () => {
  const missing = findUnregisteredPlugins(dropModule(readGradle(), "capacitor-haptics"));

  assert.deepEqual(missing, [
    {
      name: "@capacitor/haptics",
      module: "capacitor-haptics",
      files: ["android/capacitor.settings.gradle", "android/app/capacitor.build.gradle"],
    },
  ]);

  const message = formatUnregisteredError(missing);
  assert.match(message, /@capacitor\/haptics/);
  assert.match(message, /android:sync/);
});

test("只掉 settings.gradle 一侧也报（半截注册同样拿不到插件）", () => {
  const gradle = readGradle();
  const half = { ...gradle, settingsGradle: dropModule(gradle, "capacitor-keyboard").settingsGradle };

  // 只挑 keyboard 断言：这条守的是「半截注册也算缺」，别人漏别的插件时由上面那条整体断言去红。
  const keyboard = findUnregisteredPlugins(half).find((m) => m.name === "@capacitor/keyboard");
  assert.deepEqual(keyboard, {
    name: "@capacitor/keyboard",
    module: "capacitor-keyboard",
    files: ["android/capacitor.settings.gradle"],
  });
});

test("@capacitor/core 被豁免：它没有独立 Gradle 子工程，不该被要求注册", () => {
  assert.equal(nativeRegistrationExemptions.has("@capacitor/core"), true);
  // 反证豁免真的生效：一份完全空的 Gradle 里，core 也不出现在缺失清单里。
  const missing = findUnregisteredPlugins({ settingsGradle: "", buildGradle: "" });
  assert.equal(
    missing.some((m) => m.name === "@capacitor/core"),
    false,
  );
  // 而其余共享包在空 Gradle 下必须全部被点名——否则这条规则等于没跑。
  assert.deepEqual(
    missing.map((m) => m.name),
    sharedPackages.filter((name) => !nativeRegistrationExemptions.has(name)),
  );
});

test("包名到 Gradle 子工程名的映射保住带连字符的插件", () => {
  assert.equal(gradleModuleName("@capacitor/haptics"), "capacitor-haptics");
  assert.equal(gradleModuleName("@capacitor/app-launcher"), "capacitor-app-launcher");
});
