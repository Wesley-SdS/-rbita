/**
 * Achar "o Nubank", "a conta da luz" ou "mercado" pelo nome que o dono FALOU.
 * A voz e o chat não conhecem ids: a tool recebe texto e precisa chegar ao
 * registro certo, ou devolver as opções quando o nome é ambíguo (mandar a
 * fatura do cartão errado não se desfaz com um clique).
 */

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type Achado<T> = { tipo: "um"; item: T } | { tipo: "varios"; opcoes: T[] } | { tipo: "nenhum" };

/**
 * Nome exato primeiro; depois quem CONTÉM o que foi dito; depois o que foi
 * dito contém o nome ("paga a conta de luz da enel" acha "Enel"). Mais de um
 * no mesmo nível é ambíguo e volta como opções.
 */
export function acharPorNome<T>(lista: T[], dito: string | null | undefined, nomeDe: (t: T) => string): Achado<T> {
  const q = normalizar(dito ?? "");
  if (!q) return { tipo: "nenhum" };
  const niveis = [
    (n: string) => n === q,
    (n: string) => n.includes(q),
    (n: string) => n.length >= 3 && q.includes(n),
  ];
  for (const casa of niveis) {
    const achados = lista.filter((t) => casa(normalizar(nomeDe(t))));
    if (achados.length === 1) return { tipo: "um", item: achados[0]! };
    if (achados.length > 1) return { tipo: "varios", opcoes: achados };
  }
  return { tipo: "nenhum" };
}
