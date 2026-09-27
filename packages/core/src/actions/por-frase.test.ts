import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aprovar FALANDO (PRD-WHATSAPP W6). Quem aprova é o código lendo a frase do
 * dono, e só a proposta do MESMO canal: um "manda" no WhatsApp não aprova o
 * que foi pedido na voz, e vice-versa.
 */

type Pendente = { id: string; summary: string; createdAt: Date; expiraEm: Date | null; canal: string };
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
    getMany: async () => ({ "whatsapp.frasesConfirmar": ["manda", "pode mandar", "sim"], "whatsapp.frasesCancelar": ["cancela", "não"] }),
  },
}));

const { aprovarPorFrase } = await import("./por-frase");

const daqui = (min: number) => new Date(Date.now() + min * 60_000);
const p = (id: string, canal = "whatsapp", expira = 20, criada = -1): Pendente => ({ id, summary: `Responder ${id}`, createdAt: daqui(criada), expiraEm: daqui(expira), canal });

beforeEach(() => {
  vi.clearAllMocks();
  pendentes = [];
});

describe("aprovar por frase", () => {
  it("'manda' com uma proposta do canal aprova ela", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "Manda!")).toBe("Enviado.");
    expect(aprovarAcao).toHaveBeenCalledWith("u1", "a");
  });

  it("'cancela' cancela", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "cancela")).toBe("Cancelado, não mandei.");
    expect(cancelarAcao).toHaveBeenCalledWith("u1", "a");
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("proposta de OUTRO canal não é aprovada", async () => {
    pendentes = [p("voz1", "voz"), p("tela1", "tela")];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("'sim' sem proposta é conversa, não aprovação", async () => {
    expect(await aprovarPorFrase("u1", "whatsapp", "sim")).toBeNull();
  });

  it("só vencidas: a frase segue como pedido (e não vira aviso eterno)", async () => {
    pendentes = [p("velha", "whatsapp", -60, -90)];
    expect(await aprovarPorFrase("u1", "whatsapp", "sim")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("duas válidas: devolve a lista numerada; 'manda 2' escolhe", async () => {
    pendentes = [p("a", "whatsapp", 20, -5), p("b", "whatsapp", 20, -1)];
    const lista = await aprovarPorFrase("u1", "whatsapp", "manda");
    expect(lista).toContain("1. Responder a");
    expect(lista).toContain("2. Responder b");
    expect(aprovarAcao).not.toHaveBeenCalled();
    await aprovarPorFrase("u1", "whatsapp", "manda 2");
    expect(aprovarAcao).toHaveBeenCalledWith("u1", "b");
  });

  it("pedido novo com cara de resposta não aprova", async () => {
    pendentes = [p("a")];
    expect(await aprovarPorFrase("u1", "whatsapp", "manda um oi pra Maria também")).toBeNull();
    expect(aprovarAcao).not.toHaveBeenCalled();
  });

  it("falha do envio volta como recado", async () => {
    pendentes = [p("a")];
    aprovarAcao.mockResolvedValueOnce({ ok: false, status: 502, erro: "ponte fora do ar" } as never);
    expect(await aprovarPorFrase("u1", "voz", "manda")).toBeNull(); // canal errado: nem tenta
    pendentes = [p("a", "voz")];
    expect(await aprovarPorFrase("u1", "voz", "manda")).toBe("Não consegui enviar: ponte fora do ar");
  });
});
