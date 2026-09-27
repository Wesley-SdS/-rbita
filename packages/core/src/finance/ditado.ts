import { diaNoMes, mesDe, partes, somarDias, type Ymd } from "./calendario";
import { palpitarCategoria, type CategoriaParaPalpite, type RegraCategorizacao } from "./palpite";
import type { Centavos } from "./tipos";

/**
 * Ditado de lançamentos (PRD §8.1.3): texto livre (voz ou digitado) vira uma
 * ou mais propostas de lançamento. Puro: nada de banco, nada de LLM (isto é
 * regra e regex, não IA) — a tela e a voz chamam a mesma função e enxergam o
 * mesmo resultado.
 *
 * Todas as comparações de PALAVRA (data, verbo, onde, categoria) são "sem
 * acentos e em minúsculas", como o PRD manda no preâmbulo do passo 2. A ÚNICA
 * exceção deliberada é a regra do dono (`contem`), delegada para
 * `palpitarCategoria`, que por §8.3 só ignora maiúscula, não acento: é o
 * texto que o dono viu de verdade (ex. "IFOOD" do extrato) e a regra dele não
 * deveria mudar de comportamento por causa de um acento que ele não digitou.
 */

export interface ContaOuCartao {
  id: string;
  nome: string;
}

export interface ContextoDitado {
  hoje: Ymd;
  contas: ContaOuCartao[];
  cartoes: ContaOuCartao[];
  categorias: CategoriaParaPalpite[];
  regras: RegraCategorizacao[];
}

export type Proposta =
  | { tipo: "transferencia"; valor: Centavos; data: Ymd; descricao: string; origemId: string | null; destinoId: string | null }
  | {
      tipo: "despesa" | "receita";
      estorno: boolean;
      valor: Centavos;
      data: Ymd;
      descricao: string;
      categoriaId: string | null;
      contaId: string | null;
      cartaoId: string | null;
      parcelas: number;
      frase: string;
    };

const pad = (n: number) => String(n).padStart(2, "0");

/** NFD tira o acento como marca separada; removê-la mantém 1 caractere por 1 caractere (mesmo índice do texto original). */
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const VERBOS_LANCAMENTO =
  "gastei|paguei|comprei|torrei|recebi|entrou|ganhei|saquei|transferi|estornaram|devolveram";

/** PRD §8.1.3 passo 1: quebra em frases por conectivos, pontuação, e por " e " antes de um verbo de lançamento. */
function quebrarFrases(texto: string): string[] {
  const MARCA = "\u0000";
  let t = texto
    .replace(/\se\s+tamb[eé]m\s/gi, MARCA)
    .replace(/\se\s+depois\s/gi, MARCA)
    .replace(/;/g, MARCA)
    .replace(/\.(?!\d)/g, MARCA);
  t = t.replace(new RegExp(`\\se\\s+(?=(?:${VERBOS_LANCAMENTO})\\b)`, "gi"), MARCA);
  return t
    .split(MARCA)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

const PARCELAS_RE = /\bem\s+(\d{1,2})\s*(?:x|vezes|parcelas)\b|\bparcelado\s+em\s+(\d{1,2})\b|\b(\d{1,2})\s*(?:x|vezes)\b/;

const DATA_RE = /\bhoje\b|\banteontem\b|\bontem\b|\bsemana\s+passada\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\bdia\s+(\d{1,2})\b/;

const MIL_RE = /\b(\d+(?:,\d+)?)\s*mil\b(?:\s+e\s+(\d+))?/;
const RS_RE = /r\$\s*(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?/;
const VIRGULA_RE = /\b(\d+(?:\.\d{3})*),(\d{1,2})\b/;
const REAIS_RE = /\b(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?\s*(?:reais|real|contos|conto|pila)\b/;
const NUM_RE = /\b(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?\b/;

const VERBOS_TRANSFERENCIA = [/\btransferi\b/, /\bsaquei\b/, /\bsaque\b/, /\btirei\s+d[ao]\b/, /\bpassei\s+d[ao]\b/];
const VERBOS_ESTORNO = [/\bestorn\w*\b/, /\bdevolv\w*\b/, /\breembols\w*\b/, /\bcancelaram\b/];
const VERBOS_ENTRADA = [/\brecebi\b/, /\bentrou\b/, /\bganhei\b/, /\bcaiu\b/, /\bcreditou\b/, /\bpagaram\b/];
const VERBOS_SAIDA = [/\bgastei\b/, /\bpaguei\b/, /\bcomprei\b/, /\btorrei\b/, /\bsaiu\b/, /\bdebitou\b/, /\bdebitado\b/];

const PREPOSICOES_RE = /\b(de|do|da|no|na|em|com|para|pra|um|uma|uns|umas|foi|que|entao)\b/g;
const LETRA_SOLTA_RE = /\b[a-z]\b/g;

function paraCentavos(intStr: string, centStr?: string): Centavos {
  const reais = parseInt(intStr.replace(/\./g, ""), 10);
  const centavos = centStr ? parseInt((centStr + "0").slice(0, 2), 10) : 0;
  return reais * 100 + centavos;
}

interface Span {
  ini: number;
  fim: number;
}

/** Calcula a data a partir do literal batido pelo `DATA_RE` (§8.1.3). */
function calcularData(m: RegExpMatchArray, hoje: Ymd): Ymd {
  const lit = m[0];
  if (/^hoje$/.test(lit)) return hoje;
  if (/^anteontem$/.test(lit)) return somarDias(hoje, -2);
  if (/^ontem$/.test(lit)) return somarDias(hoje, -1);
  if (/^semana\s+passada$/.test(lit)) return somarDias(hoje, -7);
  if (m[1] && m[2]) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let ano = partes(hoje).y;
    if (m[3]) ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${ano}-${pad(mm)}-${pad(dd)}`;
  }
  if (m[4]) return diaNoMes(mesDe(hoje), Number(m[4]));
  return hoje;
}

/** Valor por prioridade (§8.1.3): "2 mil"/"1,5 mil" > "R$ X" > vírgula decimal > "X reais/conto/pila" > primeiro número. */
function extrairValor(trabalho: string): { valor: Centavos; span: Span } | null {
  let m = trabalho.match(MIL_RE);
  if (m && m.index !== undefined) {
    const base = m[1]!.includes(",") ? parseFloat(m[1]!.replace(",", ".")) : parseInt(m[1]!, 10);
    const extra = m[2] ? parseInt(m[2], 10) : 0;
    const reais = Math.round(base * 1000) + extra;
    return { valor: reais * 100, span: { ini: m.index, fim: m.index + m[0].length } };
  }
  for (const re of [RS_RE, VIRGULA_RE, REAIS_RE, NUM_RE]) {
    m = trabalho.match(re);
    if (m && m.index !== undefined) {
      return { valor: paraCentavos(m[1]!, m[2]), span: { ini: m.index, fim: m.index + m[0].length } };
    }
  }
  return null;
}

function acharOnde(norm: string, ctx: ContextoDitado): { tipo: "conta" | "cartao"; id: string; span: Span | null } {
  const cartao = ctx.cartoes.find((c) => c.nome.length > 2 && norm.includes(semAcento(c.nome)));
  if (cartao) {
    const ini = norm.indexOf(semAcento(cartao.nome));
    return { tipo: "cartao", id: cartao.id, span: { ini, fim: ini + cartao.nome.length } };
  }
  const conta = ctx.contas.find((c) => c.nome.length > 2 && norm.includes(semAcento(c.nome)));
  if (conta) {
    const ini = norm.indexOf(semAcento(conta.nome));
    return { tipo: "conta", id: conta.id, span: { ini, fim: ini + conta.nome.length } };
  }
  if (/\bdinheiro\b|\bespecie\b|\bcash\b|\bna\s+mao\b/.test(norm)) {
    const dinheiro = ctx.contas.find((c) => semAcento(c.nome).includes("dinheiro"));
    if (dinheiro) return { tipo: "conta", id: dinheiro.id, span: null };
  }
  if (/\bcredito\b|\bcartao\b/.test(norm) && ctx.cartoes.length === 1) {
    return { tipo: "cartao", id: ctx.cartoes[0]!.id, span: null };
  }
  return { tipo: "conta", id: ctx.contas[0]?.id ?? "", span: null };
}

function primeiroMatch(norm: string, padroes: RegExp[]): Span | null {
  for (const re of padroes) {
    const m = norm.match(re);
    if (m && m.index !== undefined) return { ini: m.index, fim: m.index + m[0].length };
  }
  return null;
}

function algumBate(norm: string, padroes: RegExp[]): boolean {
  return padroes.some((re) => re.test(norm));
}

function capitalizar(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function interpretarFrase(fraseOriginal: string, ctx: ContextoDitado): Proposta | null {
  const norm = semAcento(fraseOriginal);
  const mask = new Array<boolean>(fraseOriginal.length).fill(true);
  const remover = (span: Span | null) => {
    if (!span) return;
    for (let i = span.ini; i < span.fim && i < mask.length; i++) mask[i] = false;
  };
  // as duas chamadas abaixo usam regex com flag "g" (matchAll exige)
  const removerTodos = (texto: string, re: RegExp) => {
    for (const m of texto.matchAll(re)) {
      if (m.index !== undefined) remover({ ini: m.index, fim: m.index + m[0].length });
    }
  };

  // 1) parcelas
  let parcelas = 1;
  const mParc = norm.match(PARCELAS_RE);
  if (mParc && mParc.index !== undefined) {
    const n = Number(mParc[1] ?? mParc[2] ?? mParc[3]);
    if (n >= 2 && n <= 48) parcelas = n;
    remover({ ini: mParc.index, fim: mParc.index + mParc[0].length });
  }

  // 2) data
  let data = ctx.hoje;
  const mData = norm.match(DATA_RE);
  if (mData && mData.index !== undefined) {
    data = calcularData(mData, ctx.hoje);
    remover({ ini: mData.index, fim: mData.index + mData[0].length });
  }

  // 3) valor, sobre o texto já sem parcelas/data (retirar antes de procurar, PRD §8.1.3)
  const trabalho = Array.from(norm)
    .map((ch, i) => (mask[i] ? ch : " "))
    .join("");
  const achadoValor = extrairValor(trabalho);
  if (!achadoValor) return null; // frase sem valor é ignorada
  remover(achadoValor.span);

  // 4) tipo
  const ehTransferencia = algumBate(norm, VERBOS_TRANSFERENCIA);
  const ehEstorno = !ehTransferencia && algumBate(norm, VERBOS_ESTORNO);
  const ehEntrada = !ehTransferencia && !ehEstorno && algumBate(norm, VERBOS_ENTRADA) && !algumBate(norm, VERBOS_SAIDA);

  for (const lista of [VERBOS_TRANSFERENCIA, VERBOS_ESTORNO, VERBOS_ENTRADA, VERBOS_SAIDA]) {
    for (const re of lista) remover(primeiroMatch(norm, [re]));
  }

  // 5) onde (conta ou cartão)
  const onde = acharOnde(norm, ctx);
  remover(onde.span);

  // 6) descrição: tira preposições/artigos e letras soltas do que sobrou
  removerTodos(norm, PREPOSICOES_RE);
  removerTodos(norm, LETRA_SOLTA_RE);

  let descricao = Array.from(fraseOriginal)
    .map((ch, i) => (mask[i] ? ch : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  descricao = capitalizar(descricao.slice(0, 42));

  if (ehTransferencia) {
    return {
      tipo: "transferencia",
      valor: achadoValor.valor,
      data,
      descricao: descricao.length >= 3 ? descricao : "Transferência",
      origemId: ctx.contas[0]?.id ?? null,
      destinoId: ctx.contas[1]?.id ?? null,
    };
  }

  const tipoLancamento: "despesa" | "receita" = ehEstorno || ehEntrada ? "receita" : "despesa";
  // estorno abate o gasto: usa categoria de SAÍDA (§8.1.3); as demais usam a categoria do próprio tipo
  const tipoCategoria: "despesa" | "receita" = ehEstorno ? "despesa" : tipoLancamento;
  const categoriasDoTipo = ctx.categorias.filter((c) => c.tipo === tipoCategoria);

  const categoriaPorNome = categoriasDoTipo.find((c) => c.nome.length > 3 && norm.includes(semAcento(c.nome)));
  let categoriaId = categoriaPorNome?.id ?? null;
  if (!categoriaId) categoriaId = palpitarCategoria(fraseOriginal, ctx.regras, categoriasDoTipo, tipoCategoria);
  if (!categoriaId) {
    const nomePadrao = tipoCategoria === "despesa" ? "Outros gastos" : "Outras entradas";
    categoriaId = categoriasDoTipo.find((c) => c.nome === nomePadrao)?.id ?? null;
  }

  if (descricao.length < 3) {
    const categoria = ctx.categorias.find((c) => c.id === categoriaId);
    descricao = categoria?.nome ?? descricao;
  }

  return {
    tipo: tipoLancamento,
    estorno: ehEstorno,
    valor: achadoValor.valor,
    data,
    descricao,
    categoriaId,
    contaId: onde.tipo === "conta" ? onde.id : null,
    cartaoId: onde.tipo === "cartao" ? onde.id : null,
    parcelas,
    frase: fraseOriginal.trim(),
  };
}

/** Interpreta texto livre (voz ou digitado) em propostas de lançamento (PRD §8.1.3). */
export function interpretarDitado(texto: string, ctx: ContextoDitado): Proposta[] {
  const propostas: Proposta[] = [];
  for (const frase of quebrarFrases(texto)) {
    const p = interpretarFrase(frase, ctx);
    if (p) propostas.push(p);
  }
  return propostas;
}
