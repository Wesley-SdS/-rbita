/**
 * A LOJA do cache de dados da tela: guarda, deduplica, invalida.
 *
 * Fica separada dos hooks (`recurso.tsx`) por dois motivos. O primeiro é
 * testar: isto aqui é lógica pura sobre mapas e se verifica sem montar React.
 * O segundo é que o cache é do APP, não de um componente: duas telas diferentes
 * pedindo a mesma URL têm de encontrar o mesmo dado, e isso só vale se a loja
 * for um módulo e não um estado dentro de uma árvore.
 */

export interface EstadoRecurso<T> {
  /** o último dado bom conhecido; continua valendo durante erro e revalidação */
  dado: T | null;
  erro: string | null;
  /** primeira carga: ainda não há nada para mostrar */
  carregando: boolean;
  /** já há dado na tela e uma atualização está a caminho */
  revalidando: boolean;
  /** quando o dado foi buscado (ms); 0 = nunca */
  em: number;
}

export const VAZIO: EstadoRecurso<never> = Object.freeze({
  dado: null,
  erro: null,
  carregando: true,
  revalidando: false,
  em: 0,
});

// O estado guardado é a PRÓPRIA referência devolvida ao React: trocar o objeto
// só quando algo muda é o que impede o laço infinito de re-render.
const memoria = new Map<string, EstadoRecurso<unknown>>();
const emVoo = new Map<string, Promise<void>>();
const ouvintes = new Map<string, Set<() => void>>();

/** Quem faz a requisição. Trocável para o teste não depender de rede. */
let buscador: (url: string) => Promise<Response> = (url) => fetch(url, { headers: { accept: "application/json" } });

/** Só para teste: troca o buscador e devolve como estava. */
export function definirBuscador(f: typeof buscador): typeof buscador {
  const antes = buscador;
  buscador = f;
  return antes;
}

function avisar(chave: string) {
  for (const cb of [...(ouvintes.get(chave) ?? [])]) cb();
}

export function lerCache<T>(chave: string | null): EstadoRecurso<T> {
  if (!chave) return VAZIO as EstadoRecurso<T>;
  return (memoria.get(chave) ?? VAZIO) as EstadoRecurso<T>;
}

export function inscrever(chave: string, cb: () => void): () => void {
  let set = ouvintes.get(chave);
  if (!set) ouvintes.set(chave, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) ouvintes.delete(chave);
  };
}

/** Quem está olhando esta chave agora? Decide se vale refazer a busca ao invalidar. */
function temPlateia(chave: string): boolean {
  return (ouvintes.get(chave)?.size ?? 0) > 0;
}

async function buscar(chave: string): Promise<void> {
  const antes = memoria.get(chave) ?? VAZIO;
  const tinhaDado = antes.dado !== null;
  memoria.set(chave, { ...antes, carregando: !tinhaDado, revalidando: tinhaDado, erro: null });
  avisar(chave);

  try {
    const r = await buscador(chave);
    if (!r.ok) throw new Error(r.status === 401 ? "Sessão expirada." : `Falha ao carregar (${r.status}).`);
    const dado = await r.json();
    memoria.set(chave, { dado, erro: null, carregando: false, revalidando: false, em: Date.now() });
  } catch (e) {
    // O dado velho FICA. Uma rota fora do ar por um instante não pode apagar o
    // que a pessoa já estava vendo: ela vê o aviso e o conteúdo junto.
    const atual = memoria.get(chave) ?? VAZIO;
    memoria.set(chave, {
      ...atual,
      erro: e instanceof Error ? e.message : "Falha ao carregar.",
      carregando: false,
      revalidando: false,
    });
  }
  avisar(chave);
}

/**
 * Garante que a chave está fresca. Deduplica: dois painéis pedindo a mesma
 * coisa no mesmo instante geram UMA requisição.
 */
export function garantir(chave: string, ttlMs: number, forcar = false): Promise<void> {
  const atual = memoria.get(chave);
  if (!forcar && atual && atual.dado !== null && Date.now() - atual.em < ttlMs) return Promise.resolve();
  const jaVoando = emVoo.get(chave);
  if (jaVoando) return jaVoando;
  const p = buscar(chave).finally(() => emVoo.delete(chave));
  emVoo.set(chave, p);
  return p;
}

/**
 * Marca como vencido tudo que começa com um dos prefixos e atualiza na hora o
 * que está na tela.
 *
 * Prefixo e não chave exata porque uma mutação costuma mexer em mais de uma
 * leitura: apagar um cômodo muda `/api/home/rooms` e também o
 * `/api/home/entities`, que mostra em que cômodo cada dispositivo está.
 */
export function invalidar(...prefixos: string[]): void {
  for (const chave of [...memoria.keys()]) {
    if (!prefixos.some((p) => chave.startsWith(p))) continue;
    const atual = memoria.get(chave)!;
    memoria.set(chave, { ...atual, em: 0 });
    // Ninguém olhando: basta ficar vencido, a próxima montagem busca.
    if (temPlateia(chave)) void garantir(chave, 0, true);
  }
}

/** Troca o dado guardado na hora (atualização otimista). Devolve como estava, para desfazer. */
export function definirDado<T>(chave: string, atualizar: (atual: T | null) => T): T | null {
  const atual = lerCache<T>(chave);
  const antes = atual.dado;
  memoria.set(chave, { ...atual, dado: atualizar(antes), erro: null });
  avisar(chave);
  return antes;
}

/** Restaura um dado anterior (quando a mutação otimista falhou). */
export function restaurarDado<T>(chave: string, antes: T | null): void {
  const atual = lerCache<T>(chave);
  memoria.set(chave, { ...atual, dado: antes });
  avisar(chave);
}

/**
 * Preenche o cache com o que o SERVIDOR já leu (ver `servidor.ts`).
 *
 * Só planta onde ainda não há nada: se o painel já buscou (ou a pessoa já
 * mexeu na lista), o que está na tela é mais novo que o do servidor e não pode
 * ser sobrescrito por ele. É isso que torna a semeadura segura de repetir,
 * inclusive no render duplo do modo estrito do React.
 */
export function semear(dados: Record<string, unknown>): void {
  for (const [chave, dado] of Object.entries(dados)) {
    if (dado === null || dado === undefined) continue;
    const atual = memoria.get(chave);
    if (atual && atual.dado !== null) continue;
    memoria.set(chave, { dado, erro: null, carregando: false, revalidando: false, em: Date.now() });
    avisar(chave);
  }
}

/** Esquece tudo. O cache é da sessão do dono: sair da conta não pode deixar rastro. */
export function limparCache(): void {
  const chaves = [...memoria.keys()];
  memoria.clear();
  emVoo.clear();
  for (const c of chaves) avisar(c);
}

/**
 * Mutação com atualização otimista e desfazer.
 *
 * O padrão antigo (`setReload(n + 1)`) esperava o servidor e recarregava a
 * lista inteira, então marcar uma tarefa tinha latência visível mesmo com a
 * rota respondendo em 15ms. Aqui a tela muda na hora e só volta atrás se o
 * servidor recusar.
 *
 * Vale para mutação de BAIXO RISCO (marcar tarefa, renomear cômodo, reordenar
 * card). Nada que passe pelo gate humano (§5.1) entra aqui: aprovar uma ação
 * tem de mostrar o que o servidor de fato fez, não o que a tela supôs.
 */
export async function mutarRecurso<T>(opts: {
  /** a leitura que esta mutação muda na tela */
  chave: string;
  /** como fica a lista antes de o servidor confirmar */
  otimista: (atual: T | null) => T;
  executar: () => Promise<Response | null>;
  /** o que mais ficou velho por causa desta mutação */
  invalida?: string[];
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const antes = definirDado<T>(opts.chave, opts.otimista);
  try {
    const r = await opts.executar().catch(() => null);
    if (!r || !r.ok) throw new Error(await mensagemDeErro(r));
    invalidar(opts.chave, ...(opts.invalida ?? []));
    return { ok: true };
  } catch (e) {
    restaurarDado(opts.chave, antes);
    return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível salvar." };
  }
}

async function mensagemDeErro(r: Response | null): Promise<string> {
  if (!r) return "Sem conexão com o servidor.";
  const corpo = await r.json().catch(() => null);
  return (corpo as { error?: string } | null)?.error ?? `Não foi possível salvar (${r.status}).`;
}
