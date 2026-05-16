import { useState } from "react";

export function useRegisterSW() {
  const needRefresh = useState(false);

  return {
    needRefresh,
    updateServiceWorker: async () => {},
  };
}
