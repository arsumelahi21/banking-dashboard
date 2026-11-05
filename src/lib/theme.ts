export const THEME_COOKIE = "theme";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

/** Cookies are user input, so anything unexpected falls back to the system theme. */
export function parseThemePreference(value: string | undefined): ThemePreference {
  return themePreferences.find((theme) => theme === value) ?? "system";
}
