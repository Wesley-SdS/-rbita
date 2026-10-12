import { diasEntre, diaNoMes, mesDe, somarMeses, type Ymd } from "../finance/calendario";
import { fechamentoDaCompra, vencimentoDaFatura } from "../finance/cartao";
import type { Cartao, Centavos } from "../finance/tipos";
import type { TransacaoBruta, TxBanco } from "./normalizar";

/**
 * Cartão de crédito pela Pluggy. Puro, como `normalizar.ts` e `plano.ts`.
 *
 * O que o cartão tem de diferente da conta:
 *  - A compra só pesa no mês certo se cair na FATURA certa. A Órbita decide a
 *    fatura pelo dia de fechamento do cartão; o banco decide pela fatura que
 *    emitiu (e o fechamento anda um dia quando cai em fim de semana). Quando as
 *    duas discordam, vale a do banco, e a data da compra é movida para o dia
 *    de fechamento daquela fatura.
 *  - O pagamento da fatura sai da CONTA CORRENTE, não do cartão. Ele precisa
 *    entrar como transferência (a compra já contou como gasto) e abater a
 *    fatura; senão o gasto é contado duas vezes.
 *  - A linha de "pagamento recebido" que aparece dentro do cartão é só o outro
 *    lado desse pagamento: lançá-la como entrada inventaria renda.
 */

export interface TxCartao extends TxBanco {
  /** crédito que abate gasto (estorno de compra), não renda */
  estorno: boolean;
  parcelaN: number | null;
  parcelaDe: number | null;
  billId: string | null;
}

export interface CompraBruta extends TransacaoBruta {
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; billId?: string | null } | null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Pagamento recebido", "PGTO FATURA": o lado cartão de um pagamento de fatura. */
const PAGAMENTO_RECEBIDO = /\b(pagamento|pgto|pag|payment)\b.{0,25}\b(recebido|efetuado|fatura|received|obrigado)\b|\bpagamento\s+de\s+fatura\b/;

/** O débito da conta corrente que parece pagar fatura de cartão. */
const PAGAMENTO_DE_FATURA = /\b(fatura|pgto\.?\s*cart|pag\.?\s*cart|pagamento\s+(de\s+)?cart|cartao\s+(de\s+)?credito|cartao\s+de\s+cred)/;

export function pareceDebitoDeFatura(descricao: string): boolean {
  return PAGAMENTO_DE_FATURA.test(semAcento(descricao));
}

/**
 * Normaliza uma linha do cartão. Devolve null para o que não vira lançamento:
 * pendente, moeda estrangeira, valor zero, sem `type` (o sinal do valor no
 * cartão não é confiável entre bancos, e inverter compra em estorno estraga o
 * limite) e o "pagamento recebido" (ver acima).
 */
export function normalizarCompraDoCartao(raw: CompraBruta, contaRef: string): TxCartao | null {
  if (!raw?.id || typeof raw.amount !== "number" || !Number.isFinite(raw.amount)) return null;
  if (raw.status && raw.status !== "POSTED") return null;
  if (raw.currencyCode && raw.currencyCode !== "BRL") return null;
  if (raw.type !== "DEBIT" && raw.type !== "CREDIT") return null;
  const data = /^\d{4}-\d{2}-\d{2}/.exec(raw.date ?? "")?.[0];
  if (!data) return null;
  const valor = Math.round(Math.abs(raw.amount) * 100);
  if (valor <= 0) return null;
  const descricao = (raw.description?.trim() || raw.descriptionRaw?.trim() || "Compra no cartão").slice(0, 300);
  const natureza = raw.type === "CREDIT" ? "receita" : "despesa";
  if (natureza === "receita" && PAGAMENTO_RECEBIDO.test(semAcento(descricao))) return null;
  const m = raw.creditCardMetadata;
  const de = Math.floor(m?.totalInstallments ?? 0);
  const n = Math.floor(m?.installmentNumber ?? 0);
  const parcelada = de > 1 && n >= 1 && n <= de;
  return {
    pluggyId: raw.id, contaRef, data, natureza, valor, descricao, propria: false, terceiro: false,
    estorno: natureza === "receita",
    parcelaN: parcelada ? n : null, parcelaDe: parcelada ? de : null,
    billId: m?.billId ?? null,
  };
}

export interface FaturaDoBanco {
  id: string;
  dueDate: string;
  totalAmount: number;
  billClosingDate?: string | null;
}

/** Uma fatura já traduzida para a chave da Órbita (a data de fechamento que agrupa as compras dela). */
export interface FaturaConhecida {
  cartaoId: string;
  /** a chave da fatura na Órbita: o dia de fechamento, como `faturasDoCartao` agrupa */
  fechamento: Ymd;
  vencimento: Ymd;
  total: Centavos;
  billId: string;
}

/**
 * Qual é a chave da Órbita para a fatura do banco. Primeiro pelo vencimento
 * (o fechamento cuja fatura vence naquele dia, pelas regras do cartão),
 * depois pelo fechamento que o banco informou; sem nenhum dos dois, null e a
 * compra fica com a data que veio.
 */
export function fechamentoDaFatura(cartao: Cartao, fatura: Pick<FaturaDoBanco, "dueDate" | "billClosingDate">): Ymd | null {
  const venc = fatura.dueDate?.slice(0, 10);
  if (venc && /^\d{4}-\d{2}-\d{2}$/.test(venc)) {
    for (const mes of [somarMeses(mesDe(venc), -1), mesDe(venc)]) {
      const candidato = diaNoMes(mes, cartao.fechamento);
      if (vencimentoDaFatura(cartao, candidato) === venc) return candidato;
    }
  }
  // o banco fechou nesse mês, mesmo que num dia diferente do cadastrado (fim de semana): a fatura é a do mês dele
  const fecha = fatura.billClosingDate?.slice(0, 10);
  return fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? diaNoMes(mesDe(fecha), cartao.fechamento) : null;
}

/** Se a Órbita puser a compra numa fatura diferente da do banco, a compra vai para a data-chave da fatura do banco. */
export function dataNaFaturaDoBanco(cartao: Cartao, data: Ymd, fechamentoDoBanco: Ymd | null): Ymd {
  if (!fechamentoDoBanco) return data;
  return fechamentoDaCompra(cartao, data) === fechamentoDoBanco ? data : fechamentoDoBanco;
}

/**
 * A fatura que este débito da conta corrente paga: descrição de fatura, vencimento
 * a até `folgaDias` do dia do débito, e valor igual ao total (ou um pagamento
 * parcial que só cabe numa fatura). Mais de uma candidata, ou nenhuma: null,
 * e o débito segue como saída comum (o aviso diz que ficou sem fatura).
 */
export function acharFaturaDoPagamento(tx: { descricao: string; data: Ymd; valor: Centavos }, faturas: FaturaConhecida[], folgaDias = 7): FaturaConhecida | null {
  if (!pareceDebitoDeFatura(tx.descricao)) return null;
  const perto = faturas.filter((f) => Math.abs(diasEntre(f.vencimento, tx.data)) <= folgaDias && f.total > 0);
  const exatas = perto.filter((f) => f.total === tx.valor);
  if (exatas.length) return exatas.length === 1 ? exatas[0]! : null;
  const cabem = perto.filter((f) => tx.valor < f.total);
  return cabem.length === 1 ? cabem[0]! : null;
}
