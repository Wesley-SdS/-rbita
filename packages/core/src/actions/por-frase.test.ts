import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aprovar FALANDO (PRD-WHATSAPP W6). Quem aprova é o código lendo a frase do
 * dono, e com três travas: só proposta do MESMO canal, só a que nasceu depois
 * da fala anterior do dono, e NUNCA risco perigoso (decisão 9.5).
 */

type Pendente = { id: string; kind: string; summary: string; createdAt: Date; expiraEm: Date | null; canal: string };
let pendentes: Pendente[] = [];
const aprovarAcao = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, resultado: "ok" }));
const cancelarAcao = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("./aprovar", () => ({
  aprovarAcao,
  cancelarAcao,
  pendentesDoCanal: async (_u: string, canal: string) => pendentes.filter((p) => p.canal === canal),
}));
vi.mock("../settings", () => ({
  settings: {
    getMany: async () => ({ "whatsapp.frasesConfirmar": ["manda", "pode mandar"], "whatsapp.frasesCancelar": ["cancela", "não manda"] }),
  },
}));
const riscos: Record<string, string> = { responder_whatsapp: "efeito_externo", casa_acionar_com_aprovacao: "perigoso" };
vi.mock("../tools/index", () => ({
  getTool: (k: string) => (riscos[k] ? { name: k, risk: riscos[k] } : undefined),
  effectiveRisk: (d: { risk: string }) => d.risk,
  loadToolOverrides: async () => new Map(),
}));

const { aprovarPorFrase } = await import("./por-frase");

const daqui = (min: number) => new Date(Date.now() + min * 60_000);
const p = (id: string, canal = "whatsapp", expira = 20, criada = -1, kind = "responder_whatsapp"): Pendente => ({ id, kind, summary: `Responder ${id}`, createdAt: daqui(criada), expiraEm: daqui(expira), canal });

beforeEach(() => {
  vi.clearAllMocks();
  pendentes = [];
});

describe("aprovar por frase", () => {
  it("'manda' com uma proposta do canal aprova ela", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "Manda!")).toEqual({ estado: "enviado", texto: "Enviado." });
    expect(aprovarAcao).toHaveBeenCalledWith("u1", "a");
  });

  it("'cancela' cancela", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "cancela")).toEqual({ estado: "cancelado", texto: "Cancelado, não mandei." });
    expect(cancelarAcao).toHaveBeenCalledWith("u1", "a");
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("proposta de OUTRO canal não é aprovada", async () => {
    pendentes = [p("voz1", "voz"), p("tela1", "tela")];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("risco PERIGOSO nunca sai por frase (portão, fechadura, alarme): só pela tela, e ela DIZ isso", async () => {
    pendentes = [p("portao", "voz", 20, -1, "casa_acionar_com_aprovacao")];
    expect(await aprovarPorFrase("u1", "voz", "manda")).toMatchObject({ estado: "so_na_tela" });
    // cancelar falando também não mexe na perigosa: ela fica na tela
    expect(await aprovarPorFrase("u1", "voz", "cancela")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("só responde ao que foi proposto DEPOIS da fala anterior do dono", async () => {
    // proposta de 10 min atrás; o dono falou de outra coisa há 5 min
    pendentes = [p("velha", "whatsapp", 20, -10)];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda", daqui(-5))).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
    // a mesma proposta, se foi feita depois da fala anterior, sai
    expect(await aprovarPorFrase("u1", "whatsapp", "manda", daqui(-15))).toMatchObject({ estado: "enviado" });
  });

  it("palavra genérica não aprova nada (não está nas frases padrão)", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "sim")).toBeNull();
    expect(await aprovarPorFrase("u1", "whatsapp", "não")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
    expect(cancelarAcao).not.toHaveBeenCalled();
  });

  it("só vencidas: a frase segue como pedido (e não vira aviso eterno)", async () => {
    pendentes = [p("velha", "whatsapp", -60, -90)];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("'manda 1 manda 2' aprova as duas, mesmo criadas antes da fala anterior (a lista que ela mostrou)", async () => {
    pendentes = [p("a", "whatsapp", 20, -10), p("b", "whatsapp", 20, -9)];
    const r = await aprovarPorFrase("u1", "whatsapp", "Manda 1 manda 2", daqui(-5));
    expect(aprovarAcao.mock.calls.map((c) => c[1])).toEqual(["a", "b"]);
    expect(r?.estado).toBe("enviado");
    expect(r?.texto).toContain("Responder a");
    expect(r?.texto).toContain("Responder b");
  });

  it("'manda' SEM número continua só para proposta depois da fala anterior", async () => {
    pendentes = [p("velha", "whatsapp", 20, -10)];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda", daqui(-5))).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("duas válidas: devolve a lista numerada; 'manda 2' escolhe", async () => {
    pendentes = [p("a", "whatsapp", 20, -5), p("b", "whatsapp", 20, -1)];
    const lista = await aprovarPorFrase("u1", "whatsapp", "manda");
    expect(lista?.estado).toBe("lista");
    expect(lista?.texto).toContain("1. Responder a");
    expect(lista?.texto).toContain("2. Responder b");
    expect(aprovarAcao).not.toHaveBeenCalled();
    await aprovarPorFrase("u1", "whatsapp", "manda 2");
    expect(aprovarAcao).toHaveBeenCalledWith("u1", "b");
  });

  it("pedido novo com cara de resposta não aprova", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda um oi pra Maria também")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("falha do envio volta como recado; envio incerto não vira 'Enviado.'", async () => {
    pendentes = [p("a", "voz")];
    aprovarAcao.mockResolvedValueOnce({ ok: false, status: 502, erro: "ponte fora do ar" } as never);
    expect(await aprovarPorFrase("u1", "voz", "manda")).toEqual({ estado: "falhou", texto: "Não consegui enviar: ponte fora do ar" });
    aprovarAcao.mockResolvedValueOnce({ ok: true, resultado: "Talvez tenha saído: confira" } as never);
    expect((await aprovarPorFrase("u1", "voz", "manda"))?.texto).toBe("Talvez tenha saído: confira");
  });
});
