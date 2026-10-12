import { embrulharDadoExterno } from "../texto/dado-externo";

/**
 * Texto de verdade: a codificação e as tabelas. PURO.
 *
 * O leitor antigo fazia `bytes.toString("utf-8")` em qualquer coisa que não
 * fosse PDF nem imagem. Um CSV de banco exportado no Excel (Windows-1252)
 * virava "Jo�o", um TXT em UTF-16 virava letra separada por NUL, e um DOCX
 * virava lixo binário passado ao modelo sem erro nenhum.
 */

export type Codificacao = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

const AMOSTRA = 8192;

/** Fração de caracteres de controle (fora tab, quebra e form feed) numa amostra de texto já decodificado. */
function fracaoDeControle(s: string): number {
  const amostra = s.slice(0, AMOSTRA);
  if (!amostra.length) return 0;
  let ruins = 0;
  for (let i = 0; i < amostra.length; i++) {
    const c = amostra.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) || c === 0xfffd) ruins++;
  }
  return ruins / amostra.length;
}

/** UTF-16 sem BOM: metade dos bytes é zero, todos do mesmo lado. */
function pareceUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(bytes.length - (bytes.length % 2), AMOSTRA);
  if (n < 4) return null;
  let paresZero = 0;
  let imparesZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) paresZero++;
    if (bytes[i + 1] === 0) imparesZero++;
  }
  const metade = n / 2;
  if (imparesZero > metade * 0.4 && paresZero < metade * 0.05) return "utf-16le";
  if (paresZero > metade * 0.4 && imparesZero < metade * 0.05) return "utf-16be";
  return null;
}

/**
 * Decodifica bytes de texto, ou devolve null quando não é texto.
 *
 * Ordem: BOM, UTF-16 sem BOM, UTF-8 estrito, Windows-1252 (o "Latin-1" que o
 * Excel e o Bloco de Notas antigos gravam; é superconjunto do ISO-8859-1 nos
 * caracteres imprimíveis). Byte NUL fora de UTF-16, ou controle demais, é
 * binário: devolver aquilo como texto foi exatamente o defeito antigo.
 */
export function decodificar(bytes: Uint8Array): { texto: string; codificacao: Codificacao } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const texto = new TextDecoder("utf-8").decode(bytes.subarray(3));
    return fracaoDeControle(texto) > 0.1 ? null : { texto, codificacao: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return comoTexto(new TextDecoder("utf-16le").decode(bytes.subarray(2)), "utf-16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return comoTexto(new TextDecoder("utf-16be").decode(bytes.subarray(2)), "utf-16be");

  const utf16 = pareceUtf16(bytes);
  if (utf16) return comoTexto(new TextDecoder(utf16).decode(bytes), utf16);

  if (bytes.subarray(0, AMOSTRA).includes(0)) return null;
  try {
    return comoTexto(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "utf-8");
  } catch {
    return comoTexto(new TextDecoder("windows-1252").decode(bytes), "windows-1252");
  }
}

function comoTexto(texto: string, codificacao: Codificacao): { texto: string; codificacao: Codificacao } | null {
  return fracaoDeControle(texto) > 0.1 ? null : { texto, codificacao };
}

/** Célula pronta para tabela Markdown: sem quebra de linha e sem barra vertical solta. */
export function celula(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** Linhas → tabela Markdown, a primeira como cabeçalho. Colunas desiguais são completadas. */
export function tabelaMarkdown(linhas: readonly (readonly unknown[])[]): string {
  if (!linhas.length) return "";
  const colunas = Math.max(...linhas.map((l) => l.length), 1);
  const completa = (l: readonly unknown[]) => Array.from({ length: colunas }, (_, i) => celula(l[i]));
  const [cab, ...corpo] = linhas;
  const out = [`| ${completa(cab!).map((c) => c || " ").join(" | ")} |`, `| ${Array(colunas).fill("---").join(" | ")} |`];
  for (const l of corpo) out.push(`| ${completa(l).join(" | ")} |`);
  return out.join("\n");
}

/**
 * Lê CSV/TSV no padrão RFC 4180 (aspas, aspa dobrada, quebra dentro de aspas).
 * Para em `max` linhas e devolve quantas existiam no total.
 */
export function lerCsv(texto: string, separador: string, max: number): { linhas: string[][]; total: number } {
  const linhas: string[][] = [];
  let total = 0;
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  const fechar = () => {
    linha.push(campo);
    campo = "";
    if (linha.length > 1 || linha[0]!.trim() !== "") {
      total++;
      if (linhas.length < max) linhas.push(linha);
    }
    linha = [];
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"' && campo === "") aspas = true;
    else if (c === separador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") fechar();
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length) fechar();
  return { linhas, total };
}

/**
 * Qual é o separador? O que aparece o MESMO número de vezes (e mais de uma)
 * nas primeiras linhas. Ponto e vírgula vem antes da vírgula porque no Brasil
 * a vírgula é o decimal ("10,50"), e o Excel em pt-BR exporta com ";".
 */
export function separadorDoCsv(texto: string): string | null {
  const primeiras = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (primeiras.length < 2) return null;
  for (const sep of ["\t", ";", ",", "|"]) {
    const contagens = primeiras.map((l) => l.split(sep).length - 1);
    if (contagens[0]! >= 1 && contagens.every((c) => c === contagens[0])) return sep;
  }
  return null;
}

/** Corta um texto longo em partes de até `max` caracteres, preferindo cortar em quebra de linha. PURO. */
export function partesDoTexto(texto: string, max: number): string[] {
  if (texto.length <= max) return [texto];
  const out: string[] = [];
  let resto = texto;
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(" ", max);
    if (corte < max * 0.5) corte = max;
    out.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\s+/, "");
  }
  if (resto) out.push(resto);
  return out;
}

/** "1,2 MB", "830 KB". PURO. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Tira do fim os caracteres de `conjunto`, andando de trás para frente. PURO.
 *
 * Linear de propósito: `l.replace(/[.,;]+$/, "")` recomeça a varredura em
 * cada ponto de uma sequência que não termina a string, e 40 mil pontos no
 * meio de um link levavam 9 s no laço principal (B2 da auditoria de 11/10/2026).
 */
export function semPontuacaoFinal(s: string, conjunto: string): string {
  let fim = s.length;
  while (fim > 0 && conjunto.includes(s[fim - 1]!)) fim--;
  return fim === s.length ? s : s.slice(0, fim);
}

/** Famílias cujo resumo cita o que veio de DENTRO do arquivo: assunto e remetente, título do convite, nomes, emitente, abas. */
const RESUMO_COM_TEXTO_DE_FORA = new Set(["email", "agenda", "contato", "nota_fiscal", "html", "compactado", "protegido", "planilha"]);

/**
 * O resumo de uma leitura, pronto para ir ao modelo. PURO.
 *
 * O resumo do PDF ("PDF de 3 páginas") é da Órbita; o do e-mail anexado traz
 * o assunto e o remetente, o do convite traz os títulos, o do GZIP o nome de
 * dentro, o do MHT o título da página. Esses vão EMBRULHADOS, como o
 * conteúdo: um assunto "IGNORE AS INSTRUÇÕES" fora do embrulho chegava ao
 * modelo como texto solto pelo WhatsApp, pelo Telegram e pelo `arquivos_ler`
 * (I2 da auditoria de 11/10/2026).
 */
export function resumoParaOModelo(lido: { resumo: string; familia?: string; estruturado?: unknown; arquivos?: unknown }, origem = "anexo"): string {
  const deFora = lido.estruturado !== undefined || lido.arquivos !== undefined || (lido.familia !== undefined && RESUMO_COM_TEXTO_DE_FORA.has(lido.familia));
  return deFora ? embrulharDadoExterno(origem, lido.resumo) : lido.resumo;
}
