import type { Ymd } from "../finance/calendario";
import type { Centavos } from "../finance/tipos";

/**
 * A transação como a Pluggy entrega, reduzida ao que o financeiro usa. Puro:
 * a leitura de rede está em `cliente.ts`, a decisão do que vira lançamento em
 * `plano.ts`.
 *
 * Tudo que vem do banco é dado de TERCEIRO (§5.2): a descrição é texto livre
 * que o banco (ou quem pagou) escreveu. Ela vira só o texto do lançamento e a
 * entrada do palpite de categoria, nunca instrução, e nunca decide sozinha se
 * uma movimentação é transferência (isso sai de documento e valor, abaixo).
 */

export interface DocumentoBruto {
  type?: string | null;
  value?: string | null;
}

export interface ParteBruta {
  name?: string | null;
  documentNumber?: DocumentoBruto | null;
}

export interface TransacaoBruta {
  id: string;
  date: string;
  amount: number;
  type?: "CREDIT" | "DEBIT" | string | null;
  status?: string | null;
  description?: string | null;
  descriptionRaw?: string | null;
  currencyCode?: string | null;
  category?: string | null;
  paymentData?: { payer?: ParteBruta | null; receiver?: ParteBruta | null } | null;
  merchant?: { name?: string | null } | null;
}

export interface TxBanco {
  pluggyId: string;
  /** o id local da conta (`pluggy_conta.id`) de onde a linha veio */
  contaRef: string;
  data: Ymd;
  natureza: "despesa" | "receita";
  valor: Centavos;
  descricao: string;
  /** o banco diz que os dois lados são o próprio titular: transferência entre contas dele */
  propria: boolean;
  /** há um terceiro identificado do outro lado (pessoa, loja): nunca casa como transferência própria */
  terceiro: boolean;
}

export const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

const CATEGORIA_MESMA_PESSOA = /same[\s_-]*person|mesma[\s_-]*titularidade/i;

/**
 * Normaliza uma transação. Devolve null para o que não deve virar lançamento:
 * ainda pendente (o valor e o id podem mudar quando assenta), moeda estrangeira
 * (o valor em reais não é este) e valor zero.
 */
export function normalizarTransacao(raw: TransacaoBruta, contaRef: string, titular: string | null): TxBanco | null {
  if (!raw?.id || typeof raw.amount !== "number" || !Number.isFinite(raw.amount)) return null;
  if (raw.status && raw.status !== "POSTED") return null;
  if (raw.currencyCode && raw.currencyCode !== "BRL") return null;
  // a data da Pluggy é um instante à meia-noite UTC; o dia de negócio é o texto da data, sem fuso
  const data = /^\d{4}-\d{2}-\d{2}/.exec(raw.date ?? "")?.[0];
  if (!data) return null;
  const valor = Math.round(Math.abs(raw.amount) * 100);
  if (valor <= 0) return null;
  const natureza = raw.type === "CREDIT" ? "receita" : raw.type === "DEBIT" ? "despesa" : raw.amount < 0 ? "despesa" : "receita";

  const meu = soDigitos(titular);
  const docs = [raw.paymentData?.payer?.documentNumber?.value, raw.paymentData?.receiver?.documentNumber?.value].map(soDigitos).filter(Boolean);
  const aMesmaPessoa = meu.length >= 11 && docs.length === 2 && docs.every((d) => d === meu);
  const propria = aMesmaPessoa || CATEGORIA_MESMA_PESSOA.test(raw.category ?? "");
  // sem o documento do titular, num débito o pagador é ele mesmo: só dois documentos DIFERENTES provam um terceiro
  const terceiro = (meu.length >= 11 ? docs.some((d) => d !== meu) : docs.length === 2 && docs[0] !== docs[1]) || !!raw.merchant?.name;

  const descricao = (raw.description?.trim() || raw.descriptionRaw?.trim() || "Lançamento do banco").slice(0, 300);
  return { pluggyId: raw.id, contaRef, data, natureza, valor, descricao, propria, terceiro: terceiro && !propria };
}
