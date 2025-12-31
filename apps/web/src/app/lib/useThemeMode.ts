"use client";

import { useEffect, useMemo, useState } from "react";
import { DARK_THEME, LIGHT_THEME, LS_THEME_KEY, ResolvedTheme, ThemeMode } from "./theme";

export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  // load from LS
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_THEME_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") setThemeMode(saved);
    } catch {}
  }, []);

  // apply + persist
  useEffect(() => {
    try {
      localStorage.setItem(LS_THEME_KEY, themeMode);
    } catch {}

    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark);
    const next: ResolvedTheme = isDark ? "dark" : "light";

    setResolvedTheme(next);
    if (typeof document !== "undefined") document.documentElement.dataset.theme = next;
  }, [themeMode]);

  // listen to system changes (only when themeMode === system)
  useEffect(() => {
    if (themeMode !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolvedTheme(next);
      document.documentElement.dataset.theme = next;
    };

    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, [themeMode]);

  const THEME = useMemo(() => (resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME), [resolvedTheme]);

  // IMPORTANT: make --seg a STRING so React definitely sets the custom property correctly.
  const segValue = themeMode === "system" ? "0" : themeMode === "light" ? "1" : "2";

  return { themeMode, setThemeMode, resolvedTheme, THEME, segValue };
}
