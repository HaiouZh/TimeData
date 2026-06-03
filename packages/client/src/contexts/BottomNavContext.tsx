import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/** 底部导航高度，与 AppShell 底部 nav 的固定高度保持同源。 */
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
