import { convert, type DomNode, type FormatCallback } from "html-to-text";
import { semPontuacaoFinal, tabelaMarkdown } from "../texto";

export { semPontuacaoFinal };

/**
 * HTML vira texto legível, SEM nada de fora. PURO.
 *
 * Script, estilo e imagem saem (imagem remota é o pixel de rastreio de quem
 * mandou o e-mail, e baixá-la avisaria que o e-mail foi lido). Nenhum recurso
 * é buscado: o conversor só anda na árvore. Tabela vira tabela Markdown, que é
 * o formato que o resto da Órbita (o OCR, a planilha) já entrega ao modelo.
 *
 * Os links ficam fora do texto (e-mail de marketing tem dezenas de links de
 * rastreio), mas são guardados: é deles que sai a lista de documentos
 * compartilhados (Drive, OneDrive) do C6.
 */

function textoDe(n: DomNode): string {
  if (n.type === "text") return n.data ?? "";
  if (n.type === "tag" && n.name === "br") return " ";
  if (n.type === "script" || n.type === "style" || n.type === "comment") return "";
  return (n.children ?? []).map(textoDe).join("");
}

function linhasDaTabela(n: DomNode, out: string[][]): void {
  for (const filho of n.children ?? []) {
    if (filho.type !== "tag") continue;
    if (filho.name === "tr") {
      const celulas = (filho.children ?? []).filter((c) => c.type === "tag" && (c.name === "td" || c.name === "th"));
      out.push(celulas.map((c) => textoDe(c).replace(/\s+/g, " ").trim()));
    } else if (filho.name !== "table") linhasDaTabela(filho, out);
  }
}

export interface HtmlLido {
  texto: string;
  links: string[];
  tabelas: number;
}

export function htmlParaTexto(html: string): HtmlLido {
  const links: string[] = [];
  let tabelas = 0;

  const tabela: FormatCallback = (elem, _walk, builder) => {
    const linhas: string[][] = [];
    linhasDaTabela(elem, linhas);
    const uteis = linhas.filter((l) => l.some((c) => c));
    if (!uteis.length) return;
    tabelas++;
    builder.openBlock({ leadingLineBreaks: 2 });
    builder.addLiteral(tabelaMarkdown(uteis));
    builder.closeBlock({ trailingLineBreaks: 2 });
  };
  const link: FormatCallback = (elem, walk, builder) => {
    const href = typeof elem.attribs?.href === "string" ? elem.attribs.href.trim() : "";
    if (/^https?:\/\//i.test(href)) links.push(href.slice(0, URL_MAX));
    walk(elem.children, builder);
  };

  const texto = convert(html, {
    wordwrap: false,
    formatters: { tabelaMd: tabela, linkSoTexto: link },
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "head", format: "skip" },
      { selector: "svg", format: "skip" },
      { selector: "iframe", format: "skip" },
      { selector: "object", format: "skip" },
      { selector: "table", format: "tabelaMd" },
      { selector: "a", format: "linkSoTexto" },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "h4", options: { uppercase: false } },
      { selector: "h5", options: { uppercase: false } },
      { selector: "h6", options: { uppercase: false } },
    ],
  });
  return { texto: texto.replace(/\n{3,}/g, "\n\n").trim(), links: [...new Set(links)], tabelas };
}

const DOCUMENTO_COMPARTILHADO = /^https?:\/\/(?:drive\.google\.com|docs\.google\.com|onedrive\.live\.com|1drv\.ms|[\w-]+\.sharepoint\.com|[\w-]+-my\.sharepoint\.com|www\.dropbox\.com|dropbox\.com)\//i;

/**
 * Links de documento compartilhado (Drive, OneDrive, SharePoint, Dropbox) num
 * texto e numa lista de links. São LISTADOS, nunca baixados (C6): abrir é o
 * caminho do navegador ou de um conector de Drive. PURO.
 */
export function linksDeDocumento(texto: string, links: readonly string[] = []): string[] {
  const doTexto = texto.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  // o corte vem ANTES de qualquer outra coisa: o link é escrito por quem mandou o e-mail
  return [...new Set([...links, ...doTexto].map((l) => semPontuacaoFinal(l.slice(0, URL_MAX), ".,;")).filter((l) => DOCUMENTO_COMPARTILHADO.test(l)))].slice(0, 20);
}

/** Nenhum link de verdade passa disto; o que passa é montado para gastar CPU de quem lê. */
export const URL_MAX = 2048;
