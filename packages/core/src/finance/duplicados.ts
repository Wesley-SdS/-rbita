import { diasEntre, type Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * "Já existe um igual. Lanço de novo?", como o banco pergunta num Pix repetido.
 *
 * Em 05/10/2026 as saídas de outubro entraram em DOBRO: a Órbita lançou a frase
 * inteira das imagens ("Boleto Grpqa, boleto Casas Bahia $ 50,43…") e depois
 * cada boleto separado, e o Abastecimento de R$ 100 saiu duas vezes. O dono
 * pediu a trava do banco: lançamento igual a um que já existe não entra calado.
 *
 * Igual quer dizer: mesma natureza, mesmo valor, data perto (`dias` de folga),
 * mesma conta ou cartão (quando os dois dizem qual) e descrição parecida, ou
 * uma das duas sem descrição. Dois cafés de R$ 8 em lugares diferentes no
 * mesmo dia NÃO são repetidos; o mesmo boleto lançado duas vezes é. Puro.
 */

export interface LancamentoComparavel {
  tipo: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  descricao?: string | null;
  contaId?: string | null;
  cartaoId?: string | null;
}

export interface Repetido<T extends LancamentoComparavel> {
  /** posição do lançamento novo no lote */
  indice: number;
  /** o que já existe (ou um item anterior do mesmo lote) */
  igual: T | LancamentoComparavel;
}

const PALAVRAS_VAZIAS = new Set(["boleto", "pix", "pagamento", "conta", "compra", "para", "pago", "paga", "com", "dos", "das", "de", "do", "da"]);

const palavras = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !PALAVRAS_VAZIAS.has(w) && !/^\d+$/.test(w));

/** As descrições falam da mesma coisa? Sem descrição de um lado, o valor e a data já bastam. */
export function descricoesParecidas(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = palavras(a ?? "");
  const pb = palavras(b ?? "");
  if (!pa.length || !pb.length) return true;
  // uma palavra própria em comum ("Grpqa", "Comgas", "Villa") já identifica o mesmo pagamento
  return pa.some((w) => pb.includes(w));
}

function mesmoLugar(a: LancamentoComparavel, b: LancamentoComparavel): boolean {
  const ondeA = a.cartaoId ?? a.contaId ?? null;
  const ondeB = b.cartaoId ?? b.contaId ?? null;
  return !ondeA || !ondeB || ondeA === ondeB;
}

export function ehRepetido(novo: LancamentoComparavel, existente: LancamentoComparavel, dias: number): boolean {
  return (
    novo.tipo === existente.tipo &&
    novo.valor === existente.valor &&
    Math.abs(diasEntre(novo.data, existente.data)) <= dias &&
    mesmoLugar(novo, existente) &&
    descricoesParecidas(novo.descricao, existente.descricao)
  );
}

/**
 * Os lançamentos novos que repetem um existente OU um item anterior do
 * mesmo lote (a frase com cinco boletos seguida dos cinco boletos).
 */
export function acharRepetidos<T extends LancamentoComparavel>(novos: LancamentoComparavel[], existentes: T[], dias: number): Repetido<T>[] {
  const achados: Repetido<T>[] = [];
  novos.forEach((n, i) => {
    const igual = existentes.find((e) => ehRepetido(n, e, dias)) ?? novos.slice(0, i).find((anterior) => ehRepetido(n, anterior, dias));
    if (igual) achados.push({ indice: i, igual });
  });
  return achados;
}
