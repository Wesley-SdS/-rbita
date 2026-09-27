import { ehParcela } from "./mes";
import type { Categoria, Centavos, Lancamento } from "./tipos";

export interface SugestaoDeAtalho {
  rotulo: string;
  valor: Centavos;
  categoriaId: string | null;
  contaId: string | null;
  cartaoId: string | null;
  vezes: number;
}

/**
 * Gastos que se repetem viram sugestão de atalho de um toque (PRD §6.1.3):
 * agrupa pela descrição (ou pela categoria, sem descrição), sem diferenciar
 * maiúsculas, fica com o que apareceu `minimo` vezes ou mais. O valor é a
 * MEDIANA: um café que uma vez saiu R$ 40 com pão de queijo não pode puxar a
 * sugestão para cima como a média puxaria.
 */
export function sugerirAtalhos(ls: Lancamento[], categorias: Categoria[], minimo: number, max = 4): SugestaoDeAtalho[] {
  const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]));
  const grupos = new Map<string, Lancamento[]>();
  const ordenados = [...ls].sort((a, b) => (a.data === b.data ? Number(a.criadoEm ?? 0) - Number(b.criadoEm ?? 0) : a.data < b.data ? -1 : 1));
  for (const l of ordenados) {
    if (l.tipo !== "despesa" || l.transferencia || ehParcela(l)) continue;
    const rotulo = (l.descricao?.trim() || (l.categoriaId ? nomeCat.get(l.categoriaId) : "") || "").trim();
    if (!rotulo) continue;
    const k = rotulo.toLowerCase();
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  return [...grupos.values()]
    .filter((g) => g.length >= minimo)
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .map((g) => {
      const v = g.map((l) => l.valor).sort((a, b) => a - b);
      const meio = Math.floor(v.length / 2);
      const mediana = v.length % 2 ? v[meio]! : Math.round((v[meio - 1]! + v[meio]!) / 2);
      const p = g[0]!;
      return {
        rotulo: p.descricao?.trim() || nomeCat.get(p.categoriaId ?? "") || "",
        valor: mediana,
        categoriaId: p.categoriaId ?? null,
        contaId: p.contaId ?? null,
        cartaoId: p.cartaoId ?? null,
        vezes: g.length,
      };
    });
}
