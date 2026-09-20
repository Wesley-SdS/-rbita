"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { garantir, inscrever, lerCache, VAZIO, type EstadoRecurso } from "./cache";

/**
 * OS HOOKS do cache de dados (a loja fica em `cache.ts`).
 *
 * O app tinha noventa e um `useEffect` buscando sozinhos, sem cache e sem
 * deduplicação. Três painéis da tela Casa pediam `/api/home/rooms` ao mesmo
 * tempo, e trocar de aba e voltar refazia tudo de novo. Com isto:
 *
 *   - uma busca só por chave, mesmo com vários painéis pedindo junto;
 *   - volta instantânea: o guardado aparece na hora e a atualização acontece
 *     atrás (nunca se troca dado na tela por um "Carregando…");
 *   - invalidação por prefixo depois de mutar, em vez de `setReload(n + 1)`
 *     recarregando a tela inteira.
 *
 * Por que um arquivo em vez de SWR ou React Query: o que o app precisa cabe
 * aqui, e uma dependência a mais no bundle do cliente atrasa justamente a
 * hidratação que segura o prefetch dos links.
 *
 * `useSyncExternalStore` e não `useState` mais evento: é o primitivo que o
 * React 19 espera para estado que mora fora dele. Com `useState`, dois painéis
 * na mesma chave poderiam renderizar valores diferentes no mesmo passe.
 */

export type { EstadoRecurso } from "./cache";
export { invalidar, definirDado, restaurarDado, limparCache, mutarRecurso } from "./cache";

/**
 * Quanto tempo um dado continua valendo.
 *
 * Vem da configuração (`cache.recursoTtl*`, com tela em Ajustes) e desce pelo
 * servidor no layout, então não há número chumbado no front nem uma requisição
 * a mais para descobri-lo. Os valores aqui são só o default de quando o
 * provedor não existe (teste, painel fora da casca).
 */
export const ConfigCache = createContext<{ ttlMs: number; ttlLentoMs: number }>({ ttlMs: 20_000, ttlLentoMs: 300_000 });

export function ProvedorCacheDados({ ttlMs, ttlLentoMs, children }: { ttlMs: number; ttlLentoMs: number; children: ReactNode }) {
  const valor = useMemo(() => ({ ttlMs, ttlLentoMs }), [ttlMs, ttlLentoMs]);
  return <ConfigCache.Provider value={valor}>{children}</ConfigCache.Provider>;
}

export interface OpcoesRecurso {
  /** o que quase não muda (cômodos, aparelhos, pessoas, ferramentas) vale mais tempo */
  estavel?: boolean;
  /** desliga a busca sem quebrar a regra dos hooks (aba fechada, id ainda desconhecido) */
  ativo?: boolean;
}

/** O TTL em vigor para este tipo de recurso. */
function useTtl(estavel?: boolean): number {
  const { ttlMs, ttlLentoMs } = useContext(ConfigCache);
  return estavel ? ttlLentoMs : ttlMs;
}

/**
 * Atualiza ao voltar para a aba, se o dado venceu.
 *
 * Sem isto, deixar o app aberto num monitor o dia todo mostraria o estado da
 * manhã: o `useEffect` de montagem já rodou e nada mais o acordaria.
 */
function useRevalidarAoVoltar(chaves: (string | null)[], ttl: number, ativo: boolean) {
  const ref = useRef(chaves);
  ref.current = chaves;
  useEffect(() => {
    if (!ativo) return;
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      for (const c of ref.current) if (c) void garantir(c, ttl);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [ttl, ativo]);
}

/**
 * Lê uma rota de leitura com cache, deduplicação e revalidação.
 *
 * `chave` é a própria URL: é única por natureza e já descreve o que se está
 * pedindo, então não há um segundo nome para manter em dia.
 */
export function useRecurso<T>(chave: string | null, opts: OpcoesRecurso = {}): EstadoRecurso<T> & { recarregar: () => void } {
  const ttl = useTtl(opts.estavel);
  const ativo = opts.ativo !== false && !!chave;

  const estado = useSyncExternalStore(
    useCallback((cb: () => void) => (chave ? inscrever(chave, cb) : () => {}), [chave]),
    useCallback(() => lerCache<T>(chave), [chave]),
    // No servidor não há cache nem busca: a tela sai com o esqueleto e o
    // cliente preenche. Devolver sempre o MESMO objeto evita erro de hidratação.
    useCallback(() => VAZIO as EstadoRecurso<T>, []),
  );

  useEffect(() => {
    if (!ativo || !chave) return;
    void garantir(chave, ttl);
  }, [chave, ttl, ativo]);

  const chaves = useMemo(() => [chave], [chave]);
  useRevalidarAoVoltar(chaves, ttl, ativo);

  const recarregar = useCallback(() => {
    if (chave) void garantir(chave, 0, true);
  }, [chave]);

  return { ...estado, recarregar };
}

/**
 * ADIANTA a busca sem esperar o painel montar.
 *
 * A tela é uma casca leve que monta na hora; os painéis chegam por
 * `dynamic(ssr: false)`, ou seja, só depois que o pedaço de JavaScript deles
 * baixa. Antes, a busca só começava DEPOIS disso: baixar o código e buscar os
 * dados aconteciam em fila, quando podiam acontecer juntos.
 *
 * Chamado aqui, no nível da página, o pedido sai no primeiro instante e o
 * painel encontra o resultado pronto (ou já em voo, e aí ele entra na mesma
 * requisição pela deduplicação). Não custa nada ao servidor, ao contrário de
 * adiantar por lá: medido nesta máquina, a ida extra Next → apps/api somava de
 * 50 a 80ms por rota ao payload da navegação, mais do que economizava.
 *
 * Só as chaves da PRIMEIRA aba. Adiantar as outras seria buscar o que ninguém
 * pediu, que é o problema que este trabalho veio resolver.
 */
export function useAdiantarRecursos(chaves: readonly string[], opts: OpcoesRecurso = {}): void {
  const ttl = useTtl(opts.estavel);
  const assinatura = chaves.join("|");
  useEffect(() => {
    if (opts.ativo === false) return;
    for (const c of assinatura.split("|")) if (c) void garantir(c, ttl);
  }, [assinatura, ttl, opts.ativo]);
}

/**
 * Várias chaves de uma vez, em paralelo.
 *
 * Existe porque um painel costuma precisar de duas ou três listas juntas
 * (cômodos mais dispositivos mais aparelhos), e chamar `useRecurso` dentro de
 * um laço ou de um `if` quebraria a regra dos hooks.
 */
export function useRecursos<T extends Record<string, unknown>>(
  chaves: { [K in keyof T]: string | null },
  opts: OpcoesRecurso = {},
): { dados: { [K in keyof T]: T[K] | null }; carregando: boolean; erro: string | null; recarregar: () => void } {
  const assinatura = JSON.stringify(chaves);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lista = useMemo(() => Object.entries(chaves) as [keyof T, string | null][], [assinatura]);
  const ref = useRef(lista);
  ref.current = lista;

  const ttl = useTtl(opts.estavel);
  const ativo = opts.ativo !== false;

  const assinar = useCallback(
    (cb: () => void) => {
      const soltar = ref.current.filter(([, k]) => k).map(([, k]) => inscrever(k!, cb));
      return () => soltar.forEach((f) => f());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinatura],
  );

  // O instantâneo é uma STRING, não um objeto: `useSyncExternalStore` compara
  // por identidade, e montar um objeto novo a cada leitura seria laço infinito.
  const instantaneo = useSyncExternalStore(
    assinar,
    useCallback(() => ref.current.map(([, k]) => lerCache(k)).map((e) => `${e.em}:${e.erro ?? ""}`).join("|"), []),
    useCallback(() => "", []),
  );

  useEffect(() => {
    if (!ativo) return;
    for (const [, k] of lista) if (k) void garantir(k, ttl);
  }, [lista, ttl, ativo]);

  const soChaves = useMemo(() => lista.map(([, k]) => k), [lista]);
  useRevalidarAoVoltar(soChaves, ttl, ativo);

  return useMemo(() => {
    const dados = {} as { [K in keyof T]: T[K] | null };
    let carregando = false;
    let erro: string | null = null;
    for (const [nome, k] of lista) {
      const e = lerCache<T[keyof T]>(k);
      dados[nome] = e.dado;
      if (k && e.dado === null && !e.erro) carregando = true;
      if (e.erro && !erro) erro = e.erro;
    }
    return {
      dados,
      carregando,
      erro,
      recarregar: () => {
        for (const [, k] of lista) if (k) void garantir(k, 0, true);
      },
    };
    // `instantaneo` é a dependência real: muda quando qualquer chave é atualizada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, instantaneo]);
}
