import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.timedata.mobile",
  appName: "TimeData",
  webDir: "../client/dist",
  ios: {
    backgroundColor: "#0e1320",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0e1320",
  },
  server: {
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
