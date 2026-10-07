import { diasEntre, diasNoMes, mesDe, partes, somarDias, somarMeses, type Ym, type Ymd } from "./calendario";
import type { Centavos, Compromisso, Conta, EstadoFinanceiro, Lancamento, Limiares } from "./tipos";
import { lugarDaDescricao } from "./lugares";

/**
 * Os números do mês (PRD §5.1 a §5.11 e §5.17). Tudo que a tela mostra e tudo
 * que a Órbita FALA sobre dinheiro sai daqui: se a voz dissesse um "posso
 * gastar hoje" diferente do painel, o dono deixaria de confiar nos dois.
 *
 * Princípio que atravessa o arquivo: transferência não é gasto. Mover dinheiro
 * entre contas ou pagar fatura nunca entra em gasto nem em entrada.
 */

const doMes = (ym: Ym) => (l: Lancamento) => mesDe(l.data) === ym;
const saidaReal = (l: Lancamento) => l.tipo === "despesa" && !l.transferencia;
const estorno = (l: Lancamento) => l.tipo === "receita" && !!l.estorno && !l.transferencia;
const soma = (ls: Lancamento[]) => ls.reduce((s, l) => s + l.valor, 0);

export const ehParcela = (l: Lancamento) => (l.parcelaDe ?? 0) > 1 && !l.metaId;
export const ehDeMeta = (l: Lancamento) => !!l.metaId;

/** Saídas do mês (sem transferência) menos estornos. */
export function gastoDoMes(ls: Lancamento[], ym: Ym): Centavos {
  const m = ls.filter(doMes(ym));
  return soma(m.filter(saidaReal)) - soma(m.filter(estorno));
}

/** Entradas do mês que não são transferência nem estorno. */
export function entradaDoMes(ls: Lancamento[], ym: Ym): Centavos {
  return soma(ls.filter(doMes(ym)).filter((l) => l.tipo === "receita" && !l.transferencia && !l.estorno));
}

/**
 * Saldo de uma conta: tudo que passou nela fora o cartão (transferências
 * incluídas: movem dinheiro de verdade). Com `ate`, só até aquela data.
 *
 * O PRD original somava "de qualquer data", e aí a parcela de boleto de uma
 * meta, datada para dezembro, já saía do "tenho na conta" hoje, e a previsão
 * a descontava de novo em dezembro. Tela e voz passam `ate = hoje`.
 */
export function saldoDaConta(conta: Conta, ls: Lancamento[], ate?: Ymd): Centavos {
  return ls
    .filter((l) => l.contaId === conta.id && !l.cartaoId && (!ate || l.data <= ate))
    .reduce((s, l) => s + (l.tipo === "receita" ? l.valor : -l.valor), conta.saldoInicial);
}

export function saldoTotal(contas: Conta[], ls: Lancamento[], ate?: Ymd): Centavos {
  return contas.reduce((s, c) => s + saldoDaConta(c, ls, ate), 0);
}

/** Gasto por categoria no mês (estorno abate a própria categoria), só > 0, do maior para o menor. */
export function gastoPorCategoria(ls: Lancamento[], ym: Ym): { categoriaId: string | null; total: Centavos }[] {
  const acc = new Map<string | null, Centavos>();
  for (const l of ls.filter(doMes(ym))) {
    const k = l.categoriaId ?? null;
    if (saidaReal(l)) acc.set(k, (acc.get(k) ?? 0) + l.valor);
    else if (estorno(l)) acc.set(k, (acc.get(k) ?? 0) - l.valor);
  }
  return [...acc.entries()].filter(([, t]) => t > 0).map(([categoriaId, total]) => ({ categoriaId, total })).sort((a, b) => b.total - a.total);
}

/**
 * O gasto por LUGAR em cada mês pedido (`lugares.ts` diz qual é o lugar de
 * cada descrição). Mesma regra do gasto do mês: transferência não conta e
 * estorno abate, para a soma dos lugares bater com o total do painel.
 */
export function gastoPorLugar(ls: Lancamento[], meses: Ym[]): { lugar: string; total: Centavos; vezes: number; porMes: Centavos[] }[] {
  const indice = new Map(meses.map((m, i) => [m, i]));
  const acc = new Map<string, { lugar: string; total: Centavos; vezes: number; porMes: Centavos[] }>();
  for (const l of ls) {
    const i = indice.get(mesDe(l.data));
    if (i === undefined || !(saidaReal(l) || estorno(l))) continue;
    const lugar = lugarDaDescricao(l.descricao);
    const item = acc.get(lugar) ?? { lugar, total: 0, vezes: 0, porMes: new Array<Centavos>(meses.length).fill(0) };
    const v = saidaReal(l) ? l.valor : -l.valor;
    item.total += v;
    item.porMes[i]! += v;
    if (saidaReal(l)) item.vezes++;
    acc.set(lugar, item);
  }
  return [...acc.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
}

/** Gasto de cada dia do mês e o acumulado (índice 0 = dia 1). */
export function gastoDiario(ls: Lancamento[], ym: Ym): { dia: Centavos[]; acumulado: Centavos[] } {
  const dia = new Array<Centavos>(diasNoMes(ym)).fill(0);
  for (const l of ls.filter(doMes(ym))) {
    const i = partes(l.data).d - 1;
    if (saidaReal(l)) dia[i]! += l.valor;
    else if (estorno(l)) dia[i]! -= l.valor;
  }
  let corrido = 0;
  return { dia, acumulado: dia.map((v) => (corrido += v)) };
}

export interface Classificacao {
  gasto: Centavos;
  fixos: Centavos;
  parcelas: Centavos;
  projetos: Centavos;
  livre: Centavos;
}

/** Quanto do gasto do mês foi fixo, parcela, projeto e livre (§5.6). */
export function classificarGasto(ls: Lancamento[], ym: Ym): Classificacao {
  const saidas = ls.filter(doMes(ym)).filter(saidaReal);
  const gasto = gastoDoMes(ls, ym);
  const fixos = soma(saidas.filter((l) => l.fixo && !ehParcela(l) && !ehDeMeta(l)));
  const parcelas = soma(saidas.filter(ehParcela));
  const projetos = soma(saidas.filter(ehDeMeta));
  return { gasto, fixos, parcelas, projetos, livre: gasto - fixos - parcelas - projetos };
}

export interface Previsto {
  contasFixas: Centavos;
  parcelas: Centavos;
  metas: Centavos;
  /** o que entra no "posso gastar hoje": contas + parcelas (metas ficam de fora, §5.7) */
  comprometido: Centavos;
}

/** O que já está decidido que sai no mês (§5.7). */
export function previstoDoMes(ls: Lancamento[], cs: Compromisso[], ym: Ym): Previsto {
  const contasFixas = cs.filter((c) => c.direcao === "pagar" && mesDe(c.vencimento) === ym).reduce((s, c) => s + c.valor, 0);
  const saidas = ls.filter(doMes(ym)).filter(saidaReal);
  const parcelas = soma(saidas.filter(ehParcela));
  const metas = soma(saidas.filter(ehDeMeta));
  return { contasFixas, parcelas, metas, comprometido: contasFixas + parcelas };
}

/** Renda; sem renda, o teto; sem nenhum dos dois, não há base (§5.8). */
export function baseDoMes(renda: Centavos, teto: Centavos): Centavos | null {
  if (renda > 0) return renda;
  if (teto > 0) return teto;
  return null;
}

/** Dias que faltam contando hoje (mínimo 1); em outro mês que não o atual, 1. */
export function diasRestantes(ym: Ym, hoje: Ymd): number {
  if (mesDe(hoje) !== ym) return 1;
  return Math.max(1, diasNoMes(ym) - partes(hoje).d + 1);
}

export interface PossoGastar {
  disponivel: Centavos;
  sobra: Centavos;
  diasRestantes: number;
  porDia: Centavos;
}

/** "Posso gastar hoje" (§5.9): o que sobra da base depois do comprometido e do gasto livre, dividido pelos dias que faltam. */
export function possoGastar(base: Centavos, comprometido: Centavos, livre: Centavos, ym: Ym, hoje: Ymd): PossoGastar {
  const disponivel = base - comprometido;
  const sobra = disponivel - livre;
  const dias = diasRestantes(ym, hoje);
  return { disponivel, sobra, diasRestantes: dias, porDia: Math.trunc(sobra / dias) };
}

export type Situacao = "quitado" | "vencido" | "perto" | "aberto";

export function situacaoDaConta(c: Compromisso, hoje: Ymd, diasPerto: number): Situacao {
  if (c.status === "quitado") return "quitado";
  const falta = diasEntre(hoje, c.vencimento);
  if (falta < 0) return "vencido";
  if (falta <= diasPerto) return "perto";
  return "aberto";
}

export interface Janela {
  aPagar: Centavos;
  aReceber: Centavos;
  emAtraso: Centavos;
}

/** A pagar / a receber nos próximos N dias, já contando o que venceu; e o que está em atraso (§5.10). */
export function janela(cs: Compromisso[], hoje: Ymd, dias: number): Janela {
  const limite = somarDias(hoje, dias);
  const abertas = cs.filter((c) => c.status === "aberto");
  const ate = (d: "pagar" | "receber") => abertas.filter((c) => c.direcao === d && c.vencimento <= limite).reduce((s, c) => s + c.valor, 0);
  const emAtraso = abertas.filter((c) => c.direcao === "pagar" && c.vencimento < hoje).reduce((s, c) => s + c.valor, 0);
  return { aPagar: ate("pagar"), aReceber: ate("receber"), emAtraso };
}

/** Média do gasto livre dos últimos N meses COMPLETOS, só entre os que tiveram lançamento (§5.17). */
export function mediaGastoLivre(ls: Lancamento[], hoje: Ymd, meses: number): Centavos {
  const atual = mesDe(hoje);
  const valores: Centavos[] = [];
  for (let i = 1; i <= meses; i++) {
    const ym = somarMeses(atual, -i);
    if (ls.some(doMes(ym))) valores.push(classificarGasto(ls, ym).livre);
  }
  return valores.length ? Math.round(valores.reduce((s, v) => s + v, 0) / valores.length) : 0;
}

/**
 * O número principal do painel (§6.1.2), em quatro modos. A regra de ouro é a
 * honestidade: com renda mas sem saber o que sai (nenhuma conta a pagar e
 * nenhum lançamento), dividir a renda pelos dias daria um valor que não
 * existe, então o modo A se recusa a mostrar "posso gastar hoje".
 */
export type Farol =
  | { modo: "sem_saidas"; base: Centavos }
  | { modo: "posso_gastar"; fimDoMes: boolean; valor: Centavos; porDia: Centavos; sobra: Centavos; disponivel: Centavos; livre: Centavos; gastoTotal: Centavos; diasRestantes: number; usoPct: number }
  | { modo: "previsao_30"; sobra: Centavos; saldo: Centavos; aReceber: Centavos; aPagar: Centavos }
  | { modo: "gasto_do_mes"; gasto: Centavos; teto: Centavos | null; ritmoDia: Centavos | null; projecao: Centavos | null };

export function farol(e: EstadoFinanceiro, ym: Ym, hoje: Ymd, lim: Limiares): Farol {
  const base = baseDoMes(e.renda, e.teto);
  const mesAtual = mesDe(hoje) === ym;
  if (base !== null && mesAtual) {
    const semSaidas = !e.compromissos.some((c) => c.direcao === "pagar") && e.lancamentos.length === 0;
    if (semSaidas) return { modo: "sem_saidas", base };
    const cls = classificarGasto(e.lancamentos, ym);
    const prev = previstoDoMes(e.lancamentos, e.compromissos, ym);
    const p = possoGastar(base, prev.comprometido, cls.livre, ym, hoje);
    const fimDoMes = p.diasRestantes <= lim.diasFimDoMes;
    return {
      modo: "posso_gastar",
      fimDoMes,
      valor: Math.max(0, fimDoMes ? p.sobra : p.porDia),
      porDia: p.porDia,
      sobra: p.sobra,
      disponivel: p.disponivel,
      livre: cls.livre,
      gastoTotal: cls.gasto,
      diasRestantes: p.diasRestantes,
      usoPct: p.disponivel > 0 ? Math.min(100, (cls.livre / p.disponivel) * 100) : 100,
    };
  }
  if (base === null && e.compromissos.length > 0) {
    const saldo = saldoTotal(e.contas, e.lancamentos, hoje);
    const j = janela(e.compromissos, hoje, lim.diasJanela);
    return { modo: "previsao_30", sobra: saldo + j.aReceber - j.aPagar, saldo, aReceber: j.aReceber, aPagar: j.aPagar };
  }
  const gasto = gastoDoMes(e.lancamentos, ym);
  const dia = partes(hoje).d;
  const ritmo = mesAtual && gasto > 0 ? Math.round(gasto / dia) : null;
  return {
    modo: "gasto_do_mes",
    gasto,
    teto: e.teto > 0 ? e.teto : null,
    ritmoDia: ritmo,
    projecao: ritmo !== null ? ritmo * diasNoMes(ym) : null,
  };
}
