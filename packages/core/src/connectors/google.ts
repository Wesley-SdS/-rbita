import { decodificarEntidades } from "../texto/entidades";

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

export interface EmailSummary { id: string; from: string; subject: string; date: string; snippet: string }

export async function listRecentEmails(token: string, max = 5, query = "in:inbox"): Promise<EmailSummary[]> {
  const list = await gapi<GmailListResp>(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: EmailSummary[] = [];
  for (const mid of ids) {
    const msg = await gapi<GmailMsg>(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    out.push({ id: msg.id, from: h("from"), subject: h("subject"), date: h("date"), snippet: decodificarEntidades(msg.snippet ?? "") });
  }
  return out;
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
