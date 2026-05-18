import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const clientPkg = JSON.parse(readFileSync(new URL("packages/client/package.json", root), "utf8"));
const mobilePkg = JSON.parse(readFileSync(new URL("packages/mobile/package.json", root), "utf8"));

const sharedPackages = [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/filesystem",
  "@capacitor/share",
];
for (const name of sharedPackages) {
  const clientVersion = clientPkg.dependencies[name];
  const mobileVersion = mobilePkg.dependencies[name];
  if (!clientVersion || !mobileVersion) {
    throw new Error(`${name} must exist in both client and mobile package.json`);
  }
  if (!clientVersion.startsWith("^7.") || !mobileVersion.startsWith("^7.")) {
    throw new Error(`${name} must use Capacitor v7 in both packages; got client=${clientVersion}, mobile=${mobileVersion}`);
  }
}

for (const name of ["@capacitor/android", "@capacitor/cli"]) {
  const version = mobilePkg.dependencies[name] || mobilePkg.devDependencies[name];
  if (!version?.startsWith("^7.")) {
    throw new Error(`${name} must use Capacitor v7; got ${version}`);
  }
}
