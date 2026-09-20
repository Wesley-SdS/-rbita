"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * "Este painel está sendo visto agora?"
 *
 * São duas perguntas em uma: o bloco está na área visível da tela E a aba do
 * navegador está à frente. Painel que se atualiza sozinho de tempos em tempos
 * não pode continuar consultando o servidor depois que a pessoa rolou para
 * longe ou trocou de aba.
 *
 * O provedor desta metade (o "está na tela") foi perdido quando o `Block` do
 * layout antigo saiu na migração para o Presença: o contexto ficou sem
 * ninguém fornecendo, então valia sempre `true` e só a aba contava. Quem
 * fornece agora é o `BlocoObservado`, e as `Abas` o aplicam ao painel ativo.
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
 * Observa um elemento e diz se ele está (perto de) aparecer na tela.
 *
 * Começa em `true`: sem o observador (SSR, navegador antigo), o certo é
 * assumir visível e atualizar, não deixar o painel parado para sempre. A
 * margem de 200px faz o painel já estar atualizado quando ele chega à vista,
 * em vez de começar a buscar no instante em que aparece.
 */
export function useNaTela(alvo: { current: Element | null }): boolean {
  const pai = useContext(BlocoVisivel);
  const [naTela, setNaTela] = useState(true);

  useEffect(() => {
    const el = alvo.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entradas) => setNaTela(entradas.some((e) => e.isIntersecting)), { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [alvo]);

  // Bloco dentro de bloco: se o de fora saiu da tela, o de dentro saiu junto.
  return pai && naTela;
}

/**
 * Fornece o "está na tela" para tudo que estiver dentro.
 *
 * `as` existe para não empilhar uma `div` a mais onde já existe um elemento
 * com o papel certo (o `role="tabpanel"` das abas, por exemplo): um wrapper
 * extra no meio de um grid quebra o layout.
 */
export function BlocoObservado({
  children,
  className,
  role,
}: {
  children: ReactNode;
  className?: string;
  role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const naTela = useNaTela(ref);
  return (
    <div ref={ref} className={className} role={role}>
      <BlocoVisivel.Provider value={naTela}>{children}</BlocoVisivel.Provider>
    </div>
  );
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
