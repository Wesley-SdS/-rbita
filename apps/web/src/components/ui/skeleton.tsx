import type { CSSProperties } from "react";

/** Espera de um painel: mesma moldura do `.panel`, pulsando. */
export function Skeleton({ height = 92, className = "", style }: {
  height?: number; className?: string; style?: CSSProperties;
}) {
  return <div className={`panel esqueleto ${className}`.trim()} style={{ height, ...style }} aria-hidden />;
}
