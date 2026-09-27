import type {
  Painel as PainelDoCore, LinhaDeLancamento, LinhaDeConta, Pastilha,
  extrato, contas, cartoes, metas, meta, previsao, historico, cadastros,
} from "@orbita/core/finance/visoes";

/**
 * O formato das leituras de `GET /api/financas/:vista`. Só TIPOS vêm do core
 * (somem na compilação): a tela desenha o que o backend calculou e não
 * carrega o motor para o navegador.
 */

type ComData<T> = T & { hoje: string; mes: string };
type Lista<T> = ComData<{ itens: T }>;

export type { LinhaDeLancamento, LinhaDeConta, Pastilha };
export type Farol = PainelDoCore["farol"];
/**
 * `diasPerto` ainda não vem do backend: o aviso "nos próximos 7 dias" usa o
 * 7 do PRD enquanto a vista não mandar o limiar da config (`finance.diasPerto`).
 */
export type Painel = ComData<PainelDoCore & { diasPerto?: number }>;
export type Extrato = ComData<ReturnType<typeof extrato>>;
export type Contas = ComData<ReturnType<typeof contas>>;
export type Divida = ReturnType<typeof contas>["dividas"][number];
export type Cartao = ReturnType<typeof cartoes>[number];
export type Cartoes = Lista<Cartao[]>;
export type ResumoMeta = ReturnType<typeof metas>[number];
export type Metas = Lista<ResumoMeta[]>;
export type Meta = ComData<NonNullable<ReturnType<typeof meta>>>;
export type ItemDeMeta = Meta["grupos"][number]["itens"][number];
export type Previsao = ComData<ReturnType<typeof previsao>>;
export type Historico = ComData<ReturnType<typeof historico>>;
export type Cadastros = ComData<ReturnType<typeof cadastros>>;
export type Categoria = Cadastros["categorias"][number];
export type ContaCarteira = Cadastros["contas"][number];
export type CartaoCadastro = Cadastros["cartoes"][number];
export type Atalho = Cadastros["atalhos"][number];
export type Regra = Cadastros["regras"][number];

export type Aba = "painel" | "extrato" | "contas" | "cartoes" | "metas" | "previsao" | "historico" | "ajustes";
