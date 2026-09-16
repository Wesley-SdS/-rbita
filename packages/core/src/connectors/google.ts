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
    out.push({ id: msg.id, from: h("from"), subject: h("subject"), date: h("date"), snippet: msg.snippet });
  }
  return out;
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
  items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }[];
}
export interface CalEvent { id: string; summary: string; start: string; end: string; location?: string }

export async function listUpcomingEvents(token: string, max = 5): Promise<CalEvent[]> {
  const now = new Date().toISOString();
  const data = await gapi<CalListResp>(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${max}&timeMin=${encodeURIComponent(now)}&singleEvents=true&orderBy=startTime`,
  );
  return (data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? "(sem título)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location,
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
