import type { CSSProperties } from "react";

/**
 * Placeholder pulsante enquanto um painel carrega (ou é code-split). Substitui
 * o `PanelSkeleton` inline do console. `rounded` e `height` configuráveis.
 */
export function Skeleton({ height = 92, rounded = "rounded-2xl", className = "", style }: {
  height?: number; rounded?: string; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={`animate-pulse border p-4 ${rounded} ${className}`}
      style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", height, ...style }} />
  );
}
