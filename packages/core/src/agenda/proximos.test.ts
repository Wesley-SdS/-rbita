import { beforeEach, describe, expect, it, vi } from "vitest";

const google = vi.fn();
const outlook = vi.fn();
vi.mock("../connectors/google", () => ({ listarEventosEntre: (...a: unknown[]) => google(...a) }));
vi.mock("../connectors/microsoft", () => ({ listarEventosEntre: (...a: unknown[]) => outlook(...a) }));
const contas: Record<string, string[]> = { google: ["pessoal@gmail.com"], microsoft: [] };
vi.mock("../connectors/multi", () => ({
  lerDeTodasAsContas: async (cid: string, _u: string, ler: (t: string) => Promise<object[]>) => {
    const itens: object[] = [];
    const falhas: string[] = [];
    for (const conta of contas[cid] ?? []) {
      try {
        for (const e of await ler("tok")) itens.push({ ...e, conta });
      } catch {
        falhas.push(conta);
      }
    }
    return { itens, falhas, contas: (contas[cid] ?? []).length };
  },
}));
vi.mock("../settings", () => ({ settings: { getMany: async () => ({ "meetings.agendaDias": 7, "meetings.agendaCacheSegundos": 60 }) } }));
vi.mock("../observability/logger", () => ({ log: { warn: vi.fn() } }));

const { juntarEventos, linkDeChamada, proximosEventos, esquecerAgendaDaTela } = await import("./proximos");

const ev = (over: Record<string, unknown>) => ({ id: "x", titulo: "Daily", inicio: "2026-09-28T13:00:00Z", fim: "2026-09-28T13:30:00Z", diaInteiro: false, pessoas: [], provedor: "google" as const, contas: ["a@x.com"], ...over });

beforeEach(() => {
  esquecerAgendaDaTela();
  google.mockReset();
  outlook.mockReset();
  contas.google = ["pessoal@gmail.com"];
  contas.microsoft = [];
});

describe("juntarEventos", () => {
  it("ordena por início, com dia inteiro no começo do dia", () => {
    const r = juntarEventos([ev({ id: "b", titulo: "Tarde", inicio: "2026-09-28T18:00:00Z" }), ev({ id: "d", titulo: "Feriado", inicio: "2026-09-28", diaInteiro: true }), ev({ id: "a" })]);
    expect(r.map((e) => e.id)).toEqual(["d", "a", "b"]);
  });

  it("o mesmo convite em duas agendas vira uma linha com as duas contas", () => {
    const r = juntarEventos([ev({ id: "1", contas: ["a@x.com"] }), ev({ id: "2", titulo: " daily ", provedor: "microsoft", contas: ["b@empresa.com"], entrar: "https://teams.microsoft.com/l/meetup-join/abc" })]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "1", contas: ["a@x.com", "b@empresa.com"], entrar: "https://teams.microsoft.com/l/meetup-join/abc" });
  });

  it("evento com data ilegível fica de fora em vez de quebrar a ordem", () => {
    expect(juntarEventos([ev({ inicio: "" }), ev({ id: "ok" })]).map((e) => e.id)).toEqual(["ok"]);
  });
});

describe("linkDeChamada", () => {
  it("acha Zoom e Teams colados no local; texto comum não", () => {
    expect(linkDeChamada("Sala 3 / https://us02web.zoom.us/j/8123?pwd=x")).toBe("https://us02web.zoom.us/j/8123?pwd=x");
    expect(linkDeChamada("Escritório, Rua Estrela 96")).toBeUndefined();
    expect(linkDeChamada(undefined)).toBeUndefined();
  });
});

describe("proximosEventos", () => {
  const agora = new Date("2026-09-28T12:00:00Z");

  it("junta Google e Microsoft, tira o que já acabou, e guarda por um tempo", async () => {
    contas.microsoft = ["trabalho@empresa.com"];
    google.mockResolvedValue([
      { id: "g1", titulo: "Já foi", inicio: "2026-09-28T09:00:00Z", fim: "2026-09-28T10:00:00Z", diaInteiro: false, pessoas: [] },
      { id: "g2", titulo: "Almoço", inicio: "2026-09-28T15:00:00Z", fim: "2026-09-28T16:00:00Z", diaInteiro: false, pessoas: [] },
    ]);
    outlook.mockResolvedValue([{ id: "m1", titulo: "1:1", inicio: "2026-09-28T13:00:00Z", fim: "2026-09-28T13:30:00Z", diaInteiro: false, pessoas: ["Lucas"] }]);
    const r = await proximosEventos("u1", agora);
    expect(r.eventos.map((e) => [e.id, e.provedor, e.contas[0]])).toEqual([["m1", "microsoft", "trabalho@empresa.com"], ["g2", "google", "pessoal@gmail.com"]]);
    await proximosEventos("u1", new Date(agora.getTime() + 30_000));
    expect(google).toHaveBeenCalledTimes(1);
  });

  it("uma conta fora do ar não derruba a agenda: vem nas falhas", async () => {
    contas.microsoft = ["trabalho@empresa.com"];
    google.mockResolvedValue([{ id: "g2", titulo: "Almoço", inicio: "2026-09-28T15:00:00Z", fim: "2026-09-28T16:00:00Z", diaInteiro: false, pessoas: [] }]);
    outlook.mockRejectedValue(new Error("401"));
    const r = await proximosEventos("u1", agora);
    expect(r.eventos).toHaveLength(1);
    expect(r.falhas).toEqual(["trabalho@empresa.com"]);
  });
});
