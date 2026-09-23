/** Cliente REST do Microsoft Graph (Teams + Outlook). Recebe um access token válido. */
import { settings } from "../settings";

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
  const campos = "$select=id,subject,bodyPreview,receivedDateTime,from";
  const path = busca?.trim()
    ? `/me/messages?$top=${max}&${campos}&$search=${encodeURIComponent(`"${busca.trim()}"`)}`
    : `/me/mailFolders/inbox/messages?$top=${max}&${campos}&$orderby=receivedDateTime desc`;
  const r = await graph<GraphList<GraphMessage>>(token, path, busca?.trim() ? { headers: { ConsistencyLevel: "eventual" } } : undefined);
  return r.value.map(paraEmail);
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
