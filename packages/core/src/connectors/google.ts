import { decodificarEntidades } from "../texto/entidades";
import { nomesDeAnexoParaOModelo } from "../texto/dado-externo";

/** Clients REST de Gmail e Google Calendar. Recebem um access token válido. */

async function gapi<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// ---------- Gmail ----------
interface GmailListResp { messages?: { id: string }[] }
interface GmailMsg {
  id: string;
  snippet: string;
  payload?: { headers?: { name: string; value: string }[] };
}

/** Uma parte MIME do Gmail (`format=full`). Anexo tem `filename` e `body.attachmentId`. */
export interface GmailParte {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailParte[];
}

export interface AnexoDoEmail {
  /**
   * Id ESTÁVEL do anexo. No Gmail é o `partId` ("1", "0.2"), e não o
   * `attachmentId`: este muda a cada leitura da mensagem, e um id que muda
   * faria a mesma pergunta sobre o mesmo anexo baixar e ler tudo de novo.
   */
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  /** imagem no corpo (`cid:`), como logo e print colado (C6) */
  embutido: boolean;
}

export interface EmailSummary { id: string; from: string; subject: string; date: string; snippet: string; tem_anexo?: boolean; anexos?: string[] }

/** Só a estrutura das partes, sem o conteúdo (o `fields` do Google corta o corpo). */
const CAMPOS_DAS_PARTES = "partId,mimeType,filename,headers,body/size,body/attachmentId";
/**
 * Quantos níveis de partes o `fields` pede. O `fields` do Google não tem
 * recursão: cada nível é escrito. Cinco deixavam de fora o anexo de um e-mail
 * encaminhado dentro de encaminhado (aparecia no `ler_email`, que usa o
 * `format=full`, e o download dizia "não está mais no e-mail"). Doze cobrem o
 * que existe na prática, e o download ainda tem a reserva do `format=full` (M19).
 */
const NIVEIS_DE_PARTES = 12;
function partesAninhadas(niveis: number): string {
  let s = CAMPOS_DAS_PARTES;
  for (let i = 0; i < niveis; i++) s = `${CAMPOS_DAS_PARTES},parts(${s})`;
  return s;
}
const PARTES_SEM_CORPO = `id,snippet,payload(headers,${partesAninhadas(NIVEIS_DE_PARTES)})`;

const cabecalhoDaParte = (p: GmailParte, n: string) => p.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";

/** Todas as partes, em profundidade, na ordem do e-mail. PURO. */
export function todasAsPartes(p: GmailParte | undefined): GmailParte[] {
  if (!p) return [];
  return [p, ...(p.parts ?? []).flatMap(todasAsPartes)];
}

/**
 * Os anexos de uma mensagem, incluindo a imagem embutida no corpo (C6). PURO.
 *
 * É anexo a parte com nome de arquivo, ou a que tem `Content-ID` e conteúdo
 * separado (a imagem colada no corpo às vezes vem sem nome). Texto do próprio
 * corpo nunca entra, mesmo quando o Gmail o entrega por `attachmentId`.
 */
export function anexosDasPartes(payload: GmailParte | undefined): AnexoDoEmail[] {
  const out: AnexoDoEmail[] = [];
  for (const p of todasAsPartes(payload)) {
    if (!p.partId || p.parts?.length) continue;
    const disposicao = cabecalhoDaParte(p, "content-disposition").toLowerCase();
    const cid = cabecalhoDaParte(p, "content-id");
    const nome = (p.filename ?? "").trim();
    const corpo = !nome && /^text\/(plain|html)$/i.test(p.mimeType ?? "") && !disposicao.startsWith("attachment");
    if (corpo) continue;
    if (!nome && !(cid && p.body?.attachmentId)) continue;
    out.push({
      id: p.partId,
      nome: nome || `embutido-${cid.replace(/[<>]/g, "") || p.partId}`,
      tipo: (p.mimeType ?? "application/octet-stream").toLowerCase(),
      tamanho: p.body?.size ?? 0,
      embutido: Boolean(cid) && !disposicao.startsWith("attachment"),
    });
  }
  return out;
}

export async function listRecentEmails(token: string, max = 5, query = "in:inbox"): Promise<EmailSummary[]> {
  const list = await gapi<GmailListResp>(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: EmailSummary[] = [];
  for (const mid of ids) {
    // `format=full` com `fields`: a estrutura das partes (para dizer se tem anexo
    // e quais), sem baixar corpo nenhum. O `metadata` não traz as partes.
    const msg = await gapi<GmailMsg & { payload?: GmailParte }>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}?format=full&fields=${encodeURIComponent(PARTES_SEM_CORPO)}`);
    const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const anexos = anexosDasPartes(msg.payload).filter((a) => !a.embutido);
    // o nome do anexo é escolha de quem mandou: vai embrulhado como dado (I2 da auditoria)
    out.push({ id: msg.id, from: h("from"), subject: h("subject"), date: h("date"), snippet: decodificarEntidades(msg.snippet ?? ""), tem_anexo: anexos.length > 0, anexos: nomesDeAnexoParaOModelo(anexos.map((a) => a.nome)) });
  }
  return out;
}

export interface MensagemCompleta {
  id: string;
  de: string;
  para: string[];
  cc: string[];
  data: string;
  assunto: string;
  /** texto puro, se a mensagem tiver; senão vazio */
  textoPuro: string;
  /** HTML, quando não há texto puro (quem chama converte, sem recurso remoto) */
  html: string;
  anexos: AnexoDoEmail[];
  link: string | null;
  /** o `Authentication-Results` de cima (o do Gmail): é dele que sai se o From é de verdade */
  autenticacao?: string;
}

const separarEnderecos = (v: string) => v.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean);

/**
 * Os bytes do corpo no charset que a PARTE declara (`Content-Type: text/plain;
 * charset=ISO-8859-1`). Antes tudo era lido como UTF-8, e e-mail de banco
 * brasileiro, que ainda sai muito em Latin-1, chegava com "Ã§" no lugar de "ç"
 * (M2). Charset desconhecido ou inválido cai no UTF-8 de antes. PURO.
 */
export function textoNoCharset(bytes: Buffer, contentType: string): string {
  const m = /charset\s*=\s*"?([\w.:-]{1,40})"?/i.exec(contentType.slice(0, 500));
  const charset = (m?.[1] ?? "utf-8").toLowerCase();
  if (charset === "utf-8" || charset === "utf8" || charset === "us-ascii") return bytes.toString("utf8");
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function corpoDaParte(p: GmailParte): string {
  return p.body?.data ? textoNoCharset(Buffer.from(p.body.data, "base64url"), cabecalhoDaParte(p, "content-type")) : "";
}

/**
 * Lê UM e-mail inteiro (C1): cabeçalhos, corpo e a lista de anexos.
 *
 * A permissão `https://mail.google.com/` que a Órbita já pede cobre isto e o
 * download do anexo: não precisa reconectar a conta.
 */
export async function lerMensagemCompleta(token: string, id: string): Promise<MensagemCompleta> {
  const msg = await gapi<{ id: string; threadId?: string; payload?: GmailParte }>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const partes = todasAsPartes(msg.payload);
  const h = (n: string) => cabecalhoDaParte(msg.payload ?? {}, n);
  const ehCorpo = (p: GmailParte, tipo: string) => (p.mimeType ?? "").toLowerCase() === tipo && !(p.filename ?? "").trim() && !cabecalhoDaParte(p, "content-disposition").toLowerCase().startsWith("attachment");
  const texto = partes.filter((p) => ehCorpo(p, "text/plain"));
  const html = partes.filter((p) => ehCorpo(p, "text/html"));
  // corpo grande vem por `attachmentId`, mesmo sendo o próprio texto do e-mail
  const conteudo = async (p: GmailParte) => (p.body?.data ? corpoDaParte(p) : p.body?.attachmentId ? baixarParte(token, msg.id, p.body.attachmentId).then((b) => textoNoCharset(b, cabecalhoDaParte(p, "content-type"))) : "");
  const textoPuro = (await Promise.all(texto.map(conteudo))).join("\n\n");
  const htmlTexto = textoPuro.trim() ? "" : (await Promise.all(html.map(conteudo))).join("\n");
  return {
    id: msg.id,
    de: h("from"),
    para: separarEnderecos(h("to")),
    cc: separarEnderecos(h("cc")),
    data: h("date"),
    assunto: h("subject"),
    textoPuro,
    html: htmlTexto,
    anexos: anexosDasPartes(msg.payload),
    link: msg.threadId ? `https://mail.google.com/mail/#all/${msg.threadId}` : null,
    // só o PRIMEIRO: é o que o Gmail escreveu ao receber; os de baixo podem ter vindo prontos do remetente
    autenticacao: h("authentication-results"),
  };
}

async function baixarParte(token: string, mensagemId: string, attachmentId: string): Promise<Buffer> {
  const r = await gapi<{ data?: string; size?: number }>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mensagemId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return Buffer.from(r.data ?? "", "base64url");
}

/**
 * Baixa um anexo pelo id ESTÁVEL (o `partId`). Relê a estrutura da mensagem
 * para achar o `attachmentId` de agora, que o Gmail troca a cada leitura.
 */
export async function baixarAnexoGmail(token: string, mensagemId: string, parteId: string): Promise<{ bytes: Buffer; anexo: AnexoDoEmail }> {
  let msg = await gapi<{ id: string; payload?: GmailParte }>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mensagemId)}?format=full&fields=${encodeURIComponent(PARTES_SEM_CORPO.replace(/body\/attachmentId/g, "body/attachmentId,body/data"))}`);
  // a parte mora mais fundo do que o `fields` alcança: pede a mensagem inteira, como o `ler_email` (M19)
  if (!todasAsPartes(msg.payload).some((p) => p.partId === parteId)) {
    msg = await gapi<{ id: string; payload?: GmailParte }>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mensagemId)}?format=full`);
  }
  const parte = todasAsPartes(msg.payload).find((p) => p.partId === parteId);
  const anexo = anexosDasPartes(msg.payload).find((a) => a.id === parteId);
  if (!parte || !anexo) throw new Error("Esse anexo não está mais no e-mail.");
  const bytes = parte.body?.attachmentId ? await baixarParte(token, mensagemId, parte.body.attachmentId) : Buffer.from(parte.body?.data ?? "", "base64url");
  return { bytes, anexo };
}

export interface ImportantEmail { id: string; from: string; subject: string; snippet: string; internalDate: Date }

/**
 * E-mails não lidos que o PRÓPRIO Gmail marcou como importantes (label
 * automática do Google, sem precisarmos treinar classificador nenhum).
 * `internalDate` vem sempre no recurso da mensagem, mesmo em `format=metadata`.
 */
export async function listImportantUnread(token: string, max = 10): Promise<ImportantEmail[]> {
  const list = await gapi<GmailListResp>(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent("is:unread is:important in:inbox")}`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: ImportantEmail[] = [];
  for (const mid of ids) {
    const msg = await gapi<GmailMsg & { internalDate?: string }>(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    );
    const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const ms = Number(msg.internalDate);
    out.push({ id: msg.id, from: h("from"), subject: h("subject"), snippet: decodificarEntidades(msg.snippet ?? ""), internalDate: new Date(Number.isFinite(ms) ? ms : Date.now()) });
  }
  return out;
}

/** O que a triagem precisa de cada mensagem: além do básico, os rótulos e os cabeçalhos que dizem quem mandou de verdade. */
export interface MensagemDaCaixa {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  internalDate: Date;
  labelIds: string[];
  listUnsubscribe: boolean;
  authResults: string;
}

/**
 * A caixa de entrada desde um instante, da mais antiga para a mais nova (a
 * triagem avança o marcador da conta até a última que conseguiu processar).
 * `after:` do Gmail é em segundos e inclusivo: quem chama descarta o que já
 * viu pelo id.
 */
export async function listarCaixaDesde(token: string, desde: Date, max = 25): Promise<MensagemDaCaixa[]> {
  const q = `in:inbox after:${Math.floor(desde.getTime() / 1000)}`;
  const list = await gapi<GmailListResp>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  const out: MensagemDaCaixa[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = await gapi<GmailMsg & { internalDate?: string; labelIds?: string[] }>(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe&metadataHeaders=Authentication-Results`,
    );
    const hs = msg.payload?.headers ?? [];
    const h = (n: string) => hs.filter((x) => x.name.toLowerCase() === n).map((x) => x.value);
    const ms = Number(msg.internalDate);
    out.push({
      id: msg.id,
      from: h("from")[0] ?? "",
      subject: h("subject")[0] ?? "",
      snippet: decodificarEntidades(msg.snippet ?? ""),
      internalDate: new Date(Number.isFinite(ms) ? ms : Date.now()),
      labelIds: msg.labelIds ?? [],
      listUnsubscribe: h("list-unsubscribe").length > 0,
      // pode haver mais de um (cada servidor no caminho escreve o seu): todos contam
      authResults: h("authentication-results").join("; "),
    });
  }
  return out.sort((a, b) => a.internalDate.getTime() - b.internalDate.getTime());
}

/** Cria um RASCUNHO (não envia) — ação segura; o envio real exige confirmação. */
export async function createDraft(token: string, to: string, subject: string, body: string): Promise<{ id: string }> {
  const raw = Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n"),
  ).toString("base64url");
  return gapi(token, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });
}

/** Envia um e-mail de fato. Chamar só após confirmação explícita do usuário. */
export async function sendEmail(token: string, to: string, subject: string, body: string): Promise<{ id: string }> {
  const raw = Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n"),
  ).toString("base64url");
  return gapi(token, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
}

/** Cabeçalho MIME em UTF-8 sem quebra de linha (quebra num cabeçalho é injeção de cabeçalho). */
const cabecalhoUtf8 = (s: string) => `=?UTF-8?B?${Buffer.from(s.replace(/[\r\n]+/g, " ")).toString("base64")}?=`;
const base64EmLinhas = (b: Buffer) => b.toString("base64").replace(/.{76}/g, "$&\r\n");

/**
 * Monta o e-mail (MIME) com UM arquivo anexado. PURO.
 *
 * O destino já vem resolvido pela agenda (`contatos/agenda.ts`); mesmo assim
 * CR e LF saem dele: um "para" com quebra de linha acrescentaria cabeçalhos
 * (um Bcc escondido) ao e-mail que o dono aprovou.
 */
export function mimeComAnexo(para: string, assunto: string, corpo: string, anexo: { nome: string; mime: string; bytes: Buffer }, fronteira: string): Buffer {
  const nome = cabecalhoUtf8(anexo.nome);
  const tipo = /^[\w.+-]+\/[\w.+-]+$/.test(anexo.mime) ? anexo.mime : "application/octet-stream";
  const linhas = [
    `To: ${para.replace(/[\r\n]+/g, "")}`,
    `Subject: ${cabecalhoUtf8(assunto)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${fronteira}"`,
    "",
    `--${fronteira}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64EmLinhas(Buffer.from(corpo, "utf8")),
    `--${fronteira}`,
    `Content-Type: ${tipo}; name="${nome}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${nome}"`,
    "",
    base64EmLinhas(anexo.bytes),
    `--${fronteira}--`,
    "",
  ];
  return Buffer.from(linhas.join("\r\n"), "utf8");
}

/**
 * Manda um e-mail COM um arquivo (encaminhar o anexo, C4). Chamar só depois da
 * aprovação. Vai pelo endpoint de upload, que aceita a mensagem crua de até
 * 35 MB; o `messages/send` com JSON para em poucos MB.
 */
export async function enviarEmailComAnexo(token: string, para: string, assunto: string, corpo: string, anexo: { nome: string; mime: string; bytes: Buffer }): Promise<{ id: string }> {
  const mime = mimeComAnexo(para, assunto, corpo, anexo, `orbita-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
    body: new Uint8Array(mime),
  });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { id: string };
}

// ---------- Calendar ----------
interface CalListResp {
  items?: {
    id: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    location?: string;
    hangoutLink?: string;
    attendees?: { email: string; displayName?: string; self?: boolean }[];
  }[];
}
export interface CalEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  link?: string;
  attendees?: string[];
}

function toCalEvent(e: NonNullable<CalListResp["items"]>[number]): CalEvent {
  return {
    id: e.id,
    summary: e.summary ?? "(sem título)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location,
    description: e.description,
    link: e.hangoutLink,
    attendees: e.attendees?.filter((a) => !a.self).map((a) => a.displayName || a.email),
  };
}

export async function listUpcomingEvents(token: string, max = 5): Promise<CalEvent[]> {
  const now = new Date().toISOString();
  const data = await gapi<CalListResp>(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${max}&timeMin=${encodeURIComponent(now)}&singleEvents=true&orderBy=startTime`,
  );
  return (data.items ?? []).map(toCalEvent);
}

/** Eventos que começam entre agora e `windowMinutes` à frente (a janela do aviso pré-reunião). */
export async function listEventsStartingWithin(token: string, windowMinutes: number, max = 20): Promise<CalEvent[]> {
  const now = new Date();
  const until = new Date(now.getTime() + windowMinutes * 60_000);
  const data = await gapi<CalListResp>(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${max}` +
      `&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(until.toISOString())}` +
      `&singleEvents=true&orderBy=startTime`,
  );
  return (data.items ?? []).map(toCalEvent);
}

/** Um evento como a TELA da agenda precisa (Visão geral, Reuniões): link para abrir e para entrar. */
export interface EventoDaAgenda {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local?: string;
  pessoas: string[];
  /** onde abrir o evento no provedor */
  abrir?: string;
  /** link da chamada (Meet, ou Zoom/Teams colado no evento) */
  entrar?: string;
}

interface CalItemTela {
  id: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email: string; displayName?: string; self?: boolean; responseStatus?: string }[];
}

/** Eventos entre dois instantes, com os links da tela. Recusados pelo dono e cancelados ficam de fora. */
export async function listarEventosEntre(token: string, de: Date, ate: Date, max = 50): Promise<EventoDaAgenda[]> {
  const data = await gapi<{ items?: CalItemTela[] }>(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${max}` +
      `&timeMin=${encodeURIComponent(de.toISOString())}&timeMax=${encodeURIComponent(ate.toISOString())}` +
      `&singleEvents=true&orderBy=startTime`,
  );
  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled" && e.attendees?.find((a) => a.self)?.responseStatus !== "declined")
    .map((e) => ({
      id: e.id,
      titulo: e.summary?.trim() || "(sem título)",
      inicio: e.start?.dateTime ?? e.start?.date ?? "",
      fim: e.end?.dateTime ?? e.end?.date ?? "",
      diaInteiro: !e.start?.dateTime,
      local: e.location || undefined,
      pessoas: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.displayName || a.email),
      abrir: e.htmlLink,
      entrar: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri,
    }));
}

export async function createEvent(
  token: string,
  input: { summary: string; startISO: string; endISO: string; description?: string; location?: string },
): Promise<{ id: string; htmlLink: string }> {
  return gapi(token, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startISO },
      end: { dateTime: input.endISO },
    }),
  });
}
