import type {
  FinConta, FinCartao, FinCategoria, FinLancamento, FinCompromisso, FinPagamentoFatura,
  FinDivida, FinDividaPagamento, FinDividaRolagem, FinMeta, FinMetaItem, FinAtalho, FinRegra,
} from "@orbita/db/finance-schema";
import type { EstadoFinanceiro } from "./tipos";

/**
 * O financeiro de um dono como saiu do banco. Fica fora do store para as
 * visões (`visoes.ts`) seguirem puras e testáveis sem Postgres: só tipos
 * vêm do schema, nada do cliente.
 */
export interface DadosFinanceiros {
  renda: number;
  teto: number;
  boasVindasVistas: boolean;
  contas: FinConta[];
  cartoes: FinCartao[];
  categorias: FinCategoria[];
  lancamentos: FinLancamento[];
  compromissos: FinCompromisso[];
  pagamentosFatura: FinPagamentoFatura[];
  dividas: (FinDivida & { pagamentos: FinDividaPagamento[]; rolagens: FinDividaRolagem[] })[];
  metas: (FinMeta & { itens: (FinMetaItem & { fotos: number })[] })[];
  atalhos: FinAtalho[];
  regras: FinRegra[];
}

export const paraMotorCompromissos = (cs: FinCompromisso[]) =>
  cs.map((c) => ({ ...c, recorrencia: c.recorrencia, status: c.status }));

/** A visão que o motor de cálculo enxerga. */
export function paraMotor(d: DadosFinanceiros): EstadoFinanceiro {
  return {
    renda: d.renda,
    teto: d.teto,
    contas: d.contas,
    cartoes: d.cartoes,
    categorias: d.categorias,
    lancamentos: d.lancamentos.map((l) => ({ ...l, criadoEm: l.criadoEm.getTime() })),
    compromissos: paraMotorCompromissos(d.compromissos),
    dividas: d.dividas.map((x) => ({ ...x, pagamentos: x.pagamentos })),
    pagamentosFatura: d.pagamentosFatura,
  };
}

