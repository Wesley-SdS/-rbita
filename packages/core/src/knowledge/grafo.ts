/**
 * O MAPA DO QUE A ÓRBITA SABE.
 *
 * O grafo antigo ligava memória com memória por similaridade de cosseno. Isso
 * responde "o que se parece com o quê", que é uma pergunta de busca, não de
 * mapa. O dono pediu outra coisa: ver o que está guardado, ligado ao quê, e DE
 * ONDE VEIO.
 *
 * Por isso as arestas daqui são VÍNCULOS REAIS, tirados das colunas que já
 * existem: a tarefa que nasceu daquela reunião, o documento que saiu daquela
 * conversa, a memória que foi extraída dali. Similaridade continua existindo,
 * mas como um tipo de aresta a mais, fraca e opcional, nunca como o mapa
 * inteiro. Um mapa em que tudo se liga com tudo não é um mapa.
 *
 * Este arquivo é puro: recebe as linhas e devolve o grafo. Quem vai ao banco é
 * o `grafo-query.ts`. É a parte que decide o que aparece e com que tamanho, e
 * isso precisa de teste.
 */

export type TipoDeNo = "conversa" | "documento" | "reuniao" | "tarefa" | "memoria" | "pessoa";

export interface NoDoGrafo {
  id: string;
  tipo: TipoDeNo;
  rotulo: string;
  /** peso visual: quantas ligações o nó tem, calculado aqui */
  grau: number;
  /** quando foi criado, para o dono achar o que é recente */
  quando: string | null;
  /** o que abrir ao clicar, quando existe tela para o tipo */
  href?: string;
}

export type TipoDeAresta = "veio_de" | "gerou" | "falou_em" | "parecido";

export interface ArestaDoGrafo {
  origem: string;
  destino: string;
  tipo: TipoDeAresta;
  /** só em `parecido`: de 0 a 1 */
  forca?: number;
}

export interface Grafo {
  nos: NoDoGrafo[];
  arestas: ArestaDoGrafo[];
  /** o que ficou de fora do teto, para a tela poder dizer em vez de esconder */
  omitidos: number;
}

/** Entrada crua: cada linha é uma coisa guardada. */
export interface LinhaDeNo {
  id: string;
  tipo: TipoDeNo;
  rotulo: string;
  quando?: Date | string | null;
  /** de onde veio (id de outro nó), quando há vínculo */
  origemId?: string | null;
}

/** Entrada crua de uma ligação já conhecida. */
export interface LinhaDeAresta {
  origem: string;
  destino: string;
  tipo: TipoDeAresta;
  forca?: number;
}

const HREF: Partial<Record<TipoDeNo, (id: string) => string>> = {
  conversa: (id) => `/app/conversa?c=${id}`,
  documento: () => `/app/conhecimento`,
  reuniao: () => `/app/reunioes`,
  tarefa: () => `/app/financas`,
  memoria: () => `/app/conhecimento`,
  pessoa: () => `/app/presenca`,
};

const quandoISO = (v: Date | string | null | undefined): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;

/** Corta o rótulo sem cortar palavra no meio, que é o que deixa a tela ilegível. */
export function encurtar(texto: string, max = 60): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= max) return limpo || "(sem título)";
  const corte = limpo.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).trimEnd() + "…";
}

/**
 * Monta o grafo.
 *
 * Três decisões que só aparecem aqui:
 *
 * 1. Aresta apontando para nó que não está no mapa é DESCARTADA. Uma tarefa
 *    cuja reunião foi apagada ficaria ligada ao nada, e a tela desenharia uma
 *    linha para um ponto invisível.
 * 2. O grau é contado DEPOIS de descartar, senão um nó pareceria importante
 *    por ligações que não existem mais.
 * 3. Quando passa do teto, saem os de MENOR grau, não os mais antigos. O que
 *    conecta muita coisa é justamente o que faz o mapa valer, e cortar por
 *    data apagaria o centro do mapa em vez da borda.
 */
export function montarGrafo(linhas: LinhaDeNo[], ligacoes: LinhaDeAresta[], opcoes: { teto?: number } = {}): Grafo {
  const teto = opcoes.teto ?? 300;

  const porId = new Map<string, NoDoGrafo>();
  for (const l of linhas) {
    if (porId.has(l.id)) continue;
    porId.set(l.id, {
      id: l.id,
      tipo: l.tipo,
      rotulo: encurtar(l.rotulo),
      grau: 0,
      quando: quandoISO(l.quando),
      href: HREF[l.tipo]?.(l.id),
    });
  }

  // arestas derivadas do "veio de" das próprias linhas
  const todas: LinhaDeAresta[] = [...ligacoes];
  for (const l of linhas) {
    if (l.origemId) todas.push({ origem: l.id, destino: l.origemId, tipo: "veio_de" });
  }

  const vistas = new Set<string>();
  const arestas: ArestaDoGrafo[] = [];
  for (const a of todas) {
    // ponta solta não vira linha para lugar nenhum
    if (!porId.has(a.origem) || !porId.has(a.destino) || a.origem === a.destino) continue;
    const chave = `${a.origem}|${a.destino}|${a.tipo}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    arestas.push(a.forca === undefined ? { origem: a.origem, destino: a.destino, tipo: a.tipo } : { ...a });
    porId.get(a.origem)!.grau++;
    porId.get(a.destino)!.grau++;
  }

  let nos = [...porId.values()];
  let omitidos = 0;
  if (nos.length > teto) {
    // desempate por data: entre dois nós soltos, o mais novo é o mais útil
    nos = nos
      .sort((a, b) => b.grau - a.grau || (b.quando ?? "").localeCompare(a.quando ?? ""))
      .slice(0, teto);
    omitidos = porId.size - nos.length;
    const dentro = new Set(nos.map((n) => n.id));
    return {
      nos,
      arestas: arestas.filter((a) => dentro.has(a.origem) && dentro.has(a.destino)),
      omitidos,
    };
  }

  return { nos, arestas, omitidos };
}

/**
 * Quem está ligado a quem, a partir de um nó.
 *
 * É o "abrir uma nota e ver as ligações dela": a tela usa isto ao clicar num
 * ponto do mapa, em vez de fazer outra consulta ao banco.
 */
export function vizinhos(grafo: Grafo, id: string): { no: NoDoGrafo; tipo: TipoDeAresta; sentido: "saiu" | "chegou" }[] {
  const porId = new Map(grafo.nos.map((n) => [n.id, n]));
  const out: { no: NoDoGrafo; tipo: TipoDeAresta; sentido: "saiu" | "chegou" }[] = [];
  for (const a of grafo.arestas) {
    if (a.origem === id && porId.has(a.destino)) out.push({ no: porId.get(a.destino)!, tipo: a.tipo, sentido: "saiu" });
    else if (a.destino === id && porId.has(a.origem)) out.push({ no: porId.get(a.origem)!, tipo: a.tipo, sentido: "chegou" });
  }
  return out;
}
