/// <reference types="vite/client" />

declare const __TIMEDATA_ANDROID_VERSION_CODE__: string;
declare const __TIMEDATA_BUILD_ID__: string;

declare module "virtual:pwa-register/react" {
  export function useRegisterSW(options?: {
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  }): {
    needRefresh: [boolean, (value: boolean) => void];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}
