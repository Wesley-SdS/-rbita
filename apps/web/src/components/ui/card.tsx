import type { CSSProperties, ReactNode } from "react";

/**
 * Cartão padrão dos painéis: `rounded-2xl border` sobre a superfície. Substitui
 * o `<div className="rounded-2xl border p-4" style={{borderColor,background}}>`
 * repetido em ~14 painéis. `style` é mesclado (permite gradientes/overrides).
 */
export function Card({ children, className = "", padding = "p-4", style }: {
  children: ReactNode; className?: string; padding?: string; style?: CSSProperties;
}) {
  return (
    <div className={`rounded-2xl border ${padding} ${className}`}
      style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", ...style }}>
      {children}
    </div>
  );
}

/** Título de painel (font-mono, caixa alta, tracking largo, tom apagado). */
export function PanelTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`font-mono text-[10px] uppercase tracking-widest ${className}`} style={{ color: "var(--color-ink-dim)" }}>
      {children}
    </h3>
  );
}
