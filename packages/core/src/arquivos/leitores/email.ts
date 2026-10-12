import PostalMime from "postal-mime";
import * as msgreaderNs from "@kenjiuno/msgreader";
import { padrao } from "../interop";
import { decodificar } from "../texto";
import { htmlParaTexto, linksDeDocumento } from "./html";
import type { CabecalhoDeEmail, Extraido } from "../tipos";

/**
 * E-mail anexado a e-mail (EML, MSG do Outlook) e página arquivada (MHT).
 *
 * O e-mail anexado é a forma mais comum de "encaminhar como anexo", e os
 * anexos DELE são lidos pelo mesmo extrator, recursivo, gastando o mesmo
 * orçamento de profundidade e de bytes que um ZIP dentro de ZIP.
 */

export type ExtrairFilho = (bytes: Buffer, nome: string, mime: string | null) => Promise<Extraido>;

export interface EmailLido {
  cabecalho: CabecalhoDeEmail;
  corpo: string;
  links: string[];
  anexos: Extraido[];
}

const endereco = (a?: { name?: string; address?: string } | null) => (a ? (a.name && a.address ? `${a.name} <${a.address}>` : a.address || a.name || "") : "");

function lista(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a: { name?: string; address?: string; group?: { name?: string; address?: string }[] }) => (a.group ? a.group.map(endereco) : [endereco(a)])).filter(Boolean);
}

export async function lerEml(bytes: Buffer, extrairFilho: ExtrairFilho): Promise<EmailLido> {
  const m = await PostalMime.parse(bytes, { attachmentEncoding: "arraybuffer" });
  const html = m.html ? htmlParaTexto(m.html) : null;
  const corpo = (m.text?.trim() || html?.texto || "").trim();
  const anexos: Extraido[] = [];
  for (const a of m.attachments ?? []) {
    const conteudo = Buffer.from(a.content as ArrayBuffer);
    anexos.push(await extrairFilho(conteudo, a.filename || (a.contentId ? `embutido-${a.contentId.replace(/[<>]/g, "")}` : "anexo"), a.mimeType ?? null));
  }
  return {
    cabecalho: { de: endereco(m.from) || null, para: lista(m.to), cc: lista(m.cc), data: m.date ?? null, assunto: m.subject ?? null },
    corpo,
    links: linksDeDocumento(corpo, html?.links ?? []),
    anexos,
  };
}

/**
 * O `<title>` da página, por `indexOf`. A regex de antes (`<title[^>]*>…`)
 * recomeçava a varredura a cada `<title` sem `>` depois: quadrática num MHT
 * montado para isso. PURO.
 */
export function tituloDoHtml(html: string): string | null {
  // regex de texto fixo (sem repetição) é linear; o `toLowerCase` mudaria o tamanho de "İ" e desalinharia as posições
  const abre = /<title/i.exec(html)?.index ?? -1;
  if (abre === -1) return null;
  const fimDaTag = html.indexOf(">", abre);
  if (fimDaTag === -1) return null;
  const re = /<\/title>/gi;
  re.lastIndex = fimDaTag;
  const fecha = re.exec(html)?.index ?? -1;
  if (fecha === -1) return null;
  const dentro = html.slice(fimDaTag + 1, fecha);
  // como antes: título com outra tag dentro não é título
  return dentro.includes("<") ? null : dentro.trim() || null;
}

/** Página arquivada (.mht/.mhtml): o HTML de dentro vira texto; imagens e recursos ficam de fora. */
export async function lerMht(bytes: Buffer): Promise<{ texto: string; links: string[]; tabelas: number; titulo: string | null }> {
  const m = await PostalMime.parse(bytes, { attachmentEncoding: "arraybuffer" });
  const html = m.html ?? (m.attachments ?? []).filter((a) => a.mimeType === "text/html").map((a) => decodificar(new Uint8Array(a.content as ArrayBuffer))?.texto ?? "")[0] ?? "";
  const h = htmlParaTexto(html);
  const titulo = tituloDoHtml(html) || m.subject || null;
  return { texto: h.texto || (m.text ?? "").trim(), links: h.links, tabelas: h.tabelas, titulo };
}

export interface MsgAnexo {
  fileName?: string;
  fileNameShort?: string;
  name?: string;
  attachMimeTag?: string;
  innerMsgContent?: boolean;
  innerMsgContentFields?: unknown;
}
export interface MsgDados {
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  senderSmtpAddress?: string;
  body?: string;
  bodyHtml?: string;
  html?: Uint8Array;
  clientSubmitTime?: string;
  messageDeliveryTime?: string;
  creationTime?: string;
  recipients?: { name?: string; email?: string; smtpAddress?: string; recipType?: string }[];
  attachments?: MsgAnexo[];
  error?: string;
}
export interface MsgReader {
  getFileData(): MsgDados;
  getAttachment(a: MsgAnexo | number): { fileName: string; content: Uint8Array };
}

/**
 * MSG do Outlook. O `msgreader` só lê as propriedades MAPI (é um leitor de
 * contêiner OLE, não um cliente de e-mail): nada é executado, nenhum recurso é
 * buscado. E-mail anexado dentro do MSG vem como MSG de novo e é lido igual.
 */
/**
 * O e-mail de dentro do MSG chega já lido (não passa pelo extrator), então os
 * tetos são conferidos aqui: `niveis` é quantos e-mails dentro de e-mail ainda
 * cabem (o `anexos.zipProfundidade` que sobra), e `podeAbrir` gasta do mesmo
 * teto de arquivos dos anexos. Antes a recursão não tinha fundo (I6).
 */
export interface TetosDoMsg {
  niveis?: number;
  podeAbrir?: () => boolean;
}

export async function lerMsg(bytes: Buffer, extrairFilho: ExtrairFilho, tetos: TetosDoMsg = {}): Promise<EmailLido> {
  const MsgReaderClasse = padrao<new (b: ArrayBuffer | Uint8Array) => MsgReader>(msgreaderNs);
  const leitor = new MsgReaderClasse(new Uint8Array(bytes));
  const dados = leitor.getFileData();
  if (dados.error) throw new Error(`MSG ilegível: ${dados.error}`);
  return lerDadosDoMsg(extrairFilho, tetos)(dados, leitor, 0);
}

/** Exportado para o teste montar um MSG aninhado sem precisar de um arquivo binário de 10 níveis. */
export function lerDadosDoMsg(extrairFilho: ExtrairFilho, tetos: TetosDoMsg) {
  const niveis = tetos.niveis ?? Number.POSITIVE_INFINITY;
  return async function ler(dados: MsgDados, leitor: MsgReader, nivel: number): Promise<EmailLido> {
    const de = dados.senderName && (dados.senderSmtpAddress || dados.senderEmail) ? `${dados.senderName} <${dados.senderSmtpAddress || dados.senderEmail}>` : dados.senderSmtpAddress || dados.senderEmail || dados.senderName || null;
    const pessoa = (r: { name?: string; email?: string; smtpAddress?: string }) => (r.name && (r.smtpAddress || r.email) ? `${r.name} <${r.smtpAddress || r.email}>` : r.smtpAddress || r.email || r.name || "");
    const recip = dados.recipients ?? [];
    const html = !dados.body?.trim() && (dados.bodyHtml || dados.html) ? htmlParaTexto(dados.bodyHtml ?? new TextDecoder().decode(dados.html)) : null;
    const corpo = (dados.body?.trim() || html?.texto || "").trim();
    const anexos: Extraido[] = [];
    for (const a of dados.attachments ?? []) {
      if (a.innerMsgContent && a.innerMsgContentFields) {
        const nomeDoInterno = a.name || a.fileName || "mensagem.msg";
        if (nivel >= niveis) {
          anexos.push(anexoIlegivel(nomeDoInterno, `E-mail anexado dentro de outro além de ${niveis} nível(is): não abri.`));
          continue;
        }
        if (tetos.podeAbrir && !tetos.podeAbrir()) {
          anexos.push(anexoIlegivel(nomeDoInterno, "Não aberto: o e-mail passa do teto de arquivos (Ajustes, Anexos)."));
          continue;
        }
        // e-mail dentro do e-mail: os campos já vêm lidos, os anexos dele também
        const interno = await ler(a.innerMsgContentFields as MsgDados, leitor, nivel + 1);
        anexos.push(emailComoExtraido(interno, nomeDoInterno));
        continue;
      }
      let arq: { fileName: string; content: Uint8Array } | null = null;
      try {
        arq = leitor.getAttachment(a);
      } catch {
        // um anexo corrompido não esconde os outros nem o corpo
        anexos.push(anexoIlegivel(a.fileName || a.name || "anexo"));
        continue;
      }
      anexos.push(await extrairFilho(Buffer.from(arq.content), arq.fileName || a.fileName || "anexo", a.attachMimeTag ?? null));
    }
    return {
      cabecalho: {
        de,
        para: recip.filter((r) => !r.recipType || r.recipType === "to").map(pessoa).filter(Boolean),
        cc: recip.filter((r) => r.recipType === "cc").map(pessoa).filter(Boolean),
        data: dados.clientSubmitTime || dados.messageDeliveryTime || dados.creationTime || null,
        assunto: dados.subject ?? null,
      },
      corpo,
      links: linksDeDocumento(corpo, html?.links ?? []),
      anexos,
    };
  };
}

/** Texto de um e-mail lido: cabeçalho, corpo e o que cada anexo era. PURO. */
export function textoDoEmail(e: EmailLido): string {
  const c = e.cabecalho;
  const linhas = [
    c.de ? `De: ${c.de}` : null,
    c.para.length ? `Para: ${c.para.join(", ")}` : null,
    c.cc.length ? `Cc: ${c.cc.join(", ")}` : null,
    c.data ? `Data: ${c.data}` : null,
    c.assunto ? `Assunto: ${c.assunto}` : null,
    "",
    e.corpo,
  ].filter((l): l is string => l !== null);
  for (const a of e.anexos) {
    linhas.push("", `### Anexo: ${a.nome} (${a.tipo.ext})`, a.lido ? a.texto : a.resumo);
  }
  if (e.links.length) linhas.push("", "Documentos compartilhados citados (não baixados):", ...e.links.map((l) => `- ${l}`));
  return linhas.join("\n").trim();
}

function anexoIlegivel(nome: string, resumo = "Anexo corrompido dentro do e-mail: não consegui tirá-lo de lá."): Extraido {
  return { nome, tipo: { ext: "bin", mime: "application/octet-stream", familia: "desconhecido" }, tamanho: 0, sha256: "", lido: false, texto: "", partes: [], resumo, tabelas: 0, avisos: [] };
}

/** Um e-mail aninhado no formato de qualquer arquivo lido, para entrar na lista de anexos. */
export function emailComoExtraido(e: EmailLido, nome: string): Extraido {
  const texto = textoDoEmail(e);
  return {
    nome,
    tipo: { ext: "msg", mime: "application/vnd.ms-outlook", familia: "email" },
    tamanho: texto.length,
    sha256: "",
    lido: true,
    texto,
    partes: [texto],
    resumo: `E-mail${e.cabecalho.assunto ? ` "${e.cabecalho.assunto}"` : ""}${e.cabecalho.de ? ` de ${e.cabecalho.de}` : ""}, com ${e.anexos.length} anexo(s).`,
    tabelas: 0,
    avisos: [],
    estruturado: { tipo: "email", cabecalho: e.cabecalho },
  };
}
