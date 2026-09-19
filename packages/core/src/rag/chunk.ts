import { countTokens } from "gpt-tokenizer";

/**
 * CORTE DE DOCUMENTO EM TRECHOS (R2).
 *
 * Duas mudanças em relação ao corte antigo, que era só por caractere:
 *
 * 1. O tamanho é medido em TOKENS, não em caracteres. Caractere não diz nada
 *    para o modelo de embedding: uma tabela de números e um parágrafo de prosa
 *    com o mesmo tamanho em caracteres consomem contextos muito diferentes, e o
 *    modelo local (512 tokens) trunca em silêncio o que passar.
 *    A contagem usa o tokenizador cl100k (`gpt-tokenizer`, JS puro): não é o
 *    tokenizador exato do nomic nem do Gemini, mas erra para o mesmo lado em
 *    português e o alvo já tem folga. Trocar a contagem exata por uma
 *    dependência nativa pesada não se paga aqui.
 *
 * 2. O trecho sabe DE ONDE veio: página inicial e final, e a posição em
 *    caracteres no texto de origem. É isso que permite a resposta citar
 *    "documento X, página 4" e a tela abrir exatamente o trecho.
 */

export interface TrechoOpcoes {
  /** alvo de tokens por trecho */
  tokens: number;
  /** tokens repetidos entre trechos vizinhos, para não cortar contexto no meio */
  overlap: number;
}

export interface Trecho {
  content: string;
  /** 1-based; igual a `pageEnd` quando o trecho cabe numa página só */
  pageStart: number;
  pageEnd: number;
  /** posição no texto completo do documento (páginas coladas por "\n\n") */
  charStart: number;
  charEnd: number;
}

/** Aproximação de caracteres por token em pt-BR, usada só para fatiar rápido. */
const CHARS_POR_TOKEN = 4;

export function contarTokens(texto: string): number {
  if (!texto) return 0;
  try {
    return countTokens(texto);
  } catch {
    // tokenizador nunca deve derrubar indexação: estimativa serve de reserva
    return Math.ceil(texto.length / CHARS_POR_TOKEN);
  }
}

/**
 * Limpeza obrigatória antes de qualquer coisa: PDF de verdade traz byte nulo e
 * metade de par substituto (surrogate solto) no texto extraído, e o Postgres
 * recusa os dois ("invalid byte sequence"). Um documento do dono não pode
 * falhar a indexação inteira por causa de um caractere que ninguém vê.
 *
 * É a MESMA função usada ao juntar as páginas para guardar o texto de origem:
 * os dois lados precisam limpar igual, senão as posições `charStart`/`charEnd`
 * apontariam para lugares diferentes.
 */
// Escritos por código de caractere de propósito: escapes literais neste
// arquivo já viraram bytes de verdade uma vez, e byte nulo em arquivo-fonte
// faz o git tratar o módulo como binário.
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const NULO = String.fromCharCode(0);

export function limparTexto(texto: string): string {
  const base = (texto ?? "").split(CRLF).join(LF).split(NULO).join("");
  let saida = "";
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    const alto = c >= 0xd800 && c <= 0xdbff;
    const baixo = c >= 0xdc00 && c <= 0xdfff;
    if (alto) {
      const proximo = base.charCodeAt(i + 1);
      if (proximo >= 0xdc00 && proximo <= 0xdfff) {
        saida += base[i]! + base[i + 1]!;
        i++;
      }
      continue; // metade alta sem par: some
    }
    if (baixo) continue; // metade baixa sem par: some
    saida += base[i];
  }
  return saida;
}

const normalizar = limparTexto;

/**
 * Quebra um texto em unidades candidatas, da maior para a menor: parágrafo,
 * depois frase, depois palavra. Devolve as unidades com a posição de origem.
 */
function unidades(texto: string, inicio: number, maxTokens: number): { texto: string; ini: number }[] {
  const saida: { texto: string; ini: number }[] = [];
  const paragrafos = texto.split(/(\n{2,})/);
  let pos = inicio;
  for (const parte of paragrafos) {
    if (!parte) continue;
    if (/^\n{2,}$/.test(parte)) {
      pos += parte.length;
      continue;
    }
    if (contarTokens(parte) <= maxTokens) {
      if (parte.trim()) saida.push({ texto: parte, ini: pos });
      pos += parte.length;
      continue;
    }
    // parágrafo grande demais: frases
    const frases = parte.split(/(?<=[.!?;:])\s+/);
    let fPos = pos;
    for (const frase of frases) {
      if (!frase.trim()) {
        fPos += frase.length + 1;
        continue;
      }
      if (contarTokens(frase) <= maxTokens) {
        saida.push({ texto: frase, ini: fPos });
        fPos += frase.length + 1;
        continue;
      }
      // frase gigante (tabela colada, extrato sem pontuação): fatia por palavra
      const palavras = frase.split(/(\s+)/);
      let buffer = "";
      let bufIni = fPos;
      let p = fPos;
      for (const palavra of palavras) {
        if (contarTokens(buffer + palavra) > maxTokens && buffer.trim()) {
          saida.push({ texto: buffer, ini: bufIni });
          buffer = "";
          bufIni = p;
        }
        buffer += palavra;
        p += palavra.length;
      }
      if (buffer.trim()) saida.push({ texto: buffer, ini: bufIni });
      fPos += frase.length + 1;
    }
    pos += parte.length;
  }
  return saida;
}

/** Pega a cauda do texto com no máximo `tokens` tokens (sobreposição). */
function cauda(texto: string, tokens: number): string {
  if (tokens <= 0) return "";
  let corte = Math.max(0, texto.length - tokens * CHARS_POR_TOKEN * 2);
  let trecho = texto.slice(corte);
  while (contarTokens(trecho) > tokens && trecho.length > 1) {
    corte += Math.max(1, Math.floor((trecho.length - tokens * CHARS_POR_TOKEN) / 2));
    trecho = texto.slice(corte);
  }
  // começa numa fronteira de palavra para não cortar no meio de um número
  const espaco = trecho.search(/\s/);
  return espaco > 0 ? trecho.slice(espaco + 1) : trecho;
}

/**
 * Corta um documento com páginas. Páginas curtas (capa, índice) se juntam à
 * seguinte, e página longa vira vários trechos. Puro e testável.
 */
export function chunkPaginas(paginas: string[], opcoes: TrechoOpcoes): Trecho[] {
  const alvo = Math.max(16, Math.floor(opcoes.tokens));
  const overlap = Math.max(0, Math.min(Math.floor(opcoes.overlap), alvo - 1));

  // texto completo, com as páginas coladas: `charStart`/`charEnd` são posições
  // NELE, e não dentro da página, porque é esse texto que a tela mostra
  const textos = paginas.map((p) => normalizar(p ?? ""));
  const limites: { pagina: number; ini: number; fim: number }[] = [];
  let pos = 0;
  for (const [i, t] of textos.entries()) {
    limites.push({ pagina: i + 1, ini: pos, fim: pos + t.length });
    pos += t.length + 2; // o separador "\n\n"
  }
  const completo = textos.join("\n\n");
  const paginaDe = (indice: number) => limites.find((l) => indice >= l.ini && indice <= l.fim)?.pagina ?? limites.at(-1)?.pagina ?? 1;

  const trechos: Trecho[] = [];
  let buffer = "";
  let bufIni = 0;
  const fechar = () => {
    const conteudo = buffer.trim();
    if (!conteudo) {
      buffer = "";
      return;
    }
    // as bordas do conteúdo (sem o espaço em branco aparado) são o que a tela usa
    const deslocamento = buffer.indexOf(conteudo[0]!);
    const charStart = bufIni + (deslocamento < 0 ? 0 : deslocamento);
    const charEnd = charStart + conteudo.length;
    trechos.push({ content: conteudo, pageStart: paginaDe(charStart), pageEnd: paginaDe(Math.max(charStart, charEnd - 1)), charStart, charEnd });
    buffer = "";
  };

  for (const unidade of unidades(completo, 0, alvo)) {
    const candidato = buffer ? buffer + "\n\n" + unidade.texto : unidade.texto;
    if (buffer && contarTokens(candidato) > alvo) {
      const anterior = buffer;
      fechar();
      const sobreposicao = cauda(anterior, overlap);
      buffer = sobreposicao ? sobreposicao + "\n\n" + unidade.texto : unidade.texto;
      bufIni = unidade.ini - (sobreposicao ? sobreposicao.length + 2 : 0);
      if (bufIni < 0) bufIni = unidade.ini;
    } else {
      if (!buffer) bufIni = unidade.ini;
      buffer = candidato;
    }
  }
  fechar();
  return trechos;
}

/**
 * O texto completo que o corte usa como origem, e onde cada página começa.
 * É o par que a indexação guarda: com ele dá para recortar de novo sem o
 * arquivo original e sem perder a divisão de páginas.
 */
export function juntarPaginas(paginas: string[]): { texto: string; offsets: number[] } {
  const textos = paginas.map((p) => limparTexto(p));
  const offsets: number[] = [];
  let pos = 0;
  for (const t of textos) {
    offsets.push(pos);
    pos += t.length + 2; // o separador "\n\n"
  }
  return { texto: textos.join("\n\n"), offsets };
}

/** Desfaz `juntarPaginas`: volta às páginas originais. */
export function separarPaginas(texto: string, offsets: number[]): string[] {
  if (!offsets?.length) return [texto];
  return offsets.map((ini, i) => texto.slice(ini, i + 1 < offsets.length ? Math.max(ini, offsets[i + 1]! - 2) : undefined));
}

/** Texto sem páginas (colado, transcrição, memória): uma página só. */
export function chunkText(text: string, tokens = 400, overlap = 60): string[] {
  return chunkPaginas([text], { tokens, overlap }).map((t) => t.content);
}
