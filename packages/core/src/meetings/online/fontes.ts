import { falasDoVtt, juntarFalas, textoDasFalas, type Fala } from "./vtt";

/**
 * De onde vêm as transcrições das reuniões online. Cada fonte lista o que
 * existe desde uma data e sabe baixar o texto de uma; o título e o texto são
 * preguiçosos porque custam chamadas, e só valem a pena para o que é NOVO.
 *
 * Limite comum às três, e é do provedor, não nosso: só existe transcrição de
 * reunião em que alguém ligou a transcrição (ou a gravação na nuvem, no Zoom),
 * e a API entrega a do ORGANIZADOR. Reunião de outra pessoa que você só
 * assistiu fica na conta dela.
 */

export interface Gravacao {
  externalId: string;
  inicio: Date | null;
  titulo: () => Promise<string>;
  baixar: () => Promise<string>;
}

async function pedir<T>(url: string, token: string, rotulo: string, aceitar = "application/json"): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: aceitar }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${rotulo} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (aceitar === "application/json" ? res.json() : res.text()) as Promise<T>;
}

// ── Google Meet (Meet REST API v2) ──

const MEET = "https://meet.googleapis.com/v2";

interface RegistroMeet { name: string; startTime?: string; endTime?: string; space?: string }
interface TranscricaoMeet { name: string; state?: string; startTime?: string }
interface EntradaMeet { participant?: string; text?: string }
interface ParticipanteMeet { signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } }

/**
 * O Meet não dá título à reunião: o título mora no evento da agenda. Casa pelo
 * código da sala ("abc-defg-hij") dentro do link do evento que começa perto.
 */
async function tituloDoMeet(token: string, r: RegistroMeet): Promise<string | null> {
  if (!r.space || !r.startTime) return null;
  const sala = await pedir<{ meetingCode?: string }>(`${MEET}/${r.space}`, token, "Meet");
  if (!sala.meetingCode) return null;
  const inicio = new Date(r.startTime).getTime();
  const q = `timeMin=${encodeURIComponent(new Date(inicio - 3 * 3_600_000).toISOString())}&timeMax=${encodeURIComponent(new Date(inicio + 3_600_000).toISOString())}`;
  const ev = await pedir<{ items?: { summary?: string; hangoutLink?: string; conferenceData?: { conferenceId?: string } }[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=50&${q}`,
    token,
    "Agenda",
  );
  const achado = (ev.items ?? []).find((e) => e.conferenceData?.conferenceId === sala.meetingCode || e.hangoutLink?.includes(sala.meetingCode!));
  return achado?.summary?.trim() || null;
}

async function textoDoMeet(token: string, transcricao: string, maxPaginas: number): Promise<string> {
  const nomes = new Map<string, string | null>();
  const falas: Fala[] = [];
  let pagina: string | undefined;
  let n = 0;
  do {
    const r = await pedir<{ transcriptEntries?: EntradaMeet[]; nextPageToken?: string }>(
      `${MEET}/${transcricao}/entries?pageSize=100${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`,
      token,
      "Meet",
    );
    for (const e of r.transcriptEntries ?? []) {
      if (!e.text?.trim()) continue;
      let quem: string | null = null;
      if (e.participant) {
        if (!nomes.has(e.participant)) {
          const p = await pedir<ParticipanteMeet>(`${MEET}/${e.participant}`, token, "Meet").catch(() => ({}) as ParticipanteMeet);
          nomes.set(e.participant, p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? null);
        }
        quem = nomes.get(e.participant) ?? null;
      }
      falas.push({ quem, texto: e.text.trim() });
    }
    pagina = r.nextPageToken;
  } while (pagina && ++n < maxPaginas);
  return textoDasFalas(juntarFalas(falas));
}

/** Páginas lidas de uma listagem (Meet, Graph, Zoom): a janela é de dias, então poucas bastam. */
const MAX_PAGINAS_LISTA = 4;

export async function gravacoesDoMeet(token: string, desde: Date, opts: { maxPaginas: number; nomeReserva: (d: Date | null) => string }): Promise<Gravacao[]> {
  const filtro = encodeURIComponent(`end_time>="${desde.toISOString()}"`);
  // a lista vem da mais NOVA para a mais velha: sem seguir as páginas, a 26ª
  // reunião da janela nunca seria vista
  const registros: RegistroMeet[] = [];
  let pagina: string | undefined;
  let n = 0;
  do {
    const r = await pedir<{ conferenceRecords?: RegistroMeet[]; nextPageToken?: string }>(
      `${MEET}/conferenceRecords?pageSize=25&filter=${filtro}${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`,
      token,
      "Meet",
    );
    registros.push(...(r.conferenceRecords ?? []));
    pagina = r.nextPageToken;
  } while (pagina && ++n < MAX_PAGINAS_LISTA);

  const out: Gravacao[] = [];
  for (const reg of registros) {
    const t = await pedir<{ transcripts?: TranscricaoMeet[] }>(`${MEET}/${reg.name}/transcripts`, token, "Meet");
    for (const tr of t.transcripts ?? []) {
      // ainda transcrevendo: pega na próxima volta, inteira
      if (tr.state === "STARTED") continue;
      const quando = tr.startTime ?? reg.startTime;
      const inicio = quando ? new Date(quando) : null;
      out.push({
        externalId: tr.name,
        inicio,
        titulo: async () => (await tituloDoMeet(token, reg).catch(() => null)) ?? opts.nomeReserva(inicio),
        baixar: () => textoDoMeet(token, tr.name, opts.maxPaginas),
      });
    }
  }
  return out;
}

// ── Microsoft Teams (Graph, com o login DELEGADO do dono) ──

const GRAPH = "https://graph.microsoft.com/v1.0";

interface EventoOutlook { subject?: string; start?: { dateTime?: string }; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl?: string } | null }
interface TranscricaoTeams { id: string; createdDateTime?: string }

/** Lista do Graph inteira (até o teto), seguindo o `@odata.nextLink`. */
async function paginasDoGraph<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let proxima: string | undefined = url;
  for (let n = 0; proxima && n < MAX_PAGINAS_LISTA; n++) {
    const r: { value?: T[]; "@odata.nextLink"?: string } = await pedir(proxima, token, "Microsoft Graph");
    out.push(...(r.value ?? []));
    // o próximo link é do próprio Graph; qualquer outro domínio é recusado
    const link = r["@odata.nextLink"];
    proxima = link?.startsWith(`${GRAPH}/`) ? link : undefined;
  }
  return out;
}

/** A legenda da transcrição. Com a identificação de quem fala desligada no tenant, o VTT volta 403: pede sem o formato. */
async function vttDoTeams(token: string, meetingId: string, transcricaoId: string): Promise<string> {
  const base = `${GRAPH}/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcricaoId)}/content`;
  try {
    return await pedir<string>(`${base}?$format=text/vtt`, token, "Microsoft Graph", "text/vtt");
  } catch (e) {
    if (!(e instanceof Error) || !/SpeakerAttribution|\b403\b/.test(e.message)) throw e;
    return pedir<string>(base, token, "Microsoft Graph", "text/vtt");
  }
}

/**
 * O caminho que aceita o login delegado. `getAllTranscripts` seria uma
 * chamada só, mas a Microsoft NÃO a aceita com permissão delegada (só de
 * aplicativo, com política do administrador): foi o primeiro desenho e nunca
 * funcionaria (auditoria de 27/09/2026). Aqui: os eventos online da agenda do
 * período → a reunião pelo link de entrada → as transcrições dela.
 */
export async function gravacoesDoTeams(token: string, desde: Date, ate: Date, opts: { nomeReserva: (d: Date | null) => string }): Promise<Gravacao[]> {
  const eventos = await paginasDoGraph<EventoOutlook>(
    `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(desde.toISOString())}&endDateTime=${encodeURIComponent(ate.toISOString())}&$select=subject,start,isOnlineMeeting,onlineMeeting&$top=50`,
    token,
  );
  const out: Gravacao[] = [];
  let recusa: Error | null = null;
  for (const ev of eventos) {
    const link = ev.isOnlineMeeting ? ev.onlineMeeting?.joinUrl : undefined;
    if (!link) continue;
    try {
      const filtro = encodeURIComponent(`JoinWebUrl eq '${link.replace(/'/g, "''")}'`);
      const reunioes = await pedir<{ value?: { id: string; subject?: string }[] }>(`${GRAPH}/me/onlineMeetings?$filter=${filtro}`, token, "Microsoft Graph");
      for (const r of reunioes.value ?? []) {
        const transcricoes = await pedir<{ value?: TranscricaoTeams[] }>(`${GRAPH}/me/onlineMeetings/${encodeURIComponent(r.id)}/transcripts`, token, "Microsoft Graph");
        for (const t of transcricoes.value ?? []) {
          const inicio = t.createdDateTime ? new Date(t.createdDateTime) : ev.start?.dateTime ? new Date(`${ev.start.dateTime}Z`) : null;
          const assunto = ev.subject?.trim() || r.subject?.trim();
          out.push({
            externalId: t.id,
            inicio,
            titulo: async () => assunto || opts.nomeReserva(inicio),
            baixar: async () => textoDasFalas(falasDoVtt(await vttDoTeams(token, r.id, t.id))),
          });
        }
      }
    } catch (e) {
      // reunião de OUTRA pessoa (o dono só foi convidado) volta 403/404: pula.
      // Mas se nada deu certo e houve recusa, é permissão faltando, e quem
      // chama precisa saber (vira "sem permissão", não silêncio)
      if (e instanceof Error && /\b(401|403)\b/.test(e.message)) recusa ??= e;
    }
  }
  if (!out.length && recusa) throw recusa;
  return out;
}

// ── Zoom (gravação na nuvem com transcrição de áudio) ──

interface ArquivoZoom { id?: string; file_type?: string; status?: string; download_url?: string }
interface ReuniaoZoom { topic?: string; start_time?: string; recording_files?: ArquivoZoom[] }

export async function gravacoesDoZoom(token: string, desde: Date, ate: Date): Promise<Gravacao[]> {
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  // o Zoom recusa período de mais de um mês
  const de = new Date(Math.max(desde.getTime(), ate.getTime() - 30 * 86_400_000));
  const reunioes: ReuniaoZoom[] = [];
  let pagina = "";
  let n = 0;
  do {
    const r = await pedir<{ meetings?: ReuniaoZoom[]; next_page_token?: string }>(
      `https://api.zoom.us/v2/users/me/recordings?page_size=30&from=${dia(de)}&to=${dia(ate)}${pagina ? `&next_page_token=${encodeURIComponent(pagina)}` : ""}`,
      token,
      "Zoom",
    );
    reunioes.push(...(r.meetings ?? []));
    pagina = r.next_page_token ?? "";
  } while (pagina && ++n < MAX_PAGINAS_LISTA);

  const out: Gravacao[] = [];
  for (const m of reunioes) {
    for (const f of m.recording_files ?? []) {
      if (f.file_type !== "TRANSCRIPT" || f.status !== "completed" || !f.id || !f.download_url) continue;
      const inicio = m.start_time ? new Date(m.start_time) : null;
      if (inicio && inicio < desde) continue;
      const url = f.download_url;
      // o link de download é do Zoom; outro domínio não recebe o token do dono
      if (!/^https:\/\/([a-z0-9-]+\.)*zoom\.us\//.test(url)) continue;
      out.push({
        externalId: f.id,
        inicio,
        titulo: async () => m.topic?.trim() || "Reunião do Zoom",
        baixar: async () => textoDasFalas(falasDoVtt(await pedir<string>(url, token, "Zoom", "text/vtt"))),
      });
    }
  }
  return out;
}
