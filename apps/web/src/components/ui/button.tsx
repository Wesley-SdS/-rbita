import type { ButtonHTMLAttributes, CSSProperties } from "react";

type Variant = "primary" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

// Tamanhos alinhados aos botões já usados nos painéis:
// sm = mini (ex. "+"), md = botão de painel (o mais comum), lg = ação do compositor.
const SIZES: Record<Size, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-xs",
  lg: "px-4 py-2.5 text-sm",
};

/** Estilos por variante (batem com os botões inline já usados no app). */
function variantStyle(variant: Variant): CSSProperties {
  if (variant === "primary") return { background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" };
  if (variant === "danger") return { background: "var(--color-danger)", color: "#fff" };
  return { borderColor: "var(--color-line)", color: "var(--color-ink-dim)", background: "var(--color-surface)" }; // outline
}

/**
 * Botão do design system. `primary` = gradiente dourado (ação principal),
 * `outline` = borda discreta, `danger` = vermelho. Mantém `disabled:opacity`.
 */
export function Button({
  variant = "primary", size = "md", className = "", style, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const border = variant === "outline" ? "border" : "";
  return (
    <button
      {...rest}
      className={`rounded-lg font-semibold leading-none disabled:opacity-50 ${border} ${SIZES[size]} ${className}`}
      style={{ ...variantStyle(variant), ...style }}
    />
  );
}
