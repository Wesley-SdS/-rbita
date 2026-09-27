/**
 * Decisões de APRESENTAÇÃO das finanças que valem para várias telas: plural,
 * faixa de cor de barra, onde "conta:" ou "cartao:" aponta. Nada aqui muda
 * número nenhum; o número vem pronto do backend.
 */

export const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** "3 dias", "1 dia". */
export const nDias = (n: number) => `${n} ${plural(n, "dia", "dias")}`;

export type TomDaBarra = "ok" | "alerta" | "perigo";

/**
 * Cor de uma barra de progresso por faixa. As faixas mudam de tela para tela
 * no PRD (farol 75/100, orçamento 80/100, cartão 70/90, meta 85/100), então
 * quem chama diz onde começa cada uma.
 */
export function tomDaBarra(pct: number, alertaEm: number, perigoEm: number): TomDaBarra {
  if (!Number.isFinite(pct)) return "perigo";
  if (pct >= perigoEm) return "perigo";
  if (pct >= alertaEm) return "alerta";
  return "ok";
}

/** Largura de barra em % (0 a 100), à prova de divisão por zero. */
export function largura(valor: number, total: number): number {
  if (total <= 0 || valor <= 0) return 0;
  return Math.min(100, (valor / total) * 100);
}

/** O seletor "pago com" guarda "conta:ID" ou "cartao:ID"; o comando quer os dois campos separados. */
export function separarOnde(onde: string): { contaId: string | null; cartaoId: string | null } {
  const [tipo, id] = onde.split(":");
  if (!id) return { contaId: null, cartaoId: null };
  return tipo === "cartao" ? { contaId: null, cartaoId: id } : { contaId: id, cartaoId: null };
}

export const juntarOnde = (contaId: string | null | undefined, cartaoId: string | null | undefined) =>
  cartaoId ? `cartao:${cartaoId}` : contaId ? `conta:${contaId}` : "";

/** "Geladeira (3/10)" volta a ser "Geladeira": a descrição base de uma compra parcelada. */
export const semSufixoDeParcela = (descricao: string) => descricao.replace(/\s*\(\d+\/\d+\)\s*$/, "");

/**
 * Quanto a meta passa do teto COM este item (§7.12), para perguntar ANTES de
 * salvar. `totalAtual` já inclui o valor antigo do item em edição, que sai da
 * conta. Sem teto (zero), nunca passa.
 */
export function excessoDoTeto(orcamento: number, totalAtual: number, valorAntigo: number, valorNovo: number): number | null {
  if (orcamento <= 0) return null;
  const novo = totalAtual - valorAntigo + valorNovo;
  return novo > orcamento ? novo - orcamento : null;
}
