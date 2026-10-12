/// <reference path="./bibliotecas.d.ts" />
import mammothNs from "mammoth";
import wordExtractorNs from "word-extractor";
import { abrirZip } from "../zip";
import { membro, padrao } from "../interop";
import { textoDoSlide, textoOdf, atributo, tokens } from "../xml";
import { htmlParaTexto } from "./html";
import { decodificar } from "../texto";
import type { Limites, Orcamento } from "../tipos";

/**
 * Word, Writer, RTF e apresentações. O arquivo é lido como DADO: macro de DOCM
 * e de DOC nunca roda (nenhuma biblioteca aqui executa VBA, elas só leem o XML
 * ou os fluxos de texto), e campo de fórmula vira o texto que já estava
 * calculado.
 */

export interface DocumentoLidoDoOffice {
  texto: string;
  partes: string[];
  tabelas: number;
  resumo: string;
}

/**
 * Infla TODAS as entradas de um contêiner Office contando os bytes, antes de
 * qualquer biblioteca abri-lo. O `mammoth` infla o ZIP inteiro na memória sem
 * teto: um DOCX-bomba passaria direto por ele. Depois desta conferência, o
 * contêiner já provou que cabe no orçamento.
 *
 * O teto de arquivos aqui é dez vezes o de um compactado comum: um PPTX de 50
 * slides tem facilmente 300 entradas (slide, relação, nota, mídia), e não é
 * isso que caracteriza bomba, é o tamanho descompactado.
 *
 * Toda entrada é inflada para CONTAR, mas só fica na memória a que o leitor
 * vai usar (`guardar`, por padrão o XML e as relações). Antes o mapa guardava
 * tudo, imagem e vídeo inclusive: até o teto do orçamento (500 MB por padrão)
 * de uma vez na memória, só para depois ler um content.xml (O6 da revisão).
 */
const SO_XML = (nome: string) => /\.(xml|rels)$/i.test(nome);
export async function conteudoDoContainer(bytes: Buffer, limites: Limites, orcamento: Orcamento, guardar: (nome: string) => boolean = SO_XML): Promise<Map<string, Buffer>> {
  const zip = await abrirZip(bytes, limites.zipMaxArquivos * 10);
  try {
    const out = new Map<string, Buffer>();
    for (const e of zip.entradas) {
      if (e.pasta) continue;
      const conteudo = await zip.ler(e.nome, { maxBytes: limites.zipMaxBytes, orcamento });
      if (guardar(e.nome)) out.set(e.nome, conteudo);
    }
    return out;
  } finally {
    zip.fechar();
  }
}

const utf8 = (b?: Buffer) => (b ? b.toString("utf8") : "");

export async function lerDocx(bytes: Buffer, limites: Limites, orcamento: Orcamento): Promise<DocumentoLidoDoOffice> {
  // só a conferência do tamanho: quem lê o DOCX é o mammoth, a partir dos bytes
  await conteudoDoContainer(bytes, limites, orcamento, () => false);
  const converter = membro<(e: { buffer: Buffer }) => Promise<{ value: string }>>(mammothNs, "convertToHtml");
  const { value } = await converter({ buffer: bytes });
  const h = htmlParaTexto(value);
  return { texto: h.texto, partes: [h.texto], tabelas: h.tabelas, resumo: resumoDeTexto("Documento do Word", h.texto, h.tabelas) };
}

export async function lerOdt(bytes: Buffer, limites: Limites, orcamento: Orcamento): Promise<DocumentoLidoDoOffice> {
  const c = await conteudoDoContainer(bytes, limites, orcamento);
  const r = textoOdf(utf8(c.get("content.xml")));
  const texto = r.partes.map((p) => p.texto.trim()).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texto, partes: [texto], tabelas: r.tabelas, resumo: resumoDeTexto("Documento do Writer (ODT)", texto, r.tabelas) };
}

export async function lerDoc(bytes: Buffer): Promise<DocumentoLidoDoOffice> {
  const WordExtractor = padrao<new () => { extract(b: Buffer): Promise<{ getBody(): string; getFootnotes(): string; getHeaders(o?: { includeFooters?: boolean }): string }> }>(wordExtractorNs);
  const doc = await new WordExtractor().extract(bytes);
  // o extrator separa célula de tabela por TAB e linha por quebra: fica legível como está
  const texto = [doc.getBody(), doc.getFootnotes()].map((s) => (s ?? "").trim()).filter(Boolean).join("\n\n");
  return { texto, partes: [texto], tabelas: 0, resumo: resumoDeTexto("Documento do Word antigo (DOC)", texto, 0) };
}

/** Ordem real dos slides: a lista de `p:sldId` da apresentação, não o número do arquivo. */
function ordemDosSlides(c: Map<string, Buffer>): string[] {
  const rels = new Map<string, string>();
  for (const tk of tokens(utf8(c.get("ppt/_rels/presentation.xml.rels")))) {
    if ("tag" in tk && tk.tag.nome === "Relationship") {
      const id = atributo(tk.tag.atributos, "Id");
      const alvo = atributo(tk.tag.atributos, "Target");
      if (id && alvo) rels.set(id, alvo.replace(/^\/?(ppt\/)?/, "ppt/"));
    }
  }
  const ordem: string[] = [];
  for (const tk of tokens(utf8(c.get("ppt/presentation.xml")))) {
    if ("tag" in tk && tk.tag.nome === "p:sldId") {
      const alvo = rels.get(atributo(tk.tag.atributos, "r:id") ?? "");
      if (alvo && c.has(alvo)) ordem.push(alvo);
    }
  }
  if (ordem.length) return ordem;
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  return [...c.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
}

function notasDoSlide(c: Map<string, Buffer>, slide: string): string {
  const rels = utf8(c.get(slide.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")));
  for (const tk of tokens(rels)) {
    if ("tag" in tk && tk.tag.nome === "Relationship" && /notesSlide$/.test(atributo(tk.tag.atributos, "Type") ?? "")) {
      const alvo = (atributo(tk.tag.atributos, "Target") ?? "").replace(/^\.\.\//, "ppt/");
      return textoDoSlide(utf8(c.get(alvo))).texto;
    }
  }
  return "";
}

export async function lerPptx(bytes: Buffer, limites: Limites, orcamento: Orcamento): Promise<DocumentoLidoDoOffice> {
  const c = await conteudoDoContainer(bytes, limites, orcamento);
  const partes: string[] = [];
  let tabelas = 0;
  ordemDosSlides(c).forEach((slide, i) => {
    const s = textoDoSlide(utf8(c.get(slide)));
    tabelas += s.tabelas;
    const notas = notasDoSlide(c, slide);
    partes.push([`## Slide ${i + 1}`, s.texto, notas ? `Notas: ${notas}` : ""].filter(Boolean).join("\n"));
  });
  const texto = partes.join("\n\n");
  return { texto, partes, tabelas, resumo: `Apresentação com ${partes.length} slide(s)${tabelas ? ` e ${tabelas} tabela(s)` : ""}.` };
}

export async function lerOdp(bytes: Buffer, limites: Limites, orcamento: Orcamento): Promise<DocumentoLidoDoOffice> {
  const c = await conteudoDoContainer(bytes, limites, orcamento);
  const r = textoOdf(utf8(c.get("content.xml")));
  const partes = r.partes.map((p, i) => [`## Slide ${i + 1}${p.nome && !/^page\d+$/i.test(p.nome) ? `: ${p.nome}` : ""}`, p.texto.trim(), p.notas.trim() ? `Notas: ${p.notas.trim()}` : ""].filter(Boolean).join("\n"));
  const texto = partes.join("\n\n");
  return { texto, partes, tabelas: r.tabelas, resumo: `Apresentação (ODP) com ${partes.length} slide(s).` };
}

/* --- RTF ---------------------------------------------------------------------
 * Um leitor de RTF pequeno, sem biblioteca: grupos, palavras de controle,
 * escapes hexadecimais na página de código do documento e Unicode (\uN). Os
 * destinos que não são texto (fontes, cores, estilos, imagem, metadados, tema
 * do Word) são pulados inteiros.
 */

const DESTINOS_IGNORADOS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl",
  "mmathpr", "latentstyles", "themedata", "colorschememapping", "datastore", "defchp", "defpap", "pgdsctbl", "header", "footer",
  "headerl", "headerr", "headerf", "footerl", "footerr", "footerf", "fldinst", "filetbl", "revtbl", "operator", "author", "title",
  "pnseclvl", "pntext", "pntxta", "pntxtb", "bkmkstart", "bkmkend", "comment", "atnid", "atnauthor", "annotation", "xe", "tc", "datafield", "formfield", "shppict", "nonshppict", "blipuid", "sp", "sn", "sv",
]);

const PAGINA_DE_CODIGO: Record<number, string> = { 1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253", 1254: "windows-1254", 1257: "windows-1257", 437: "ibm866", 850: "windows-1252", 10000: "macintosh" };

export function rtfParaTexto(rtf: string): string {
  let out = "";
  let i = 0;
  let decoder = new TextDecoder("windows-1252");
  const pilha: { ignorar: boolean; uc: number }[] = [];
  let ignorar = false;
  let uc = 1;
  let pularFallback = 0;
  let bytesPendentes: number[] = [];
  const despejar = () => {
    if (bytesPendentes.length) {
      if (!ignorar) out += decoder.decode(new Uint8Array(bytesPendentes));
      bytesPendentes = [];
    }
  };
  const emitir = (s: string) => {
    despejar();
    if (pularFallback > 0) {
      const n = Math.min(pularFallback, s.length);
      pularFallback -= n;
      s = s.slice(n);
    }
    if (!ignorar && s) out += s;
  };

  while (i < rtf.length) {
    const c = rtf[i]!;
    if (c === "{") {
      despejar();
      pilha.push({ ignorar, uc });
      i++;
      // {\* ...} é destino opcional: quem não o conhece deve pular
      if (rtf.startsWith("\\*", i)) ignorar = true;
      continue;
    }
    if (c === "}") {
      despejar();
      const topo = pilha.pop();
      if (topo) ({ ignorar, uc } = topo);
      i++;
      continue;
    }
    if (c === "\\") {
      const prox = rtf[i + 1] ?? "";
      if (prox === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (pularFallback > 0) pularFallback--;
        else bytesPendentes.push(parseInt(hex, 16));
        i += 4;
        continue;
      }
      if ("\\{}".includes(prox)) {
        emitir(prox);
        i += 2;
        continue;
      }
      if (prox === "~") { emitir(" "); i += 2; continue; }
      if (prox === "-" ) { i += 2; continue; }
      if (prox === "_") { emitir("-"); i += 2; continue; }
      if (prox === "\n" || prox === "\r") { emitir("\n"); i += 2; continue; }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(rtf.slice(i + 1, i + 50));
      if (!m) {
        i += 2;
        continue;
      }
      i += 1 + m[0].length;
      const palavra = m[1]!.toLowerCase();
      const n = m[2] !== undefined ? Number(m[2]) : null;
      if (DESTINOS_IGNORADOS.has(palavra)) {
        despejar();
        ignorar = true;
        continue;
      }
      switch (palavra) {
        case "ansicpg":
          if (n && PAGINA_DE_CODIGO[n]) decoder = new TextDecoder(PAGINA_DE_CODIGO[n]!);
          break;
        case "par": case "line": case "sect": case "page": emitir("\n"); break;
        case "row": emitir("\n"); break;
        case "cell": emitir("\t"); break;
        case "tab": emitir("\t"); break;
        case "emdash": emitir("—"); break;
        case "endash": emitir("–"); break;
        case "bullet": emitir("•"); break;
        case "lquote": emitir("‘"); break;
        case "rquote": emitir("’"); break;
        case "ldblquote": emitir("“"); break;
        case "rdblquote": emitir("”"); break;
        case "uc": uc = n ?? 1; break;
        case "u": {
          const cp = n !== null && n < 0 ? n + 65536 : n ?? 63;
          emitir(String.fromCharCode(cp));
          pularFallback = uc;
          break;
        }
        case "bin":
          // dado binário cru: n bytes que não são texto
          despejar();
          i += Math.max(0, n ?? 0);
          break;
        default:
          break;
      }
      continue;
    }
    if (c === "\r" || c === "\n") {
      i++;
      continue;
    }
    emitir(c);
    i++;
  }
  despejar();
  return out
    .split("\n")
    // `trimEnd` já tira os tabs do fim; o `/\t+$/` que vinha antes era quadrático
    // numa linha de tabs que não termina nele (40 mil levavam 8 s, M1 da auditoria)
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function lerRtf(bytes: Buffer): DocumentoLidoDoOffice {
  // RTF é ASCII de 7 bits por definição; o que não é ASCII vem escapado
  const t = decodificar(bytes)?.texto ?? bytes.toString("latin1");
  const texto = rtfParaTexto(t);
  return { texto, partes: [texto], tabelas: 0, resumo: resumoDeTexto("Documento RTF", texto, 0) };
}

function resumoDeTexto(oQue: string, texto: string, tabelas: number): string {
  const palavras = texto.split(/\s+/).filter(Boolean).length;
  return `${oQue} com ${palavras} palavra(s)${tabelas ? ` e ${tabelas} tabela(s)` : ""}.`;
}
