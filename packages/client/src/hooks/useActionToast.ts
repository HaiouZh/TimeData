import { useCallback, useEffect, useRef, useState } from "react";

export interface ActionToastData {
  message: string;
  actions?: { label: string; onClick: () => void }[];
}

export const ACTION_TOAST_DISMISS_MS = 6000;

// 带自动消失的操作反馈 toast：再次 show 会重置计时，卸载时清定时器。
export function useActionToast(dismissMs: number = ACTION_TOAST_DISMISS_MS) {
  const [toast, setToast] = useState<ActionToastData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (next: ActionToastData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, dismissMs);
    },
    [dismissMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast, showToast, clearToast };
}
