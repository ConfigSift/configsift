export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const LS_THEME_KEY = "configsift:theme:v1";

export const LIGHT_THEME = {
  bgTop: "#F6F8FF",
  bgMid: "#F0F4FF",
  bgBottom: "#F8F9FB",
  card: "#FFFFFF",
  card2: "rgba(255,255,255,0.86)",
  border: "rgba(53,56,83,0.14)",
  borderSoft: "rgba(53,56,83,0.10)",
  text: "#121528",
  muted: "#5B5F77",
  blue: "#4A7FEB",
  blue2: "#5693D8",
  blueSoft: "rgba(74,127,235,0.14)",
  blueSoft2: "rgba(86,147,216,0.12)",
  shadow: "0 12px 34px rgba(16, 21, 40, 0.08)",
  shadowSm: "0 6px 18px rgba(16, 21, 40, 0.06)",
};

export const DARK_THEME = {
  bgTop: "#0B0F14",
  bgMid: "#0C121B",
  bgBottom: "#0A0E13",
  card: "rgba(255,255,255,0.05)",
  card2: "rgba(255,255,255,0.03)",
  border: "rgba(231,236,255,0.14)",
  borderSoft: "rgba(231,236,255,0.10)",
  text: "#E8EEF9",
  muted: "rgba(232,238,249,0.70)",
  blue: "#4DA3FF",
  blue2: "#66B6FF",
  blueSoft: "rgba(77,163,255,0.18)",
  blueSoft2: "rgba(102,182,255,0.14)",
  shadow: "0 18px 52px rgba(0,0,0,0.55)",
  shadowSm: "0 10px 28px rgba(0,0,0,0.42)",
};
