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
