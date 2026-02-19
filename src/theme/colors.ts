import type { ThemeName } from "../config/config.ts";
import { MONOCHROME_THEME, THEMES, THEME_NAMES, type ThemeColors } from "./themes.ts";

// ── Mutable active theme ─────────────────────────────

let _activeTheme: ThemeName = "tokyo-night";
let _monochromeEnabled = false;

export function setTheme(name: ThemeName): void {
  _activeTheme = name;
}

export function getThemeName(): ThemeName {
  return _activeTheme;
}

export function cycleTheme(): ThemeName {
  const idx = THEME_NAMES.indexOf(_activeTheme);
  const next = THEME_NAMES[(idx + 1) % THEME_NAMES.length]!;
  _activeTheme = next;
  return next;
}

export function setMonochromeEnabled(enabled: boolean): void {
  _monochromeEnabled = enabled;
}

// ── colors proxy: always reads from active theme ─────
// This keeps all existing `colors.xxx` references working.

export const colors: ThemeColors = new Proxy({} as ThemeColors, {
  get(_target, prop: string) {
    const theme = _monochromeEnabled ? MONOCHROME_THEME : THEMES[_activeTheme];
    return (theme as unknown as Record<string, unknown>)[prop];
  },
});

export { THEMES, THEME_NAMES };
export type { ThemeColors };
