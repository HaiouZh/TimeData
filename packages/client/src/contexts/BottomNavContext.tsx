import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/**
 * 底部导航**内容区**高度（不含底部安全区 inset），与 MobileBottomNav 的内容高同源。
 * nav 实际渲染总高 = 本值 + env(safe-area-inset-bottom)（iPhone 可达 83px）；
 * 要与 nav 对齐的消费方需自行追加 env(safe-area-inset-bottom)。
 */
export const BOTTOM_NAV_HEIGHT_PX = 49;

interface BottomNavContextValue {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const BottomNavContext = createContext<BottomNavContextValue | null>(null);

export function BottomNavProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const value = useMemo(() => ({ hidden, setHidden }), [hidden]);
  return <BottomNavContext.Provider value={value}>{children}</BottomNavContext.Provider>;
}

export function useBottomNav(): BottomNavContextValue {
  const value = useContext(BottomNavContext);
  if (!value) throw new Error("useBottomNav must be used within BottomNavProvider");
  return value;
}
