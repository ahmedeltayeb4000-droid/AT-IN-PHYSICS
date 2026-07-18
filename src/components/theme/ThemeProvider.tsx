import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

export type Theme = "dark" | "light";
export type Direction = "ltr" | "rtl";
type ThemeContextValue = {
  theme: Theme;
  direction: Direction;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setDirection: (direction: Direction) => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("at-theme") as Theme) || "dark",
  );
  const [direction, setDirection] = useState<Direction>(
    () => (localStorage.getItem("at-direction") as Direction) || "ltr",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dir = direction;
    document.documentElement.lang = direction === "rtl" ? "ar" : "en";
    localStorage.setItem("at-theme", theme);
    localStorage.setItem("at-direction", direction);
  }, [theme, direction]);
  const value = useMemo(
    () => ({
      theme,
      direction,
      setTheme,
      setDirection,
      toggleTheme: () =>
        setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme, direction],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
