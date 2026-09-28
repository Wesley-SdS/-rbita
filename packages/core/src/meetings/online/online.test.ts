import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reunião online vira resumo sozinha (27/09/2026, refeito na auditoria do
 * mesmo dia). O que fica travado:
 *   - a legenda do Teams e a do Zoom viram "Nome: fala", juntando as falas seguidas;
 *   - o título do Meet vem do evento da agenda (o Meet não tem título);
 *   - o Teams sai da AGENDA (evento online → reunião pelo link → transcrições),
 *     porque a listagem direta não aceita o login delegado;
 *   - a mesma transcrição nunca é resumida duas vezes;
 *   - falha vira tentativa com espera, e NÃO gasta a vaga das reuniões novas;
 *   - conta sem a permissão pede reconexão, não vira erro nem tentativa infinita.
 */

const cfg: Record<string, unknown> = {
  "meetings.importarMeet": true,
  "meetings.importarTeams": true,
  "meetings.importarZoom": true,
  "meetings.importarDias": 2,
  "meetings.importarMaxPorVolta": 3,
  "meetings.importarMinCaracteres": 20,
  "meetings.importarMaxPaginas": 10,
  "meetings.importarTentativas": 3,
  "meetings.importarEsperaMs": 8000,
  "connectors.fusoHorario": "America/Sao_Paulo",
};
vi.mock("../../settings", () => ({ settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) } }));
vi.mock("@orbita/db", () => ({ db: {} }));

// a memória do que foi importado, em memória (o SQL mora em registro.ts)
type Linha = { id: string; fonte: string; externalId: string; situacao: string; tentativas: number; proximaTentativa: Date | null; jobId?: string };
const linhas: Linha[] = [];
let proximoId = 0;
const reconciliar = vi.fn(async () => undefined);
vi.mock("./registro", () => ({
  registrosDaFonte: async (_u: string, fonte: string, ids: string[]) => linhas.filter((l) => l.fonte === fonte && ids.includes(l.externalId)),
  travar: async (_u: string, fonte: string, g: { externalId: string }, _t: string, curta: boolean) => {
    const ja = linhas.find((l) => l.fonte === fonte && l.externalId === g.externalId);
    if (ja && ja.situacao !== "falhou") return null;
    if (ja) {
      ja.situacao = curta ? "curta" : "resumindo";
      return ja.id;
    }
    const nova = { id: `l${++proximoId}`, fonte, externalId: g.externalId, situacao: curta ? "curta" : "resumindo", tentativas: 0, proximaTentativa: null };
    linhas.push(nova);
    return nova.id;
  },
  anotarTrabalho: async (id: string, jobId: string) => void (linhas.find((l) => l.id === id)!.jobId = jobId),
  registrarFalha: async (_u: string, fonte: string, g: { externalId: string }, _t: string, _e: string, max: number, agora: Date) => {
    let l = linhas.find((x) => x.fonte === fonte && x.externalId === g.externalId);
    if (!l) linhas.push((l = { id: `l${++proximoId}`, fonte, externalId: g.externalId, situacao: "falhou", tentativas: 0, proximaTentativa: null }));
    l.tentativas++;
    l.situacao = l.tentativas >= max ? "desistiu" : "falhou";
    l.proximaTentativa = new Date(agora.getTime() + 15 * 60_000);
  },
  reconciliar: (...a: unknown[]) => (reconciliar as (...x: unknown[]) => Promise<void>)(...a),
}));

type Conta = { conexao: { scope: string | null; accountLabel: string | null }; token: string };
const contas: Record<string, Conta[]> = { google: [], microsoft: [], zoom: [] };
vi.mock("../../connectors/store", () => ({
  tokensDeTodasAsContas: async (c: string) => contas[c] ?? [],
  usersConnected: async (c: string) => ((contas[c] ?? []).length ? ["u1"] : []),
}));
const enqueueJob = vi.fn(async (..._a: unknown[]) => ({ job: { id: "job-1" }, jaExistia: false }));
vi.mock("../../jobs/queue", () => ({ enqueueJob: (...a: unknown[]) => enqueueJob(...a) }));
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../../routines/run", () => ({ notifyUser: (...a: unknown[]) => notifyUser(...a) }));

const { falasDoVtt, textoDasFalas } = await import("./vtt");
const { gravacoesDoMeet, gravacoesDoTeams, gravacoesDoZoom } = await import("./fontes");
const { aTentar, esperaDaTentativa, importarDeTodos, importarReunioesOnline, temEscopo } = await import("./importar");
const { buscar_reunioes_online } = await import("../../tools/domains/reunioes");

const fetchOriginal = globalThis.fetch;
const rotas = (tabela: [RegExp, unknown][]) =>
  (globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
    const url = decodeURIComponent(String(u));
    const achada = tabela.find(([re]) => re.test(url));
    if (!achada) return new Response("não mapeado: " + url, { status: 404 });
    const [, corpo] = achada;
    if (corpo instanceof Response) return corpo.clone();
    return typeof corpo === "string" ? new Response(corpo) : Response.json(corpo);
  }) as typeof fetch);
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("legenda WebVTT", () => {
  it("Teams: <v Nome>, juntando as falas seguidas da mesma pessoa", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Wesley Santos>Bom dia.</v>\n\n2\n00:00:03.500 --> 00:00:05.000\n<v Wesley Santos>Vamos começar.</v>\n\n00:00:06.000 --> 00:00:08.000\n<v Lucas>Beleza.</v>\n";
    expect(textoDasFalas(falasDoVtt(vtt))).toBe("Wesley Santos: Bom dia. Vamos começar.\nLucas: Beleza.");
  });
  it("Zoom: 'Nome: texto'; frase com dois-pontos não vira pessoa; nome com abreviação vira", () => {
    const vtt =
      "WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:03.000\r\nAnna: Chego às oito.\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.000\r\nobservação importante. prazo: sexta\r\n\r\n3\r\n00:00:06.000 --> 00:00:07.000\r\nDr. João S. Lima: Pode ser.\r\n";
    expect(falasDoVtt(vtt)).toEqual([
      { quem: "Anna", texto: "Chego às oito." },
      { quem: null, texto: "observação importante. prazo: sexta" },
      { quem: "Dr. João S. Lima", texto: "Pode ser." },
    ]);
  });
});

describe("fontes", () => {
  it("Meet: título do evento da agenda, nomes dos participantes, pula a que ainda transcreve, segue as páginas", async () => {
    rotas([
      [/conferenceRecords\?.*pageToken=p2/, { conferenceRecords: [{ name: "conferenceRecords/r2", startTime: "2026-09-26T13:00:00Z" }] }],
      [/conferenceRecords\?/, { conferenceRecords: [{ name: "conferenceRecords/r1", startTime: "2026-09-27T13:00:00Z", space: "spaces/s1" }], nextPageToken: "p2" }],
      [/conferenceRecords\/r1\/transcripts$/, { transcripts: [{ name: "conferenceRecords/r1/transcripts/t1", state: "FILE_GENERATED" }, { name: "conferenceRecords/r1/transcripts/t2", state: "STARTED" }] }],
      [/conferenceRecords\/r2\/transcripts$/, { transcripts: [{ name: "conferenceRecords/r2/transcripts/t9", state: "ENDED" }] }],
      [/transcripts\/t1\/entries/, { transcriptEntries: [{ participant: "conferenceRecords/r1/participants/p1", text: "Fechamos o escopo." }, { participant: "conferenceRecords/r1/participants/p2", text: "Eu mando a proposta." }] }],
      [/participants\/p1$/, { signedinUser: { displayName: "Wesley" } }],
      [/participants\/p2$/, { anonymousUser: { displayName: "Cliente" } }],
      [/spaces\/s1$/, { meetingCode: "abc-defg-hij" }],
      [/calendar\/v3/, { items: [{ summary: "Kickoff Adalink", hangoutLink: "https://meet.google.com/abc-defg-hij" }] }],
    ]);
    const lista = await gravacoesDoMeet("tk", new Date("2026-09-26T00:00:00Z"), { maxPaginas: 5, nomeReserva: () => "reserva" });
    expect(lista.map((g) => g.externalId)).toEqual(["conferenceRecords/r1/transcripts/t1", "conferenceRecords/r2/transcripts/t9"]);
    expect(await lista[0].titulo()).toBe("Kickoff Adalink");
    expect(await lista[0].baixar()).toBe("Wesley: Fechamos o escopo.\nCliente: Eu mando a proposta.");
  });

  it("Teams: da agenda para a reunião pelo link, e dela para as transcrições", async () => {
    rotas([
      [/calendarView/, { value: [{ subject: "Daily", isOnlineMeeting: true, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" } }, { subject: "Almoço", isOnlineMeeting: false }] }],
      [/onlineMeetings\?\$filter=JoinWebUrl eq 'https:\/\/teams\.microsoft\.com\/l\/meetup-join\/abc'/, { value: [{ id: "mt1" }] }],
      [/onlineMeetings\/mt1\/transcripts\/tr1\/content/, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>Tudo certo.</v>\n"],
      [/onlineMeetings\/mt1\/transcripts$/, { value: [{ id: "tr1", createdDateTime: "2026-09-27T14:00:00Z" }] }],
    ]);
    const [g, ...resto] = await gravacoesDoTeams("tk", new Date("2026-09-26T00:00:00Z"), new Date("2026-09-28T00:00:00Z"), { nomeReserva: () => "reserva" });
    expect(resto).toHaveLength(0);
    expect(await g.titulo()).toBe("Daily");
    expect(await g.baixar()).toBe("Ana: Tudo certo.");
  });

  it("Teams: reunião de outra pessoa (403) é pulada; tudo recusado vira erro de permissão", async () => {
    rotas([
      [/calendarView/, { value: [{ subject: "De outro", isOnlineMeeting: true, onlineMeeting: { joinUrl: "https://teams/x" } }] }],
      [/onlineMeetings\?/, new Response("Forbidden", { status: 403 })],
    ]);
    await expect(gravacoesDoTeams("tk", new Date(), new Date(), { nomeReserva: () => "r" })).rejects.toThrow(/403/);
  });

  it("Zoom: só o arquivo de transcrição pronto, e só link do próprio Zoom", async () => {
    rotas([
      [/users\/me\/recordings/, {
        meetings: [{ topic: "1:1", start_time: "2026-09-27T15:00:00Z", recording_files: [{ id: "f0", file_type: "MP4", status: "completed", download_url: "https://zoom.us/rec/f0" }, { id: "f1", file_type: "TRANSCRIPT", status: "completed", download_url: "https://zoom.us/rec/f1" }, { id: "f2", file_type: "TRANSCRIPT", status: "processing", download_url: "https://zoom.us/rec/f2" }, { id: "f3", file_type: "TRANSCRIPT", status: "completed", download_url: "https://atacante.com/zoom.us/" }] }],
      }],
      [/zoom\.us\/rec\/f1/, "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nWesley: Combinado.\n"],
    ]);
    const lista = await gravacoesDoZoom("tk", new Date("2026-09-26T00:00:00Z"), new Date("2026-09-28T00:00:00Z"));
    expect(lista.map((g) => g.externalId)).toEqual(["f1"]);
    expect(await lista[0].baixar()).toBe("Wesley: Combinado.");
  });
});

describe("partes puras do importador", () => {
  it("escopo: confere quando o provedor diz; sem registro, tenta", () => {
    expect(temEscopo({ scope: "openid https://www.googleapis.com/auth/meetings.space.readonly" }, "meetings.space.readonly")).toBe(true);
    expect(temEscopo({ scope: "openid email" }, "meetings.space.readonly")).toBe(false);
    expect(temEscopo({ scope: null }, "x")).toBe(true);
  });
  it("a tentar: nem as já resolvidas nem a que falhou e ainda espera; da mais antiga para a mais nova", () => {
    const g = (id: string, h: number) => ({ externalId: id, inicio: new Date(Date.UTC(2026, 8, 27, h)), titulo: async () => id, baixar: async () => "" });
    const agora = new Date(Date.UTC(2026, 8, 27, 18));
    const regs = [
      { externalId: "b", situacao: "resumindo", proximaTentativa: null },
      { externalId: "d", situacao: "falhou", proximaTentativa: new Date(agora.getTime() + 60_000) },
      { externalId: "e", situacao: "falhou", proximaTentativa: new Date(agora.getTime() - 60_000) },
      { externalId: "f", situacao: "desistiu", proximaTentativa: null },
    ];
    expect(aTentar([g("c", 12), g("a", 9), g("b", 10), g("a", 9), g("d", 8), g("e", 7), g("f", 6)], regs, agora).map((x) => x.externalId)).toEqual(["e", "a", "c"]);
  });
  it("espera crescente entre tentativas", () => {
    expect([1, 2, 3].map(esperaDaTentativa)).toEqual([15 * 60_000, 30 * 60_000, 60 * 60_000]);
  });
});

describe("importar", () => {
  const meetUmaReuniao = (texto: string | Response) =>
    rotas([
      [/conferenceRecords\?/, { conferenceRecords: [{ name: "conferenceRecords/r1", startTime: "2026-09-27T13:00:00Z" }] }],
      [/conferenceRecords\/r1\/transcripts$/, { transcripts: [{ name: "conferenceRecords/r1/transcripts/t1", state: "ENDED", startTime: "2026-09-27T13:00:00Z" }] }],
      [/entries/, texto instanceof Response ? texto : { transcriptEntries: [{ text: texto }] }],
    ]);
  const agora = new Date("2026-09-27T18:00:00Z");

  beforeEach(() => {
    linhas.length = 0;
    enqueueJob.mockClear();
    notifyUser.mockClear();
    contas.google = [{ conexao: { scope: "https://www.googleapis.com/auth/meetings.space.readonly", accountLabel: "wesley@gmail.com" }, token: "tk" }];
    contas.microsoft = [];
    contas.zoom = [];
  });

  it("transcrição nova vai para a fila de resumo com o título e fica registrada; a segunda volta não repete", async () => {
    meetUmaReuniao("Fechamos o escopo e eu mando a proposta na sexta.");
    const r = await importarReunioesOnline("u1", agora);
    expect(r.importadas).toEqual(["Reunião do Meet de 27/09, 10:00 (Meet)"]);
    expect(enqueueJob).toHaveBeenCalledWith("u1", expect.objectContaining({ kind: "reuniao.resumir", input: "Fechamos o escopo e eu mando a proposta na sexta.", payload: { title: "Reunião do Meet de 27/09, 10:00 (Meet)" } }));
    expect(linhas[0]).toMatchObject({ fonte: "meet", externalId: "conferenceRecords/r1/transcripts/t1", jobId: "job-1" });
    expect(reconciliar).toHaveBeenCalled();

    expect((await importarReunioesOnline("u1", agora)).importadas).toEqual([]);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("transcrição curta fica registrada sem resumo", async () => {
    meetUmaReuniao("alô?");
    expect((await importarReunioesOnline("u1", agora)).curtas).toHaveLength(1);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("download que falha vira tentativa com espera, sem gastar a vaga; no teto, desiste", async () => {
    meetUmaReuniao(new Response("erro", { status: 500 }));
    const r = await importarReunioesOnline("u1", agora);
    expect(r.falhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ situacao: "falhou", tentativas: 1 });
    // ainda na espera: a volta seguinte nem tenta
    await importarReunioesOnline("u1", agora);
    expect(linhas[0].tentativas).toBe(1);
    // passou a espera: tenta de novo (e desiste no teto de 3)
    await importarReunioesOnline("u1", new Date(agora.getTime() + 20 * 60_000));
    await importarReunioesOnline("u1", new Date(agora.getTime() + 40 * 60_000));
    expect(linhas[0]).toMatchObject({ situacao: "desistiu", tentativas: 3 });
  });

  it("conta sem a permissão nova: pede reconexão, nem pergunta à API", async () => {
    contas.google = [{ conexao: { scope: "openid email", accountLabel: "wesley@gmail.com" }, token: "tk" }];
    globalThis.fetch = vi.fn() as never;
    expect((await importarReunioesOnline("u1", agora)).semPermissao).toEqual(["Meet (wesley@gmail.com)"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("403 da API (Meet API desligada no projeto) vira 'sem permissão', e o laço avisa o dono UMA vez", async () => {
    rotas([[/conferenceRecords/, new Response("Meet REST API has not been used in project", { status: 403 })]]);
    expect((await importarReunioesOnline("u1", agora)).semPermissao).toHaveLength(1);
    await importarDeTodos(agora);
    await importarDeTodos(agora);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser.mock.calls[0][2]).toContain("Reconecte a conta");
  });

  it("fila fora do ar: vira falha com espera, para a próxima volta tentar", async () => {
    meetUmaReuniao("Fechamos o escopo e eu mando a proposta na sexta.");
    enqueueJob.mockRejectedValueOnce(new Error("banco caiu"));
    const r = await importarReunioesOnline("u1", agora);
    expect(r.falhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ situacao: "falhou" });
  });

  it("tudo desligado em Ajustes: nada é consultado, e a tool diz que está desligado", async () => {
    const antes = { ...cfg };
    cfg["meetings.importarMeet"] = cfg["meetings.importarTeams"] = cfg["meetings.importarZoom"] = false;
    globalThis.fetch = vi.fn() as never;
    try {
      expect((await importarReunioesOnline("u1", agora)).fontesLigadas).toBe(0);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(String(await buscar_reunioes_online.run({}, { userId: "u1" }))).toContain("desligada");
    } finally {
      Object.assign(cfg, antes);
    }
  });

  it("a tool diz o que fez e o que falta o dono fazer", async () => {
    contas.google = [{ conexao: { scope: "openid", accountLabel: "wesley@gmail.com" }, token: "tk" }];
    expect(String(await buscar_reunioes_online.run({}, { userId: "u1" }))).toContain("reconectar a conta em Conectores");
    contas.google = [];
    expect(String(await buscar_reunioes_online.run({}, { userId: "u1" }))).toContain("Nenhuma transcrição nova");
  });

  it("a tool não prende o turno: passou do prazo, segue em segundo plano", async () => {
    cfg["meetings.importarEsperaMs"] = 5;
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as never;
    try {
      expect(String(await buscar_reunioes_online.run({}, { userId: "u1" }))).toContain("segundo plano");
    } finally {
      cfg["meetings.importarEsperaMs"] = 8000;
    }
  });
});
