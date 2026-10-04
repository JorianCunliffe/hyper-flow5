/**
 * Light / Midnight (dark) appearance. The resolved theme is written to
 * <html data-theme>, which styles/palette.css and styles/theme.css key off,
 * so every Tailwind palette class follows it without per-component changes.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "hyperflow.theme.v1";
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#F5F5F7",
  dark: "#000000",
};

export const parseThemePreference = (value: unknown): ThemePreference =>
  value === "light" || value === "dark" ? value : "system";

export const resolveTheme = (
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme =>
  preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;

const darkQuery = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, !!darkQuery()?.matches);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[resolved]);
  return resolved;
}

export function saveThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage can be unavailable (private mode); the choice still applies for this session */
  }
  const resolved = applyTheme(preference);
  window.dispatchEvent(new CustomEvent("hyperflow:theme", { detail: preference }));
  return resolved;
}

/** Apply the saved choice and keep "system" in step with the OS setting. */
export function initTheme(): () => void {
  applyTheme(readThemePreference());
  const query = darkQuery();
  const onChange = () => {
    if (readThemePreference() === "system") applyTheme("system");
  };
  query?.addEventListener("change", onChange);
  // Paper is white: print Midnight pages in Light, then restore.
  const beforePrint = () => applyTheme("light");
  const afterPrint = () => applyTheme(readThemePreference());
  window.addEventListener("beforeprint", beforePrint);
  window.addEventListener("afterprint", afterPrint);
  return () => {
    query?.removeEventListener("change", onChange);
    window.removeEventListener("beforeprint", beforePrint);
    window.removeEventListener("afterprint", afterPrint);
  };
}
