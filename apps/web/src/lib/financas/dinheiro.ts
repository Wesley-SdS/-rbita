import { valorSemPrefixo } from "@orbita/core/finance/formato";

/**
 * Dinheiro na TELA das finanças (PRD §5.19 e §5.20). O cálculo mora no
 * backend e chega em centavos inteiros; aqui só se decide como o número
 * aparece e como o que a pessoa digita vira centavos.
 */

/** Máximo de dígitos do campo de valor (999.999.999,99): acima disso é engano de digitação. */
export const MAX_DIGITOS = 11;

/**
 * Caixa registradora: só os dígitos contam e eles entram pela direita, como
 * centavos. "4590" vira 4590 (R$ 45,90). Zeros à esquerda somem e o que passar
 * de 11 dígitos é ignorado, em vez de virar um valor que ninguém quis.
 */
export function centavosDoTexto(texto: string): number {
  const digitos = texto.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITOS);
  return digitos ? Number(digitos) : 0;
}

/** "1.234,56" sem prefixo; zero vira campo vazio, para o placeholder "0,00" aparecer. */
export function textoDoCampo(centavos: number): string {
  return centavos > 0 ? valorSemPrefixo(centavos) : "";
}

export type Tom = "saida" | "entrada" | "neutro";

/**
 * Valor em lista: sem "R$", com sinal e cor (§5.20). Transferência não é
 * gasto nem entrada, então não ganha sinal nem cor: pintar de vermelho um
 * dinheiro que só mudou de conta ensinaria a pessoa a desconfiar da cor.
 * O sinal de menos é o U+2212, que tem a largura do "+" e alinha a coluna.
 */
export function valorEmLista(centavos: number, natureza: "despesa" | "receita", transferencia = false): { texto: string; tom: Tom } {
  const numero = valorSemPrefixo(Math.abs(centavos));
  if (transferencia) return { texto: numero, tom: "neutro" };
  return natureza === "despesa" ? { texto: `− ${numero}`, tom: "saida" } : { texto: `+ ${numero}`, tom: "entrada" };
}

/** Tom de um número que é ruim quando negativo (saldo, sobra). */
export const tomDoSaldo = (centavos: number): Tom => (centavos < 0 ? "saida" : "entrada");

/**
 * Juros da dívida: o único campo de número que NÃO é caixa registradora
 * (§5.19), porque "14,9" tem casa decimal variável. Vírgula ou ponto; vazio é
 * zero; lixo é null, para a folha avisar em vez de gravar um juro inventado.
 */
export function jurosDoTexto(texto: string): number | null {
  const t = texto.trim().replace("%", "").replace(",", ".");
  if (!t) return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n <= 100 ? n : null;
}

export const textoDosJuros = (n: number) => (n ? String(n).replace(".", ",") : "");
