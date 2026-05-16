import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.timedata.mobile",
  appName: "TimeData",
  webDir: "../client/dist",
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f172a",
  },
  server: {
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
