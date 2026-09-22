/**
 * O que a tela de gestão mostra: o consumo da casa, agrupado.
 *
 * Puro de propósito. A consulta ao banco fica na rota; aqui está só a regra de
 * como agrupar e o que destacar, que é a parte que precisa de teste e a que
 * decide se o número faz sentido para quem olha.
 */

export interface LinhaDeUso {
  fluxo: string;
  referencia: string | null;
  provider: string;
  modelo: string;
  unidade: string;
  entrada: number;
  saida: number;
  custoUsd: number;
  cobranca: string;
  duracaoMs: number | null;
  erro: string | null;
  createdAt: Date | string;
}

export interface Grupo {
  chave: string;
  chamadas: number;
  custoUsd: number;
  entrada: number;
  saida: number;
  /** chamadas que falharam (custaram tempo, às vezes dinheiro, e não entregaram nada) */
  falhas: number;
  /** chamadas cujo provedor não informa preço: o custo delas é desconhecido, não zero */
  semPreco: number;
  unidades: string[];
}

export interface ResumoDeUso {
  totalUsd: number;
  chamadas: number;
  falhas: number;
  /** quantas chamadas rodaram sob assinatura (custo zero por chamada, mas consomem a cota) */
  chamadasAssinatura: number;
  /** quantas rodaram na máquina de casa */
  chamadasLocais: number;
  /** chamadas pagas cujo preço o provedor não informou */
  chamadasSemPreco: number;
  porFluxo: Grupo[];
  porProvedor: Grupo[];
  porModelo: Grupo[];
}

/** Uma chamada paga sem preço informado. Custo zero aqui significa "não sei", não "de graça". */
function semPrecoConhecido(l: LinhaDeUso): boolean {
  return l.cobranca === "uso" && l.custoUsd === 0 && (l.entrada > 0 || l.saida > 0);
}

function agrupar(linhas: LinhaDeUso[], chaveDe: (l: LinhaDeUso) => string): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const l of linhas) {
    const chave = chaveDe(l);
    const g = mapa.get(chave) ?? { chave, chamadas: 0, custoUsd: 0, entrada: 0, saida: 0, falhas: 0, semPreco: 0, unidades: [] };
    g.chamadas += 1;
    g.custoUsd += l.custoUsd;
    g.entrada += l.entrada;
    g.saida += l.saida;
    if (l.erro) g.falhas += 1;
    if (semPrecoConhecido(l)) g.semPreco += 1;
    if (!g.unidades.includes(l.unidade)) g.unidades.push(l.unidade);
    mapa.set(chave, g);
  }
  // o que custa mais primeiro; empate (tudo zero) resolve por volume, senão a
  // lista de uma casa só com assinatura sairia em ordem aleatória
  return [...mapa.values()].sort((a, b) => b.custoUsd - a.custoUsd || b.chamadas - a.chamadas);
}

export function resumirUso(linhas: LinhaDeUso[]): ResumoDeUso {
  return {
    totalUsd: linhas.reduce((n, l) => n + l.custoUsd, 0),
    chamadas: linhas.length,
    falhas: linhas.filter((l) => l.erro).length,
    chamadasAssinatura: linhas.filter((l) => l.cobranca === "assinatura").length,
    chamadasLocais: linhas.filter((l) => l.cobranca === "local").length,
    chamadasSemPreco: linhas.filter(semPrecoConhecido).length,
    porFluxo: agrupar(linhas, (l) => l.fluxo),
    porProvedor: agrupar(linhas, (l) => l.provider),
    porModelo: agrupar(linhas, (l) => l.modelo),
  };
}

/**
 * O gasto por dia, para o gráfico. Devolve TODOS os dias do período, inclusive
 * os de custo zero: um gráfico que pula os dias sem gasto mente sobre o ritmo.
 */
export function porDia(linhas: LinhaDeUso[], dias: number, hoje = new Date()): { dia: string; custoUsd: number; chamadas: number }[] {
  const saida: { dia: string; custoUsd: number; chamadas: number }[] = [];
  const porChave = new Map<string, { custoUsd: number; chamadas: number }>();
  for (const l of linhas) {
    const d = new Date(l.createdAt);
    const chave = d.toISOString().slice(0, 10);
    const atual = porChave.get(chave) ?? { custoUsd: 0, chamadas: 0 };
    atual.custoUsd += l.custoUsd;
    atual.chamadas += 1;
    porChave.set(chave, atual);
  }
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const chave = d.toISOString().slice(0, 10);
    saida.push({ dia: chave, ...(porChave.get(chave) ?? { custoUsd: 0, chamadas: 0 }) });
  }
  return saida;
}
