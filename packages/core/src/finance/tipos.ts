import type { Ymd } from "./calendario";

/**
 * O que o motor de cálculo enxerga. É o recorte das tabelas que importa para
 * a conta, sem banco: a tela, o chat e a voz leem o MESMO número porque saem
 * da mesma função pura sobre estes tipos.
 *
 * Dinheiro sempre em CENTAVOS inteiros. Com real em ponto flutuante, 0,1 + 0,2
 * não fecha, e a divisão em parcelas (§5.18) precisa distribuir o resto de
 * centavo com exatidão.
 */
export type Centavos = number;

export interface Lancamento {
  id: string;
  tipo: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  descricao?: string | null;
  categoriaId?: string | null;
  contaId?: string | null;
  cartaoId?: string | null;
  /** perna de transferência ou pagamento de fatura: move dinheiro, não é gasto */
  transferencia?: boolean;
  /** veio de conta a pagar quitada ou de pagamento de dívida */
  fixo?: boolean;
  /** entrada que abate gasto em vez de contar como renda */
  estorno?: boolean;
  parcelaN?: number | null;
  parcelaDe?: number | null;
  metaId?: string | null;
  /** desempate da ordenação (ms ou a Date do banco) */
  criadoEm?: number | Date;
}

export interface Compromisso {
  id: string;
  direcao: "pagar" | "receber";
  descricao: string;
  valor: Centavos;
  vencimento: Ymd;
  recorrencia: "mensal" | "nenhuma";
  serieId?: string | null;
  diaMes?: number | null;
  status: "aberto" | "quitado";
  categoriaId?: string | null;
  contaId?: string | null;
}

export interface Conta {
  id: string;
  saldoInicial: Centavos;
}

export interface Cartao {
  id: string;
  limite: Centavos;
  /** dia do fechamento, 1 a 31 */
  fechamento: number;
  /** dia do vencimento, 1 a 31 */
  vencimento: number;
}

export interface PagamentoFatura {
  cartaoId: string;
  /** qual fatura: a data de fechamento dela */
  fechamento: Ymd;
  valor: Centavos;
}

export interface Divida {
  id: string;
  saldoInicial: Centavos;
  /** % ao mês (2,5 = 2,5%) */
  jurosMes: number;
  parcelaMensal: Centavos;
  cartaoId?: string | null;
  pagamentos: { abatimento: Centavos }[];
}

export interface Categoria {
  id: string;
  nome: string;
}

export interface EstadoFinanceiro {
  renda: Centavos;
  teto: Centavos;
  contas: Conta[];
  cartoes: Cartao[];
  lancamentos: Lancamento[];
  compromissos: Compromisso[];
  dividas: Divida[];
  pagamentosFatura: PagamentoFatura[];
  categorias: Categoria[];
}

/**
 * Limiares que o PRD fixou como número. Aqui são padrão, e quem chama passa o
 * que estiver na config (CLAUDE.md §5.6): o dono pode achar que "perto" é
 * 3 dias, não 7, sem precisar de dev.
 */
export interface Limiares {
  /** conta em aberto que vence em até N dias é "perto" (§5.11) */
  diasPerto: number;
  /** janela de "a pagar / a receber / sobra em N dias" (§5.10) */
  diasJanela: number;
  /** faltando até N dias, o farol mostra o que cabe até o fim do mês (§6.1.2) */
  diasFimDoMes: number;
  /** meses completos na média de gasto livre (§5.17) */
  mesesMedia: number;
  /** contas fixas existem em aberto até N meses à frente (§4.4) */
  mesesSemeados: number;
  /** meses projetados na previsão (§6.6) */
  mesesPrevisao: number;
  /** repetições para um gasto virar sugestão de atalho (§6.1.3) */
  repeticoesAtalho: number;
}

export const LIMIARES_PADRAO: Limiares = {
  diasPerto: 7,
  diasJanela: 30,
  diasFimDoMes: 5,
  mesesMedia: 3,
  mesesSemeados: 2,
  mesesPrevisao: 12,
  repeticoesAtalho: 3,
};
