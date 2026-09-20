import type { CSSProperties, ReactNode } from "react";

/**
 * Cartão dos painéis, na linguagem do Presença: `.panel` traz superfície,
 * contorno, raio e respiro de uma vez.
 *
 * `padding` continua existindo porque alguns painéis pedem colagem nas bordas
 * (lista que sangra, vídeo, gráfico). Quando vem vazio, vale o respiro do
 * `.panel`; quando vem preenchido, a utilitária do Tailwind vence por vir depois.
 */
export function Card({ children, className = "", padding = "", style }: {
  children: ReactNode; className?: string; padding?: string; style?: CSSProperties;
}) {
  return (
    <div className={`panel ${padding} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

/** Rótulo de painel: caixa alta, miúdo e espaçado, como no protótipo. */
export function PanelTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel-label ${className}`.trim()}>{children}</div>;
}
