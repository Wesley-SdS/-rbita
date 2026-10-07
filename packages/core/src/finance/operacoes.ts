import { dividirEmParcelas } from "./parcelas";
import { dividirPagamento } from "./divida";
import type { Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * As REGRAS de cada ação do financeiro, sem banco: dado o pedido, quais
 * lançamentos nascem e com quais marcas. O store só grava o que sai daqui.
 *
 * Separado assim porque a mesma ação chega por três portas (tela, chat e voz)
 * e as marcas são o que faz os números baterem: um pagamento de fatura sem a
 * marca de transferência vira gasto em dobro (a compra já contou), e uma
 * conta quitada sem a marca de fixo aparece como prevista E como gasto livre.
 */

export interface NovoLancamento {
  tipo: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  descricao: string | null;
  categoriaId: string | null;
  contaId: string | null;
  cartaoId: string | null;
  transferencia?: boolean;
  grupoTransferencia?: string | null;
  fixo?: boolean;
  estorno?: boolean;
  grupoParcela?: string | null;
  parcelaN?: number | null;
  parcelaDe?: number | null;
  metaId?: string | null;
  metaItemId?: string | null;
  compromissoId?: string | null;
  importado?: boolean;
}

export interface PedidoDeLancamento {
  tipo: "despesa" | "receita";
  valor: Centavos;
  data: Ymd;
  descricao?: string | null;
  categoriaId: string | null;
  /** nome da categoria, para a descrição base das parcelas quando não há descrição */
  categoriaNome?: string | null;
  contaId?: string | null;
  cartaoId?: string | null;
  estorno?: boolean;
  parcelas?: number;
  importado?: boolean;
}

/**
 * Lançamento novo (PRD §7.1). Parcelas só existem no cartão e só na saída:
 * parcelar numa conta não é um conceito do banco, é só um lançamento.
 */
export function lancamentosDoPedido(p: PedidoDeLancamento, grupoParcela: () => string): NovoLancamento[] {
  const noCartao = !!p.cartaoId && p.tipo === "despesa";
  const n = noCartao ? Math.max(1, Math.min(48, Math.floor(p.parcelas ?? 1))) : 1;
  const base = {
    tipo: p.tipo,
    categoriaId: p.categoriaId,
    contaId: noCartao ? null : (p.contaId ?? null),
    cartaoId: noCartao ? p.cartaoId! : null,
    // estorno é entrada que abate gasto; saída nunca é estorno
    estorno: p.tipo === "receita" && !!p.estorno,
    importado: !!p.importado,
  };
  if (n === 1) return [{ ...base, data: p.data, valor: p.valor, descricao: p.descricao?.trim() || null }];
  const grupo = grupoParcela();
  const descricaoBase = p.descricao?.trim() || p.categoriaNome || "Compra";
  return dividirEmParcelas(p.valor, n, p.data, descricaoBase).map((x) => ({
    ...base,
    data: x.data,
    valor: x.valor,
    descricao: x.descricao,
    grupoParcela: grupo,
    parcelaN: x.n,
    parcelaDe: x.de,
  }));
}

/** As duas pernas de uma transferência: não é gasto nem entrada, só dinheiro mudando de lugar (§7.3). */
export function pernasDaTransferencia(p: {
  valor: Centavos;
  data: Ymd;
  descricao?: string | null;
  origemId: string;
  destinoId: string;
  categoriaSaidaId: string | null;
  categoriaEntradaId: string | null;
  grupo: string;
}): NovoLancamento[] {
  if (p.origemId === p.destinoId) throw new RegraFinanceiraError("Escolha duas contas diferentes.");
  if (p.valor <= 0) throw new RegraFinanceiraError("Informe o valor.");
  const comum = { data: p.data, valor: p.valor, descricao: p.descricao?.trim() || "Transferência", cartaoId: null, transferencia: true, grupoTransferencia: p.grupo };
  return [
    { ...comum, tipo: "despesa", categoriaId: p.categoriaSaidaId, contaId: p.origemId },
    { ...comum, tipo: "receita", categoriaId: p.categoriaEntradaId, contaId: p.destinoId },
  ];
}

/**
 * Quitar uma conta a pagar/receber (§7.7). O lançamento sai marcado como
 * FIXO sempre, recorrente ou não: o PRD original só marcava a recorrente, e a
 * avulsa aparecia duas vezes (prevista e gasto livre), o ponto de atenção 1.
 * O vínculo `compromissoId` é o que permite desquitar (ponto de atenção 4).
 */
export function lancamentoDaQuitacao(c: {
  id: string;
  direcao: "pagar" | "receber";
  descricao: string;
  categoriaId: string | null;
}, p: { valor: Centavos; data: Ymd; contaId: string | null; cartaoId: string | null }): NovoLancamento {
  if (p.valor <= 0) throw new RegraFinanceiraError("Informe o valor.");
  const noCartao = c.direcao === "pagar" && !!p.cartaoId;
  return {
    tipo: c.direcao === "pagar" ? "despesa" : "receita",
    data: p.data,
    valor: p.valor,
    descricao: c.descricao,
    categoriaId: c.categoriaId,
    contaId: noCartao ? null : p.contaId,
    cartaoId: noCartao ? p.cartaoId : null,
    fixo: true,
    compromissoId: c.id,
  };
}

export interface PlanoDeFatura {
  /** a saída na conta: reduz o saldo mas é transferência, não gasto */
  lancamento: NovoLancamento;
  /** o que abate a fatura agora (o menor entre o pago e o restante) */
  pagamento: Centavos;
  /** o que faltou e foi para o rotativo (0 se não foi) */
  rolado: Centavos;
  /** o que faltou e ficou em aberto na fatura (0 se não ficou) */
  emAberto: Centavos;
}

/** Pagar fatura, inclusive parcial (§7.8): o resto vira rotativo ou fica em aberto, conforme o dono escolhe. */
export function planoDePagarFatura(p: {
  cartaoNome: string;
  fechamento: Ymd;
  restante: Centavos;
  valor: Centavos;
  data: Ymd;
  contaId: string;
  categoriaFaturaId: string | null;
  resto: "rotativo" | "depois";
}): PlanoDeFatura {
  if (p.valor <= 0) throw new RegraFinanceiraError("Informe o valor pago.");
  if (p.restante <= 0) throw new RegraFinanceiraError("Esta fatura já está paga.");
  const pagamento = Math.min(p.valor, p.restante);
  const falta = p.restante - pagamento;
  const [, m, d] = p.fechamento.split("-");
  return {
    lancamento: {
      tipo: "despesa",
      data: p.data,
      valor: p.valor,
      descricao: `Fatura ${p.cartaoNome} (${d}/${m})`,
      categoriaId: p.categoriaFaturaId,
      contaId: p.contaId,
      cartaoId: null,
      transferencia: true,
    },
    pagamento,
    rolado: p.resto === "rotativo" ? falta : 0,
    emAberto: p.resto === "depois" ? falta : 0,
  };
}

/** Pagamento de dívida (§7.10): o que não é juros abate o saldo. Juros maiores que o valor ficam iguais ao valor. */
export function planoDePagarDivida(p: {
  dividaNome: string;
  saldo: Centavos;
  jurosMesPct: number;
  valor: Centavos;
  /** juros informados pelo dono; ausente = os do mês (saldo × taxa) */
  juros?: Centavos | null;
  data: Ymd;
  contaId: string;
  categoriaDividasId: string | null;
}): { lancamento: NovoLancamento; juros: Centavos; abatimento: Centavos } {
  if (p.valor <= 0) throw new RegraFinanceiraError("Informe o valor pago.");
  const sugerido = dividirPagamento(p.saldo, p.jurosMesPct, p.valor);
  const juros = Math.min(p.valor, Math.max(0, p.juros ?? sugerido.juros));
  return {
    lancamento: {
      tipo: "despesa",
      data: p.data,
      valor: p.valor,
      descricao: `Pagamento ${p.dividaNome}`,
      categoriaId: p.categoriaDividasId,
      contaId: p.contaId,
      cartaoId: null,
      fixo: true,
    },
    juros,
    abatimento: p.valor - juros,
  };
}

export interface ItemDeMetaParaLancar {
  id: string;
  nome: string;
  valor: Centavos;
  status: "planejado" | "orcado" | "contratado" | "pago";
  forma: "avista" | "cartao" | "boleto" | "carne";
  parcelas: number;
  primeiroVenc: Ymd | null;
  contaId: string | null;
  cartaoId: string | null;
}

/**
 * Os lançamentos que um item de meta gera (§6.5.4). Planejado e orçado não
 * geram nada; contratado e pago geram as parcelas, no cartão (e aí caem nas
 * faturas certas) ou na conta. Quem chama apaga os anteriores do item antes.
 */
export function lancamentosDoItem(
  item: ItemDeMetaParaLancar,
  ctx: { metaId: string; categoriaId: string | null; contaPadraoId: string | null; hoje: Ymd; grupo: () => string },
): NovoLancamento[] {
  if (item.status !== "contratado" && item.status !== "pago") return [];
  if (item.valor <= 0) return [];
  const noCartao = item.forma === "cartao" && !!item.cartaoId;
  const n = Math.max(1, Math.min(48, Math.floor(item.parcelas || 1)));
  const grupo = n > 1 ? ctx.grupo() : null;
  return dividirEmParcelas(item.valor, n, item.primeiroVenc ?? ctx.hoje, item.nome).map((x) => ({
    tipo: "despesa",
    data: x.data,
    valor: x.valor,
    descricao: x.descricao,
    categoriaId: ctx.categoriaId,
    contaId: noCartao ? null : (item.contaId ?? ctx.contaPadraoId),
    cartaoId: noCartao ? item.cartaoId : null,
    grupoParcela: grupo,
    parcelaN: n > 1 ? x.n : null,
    parcelaDe: n > 1 ? x.de : null,
    metaId: ctx.metaId,
    metaItemId: item.id,
  }));
}

/**
 * Erro que é do DONO, não do sistema: vira mensagem na tela (400) e resposta
 * falada na voz. Mesma ideia do `JobPermanentError`: não adianta tentar de novo.
 */
export class RegraFinanceiraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegraFinanceiraError";
  }
}

/**
 * "Já tem um igual, lanço de novo?" (`finance/duplicados.ts`). Não é erro: é
 * PERGUNTA. A tela confirma e reenvia com `repetir`; o chat, a voz e o
 * WhatsApp perguntam ao dono e só repetem se ele disser que sim.
 */
export class RepetidoError extends RegraFinanceiraError {
  constructor(message: string, readonly repetidos: { descricao: string; valor: number; data: string }[], readonly novos: number) {
    super(message);
    this.name = "RepetidoError";
  }
}
