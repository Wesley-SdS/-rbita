import { partes, type Ym, type Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * Como o dinheiro e as datas aparecem para o dono (PRD §5.20). Mora no core,
 * e não só na tela, porque a Órbita também FALA esses valores: a mensagem que
 * a voz lê precisa dizer "R$ 45,90", igual ao que a tela mostra.
 */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "R$ 1.234,56" (com espaço comum, não o inseparável do Intl, para caber em texto falado e em teste). */
export const brl = (c: Centavos) => BRL.format(c / 100).replace(/ /g, " ");

/** "1.234,56" sem o prefixo, para listas. */
export const valorSemPrefixo = (c: Centavos) => NUM.format(c / 100);

export const dataCurta = (d: Ymd) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const dataLonga = (d: Ymd) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "set 26" */
export const mesCurto = (ym: Ym) => `${MESES[Number(ym.slice(5, 7)) - 1]!.slice(0, 3)} ${ym.slice(2, 4)}`;
/** "setembro de 2026" */
export const mesLongo = (ym: Ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function diaDaSemana(d: Ymd): string {
  const p = partes(d);
  return SEMANA[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]!;
}

/** "Delivery e restaurante" vira "DE": primeira letra das duas primeiras palavras. */
export const iniciais = (nome: string) =>
  // palavra sem letra ("·" em "Projeto · Reforma") não conta: daria "P·"
  nome.trim().split(/\s+/).filter((p) => /\p{L}|\p{N}/u.test(p)).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

/** Converte reais (o que o modelo e o dono falam) em centavos, sem erro de ponto flutuante. */
export const centavosDe = (reais: number) => Math.round(reais * 100);
