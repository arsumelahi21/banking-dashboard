"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { themePreferences, THEME_COOKIE, type ThemePreference } from "@/lib/theme";

const icons = { system: Monitor, light: Sun, dark: Moon };

function savePreference(theme: ThemePreference) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;

  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeToggle({ initial }: { initial: ThemePreference }) {
  const [theme, setTheme] = useState(initial);
  const next = themePreferences[(themePreferences.indexOf(theme) + 1) % themePreferences.length]!;
  const Icon = icons[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      onClick={() => {
        savePreference(next);
        setTheme(next);
      }}
    >
      <Icon aria-hidden />
    </Button>
  );
}
