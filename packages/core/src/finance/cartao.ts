import { diaNoMes, mesDe, partes, somarMeses, type Ymd } from "./calendario";
import { saldoDevedor } from "./divida";
import type { Cartao, Centavos, Divida, Lancamento, PagamentoFatura } from "./tipos";

/**
 * Cartão de crédito por FATURA (PRD §5.12 a §5.14). A fatura é identificada
 * pela data de fechamento; é ela que liga compra, pagamento e rotativo.
 */

/** Em qual fatura cai uma compra: fecha no mês da compra, ou no seguinte se a compra foi depois do fechamento. */
export function fechamentoDaCompra(cartao: Cartao, data: Ymd): Ymd {
  const mes = mesDe(data);
  const fechaEsteMes = diaNoMes(mes, cartao.fechamento);
  if (partes(data).d <= partes(fechaEsteMes).d) return fechaEsteMes;
  return diaNoMes(somarMeses(mes, 1), cartao.fechamento);
}

/** Vencimento da fatura: se o dia de vencer é <= ao de fechar, vence no mês seguinte ao fechamento. */
export function vencimentoDaFatura(cartao: Cartao, fechamento: Ymd): Ymd {
  const mes = mesDe(fechamento);
  return cartao.vencimento <= cartao.fechamento ? diaNoMes(somarMeses(mes, 1), cartao.vencimento) : diaNoMes(mes, cartao.vencimento);
}

export interface Fatura {
  fechamento: Ymd;
  vencimento: Ymd;
  total: Centavos;
  pago: Centavos;
  restante: Centavos;
  paga: boolean;
  compras: Lancamento[];
}

const doCartao = (cartao: Cartao, ls: Lancamento[]) => ls.filter((l) => l.cartaoId === cartao.id);
const sinal = (l: Lancamento) => (l.tipo === "despesa" ? l.valor : -l.valor);

function montar(cartao: Cartao, fechamento: Ymd, compras: Lancamento[], pagamentos: PagamentoFatura[]): Fatura {
  const total = compras.reduce((s, l) => s + sinal(l), 0);
  const pago = pagamentos.filter((p) => p.cartaoId === cartao.id && p.fechamento === fechamento).reduce((s, p) => s + p.valor, 0);
  return {
    fechamento,
    vencimento: vencimentoDaFatura(cartao, fechamento),
    total,
    pago,
    restante: Math.max(0, total - pago),
    // tolerância de meio centavo: em centavos inteiros, "praticamente zero" é <= 0
    paga: total <= 0 || pago >= total,
    compras,
  };
}

/** Todas as faturas que têm compra, em ordem cronológica. */
export function faturasDoCartao(cartao: Cartao, ls: Lancamento[], pagamentos: PagamentoFatura[]): Fatura[] {
  const grupos = new Map<Ymd, Lancamento[]>();
  for (const l of doCartao(cartao, ls)) {
    const f = fechamentoDaCompra(cartao, l.data);
    grupos.set(f, [...(grupos.get(f) ?? []), l]);
  }
  return [...grupos.keys()].sort().map((f) => montar(cartao, f, grupos.get(f)!, pagamentos));
}

/**
 * A fatura mostrada no cartão: a primeira não paga. Se todas estiverem pagas,
 * a do ciclo que contém hoje, mesmo vazia.
 */
export function faturaAberta(cartao: Cartao, ls: Lancamento[], pagamentos: PagamentoFatura[], hoje: Ymd): Fatura {
  const aberta = faturasDoCartao(cartao, ls, pagamentos).find((f) => !f.paga);
  if (aberta) return aberta;
  const atual = fechamentoDaCompra(cartao, hoje);
  return montar(cartao, atual, doCartao(cartao, ls).filter((l) => fechamentoDaCompra(cartao, l.data) === atual), pagamentos);
}

/** Limite usado: compras − estornos − pagamentos (nunca negativo) + rotativo das dívidas deste cartão. */
export function limiteDoCartao(cartao: Cartao, ls: Lancamento[], pagamentos: PagamentoFatura[], dividas: Divida[]): { usado: Centavos; livre: Centavos } {
  const compras = doCartao(cartao, ls).reduce((s, l) => s + sinal(l), 0);
  const pago = pagamentos.filter((p) => p.cartaoId === cartao.id).reduce((s, p) => s + p.valor, 0);
  const rotativo = dividas.filter((d) => d.cartaoId === cartao.id).reduce((s, d) => s + saldoDevedor(d), 0);
  const usado = Math.max(0, compras - pago) + rotativo;
  return { usado, livre: Math.max(0, cartao.limite - usado) };
}
