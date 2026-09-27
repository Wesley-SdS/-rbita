/**
 * Geometria dos gráficos das finanças (ritmo do mês, §6.1.6), em SVG puro.
 * Fica fora do componente para ser testável: um erro de escala aqui desenha
 * uma linha convincente e errada, que ninguém percebe olhando.
 */

export interface Caixa {
  largura: number;
  altura: number;
}

/**
 * Pontos de uma série acumulada. `dias` é quantos dias o mês tem: a série do
 * mês atual para em hoje, mas o eixo x continua sendo o mês inteiro, senão a
 * linha de 5 dias ocuparia a largura toda e pareceria um mês completo.
 */
export function pontos(valores: readonly number[], dias: number, maximo: number, caixa: Caixa): [number, number][] {
  if (dias < 1 || maximo <= 0) return [];
  const passo = dias > 1 ? caixa.largura / (dias - 1) : 0;
  return valores.map((v, i) => [round(i * passo), round(caixa.altura - (Math.max(0, v) / maximo) * caixa.altura)]);
}

export function caminho(ps: readonly [number, number][]): string {
  return ps.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
}

/** A área sob a linha: o mesmo caminho fechado até a base. */
export function area(ps: readonly [number, number][], caixa: Caixa): string {
  if (!ps.length) return "";
  const ultimo = ps[ps.length - 1]!;
  return `${caminho(ps)} L${ultimo[0]} ${caixa.altura} L${ps[0]![0]} ${caixa.altura} Z`;
}

/** Escala vertical do ritmo: 110% do maior entre o acumulado, o mês passado e o teto. */
export function escalaDoRitmo(acumulado: readonly number[], anterior: readonly number[], teto: number | null): number {
  const maior = Math.max(acumulado[acumulado.length - 1] ?? 0, anterior[anterior.length - 1] ?? 0, teto ?? 0);
  return maior > 0 ? maior * 1.1 : 0;
}

const round = (n: number) => Math.round(n * 10) / 10;
