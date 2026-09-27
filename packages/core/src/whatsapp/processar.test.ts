import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Da entrada bruta à mensagem guardada. O que fica travado:
 *   - o eco da Órbita não vira mensagem nova (nem turno);
 *   - reentrega de mensagem que caiu ANTES de rotear continua (antes sumia);
 *   - reentrega já roteada não roteia de novo;
 *   - grupo ignorado nem entra; edição sem corpo não apaga o texto;
 *   - edição de original ausente: espera (erro) enquanto recente, desiste depois;
 *   - sem o JID do dono ainda, confere a saúde antes de decidir "é a conversa Eu?".
 */

let cfg: Record<string, unknown> = {};
let eco = false;
let inserida: Record<string, unknown> | null = null;
let existente: Record<string, unknown> | null = null;
let atualizadas = 1;
let sessao: { jid: string | null } | null = { jid: "5511900000000@s.whatsapp.net" };
const roteadas: { m: Record<string, unknown>; conversaEu: boolean }[] = [];
const updatesDb: Record<string, unknown>[] = [];

const store = {
  casarEco: vi.fn(async () => eco),
  garantirContato: vi.fn(async (_u: string, jid: string) => ({ id: "c1", jid, nome: "Maria", apelido: null })),
  inserirMensagem: vi.fn(async (m: Record<string, unknown>) => (inserida = { id: "m1", roteadaEm: null, midiaCaminho: null, ...m })),
  mensagemPorExternalId: vi.fn(async () => existente),
  atualizarMensagem: vi.fn(async (..._a: unknown[]) => atualizadas),
  atualizarMensagemPorId: vi.fn(async () => undefined),
};
vi.mock("./store", () => store);
const conferirSaude = vi.fn(async () => {
  sessao = { jid: "5511900000000@s.whatsapp.net" };
  return "conectado";
});
vi.mock("./sessao", () => ({ sessaoDe: async () => sessao, conferirSaude }));
const baixarMidia = vi.fn();
vi.mock("./gowa/client", () => ({ baixarMidia }));
vi.mock("./midia", () => ({ salvarMidia: async () => ({ caminho: "aa/x.ogg", sha256: "x" }) }));
vi.mock("../meetings/transcribe", () => ({ transcribeRecording: vi.fn(async () => ({ text: "chego às oito" })) }));
const emit = vi.fn(async () => undefined);
vi.mock("../events/index", () => ({ events: { emit } }));
vi.mock("../settings", () => ({ settings: { getMany: async () => cfg } }));
vi.mock("@orbita/db", () => ({
  db: {
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void updatesDb.push(v) }) }),
  },
}));

const proc = await import("./processar");
proc.quandoGuardar(async (_u, m, ctx) => void roteadas.push({ m: m as unknown as Record<string, unknown>, conversaEu: ctx.conversaEu }));

const ev = (event: string, payload: Record<string, unknown>) => ({ event, payload }) as never;
const msg = (over: Record<string, unknown> = {}) =>
  ev("message", { id: "W1", chat_id: "5511922222222@s.whatsapp.net", from_name: "Maria", body: "oi", timestamp: "2026-09-27T10:00:00Z", ...over });
const agora = () => new Date();

beforeEach(() => {
  vi.clearAllMocks();
  cfg = { "whatsapp.grupos": "guardar", "whatsapp.status": "ignorar", "whatsapp.midiaMaxMb": 64, "whatsapp.transcricao": "local", "meetings.sttCloud": "nunca" };
  eco = false;
  inserida = existente = null;
  atualizadas = 1;
  sessao = { jid: "5511900000000@s.whatsapp.net" };
  roteadas.length = 0;
  updatesDb.length = 0;
});

describe("mensagem nova", () => {
  it("guarda, avisa (sem o texto no evento), roteia e marca como roteada", async () => {
    await proc.aplicarEvento("u1", "dev1", msg(), agora());
    expect(store.inserirMensagem).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("whatsapp.mensagem_recebida", expect.not.objectContaining({ texto: expect.anything() }), { userId: "u1" });
    expect(roteadas).toHaveLength(1);
    expect(updatesDb.at(-1)).toMatchObject({ roteadaEm: expect.any(Date) });
  });

  it("conversa 'Eu' é reconhecida pelo JID do dono", async () => {
    await proc.aplicarEvento("u1", "dev1", msg({ chat_id: "5511900000000:7@s.whatsapp.net", is_from_me: true }), agora());
    expect(roteadas[0].conversaEu).toBe(true);
  });

  it("sem JID do dono ainda (logo após parear): confere a saúde antes", async () => {
    sessao = { jid: null };
    await proc.aplicarEvento("u1", "dev1", msg({ chat_id: "5511900000000@s.whatsapp.net", is_from_me: true }), agora());
    expect(conferirSaude).toHaveBeenCalledOnce();
    expect(roteadas[0].conversaEu).toBe(true);
  });

  it("o ECO da Órbita não vira mensagem nova", async () => {
    eco = true;
    await proc.aplicarEvento("u1", "dev1", msg({ is_from_me: true }), agora());
    expect(store.inserirMensagem).not.toHaveBeenCalled();
    expect(roteadas).toHaveLength(0);
  });

  it("reentrega de mensagem que caiu antes de rotear: continua com a linha existente", async () => {
    store.inserirMensagem.mockResolvedValueOnce(null as never);
    existente = { id: "m1", roteadaEm: null, midiaCaminho: null };
    await proc.aplicarEvento("u1", "dev1", msg(), agora());
    expect(roteadas).toHaveLength(1);
  });

  it("reentrega já roteada: nada acontece de novo", async () => {
    store.inserirMensagem.mockResolvedValueOnce(null as never);
    existente = { id: "m1", roteadaEm: new Date(), midiaCaminho: null };
    await proc.aplicarEvento("u1", "dev1", msg(), agora());
    expect(roteadas).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("grupo com 'ignorar' nem entra", async () => {
    cfg["whatsapp.grupos"] = "ignorar";
    await proc.aplicarEvento("u1", "dev1", msg({ chat_id: "120363@g.us" }), agora());
    expect(store.inserirMensagem).not.toHaveBeenCalled();
  });

  it("áudio é baixado com teto e transcrito antes de rotear", async () => {
    baixarMidia.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2]), mime: "audio/ogg" });
    await proc.aplicarEvento("u1", "dev1", msg({ body: undefined, audio: "statics/media/a.ogg" }), agora());
    expect(baixarMidia).toHaveBeenCalledWith("dev1", expect.anything(), 64 * 1024 * 1024);
    expect(roteadas[0].m).toMatchObject({ transcricao: "chego às oito", midiaCaminho: "aa/x.ogg" });
  });

  it("mídia que falhou (grande demais, ponte fora) não impede a mensagem de seguir", async () => {
    baixarMidia.mockRejectedValueOnce(new Error("Mídia maior que o tamanho máximo configurado"));
    await proc.aplicarEvento("u1", "dev1", msg({ image: "statics/media/x.jpg" }), agora());
    expect(roteadas).toHaveLength(1);
  });
});

describe("edição, apagada e reação", () => {
  it("edição sem corpo NÃO apaga o texto original", async () => {
    await proc.aplicarEvento("u1", "dev1", ev("message.edited", { id: "E1", original_message_id: "W1" }), agora());
    expect(store.atualizarMensagem).toHaveBeenCalledWith("u1", "W1", { editada: true });
  });

  it("original ainda não guardada e evento recente: falha para voltar depois", async () => {
    atualizadas = 0;
    await expect(proc.aplicarEvento("u1", "dev1", ev("message.revoked", { revoked_message_id: "W9" }), agora())).rejects.toThrow("ainda não foi guardada");
  });

  it("original que nunca vai chegar (evento velho): desiste sem erro", async () => {
    atualizadas = 0;
    await expect(proc.aplicarEvento("u1", "dev1", ev("message.reaction", { reacted_message_id: "W9", emoji: "👍" }), new Date(Date.now() - 60 * 60_000))).resolves.toBeUndefined();
  });

  it("edição num grupo ignorado nem tenta", async () => {
    cfg["whatsapp.grupos"] = "ignorar";
    atualizadas = 0;
    await expect(proc.aplicarEvento("u1", "dev1", ev("message.edited", { id: "E1", original_message_id: "W1", chat_id: "120363@g.us", body: "x" }), agora())).resolves.toBeUndefined();
    expect(store.atualizarMensagem).not.toHaveBeenCalled();
  });
});

describe("chatIgnorado", () => {
  it("status e grupo seguem a config", () => {
    expect(proc.chatIgnorado("status@broadcast", { grupos: "guardar", status: "ignorar" })).toBe(true);
    expect(proc.chatIgnorado("120363@g.us", { grupos: "ignorar", status: "guardar" })).toBe(true);
    expect(proc.chatIgnorado("5511@s.whatsapp.net", { grupos: "ignorar", status: "ignorar" })).toBe(false);
  });
});
