import type { ButtonHTMLAttributes, CSSProperties } from "react";

type Variant = "primary" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";

/**
 * Botão do Presença. `primary` é o verde floresta da ação principal, `outline`
 * é o contorno discreto, `danger` é o vermelho de apagar e `subtle` some no
 * fundo.
 *
 * `lg` usa a altura cheia do protótipo (42px, feita para o toque). `sm` e `md`
 * usam a versão compacta, porque os painéis colocam muitos botões por linha e
 * a altura cheia ali empurraria tudo para baixo.
 */
const VARIANTES: Record<Variant, string> = {
  primary: "primary",
  outline: "secondary",
  danger: "danger",
  subtle: "subtle",
};

export function Button({
  variant = "primary", size = "md", className = "", style, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; style?: CSSProperties }) {
  const compacto = size === "lg" ? "" : size === "sm" ? "mini" : "compacto";
  return <button {...rest} className={`button ${VARIANTES[variant]} ${compacto} ${className}`.trim()} style={style} />;
}
