export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "irm-theme";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

// A parser-blocking head script: storage failure must not skip System resolution.
// Keep its validation/resolution aligned with the store (tested against both).
export const THEME_INIT_SCRIPT = `(function () {
  var preference = "system";
  try {
    var saved = window.localStorage.getItem("irm-theme");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (_) {}
  var systemDark = false;
  try {
    systemDark = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (_) {}
  var theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-preference", preference);
  root.style.colorScheme = theme;
})();`;

export interface ThemeSnapshot {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}

// Stable SSR/hydration content; this snapshot never writes to the root element.
export const SERVER_THEME_SNAPSHOT: ThemeSnapshot = {
  preference: "system",
  resolvedTheme: "light",
};

function getStorage(browser: Window): Storage | null {
  try {
    return browser.localStorage;
  } catch {
    return null;
  }
}

function getSystemQuery(browser: Window): MediaQueryList | null {
  try {
    return typeof browser.matchMedia === "function" ? browser.matchMedia(SYSTEM_QUERY) : null;
  } catch {
    return null;
  }
}

export function createThemeStore(browser?: Window) {
  const query = browser ? getSystemQuery(browser) : null;
  const resolve = (preference: ThemePreference): ResolvedTheme =>
    preference === "system" ? (query?.matches ? "dark" : "light") : preference;
  let preference: ThemePreference = "system";
  if (browser) {
    // Retain the bootstrap choice if storage becomes inaccessible during hydration.
    preference = normalizeThemePreference(browser.document.documentElement.getAttribute("data-theme-preference"));
    try {
      preference = normalizeThemePreference(browser.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {}
  }
  let snapshot: ThemeSnapshot = { preference, resolvedTheme: resolve(preference) };
  const listeners = new Set<() => void>();
  let hasSubscribed = false;
  let hasLocalChoice = false;

  const apply = () => {
    if (!browser) return;
    const root = browser.document.documentElement;
    root.setAttribute("data-theme", snapshot.resolvedTheme);
    root.setAttribute("data-theme-preference", snapshot.preference);
    root.style.colorScheme = snapshot.resolvedTheme;
  };
  const update = (nextPreference: ThemePreference) => {
    const nextTheme = resolve(nextPreference);
    if (snapshot.preference === nextPreference && snapshot.resolvedTheme === nextTheme) return;
    snapshot = { preference: nextPreference, resolvedTheme: nextTheme };
    apply();
    listeners.forEach(listener => listener());
  };
  const onSystemChange = () => {
    if (snapshot.preference === "system") update("system");
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && browser && event.storageArea !== getStorage(browser)) return;
    update(normalizeThemePreference(event.newValue));
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_THEME_SNAPSHOT,
    setPreference: (value: ThemePreference) => {
      const next = normalizeThemePreference(value);
      if (snapshot.preference === next) return;
      hasLocalChoice = true;
      update(next);
      try {
        browser?.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // The in-memory choice and current page still work without persistence.
      }
    },
    subscribe: (listener: () => void) => {
      const wasEmpty = listeners.size === 0;
      listeners.add(listener);
      if (wasEmpty && browser) {
        browser.addEventListener("storage", onStorage);
        if (query?.addEventListener) query.addEventListener("change", onSystemChange);
        else query?.addListener(onSystemChange);
        // Another tab can change storage between render and the first subscription.
        // Attach first, then reconcile once; later React resubscriptions must not
        // discard an in-memory choice whose persistence failed.
        if (!hasSubscribed && !hasLocalChoice) {
          try {
            update(normalizeThemePreference(browser.localStorage.getItem(THEME_STORAGE_KEY)));
          } catch {}
        }
        hasSubscribed = true;
        // Re-read the live media query, not the SSR appearance, on attachment.
        onSystemChange();
        apply();
      }
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0 && browser) {
          browser.removeEventListener("storage", onStorage);
          if (query?.removeEventListener) query.removeEventListener("change", onSystemChange);
          else query?.removeListener(onSystemChange);
        }
      };
    },
  };
}
