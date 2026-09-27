import type { Ymd } from "./calendario";
import type { Centavos, Lancamento } from "./tipos";

export interface ResumoDeMeta {
  total: Centavos;
  jaPago: Centavos;
  aVencer: Centavos;
  semContratar: Centavos;
}

/**
 * Onde está o dinheiro de um projeto (PRD §5.16). O "já pago" e o "a vencer"
 * vêm dos lançamentos que os itens contratados GERARAM, não do status do
 * item: um item "pago" em 10x no cartão ainda tem parcelas pela frente.
 */
export function resumirMeta(itens: { valor: Centavos }[], lancamentosDaMeta: Lancamento[], hoje: Ymd): ResumoDeMeta {
  const total = itens.reduce((s, i) => s + i.valor, 0);
  const jaPago = lancamentosDaMeta.filter((l) => l.data <= hoje).reduce((s, l) => s + l.valor, 0);
  const aVencer = lancamentosDaMeta.filter((l) => l.data > hoje).reduce((s, l) => s + l.valor, 0);
  return { total, jaPago, aVencer, semContratar: total - jaPago - aVencer };
}
