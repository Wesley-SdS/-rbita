import { mesDe, somarMeses, type Ym, type Ymd } from "./calendario";
import { entradaDoMes, classificarGasto, mediaGastoLivre, previstoDoMes, saldoTotal } from "./mes";
import type { Centavos, Compromisso, EstadoFinanceiro, Limiares } from "./tipos";

/**
 * O que uma direção (pagar/receber) soma num mês, contando que conta fixa
 * CONTINUA: além das ocorrências que já existem, cada série mensal sem
 * ocorrência naquele mês, cuja última é anterior a ele, entra com o valor da
 * última (PRD §6.6). Sem isso, a previsão de dezembro mostraria só os meses
 * que a semeadura já criou e pareceria que as contas acabam.
 */
export function contaProjetada(cs: Compromisso[], ym: Ym, direcao: Compromisso["direcao"]): Centavos {
  const daDirecao = cs.filter((c) => c.direcao === direcao);
  let total = daDirecao.filter((c) => mesDe(c.vencimento) === ym).reduce((s, c) => s + c.valor, 0);
  const series = new Map<string, Compromisso[]>();
  for (const c of daDirecao) if (c.recorrencia === "mensal") series.set(c.serieId ?? c.id, [...(series.get(c.serieId ?? c.id) ?? []), c]);
  for (const ocorr of series.values()) {
    if (ocorr.some((c) => mesDe(c.vencimento) === ym)) continue;
    const ultima = ocorr.reduce((a, b) => (b.vencimento > a.vencimento ? b : a));
    if (mesDe(ultima.vencimento) < ym) total += ultima.valor;
  }
  return total;
}

export interface MesPrevisto {
  mes: Ym;
  atual: boolean;
  entra: Centavos;
  contasFixas: Centavos;
  parcelas: Centavos;
  metas: Centavos;
  comprometido: Centavos;
  livre: Centavos;
  gastoLivre: Centavos;
  /** saldo em contas ao fim do mês, no ritmo médio; null no mês atual */
  saldoProjetado: Centavos | null;
}

export interface Previsao {
  meses: MesPrevisto[];
  totalComprometido: Centavos;
  maisApertado: MesPrevisto | null;
  mediaLivre: Centavos;
}

export function preverMeses(e: EstadoFinanceiro, hoje: Ymd, lim: Limiares): Previsao {
  const atual = mesDe(hoje);
  const mediaLivre = mediaGastoLivre(e.lancamentos, hoje, lim.mesesMedia);
  let saldo = saldoTotal(e.contas, e.lancamentos, hoje);
  const meses: MesPrevisto[] = [];
  for (let i = 0; i < lim.mesesPrevisao; i++) {
    const ym = somarMeses(atual, i);
    const prev = previstoDoMes(e.lancamentos, e.compromissos, ym);
    const receber = contaProjetada(e.compromissos, ym, "receber");
    const eAtual = i === 0;
    const entra = (eAtual ? Math.max(e.renda, entradaDoMes(e.lancamentos, ym)) : e.renda) + receber;
    const contasFixas = eAtual ? prev.contasFixas : contaProjetada(e.compromissos, ym, "pagar");
    const comprometido = contasFixas + prev.parcelas + prev.metas;
    const gastoLivre = eAtual ? classificarGasto(e.lancamentos, ym).livre : mediaLivre;
    let saldoProjetado: Centavos | null = null;
    if (!eAtual) {
      saldo = saldo + entra - comprometido - mediaLivre;
      saldoProjetado = saldo;
    }
    meses.push({ mes: ym, atual: eAtual, entra, contasFixas, parcelas: prev.parcelas, metas: prev.metas, comprometido, livre: entra - comprometido, gastoLivre, saldoProjetado });
  }
  const maisApertado = meses.length ? meses.reduce((a, b) => (b.livre < a.livre ? b : a)) : null;
  return { meses, totalComprometido: meses.reduce((s, m) => s + m.comprometido, 0), maisApertado, mediaLivre };
}
