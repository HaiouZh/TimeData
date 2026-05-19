import { vi } from "vitest";

type Registration = {
  update: () => void;
};

type RegisterOptions = {
  onRegisteredSW?: (swUrl: string, registration?: Registration) => void;
};

let lastRegisterOptions: RegisterOptions | undefined;
export const updateServiceWorkerMock = vi.fn();
export const setNeedRefreshMock = vi.fn();

export function useRegisterSW(options: RegisterOptions = {}) {
  lastRegisterOptions = options;
  return {
    needRefresh: [false, setNeedRefreshMock] as const,
    updateServiceWorker: updateServiceWorkerMock,
  };
}

export function getLastRegisterOptions() {
  return lastRegisterOptions;
}

export function resetPwaRegisterMock() {
  lastRegisterOptions = undefined;
  updateServiceWorkerMock.mockClear();
  setNeedRefreshMock.mockClear();
}
