"use client";

import { createContext, useContext, useEffect } from "react";
import { useRecurso } from "@/lib/dados/recurso";
import { urlDaVista, type Resultado, type Vista } from "@/lib/financas/api";
import type {
  Aba, Atalho, Cadastros, Cartao, CartaoCadastro, Categoria, ContaCarteira, Divida, ItemDeMeta, LinhaDeConta,
  LinhaDeLancamento, Meta, Regra,
} from "@/lib/financas/tipos";

/**
 * O que toda tela e toda folha das finanças compartilham: o mês escolhido, a
 * folha aberta, a notificação e a porta de gravar. Um contexto e não props
 * porque uma linha de lançamento no fundo do extrato precisa abrir uma folha
 * e trocar de mês, e passar isso por quatro níveis esconderia o fluxo.
 */

export type SubContas = "aberto" | "mes" | "quitadas" | "dividas";

export interface FiltrosExtrato {
  q: string;
  natureza: "" | "despesa" | "receita";
  categoria: string;
  onde: string;
}

/** O estado lembrado por sessão (PRD §4.6). */
export interface EstadoUi {
  aba: Aba;
  /** null = o mês atual, sempre (virar a meia-noite do dia 30 não prende a tela no mês velho) */
  mes: string | null;
  filtros: FiltrosExtrato;
  subContas: SubContas;
  metaAberta: string | null;
}

export const UI_PADRAO: EstadoUi = {
  aba: "painel",
  mes: null,
  filtros: { q: "", natureza: "", categoria: "", onde: "" },
  subContas: "aberto",
  metaAberta: null,
};

export interface Preenchimento {
  direcao: "pagar" | "receber";
  descricao: string;
  valor: number;
  vencimento: string;
  categoriaId: string | null;
}

export type FolhaAberta =
  | { tipo: "lancamento"; lanc?: LinhaDeLancamento; cartaoId?: string }
  | { tipo: "parcelas"; lanc: LinhaDeLancamento }
  | { tipo: "transferencia"; perna?: LinhaDeLancamento }
  | { tipo: "atalho"; atalho?: Atalho }
  | { tipo: "compromisso"; conta?: LinhaDeConta; preenchido?: Preenchimento }
  | { tipo: "quitar"; conta: LinhaDeConta }
  | { tipo: "fatura"; cartao: Cartao }
  | { tipo: "divida"; divida?: Divida }
  | { tipo: "pagar_divida"; divida: Divida }
  | { tipo: "meta"; meta?: Pick<Meta, "id" | "nome" | "orcamento" | "descricao" | "cor">; quantas?: number }
  | { tipo: "item"; meta: Meta; item?: ItemDeMeta }
  | { tipo: "categoria"; categoria?: Categoria }
  | { tipo: "conta"; conta?: ContaCarteira }
  | { tipo: "cartao"; cartao?: CartaoCadastro }
  | { tipo: "regra"; regra?: Regra }
  | { tipo: "ditado" }
  | { tipo: "boleto" }
  | { tipo: "importar" }
  | { tipo: "restaurar" }
  | { tipo: "boas_vindas" };

export interface OpcoesDoComando {
  /** a folha fica aberta mesmo com sucesso (ex.: salvar o item e depois subir as fotos) */
  manterAberta?: boolean;
  /** texto do toast no lugar da mensagem do backend */
  mensagem?: string;
  /** sem toast (a folha avisa do jeito dela) */
  silencioso?: boolean;
}

export interface Acao {
  rotulo: string;
  fazer: () => void;
}

export interface Financas {
  hoje: string;
  mesAtual: string;
  /** o mês que as telas mostram */
  mes: string;
  definirMes: (mes: string | null) => void;
  ui: EstadoUi;
  mudarUi: (patch: Partial<EstadoUi>) => void;
  irPara: (aba: Aba, extra?: { metaId?: string | null; focoTeto?: boolean; subContas?: SubContas; mes?: string | null }) => void;
  /** pedido de foco no campo de teto em Ajustes (links "Configurar") */
  focoTeto: number;
  abrir: (f: FolhaAberta) => void;
  fechar: () => void;
  avisar: (texto: string, acao?: Acao) => void;
  executar: (cmd: { tipo: string } & Record<string, unknown>, opts?: OpcoesDoComando) => Promise<Resultado | null>;
  /** contas, cartões, categorias: o que as folhas oferecem nos seletores */
  cad: Cadastros | null;
  abrirLancamento: (l: LinhaDeLancamento) => void;
  aprenderHoje: (hoje: string) => void;
}

export const CtxFinancas = createContext<Financas | null>(null);

export function useFinancas(): Financas {
  const f = useContext(CtxFinancas);
  if (!f) throw new Error("useFinancas fora de <FinancasApp>");
  return f;
}

/**
 * Lê uma vista e ensina o "hoje" do servidor à tela. O hoje vem do backend
 * porque é ele que decide em que dia um lançamento cai: um celular com fuso
 * errado não pode mostrar "hoje" diferente do que o servidor grava.
 */
export function useVista<T extends { hoje?: string }>(vista: Vista, params: Record<string, string | null | undefined> = {}, ativo = true) {
  const f = useFinancas();
  const r = useRecurso<T>(ativo ? urlDaVista(vista, params) : null);
  const hoje = r.dado?.hoje;
  const aprender = f.aprenderHoje;
  useEffect(() => {
    if (hoje) aprender(hoje);
  }, [hoje, aprender]);
  return r;
}
