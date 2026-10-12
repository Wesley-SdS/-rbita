/** Cliente REST do Microsoft Graph (Teams + Outlook). Recebe um access token válido. */
import { settings } from "../settings";
import type { EventoDaAgenda } from "./google";
import { nomesDeAnexoParaOModelo } from "../texto/dado-externo";

/**
 * O fuso que o Graph exige separado do horário.
 *
 * Não é constante: quem muda de estado ou viaja não deveria precisar de um
 * dev (§5.6). Lido por chamada, com o cache curto do `settings`, então trocar
 * na tela vale no próximo evento sem reiniciar nada.
 */
async function fuso(): Promise<string> {
  return settings.get("connectors.fusoHorario");
}

async function graph<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TeamsTeam { id: string; name: string }
export interface TeamsChannel { id: string; name: string }
export interface TeamsChat { id: string; topic: string | null }

interface GraphList<T> { value: T[] }

export async function listJoinedTeams(token: string): Promise<TeamsTeam[]> {
  const r = await graph<GraphList<{ id: string; displayName: string }>>(token, "/me/joinedTeams");
  return r.value.map((t) => ({ id: t.id, name: t.displayName }));
}

export async function listChannels(token: string, teamId: string): Promise<TeamsChannel[]> {
  const r = await graph<GraphList<{ id: string; displayName: string }>>(token, `/teams/${encodeURIComponent(teamId)}/channels`);
  return r.value.map((c) => ({ id: c.id, name: c.displayName }));
}

/** Chats 1:1 e em grupo (não canais de equipe). */
export async function listChats(token: string): Promise<TeamsChat[]> {
  const r = await graph<GraphList<{ id: string; topic: string | null }>>(token, "/me/chats?$top=20");
  return r.value.map((c) => ({ id: c.id, topic: c.topic }));
}

/** Posta uma mensagem num canal de equipe. Chamar só após confirmação explícita. */
export async function postChannelMessage(token: string, teamId: string, channelId: string, text: string): Promise<{ id: string }> {
  const r = await graph<{ id: string }>(token, `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: { content: text } }),
  });
  return { id: r.id };
}

/** Posta uma mensagem num chat (1:1 ou grupo). Chamar só após confirmação explícita. */
export async function postChatMessage(token: string, chatId: string, text: string): Promise<{ id: string }> {
  const r = await graph<{ id: string }>(token, `/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: { content: text } }),
  });
  return { id: r.id };
}

/* --- Outlook: e-mail e agenda ------------------------------------------- */
/**
 * Mesmas FORMAS do cliente do Google (`EmailSummary`, `CalEvent`), de
 * propósito: as tools de Outlook e de Gmail devolvem a mesma coisa, então o
 * modelo não precisa aprender dois formatos e a tela não precisa de dois
 * componentes. O que muda é o serviço, não o vocabulário.
 */

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  tem_anexo?: boolean;
  anexos?: string[];
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

interface GraphMessage {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

function paraEmail(m: GraphMessage): EmailSummary {
  const e = m.from?.emailAddress;
  return {
    id: m.id,
    from: e?.name ? `${e.name} <${e.address ?? ""}>` : e?.address ?? "(desconhecido)",
    subject: m.subject?.trim() || "(sem assunto)",
    date: m.receivedDateTime ?? "",
    snippet: (m.bodyPreview ?? "").trim().slice(0, 300),
  };
}

/**
 * E-mails recentes da caixa de entrada.
 *
 * `$search` do Graph exige o cabeçalho `ConsistencyLevel: eventual` e NÃO
 * aceita `$orderby` junto (o Graph devolve 400). Por isso a busca vem sem
 * ordenação e a listagem normal vem ordenada: são dois caminhos, não um com
 * um parâmetro a mais.
 */
export async function listRecentMessages(token: string, max = 5, busca?: string): Promise<EmailSummary[]> {
  // os nomes dos anexos vêm junto (`$expand` só com nome e se é embutido, nunca o conteúdo)
  const campos = "$select=id,subject,bodyPreview,receivedDateTime,from,hasAttachments&$expand=attachments($select=name,isInline)";
  const path = busca?.trim()
    ? `/me/messages?$top=${max}&${campos}&$search=${encodeURIComponent(`"${busca.trim()}"`)}`
    : `/me/mailFolders/inbox/messages?$top=${max}&${campos}&$orderby=receivedDateTime desc`;
  const r = await graph<GraphList<GraphMessage & { hasAttachments?: boolean; attachments?: { name?: string; isInline?: boolean }[] }>>(token, path, busca?.trim() ? { headers: { ConsistencyLevel: "eventual" } } : undefined);
  return r.value.map((m) => {
    const nomes = (m.attachments ?? []).filter((a) => !a.isInline && a.name).map((a) => a.name!);
    // o nome do anexo é escolha de quem mandou: vai embrulhado como dado (I2 da auditoria)
    return { ...paraEmail(m), tem_anexo: Boolean(m.hasAttachments) || nomes.length > 0, anexos: nomesDeAnexoParaOModelo(nomes) };
  });
}

/* --- Outlook: o e-mail inteiro e os anexos (C1, C2) ------------------------ */

export interface AnexoDoOutlook {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  embutido: boolean;
  /** e-mail ou evento anexado (o Graph entrega o MIME dele em `$value`) */
  item: boolean;
  /** anexo que é LINK para um documento no OneDrive/SharePoint: listado, não baixado (C6) */
  link: string | null;
  /**
   * É um `referenceAttachment` (link do OneDrive), com ou sem a URL. Decidido pelo
   * `@odata.type`, ANTES de qualquer download: o `/$value` dele falha com erro do
   * Graph, e a URL (`sourceUrl`) só existe no endpoint beta (I15).
   */
  referencia: boolean;
}

export interface MensagemCompletaDoOutlook {
  id: string;
  de: string;
  para: string[];
  cc: string[];
  data: string;
  assunto: string;
  textoPuro: string;
  html: string;
  anexos: AnexoDoOutlook[];
  link: string | null;
  autenticacao?: string;
}

interface GraphAnexo {
  "@odata.type"?: string;
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  sourceUrl?: string;
}

const pessoaDoGraph = (r?: { emailAddress?: { name?: string; address?: string } }) => {
  const e = r?.emailAddress;
  return e?.name && e.address ? `${e.name} <${e.address}>` : e?.address ?? e?.name ?? "";
};

/** Anexos de uma mensagem do Graph na forma da Órbita. PURO. */
export function anexosDoGraph(lista: GraphAnexo[]): AnexoDoOutlook[] {
  return lista.map((a) => {
    const tipo = (a["@odata.type"] ?? "").toLowerCase();
    return {
      id: a.id,
      nome: a.name?.trim() || "anexo",
      tipo: (a.contentType ?? (tipo.includes("itemattachment") ? "message/rfc822" : "application/octet-stream")).toLowerCase(),
      tamanho: a.size ?? 0,
      embutido: Boolean(a.isInline),
      item: tipo.includes("itemattachment"),
      link: tipo.includes("referenceattachment") ? a.sourceUrl ?? null : null,
      referencia: tipo.includes("referenceattachment"),
    };
  });
}

/**
 * Lê UM e-mail inteiro do Outlook. O corpo vem em HTML (como foi escrito) e é
 * convertido aqui mesmo, sem recurso remoto: pedir texto ao Graph
 * (`outlook.body-content-type="text"`) perderia os links, e é deles que sai a
 * lista de documentos compartilhados.
 */
export async function lerMensagemCompletaOutlook(token: string, id: string): Promise<MensagemCompletaDoOutlook> {
  const m = await graph<GraphMessage & { body?: { contentType?: string; content?: string }; toRecipients?: { emailAddress?: { name?: string; address?: string } }[]; ccRecipients?: { emailAddress?: { name?: string; address?: string } }[]; webLink?: string; internetMessageHeaders?: { name: string; value: string }[] }>(
    token,
    `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,webLink,internetMessageHeaders`,
  );
  const anexos = await graph<GraphList<GraphAnexo>>(token, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`);
  const lista = await comUrlDasReferencias(token, id, anexosDoGraph(anexos.value));
  const ehHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
  return {
    id: m.id,
    de: pessoaDoGraph(m.from),
    para: (m.toRecipients ?? []).map(pessoaDoGraph).filter(Boolean),
    cc: (m.ccRecipients ?? []).map(pessoaDoGraph).filter(Boolean),
    data: m.receivedDateTime ?? "",
    assunto: m.subject?.trim() || "(sem assunto)",
    textoPuro: ehHtml ? "" : m.body?.content ?? "",
    html: ehHtml ? m.body?.content ?? "" : "",
    anexos: lista,
    link: m.webLink ?? null,
    // só o PRIMEIRO: é o que o Exchange escreveu ao receber; os de baixo podem ter vindo do remetente
    autenticacao: (m.internetMessageHeaders ?? []).find((h) => h.name.toLowerCase() === "authentication-results")?.value ?? "",
  };
}

/**
 * A URL de cada anexo que é link (`referenceAttachment`). O `sourceUrl` existe
 * só no Graph BETA: o v1.0 nem devolve o campo. LIMITE assumido: o beta pode
 * mudar sem aviso; se a chamada falhar, o anexo continua marcado como link (e
 * nunca é baixado) e o dono abre pelo próprio e-mail no Outlook. Uma chamada por
 * anexo-link, e só quando há algum (o caso comum não paga nada a mais).
 */
async function comUrlDasReferencias(token: string, mensagemId: string, anexos: AnexoDoOutlook[]): Promise<AnexoDoOutlook[]> {
  return Promise.all(
    anexos.map(async (a) => {
      if (!a.referencia || a.link) return a;
      try {
        const res = await fetch(`https://graph.microsoft.com/beta/me/messages/${encodeURIComponent(mensagemId)}/attachments/${encodeURIComponent(a.id)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return a;
        const j = (await res.json()) as { sourceUrl?: string };
        return typeof j.sourceUrl === "string" && /^https:\/\//i.test(j.sourceUrl) ? { ...a, link: j.sourceUrl.slice(0, 2048) } : a;
      } catch {
        return a;
      }
    }),
  );
}

/**
 * O `sendMail` do Graph aceita anexo embutido só até 3 MB (o pedido inteiro
 * para em 4 MB). Acima disso o Graph exige sessão de upload num rascunho; aqui
 * a recusa é dita antes de propor, para o dono não aprovar um envio que falha.
 */
export const OUTLOOK_ANEXO_MAX_BYTES = 3 * 1024 * 1024;

/** Manda um e-mail com UM arquivo anexado pelo Outlook. Chamar só depois da aprovação. */
export async function enviarEmailComAnexoOutlook(token: string, para: string, assunto: string, corpo: string, anexo: { nome: string; mime: string; bytes: Buffer }): Promise<void> {
  if (anexo.bytes.length > OUTLOOK_ANEXO_MAX_BYTES) throw new Error("O Outlook manda por aqui anexo de até 3 MB.");
  await graph<void>(token, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        ...corpoDeMensagem(para, assunto, corpo),
        attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: anexo.nome, contentType: anexo.mime, contentBytes: anexo.bytes.toString("base64") }],
      },
      saveToSentItems: true,
    }),
  });
}

/** Os bytes de um anexo. E-mail anexado vem como o MIME dele (EML), que o extrator lê. */
export async function baixarAnexoOutlook(token: string, mensagemId: string, anexoId: string): Promise<{ bytes: Buffer; anexo: AnexoDoOutlook }> {
  const lista = await graph<GraphList<GraphAnexo>>(token, `/me/messages/${encodeURIComponent(mensagemId)}/attachments?$select=id,name,contentType,size,isInline`);
  const anexo = anexosDoGraph(lista.value).find((a) => a.id === anexoId);
  if (!anexo) throw new Error("Esse anexo não está mais no e-mail.");
  // o tipo decide, não a URL: referência sem `sourceUrl` (v1.0) também não tem `/$value`
  if (anexo.referencia || anexo.link) throw new Error("Esse anexo é um link para um documento compartilhado: abra pelo link (ou pelo e-mail no Outlook).");
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(mensagemId)}/attachments/${encodeURIComponent(anexoId)}/$value`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), anexo: anexo.item ? { ...anexo, tipo: "message/rfc822", nome: /\.(eml|msg)$/i.test(anexo.nome) ? anexo.nome : `${anexo.nome}.eml` } : anexo };
}

interface GraphMensagemDaCaixa extends GraphMessage {
  webLink?: string;
  inferenceClassification?: "focused" | "other";
  internetMessageHeaders?: { name: string; value: string }[];
}

export interface MensagemDoOutlook {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  recebidaEm: Date;
  webLink: string | null;
  outros: boolean;
  listUnsubscribe: boolean;
  authResults: string;
}

/** A caixa de entrada desde um instante, da mais antiga para a mais nova (a mesma regra do Gmail). */
export async function listarCaixaDesde(token: string, desde: Date, max = 25): Promise<MensagemDoOutlook[]> {
  const campos = "$select=id,subject,bodyPreview,receivedDateTime,from,webLink,inferenceClassification,internetMessageHeaders";
  const filtro = `$filter=${encodeURIComponent(`receivedDateTime ge ${desde.toISOString()}`)}`;
  const r = await graph<GraphList<GraphMensagemDaCaixa>>(token, `/me/mailFolders/inbox/messages?$top=${max}&${campos}&${filtro}&$orderby=receivedDateTime asc`);
  return r.value.map((m) => {
    const base = paraEmail(m);
    const hs = m.internetMessageHeaders ?? [];
    const h = (n: string) => hs.filter((x) => x.name.toLowerCase() === n).map((x) => x.value);
    return {
      id: base.id,
      from: base.from,
      subject: base.subject,
      snippet: base.snippet,
      recebidaEm: new Date(base.date || Date.now()),
      webLink: m.webLink ?? null,
      outros: m.inferenceClassification === "other",
      listUnsubscribe: h("list-unsubscribe").length > 0,
      authResults: h("authentication-results").join("; "),
    };
  });
}

function corpoDeMensagem(to: string, subject: string, body: string) {
  return {
    subject,
    body: { contentType: "Text", content: body },
    toRecipients: to
      .split(/[,;]/)
      .map((e) => e.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } })),
  };
}

/** Cria um rascunho no Outlook (não envia). */
export async function createDraftMail(token: string, to: string, subject: string, body: string): Promise<{ id: string }> {
  const r = await graph<{ id: string }>(token, "/me/messages", { method: "POST", body: JSON.stringify(corpoDeMensagem(to, subject, body)) });
  return { id: r.id };
}

/** Envia um e-mail pelo Outlook. Chamar só após confirmação explícita (gate humano, §5.1). */
export async function sendMail(token: string, to: string, subject: string, body: string): Promise<{ id: string }> {
  // `/me/sendMail` responde 202 sem corpo: não há id para devolver, e inventar
  // um seria pior do que admitir que o provedor não dá.
  await graph<void>(token, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({ message: corpoDeMensagem(to, subject, body), saveToSentItems: true }),
  });
  return { id: "enviado" };
}

interface GraphEvent {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  webLink?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { emailAddress?: { name?: string; address?: string }; type?: string }[];
  isOrganizer?: boolean;
}

function paraEvento(e: GraphEvent): CalEvent {
  return {
    id: e.id,
    summary: e.subject?.trim() || "(sem título)",
    start: e.start?.dateTime ?? "",
    end: e.end?.dateTime ?? "",
    location: e.location?.displayName,
    description: e.bodyPreview ?? undefined,
    link: e.webLink,
    attendees: e.attendees?.map((a) => a.emailAddress?.name || a.emailAddress?.address || "").filter(Boolean),
  };
}

/**
 * Próximos eventos da agenda do Outlook.
 *
 * `calendarView` em vez de `/me/events`: só ele EXPANDE série repetida em
 * ocorrências. Com `/me/events`, uma reunião semanal apareceria uma vez, com a
 * data da primeira ocorrência, e "o que tenho amanhã" daria errado.
 */
export async function listUpcomingEvents(token: string, max = 5): Promise<CalEvent[]> {
  const agora = new Date();
  const fim = new Date(agora.getTime() + 30 * 24 * 3600 * 1000);
  const path =
    `/me/calendarView?startDateTime=${agora.toISOString()}&endDateTime=${fim.toISOString()}` +
    `&$top=${max}&$orderby=start/dateTime&$select=id,subject,bodyPreview,webLink,location,start,end,attendees`;
  const r = await graph<GraphList<GraphEvent>>(token, path, { headers: { Prefer: `outlook.timezone="${await fuso()}"` } });
  return r.value.map(paraEvento);
}

/**
 * Eventos entre dois instantes, para a TELA. Em UTC (com "Z" acrescentado):
 * o Graph devolve o horário sem fuso, e misturar com a agenda do Google exige
 * um instante de verdade para ordenar.
 */
export async function listarEventosEntre(token: string, de: Date, ate: Date, max = 50): Promise<EventoDaAgenda[]> {
  const path =
    `/me/calendarView?startDateTime=${de.toISOString()}&endDateTime=${ate.toISOString()}` +
    `&$top=${max}&$orderby=start/dateTime&$select=id,subject,webLink,location,start,end,attendees,isAllDay,isCancelled,onlineMeeting,responseStatus`;
  const r = await graph<GraphList<GraphEvent & { isAllDay?: boolean; isCancelled?: boolean; onlineMeeting?: { joinUrl?: string } | null; responseStatus?: { response?: string } }>>(
    token, path, { headers: { Prefer: 'outlook.timezone="UTC"' } },
  );
  const utc = (t?: string) => (t ? (/(?:[zZ]|[+-]\d\d:\d\d)$/.test(t) ? t : `${t.replace(/\.\d+$/, "")}Z`) : "");
  return r.value
    .filter((e) => !e.isCancelled && e.responseStatus?.response !== "declined")
    .map((e) => ({
      id: e.id,
      titulo: e.subject?.trim() || "(sem título)",
      inicio: e.isAllDay ? utc(e.start?.dateTime).slice(0, 10) : utc(e.start?.dateTime),
      fim: e.isAllDay ? utc(e.end?.dateTime).slice(0, 10) : utc(e.end?.dateTime),
      diaInteiro: !!e.isAllDay,
      local: e.location?.displayName || undefined,
      pessoas: (e.attendees ?? []).map((a) => a.emailAddress?.name || a.emailAddress?.address || "").filter(Boolean),
      abrir: e.webLink,
      entrar: e.onlineMeeting?.joinUrl ?? undefined,
    }));
}

/** Cria um evento na agenda do Outlook. Chamar só após confirmação explícita. */
export async function createCalendarEvent(
  token: string,
  ev: { summary: string; startISO: string; endISO: string; description?: string; location?: string },
): Promise<CalEvent> {
  const tz = await fuso();
  const r = await graph<GraphEvent>(token, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: ev.summary,
      body: ev.description ? { contentType: "Text", content: ev.description } : undefined,
      // o Graph exige o fuso separado do horário; o ISO já traz o deslocamento,
      // e mandar os dois faria o evento cair na hora errada
      start: { dateTime: ev.startISO, timeZone: tz },
      end: { dateTime: ev.endISO, timeZone: tz },
      location: ev.location ? { displayName: ev.location } : undefined,
    }),
  });
  return paraEvento(r);
}
