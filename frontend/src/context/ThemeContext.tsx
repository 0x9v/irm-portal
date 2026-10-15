"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createThemeStore, type ThemePreference, type ThemeSnapshot } from "@/lib/theme";

interface ThemeContextValue extends ThemeSnapshot {
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createThemeStore(typeof window === "undefined" ? undefined : window));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  return (
    <ThemeContext.Provider value={{ ...snapshot, setPreference: store.setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
