import { useEffect, useState } from "react";
import * as Backend from "../../wailsjs/go/backend/App";

export function useTheme() {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const detectTheme = async () => {
      try {
        const theme = await Backend.GetSystemTheme();
        setSystemTheme(theme as "light" | "dark");
      } catch {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setSystemTheme(prefersDark ? "dark" : "light");
      }
    };

    void detectTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(systemTheme);
  }, [systemTheme]);

  return systemTheme;
}
