import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recuperar o que o webhook não entregou (o GOWA desiste em segundos, e um
 * reinício do apps/api perdia a mensagem). O que fica travado:
 *   - o histórico vira o MESMO evento do webhook (texto e mídia);
 *   - só o que falta, só dentro da janela, nunca antes de parear;
 *   - chat ignorado (canal, status, grupo) não é recuperado;
 *   - da mais antiga para a mais nova.
 */

let sessao: Record<string, unknown> | null;
let chats: { jid: string; ultimaMensagemEm: Date | null }[] = [];
let historico: Record<string, unknown>[] = [];
let conhecidas: string[] = [];
const receberEvento = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, eventoId: "e" }));

vi.mock("./sessao", () => ({ sessaoDe: async () => sessao }));
vi.mock("./gowa/client", () => ({ listarChats: async () => chats, mensagensDoChatNaPonte: async () => historico }));
vi.mock("./processar", async () => {
  const real = await vi.importActual<typeof import("./processar")>("./processar");
  return { chatIgnorado: real.chatIgnorado, receberEvento };
});
vi.mock("../settings", () => ({ settings: { getMany: async () => ({ "whatsapp.recuperarMinutos": 30, "whatsapp.grupos": "guardar", "whatsapp.status": "ignorar", "whatsapp.canais": "ignorar" }) } }));
vi.mock("@orbita/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => conhecidas.map((id) => ({ id })) }) }) } }));

const { eventoDoHistorico, recuperarPerdidas, _zerarRecuperacao } = await import("./recuperar");

const AGORA = new Date("2026-09-27T22:30:00Z");
const EU = "5511960924734@s.whatsapp.net";
const msg = (id: string, minutosAtras: number, extra: Record<string, unknown> = {}) => ({ id, chat_jid: EU, sender_jid: EU, is_from_me: true, content: "qual a previsão?", timestamp: new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString(), ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  _zerarRecuperacao();
  sessao = { deviceId: "dev1", status: "conectado", pareadoEm: new Date("2026-09-27T22:00:00Z") };
  chats = [{ jid: EU, ultimaMensagemEm: new Date(AGORA.getTime() - 60_000) }];
  historico = [];
  conhecidas = [];
});

describe("eventoDoHistorico", () => {
  it("texto vira o evento de mensagem do webhook", () => {
    expect(eventoDoHistorico(msg("A", 1) as never)).toEqual({ event: "message", payload: expect.objectContaining({ id: "A", chat_id: EU, is_from_me: true, body: "qual a previsão?" }) });
  });
  it("áudio vira mídia (baixada pelo download da ponte), legenda vai junto", () => {
    const e = eventoDoHistorico({ ...msg("B", 1), media_type: "audio", url: "https://mmg/x.enc", filename: "a.ogg", content: "" } as never);
    expect((e.payload as Record<string, unknown>).audio).toEqual({ url: "https://mmg/x.enc", filename: "a.ogg", caption: undefined });
  });
});

describe("recuperarPerdidas", () => {
  it("só o que a Órbita não tem, da mais antiga para a mais nova", async () => {
    historico = [msg("NOVA", 2), msg("JA_TENHO", 5), msg("PERDIDA", 12)];
    conhecidas = ["JA_TENHO"];
    expect(await recuperarPerdidas("u1", AGORA)).toBe(2);
    expect(receberEvento.mock.calls.map((c) => (c[2] as { payload: { id: string } }).payload.id)).toEqual(["PERDIDA", "NOVA"]);
    expect(receberEvento).toHaveBeenCalledWith("u1", "dev1", expect.anything());
  });

  it("hora em época (número em texto) é lida como no webhook, não vira NaN e some", async () => {
    const epoca = (min: number) => String(Math.floor((AGORA.getTime() - min * 60_000) / 1000));
    historico = [msg("NOVA", 0, { timestamp: epoca(2) }), msg("VELHA", 0, { timestamp: epoca(8) })];
    expect(await recuperarPerdidas("u1", AGORA)).toBe(2);
    expect(receberEvento.mock.calls.map((c) => (c[2] as { payload: { id: string } }).payload.id)).toEqual(["VELHA", "NOVA"]);
  });

  it("nada de antes de parear, nem além da janela", async () => {
    historico = [msg("ANTES_DE_PAREAR", 45), msg("DENTRO", 3)];
    await recuperarPerdidas("u1", AGORA);
    expect(receberEvento).toHaveBeenCalledTimes(1);
  });

  it("chat ignorado (canal do WhatsApp) não é olhado", async () => {
    chats = [{ jid: "120363@newsletter", ultimaMensagemEm: new Date(AGORA.getTime() - 60_000) }];
    historico = [msg("POST", 1, { chat_jid: "120363@newsletter" })];
    expect(await recuperarPerdidas("u1", AGORA)).toBe(0);
  });

  it("na volta seguinte, só olha dali para a frente", async () => {
    historico = [msg("X", 2)];
    await recuperarPerdidas("u1", AGORA);
    receberEvento.mockClear();
    await recuperarPerdidas("u1", new Date(AGORA.getTime() + 60_000));
    expect(receberEvento).not.toHaveBeenCalled();
  });

  it("sem WhatsApp conectado, não faz nada", async () => {
    sessao = { deviceId: "dev1", status: "desconectado", pareadoEm: null };
    expect(await recuperarPerdidas("u1", AGORA)).toBe(0);
  });
});
