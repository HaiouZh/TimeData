import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

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
  plugins: {
    // webview 不因键盘弹起 reflow：fixed 输入条/内容留白改由 JS 读 useKeyboardHeight() 手动避让
    // （composeBottomInset 已并入键盘高，见 lib/bottomInset.ts）。
    Keyboard: {
      resize: KeyboardResize.None,
    },
  },
};

export default config;
