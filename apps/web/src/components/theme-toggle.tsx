"use client";

import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "@/components/ui/icons";

/**
 * Alterna entre tema claro e escuro. A escolha fica no localStorage e é
 * aplicada no <html data-theme> por um script inline no layout ANTES da
 * hidratação, o que evita o flash de tema errado no primeiro paint.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("orbita.theme", next); } catch { /* navegação privada */ }
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "tema claro" : "tema escuro"}
      aria-label={theme === "dark" ? "mudar para o tema claro" : "mudar para o tema escuro"}
      className={`flex items-center justify-center rounded-lg border px-2.5 py-1.5 ${className}`}
      style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
