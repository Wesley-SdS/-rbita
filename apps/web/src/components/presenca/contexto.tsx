"use client";

import { createContext, useContext } from "react";

/**
 * O que a casca oferece às telas: abrir o foco, a busca e a atividade.
 *
 * Existe porque essas três sobreposições são globais (aparecem por cima de
 * qualquer tela e sobrevivem à troca de rota), mas quem as dispara está espalhado
 * (o cartão da Visão geral, o botão da Conversa, a barra lateral). Sem isto cada
 * tela teria a própria cópia do modo foco, e o temporizador zeraria ao navegar.
 */
export interface Casca {
  abrirFoco: () => void;
  abrirBusca: () => void;
  abrirAtividade: () => void;
  /** Preferências de interface, já resolvidas pelo servidor. */
  intensidade: number;
  reduzido: boolean;
}

const CascaCtx = createContext<Casca | null>(null);

export const ProvedorCasca = CascaCtx.Provider;

export function useCasca(): Casca {
  const ctx = useContext(CascaCtx);
  if (!ctx) throw new Error("useCasca precisa estar dentro da Casca");
  return ctx;
}
