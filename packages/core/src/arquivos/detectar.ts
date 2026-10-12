import { fileTypeFromBuffer } from "file-type";
import * as cfb from "cfb";
import { membro } from "./interop";
import { decodificar, separadorDoCsv } from "./texto";
import type { Familia, TipoDetectado } from "./tipos";

/**
 * QUE ARQUIVO É ESTE, decidido pelos BYTES (armadilha 16 do PRD).
 *
 * O nome e o Content-Type são escolha de quem mandou: um "fatura.pdf" pode ser
 * um executável, e um DOCX renomeado para PDF continua sendo Word. A assinatura
 * mágica (via `file-type`) decide a família; o nome só desempata entre
 * variantes de TEXTO (CSV ou TXT, script ou texto), onde errar não abre nada.
 *
 * Contêiner OLE (CFB) é um caso à parte: DOC, XLS, PPT, MSG, MSI e Office
 * cifrado têm todos a mesma assinatura, e o que os separa é o nome dos fluxos
 * de dentro.
 */

const FAMILIA_POR_EXT: Record<string, Familia> = {
  pdf: "pdf",
  jpg: "imagem", png: "imagem", webp: "imagem", gif: "imagem", tif: "imagem", heic: "imagem", heif: "imagem", bmp: "imagem", avif: "imagem", ico: "imagem", jxl: "imagem",
  docx: "documento", docm: "documento", odt: "documento", rtf: "documento", doc: "documento", dotx: "documento",
  xlsx: "planilha", xlsm: "planilha", xls: "planilha", ods: "planilha", xltx: "planilha",
  pptx: "apresentacao", ppsx: "apresentacao", potx: "apresentacao", odp: "apresentacao", ppt: "apresentacao",
  zip: "compactado", "7z": "compactado", rar: "compactado", gz: "compactado", bz2: "compactado", xz: "compactado", tar: "compactado", cab: "compactado", zst: "compactado",
  mp3: "audio", m4a: "audio", ogg: "audio", oga: "audio", opus: "audio", wav: "audio", aac: "audio", flac: "audio", amr: "audio", wma: "audio", aiff: "audio",
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video", "3gp": "video", "3g2": "video", m4v: "video", mpg: "video", wmv: "video", flv: "video",
  svg: "texto",
  ics: "agenda",
  vcf: "contato",
  exe: "executavel", msi: "executavel", elf: "executavel", "mach-o": "executavel", apk: "executavel", dex: "executavel", lnk: "executavel", iso: "executavel",
  deb: "executavel", rpm: "executavel", dmg: "executavel", class: "executavel", wasm: "executavel", jar: "executavel", xpi: "executavel", crx: "executavel",
  msg: "email", eml: "email",
};

const MIME_POR_EXT: Record<string, string> = {
  txt: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", md: "text/markdown", json: "application/json", xml: "application/xml",
  html: "text/html", mht: "multipart/related", eml: "message/rfc822", msg: "application/vnd.ms-outlook", doc: "application/msword",
  xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint", msi: "application/x-msi", lnk: "application/x-ms-shortcut",
  iso: "application/x-iso9660-image", nfe: "application/xml", ics: "text/calendar", vcf: "text/vcard", script: "text/plain", office: "application/x-cfb",
};

const SCRIPTS = new Set(["bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "sh", "bash", "zsh", "py", "rb", "pl", "php", "hta", "scr", "reg", "ahk", "applescript", "command"]);
const CODIGO = new Set(["ts", "tsx", "jsx", "mjs", "cjs", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "kt", "swift", "sql", "css", "scss", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "log", "txt", "text", "md", "markdown", "rst", "tex", "srt", "vtt"]);

export function extensaoDoNome(nome?: string | null): string {
  const m = /\.([a-z0-9]{1,12})$/i.exec((nome ?? "").trim());
  return m ? m[1]!.toLowerCase() : "";
}

function tipo(ext: string, familia: Familia, mime?: string): TipoDetectado {
  return { ext, familia, mime: mime ?? MIME_POR_EXT[ext] ?? "application/octet-stream" };
}

const MSI_CLSID = "84100c000000000000c0000000000046";

/** O que há dentro de um contêiner OLE. Lê só o diretório (não o conteúdo dos fluxos). */
function tipoDoCfb(bytes: Uint8Array): TipoDetectado {
  let nomes: string[] = [];
  let clsid = "";
  try {
    const ler = membro<typeof cfb.read>(cfb, "read");
    const c = ler(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { type: "buffer" });
    nomes = c.FullPaths.map((p) => p.toLowerCase());
    clsid = (c.FileIndex[0]?.clsid ?? "").toLowerCase();
  } catch {
    return tipo("cfb", "desconhecido", "application/x-cfb");
  }
  const tem = (s: string) => nomes.some((n) => n.endsWith("/" + s) || n.endsWith(s + "/"));
  if (tem("encryptioninfo") && tem("encryptedpackage")) return tipo("office", "protegido");
  if (clsid === MSI_CLSID) return tipo("msi", "executavel");
  if (nomes.some((n) => n.includes("__substg1.0_"))) return tipo("msg", "email");
  if (tem("worddocument")) return tipo("doc", "documento");
  if (tem("workbook") || tem("book")) return tipo("xls", "planilha");
  if (tem("powerpoint document")) return tipo("ppt", "apresentacao");
  return tipo("cfb", "desconhecido", "application/x-cfb");
}

/** Assinaturas que o `file-type` não cobre ou cobre de outro jeito. */
function assinaturaPropria(b: Uint8Array): TipoDetectado | null {
  if (b.length >= 20 && b[0] === 0x4c && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[4] === 0x01 && b[5] === 0x14 && b[6] === 0x02 && b[7] === 0) return tipo("lnk", "executavel");
  if (b.length > 32774 && String.fromCharCode(...b.subarray(32769, 32774)) === "CD001") return tipo("iso", "executavel");
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return tipo("exe", "executavel", "application/x-msdownload");
  return null;
}

const CABECALHO_DE_EMAIL = /^(?:from|to|subject|date|received|return-path|message-id|delivered-to|x-[\w-]+|mime-version|content-type)\s*:/im;

/** Família de um arquivo de TEXTO, pelo conteúdo e, só para desempatar, pelo nome. */
function tipoDeTexto(texto: string, ext: string): TipoDetectado {
  const inicio = texto.slice(0, 4096).replace(/^﻿/, "");
  const comeco = inicio.trimStart();
  const baixo = comeco.slice(0, 400).toLowerCase();

  if (/^begin:vcalendar/i.test(comeco)) return tipo("ics", "agenda");
  if (/^begin:vcard/i.test(comeco)) return tipo("vcf", "contato");
  if (comeco.startsWith("<")) {
    if (/portalfiscal\.inf\.br\/nfe/i.test(inicio) && /<(?:nfeProc|NFe)\b/.test(inicio)) return tipo("nfe", "nota_fiscal", "application/xml");
    if (baixo.startsWith("<!doctype html") || baixo.startsWith("<html") || /<(?:body|head|div|table|p)[\s>]/i.test(inicio)) return tipo("html", "html", "text/html");
    if (baixo.startsWith("<?xml") || /^<[a-z][\w:-]*[\s>]/i.test(comeco)) return tipo("xml", "texto", "application/xml");
  }
  // MIME: e-mail salvo (.eml) ou página arquivada (.mht, que é MIME sem remetente)
  const cabecalho = inicio.split(/\r?\n\r?\n/)[0] ?? "";
  if (CABECALHO_DE_EMAIL.test(cabecalho) && /^[\w-]+\s*:/m.test(cabecalho.split(/\r?\n/)[0] ?? "")) {
    const multipartRelated = /content-type\s*:\s*multipart\/related/i.test(cabecalho);
    if (ext === "mht" || ext === "mhtml" || (multipartRelated && !/^from\s*:/im.test(cabecalho))) return tipo("mht", "html", "multipart/related");
    if (/^(?:from|received|return-path|message-id|subject)\s*:/im.test(cabecalho)) return tipo("eml", "email", "message/rfc822");
  }
  if (SCRIPTS.has(ext) || /^#!\s*\//.test(comeco)) return tipo(SCRIPTS.has(ext) ? ext : "sh", "script", "text/plain");
  if (ext === "json" || /^[[{]/.test(comeco)) {
    try {
      JSON.parse(texto);
      return tipo("json", "texto", "application/json");
    } catch {
      /* não é JSON: segue */
    }
  }
  if (ext === "csv" || ext === "tsv" || (!CODIGO.has(ext) && separadorDoCsv(inicio))) {
    if (separadorDoCsv(inicio)) return tipo(ext === "tsv" || inicio.includes("\t") ? "tsv" : "csv", "tabela", ext === "tsv" ? "text/tab-separated-values" : "text/csv");
  }
  if (ext === "md" || ext === "markdown") return tipo("md", "texto", "text/markdown");
  return tipo(CODIGO.has(ext) ? ext : "txt", "texto", "text/plain");
}

export async function detectarTipo(bytes: Uint8Array, nome?: string | null, mimeDeclarado?: string | null): Promise<TipoDetectado> {
  const ext = extensaoDoNome(nome);
  const visto = await detectarPelosBytes(bytes, ext);
  // O aviso de divergência só vale quando o nome dizia OUTRA família: um .txt
  // que é CSV não é engano de ninguém; um .pdf que é .exe é o golpe.
  const familiaDoNome = ext ? FAMILIA_POR_EXT[ext] : undefined;
  if (familiaDoNome && familiaDoNome !== visto.familia && !(visto.familia === "protegido")) {
    return { ...visto, divergente: true, declarado: `.${ext}` };
  }
  const mime = (mimeDeclarado ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime === "application/pdf" && visto.familia !== "pdf") return { ...visto, divergente: true, declarado: mime };
  return visto;
}

async function detectarPelosBytes(bytes: Uint8Array, ext: string): Promise<TipoDetectado> {
  if (!bytes.length) return tipo("vazio", "desconhecido");
  const ft = await fileTypeFromBuffer(bytes).catch(() => undefined);
  if (ft) {
    if (ft.ext === "cfb") return tipoDoCfb(bytes);
    if (ft.ext === "xml") {
      const t = decodificar(bytes);
      return t ? tipoDeTexto(t.texto, ext === "xml" ? "xml" : ext) : tipo("xml", "texto", "application/xml");
    }
    if (ft.ext === "zip" && ext === "jar") return tipo("jar", "executavel", "application/java-archive");
    const familia = FAMILIA_POR_EXT[ft.ext];
    if (familia) return tipo(ft.ext, familia, ft.mime);
    return tipo(ft.ext, "desconhecido", ft.mime);
  }
  const propria = assinaturaPropria(bytes);
  if (propria) return propria;
  const texto = decodificar(bytes);
  if (!texto) return tipo(ext || "bin", "desconhecido");
  return tipoDeTexto(texto.texto, ext);
}
