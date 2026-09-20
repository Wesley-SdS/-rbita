"use client";

import { useRef, type ReactNode } from "react";
import { semear } from "./cache";

/**
 * Planta no cache do cliente o que o servidor já leu, ANTES de os painéis
 * montarem.
 *
 * Tem de acontecer na renderização e não num efeito: o efeito roda depois da
 * montagem dos filhos, e aí o painel já teria disparado a própria busca. Um
 * `useRef` garante uma vez só por instância, e o `semear` ainda é idempotente
 * por conta do render duplo do modo estrito.
 */
export function CacheSemeado({ dados, children }: { dados: Record<string, unknown>; children: ReactNode }) {
  const plantado = useRef(false);
  if (!plantado.current) {
    plantado.current = true;
    semear(dados);
  }
  return <>{children}</>;
}
