"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * "Este painel está sendo visto agora?" O `Block` já só MONTA o painel quando
 * ele entra na tela (e aí faz a primeira busca). Faltava o outro lado: painel
 * que atualiza sozinho de tempos em tempos continuava consultando o servidor
 * depois de você rolar para longe ou trocar de aba. Com isto, a atualização
 * periódica pausa quando ninguém está olhando e volta ao aparecer.
 *
 * Fora de um `Block` (painel sempre montado), vale só a aba estar visível.
 */
export const BlocoVisivel = createContext<boolean>(true);

function abaVisivel(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** Visível = o bloco está na tela E a aba do navegador está à frente. */
export function useVisivel(): boolean {
  const naTela = useContext(BlocoVisivel);
  const [aba, setAba] = useState(abaVisivel);
  useEffect(() => {
    const onChange = () => setAba(abaVisivel());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return naTela && aba;
}

/**
 * Atualização periódica que respeita a visibilidade: chama `fn` a cada
 * `intervaloMs` só enquanto o painel está sendo visto, e chama uma vez na hora
 * em que ele volta a aparecer (para não mostrar dado velho).
 */
export function useAtualizacaoPeriodica(fn: () => void, intervaloMs: number, ativo = true): void {
  const visivel = useVisivel();
  useEffect(() => {
    if (!ativo || !visivel || intervaloMs <= 0) return;
    fn();
    const t = setInterval(fn, intervaloMs);
    return () => clearInterval(t);
    // `fn` muda a cada render; o intervalo só recomeça quando algo relevante muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel, intervaloMs, ativo]);
}
