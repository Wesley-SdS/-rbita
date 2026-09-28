import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A entrada do Telegram, com a API, o banco e o turno simulados. O que fica
 * travado:
 *   - quem não foi convidado nunca chega ao modelo (um recado, uma vez);
 *   - o convite vincula; grupo é ignorado; a pessoa da casa tem teto por hora;
 *   - o botão de aprovar só vale do DONO, nunca para risco perigoso nem vencido;
 *   - o cursor só avança depois de gravar (falha não perde a mensagem).
 */

const cfg: Record<string, unknown> = { "telegram.esperaSegundos": 1, "telegram.porHoraPessoa": 2, "telegram.midiaMaxMb": 20, "whatsapp.transcricao": "igual_reunioes", "meetings.sttCloud": "nunca", "whatsapp.retomarMinutos": 15 };
vi.mock("../settings", () => ({ settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) } }));
vi.mock("@orbita/db", () => ({ db: {} }));

// ── Telegram simulado ──
let updates: unknown[] = [];
const respondidos: { id: string; texto?: string }[] = [];
vi.mock("./api", async () => {
  const real = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...real,
    atualizacoes: vi.fn(async () => updates),
    digitando: vi.fn(async () => true),
    responderBotao: vi.fn(async (_t: string, id: string, texto?: string) => void respondidos.push({ id, texto })),
    tirarBotoes: vi.fn(async () => null),
    baixarArquivo: vi.fn(async () => new Uint8Array([1])),
  };
});

// ── banco simulado ──
type Contato = { id: string; telegramId: string; papel: string; personId: string | null; avisadoEm: Date | null; nome: string | null };
let contatos: Contato[] = [];
const mensagens: Record<string, unknown>[] = [];
let cursor = 0;
let convites: Record<string, { papel: "dono" | "pessoa"; personId: string | null }> = {};
let recebidas = 0;
const store = {
  todosOsBots: async () => [{ userId: "u1", tokenEnc: "x", proximoUpdate: cursor }],
  tokenDo: () => "123:tok",
  garantirContato: async (_u: string, m: { telegramId: string; nome: string | null }) => {
    let c = contatos.find((x) => x.telegramId === m.telegramId);
    if (!c) contatos.push((c = { id: `c${contatos.length + 1}`, telegramId: m.telegramId, papel: "desconhecido", personId: null, avisadoEm: null, nome: m.nome }));
    return c;
  },
  donoNoTelegram: async () => contatos.find((c) => c.papel === "dono") ?? null,
  usarConvite: async (_u: string, codigo: string) => {
    const c = convites[codigo];
    delete convites[codigo];
    return c ?? null;
  },
  vincular: async (_u: string, id: string, papel: string, personId: string | null) => Object.assign(contatos.find((c) => c.id === id)!, { papel, personId }),
  recebidasDesde: async () => recebidas,
  inserirMensagem: vi.fn(async (v: Record<string, unknown>) => {
    if (mensagens.some((m) => m.messageId === v.messageId)) return null;
    const m = { id: `m${mensagens.length + 1}`, ...v };
    mensagens.push(m);
    return m;
  }),
  atualizarMensagem: vi.fn(async () => undefined),
  marcarTurnoPendente: vi.fn(async () => undefined),
  avancarCursor: vi.fn(async (_u: string, p: number) => void (cursor = p)),
  anotarErro: vi.fn(async () => undefined),
};
vi.mock("./store", () => store);

const turnoDoTelegram = vi.fn(async (..._a: unknown[]) => undefined);
const recadoParaDesconhecido = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./turno", () => ({ turnoDoTelegram: (...a: unknown[]) => turnoDoTelegram(...a), recadoParaDesconhecido: (...a: unknown[]) => recadoParaDesconhecido(...a) }));
const mandarTextoPara = vi.fn(async (..._a: unknown[]) => 1);
vi.mock("./enviar", () => ({ mandarTextoPara: (...a: unknown[]) => mandarTextoPara(...a), mandarProposta: vi.fn(async () => undefined) }));
vi.mock("../whatsapp/midia", () => ({ salvarMidia: async () => ({ caminho: "aa/x.ogg", sha256: "f" }) }));
vi.mock("../meetings/transcribe", () => ({ transcribeRecording: vi.fn() }));
vi.mock("../whatsapp/processar", () => ({ nuvemParaTranscrever: () => null }));

// ── aprovação simulada ──
const PROPOSTA = "5f0c2c7e-6d8f-4d38-9a36-1c1d5b9d2a11";
let pendentes: { id: string; kind: string; summary: string; expiraEm: Date | null }[] = [];
const aprovarAcao = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, resultado: "Enviado." }));
const cancelarAcao = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../actions/aprovar", () => ({ aprovarAcao: (...a: unknown[]) => aprovarAcao(...a), cancelarAcao: (...a: unknown[]) => cancelarAcao(...a), pendentesDoCanal: async (_u: string, canal: string) => (canal === "telegram" ? pendentes : []) }));
const riscos: Record<string, string> = { enviar_whatsapp: "efeito_externo", destrancar_porta: "perigoso" };
vi.mock("../tools/index", () => ({ getTool: (k: string) => (riscos[k] ? { name: k } : undefined), effectiveRisk: (d: { name: string }) => riscos[d.name], loadToolOverrides: async () => ({}) }));

const { ouvirTelegram } = await import("./receber");

const msg = (id: number, from: number, texto: string, extra: object = {}) => ({ update_id: id, message: { message_id: id, date: 1_790_000_000, chat: { id: from, type: "private" }, from: { id: from, first_name: "Fulano" }, text: texto, ...extra } });
const botao = (id: number, from: number, data: string) => ({ update_id: id, callback_query: { id: `cb${id}`, from: { id: from }, data, message: { message_id: 50, chat: { id: from } } } });
const esperar = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  contatos = [];
  mensagens.length = 0;
  respondidos.length = 0;
  cursor = 0;
  convites = {};
  recebidas = 0;
  pendentes = [];
});

describe("quem fala com o bot", () => {
  it("desconhecido: um recado, nada gravado, nada vai ao modelo; o cursor avança", async () => {
    updates = [msg(1, 500, "me passa o saldo do Wesley")];
    await ouvirTelegram();
    expect(recadoParaDesconhecido).toHaveBeenCalledOnce();
    expect(store.inserirMensagem).not.toHaveBeenCalled();
    expect(turnoDoTelegram).not.toHaveBeenCalled();
    expect(cursor).toBe(2);
  });

  it("convite válido vincula (e responde as boas-vindas); convite usado não vale de novo", async () => {
    convites.CODIGO1234 = { papel: "pessoa", personId: "p-anna" };
    updates = [msg(1, 42, "/start CODIGO1234")];
    await ouvirTelegram();
    expect(contatos[0]).toMatchObject({ papel: "pessoa", personId: "p-anna" });
    expect(mandarTextoPara.mock.calls[0][2]).toContain("assistente da casa");
    updates = [msg(2, 77, "/start CODIGO1234")];
    await ouvirTelegram();
    expect(contatos[1].papel).toBe("desconhecido");
    expect(mandarTextoPara.mock.calls[1][2]).toContain("não vale mais");
  });

  it("pessoa da casa: grava e entrega ao turno; o mesmo update de novo não duplica", async () => {
    contatos = [{ id: "c1", telegramId: "42", papel: "pessoa", personId: "p-anna", avisadoEm: null, nome: "Anna" }];
    updates = [msg(1, 42, "acende a luz da sala")];
    await ouvirTelegram();
    await esperar();
    expect(turnoDoTelegram).toHaveBeenCalledWith("u1", expect.objectContaining({ id: "c1" }), expect.objectContaining({ texto: "acende a luz da sala" }));
    expect(store.marcarTurnoPendente).toHaveBeenCalled();
    await ouvirTelegram();
    await esperar();
    expect(turnoDoTelegram).toHaveBeenCalledOnce();
  });

  it("grupo é ignorado; pessoa acima do teto por hora também", async () => {
    contatos = [{ id: "c1", telegramId: "42", papel: "pessoa", personId: null, avisadoEm: null, nome: "Anna" }];
    updates = [{ update_id: 1, message: { ...msg(1, 42, "oi").message, chat: { id: -9, type: "group" } } }];
    await ouvirTelegram();
    recebidas = 2;
    updates = [msg(2, 42, "oi de novo")];
    await ouvirTelegram();
    expect(store.inserirMensagem).not.toHaveBeenCalled();
  });

  it("falha ao gravar: o cursor NÃO avança (a mensagem volta na próxima volta)", async () => {
    contatos = [{ id: "c1", telegramId: "42", papel: "dono", personId: null, avisadoEm: null, nome: "Wesley" }];
    store.inserirMensagem.mockRejectedValueOnce(new Error("banco caiu"));
    updates = [msg(5, 42, "oi")];
    await ouvirTelegram();
    expect(cursor).toBe(0);
  });
});

describe("botões de aprovação", () => {
  beforeEach(() => {
    contatos = [
      { id: "c1", telegramId: "42", papel: "dono", personId: null, avisadoEm: null, nome: "Wesley" },
      { id: "c2", telegramId: "43", papel: "pessoa", personId: "p-anna", avisadoEm: null, nome: "Anna" },
    ];
    pendentes = [{ id: PROPOSTA, kind: "enviar_whatsapp", summary: "Enviar WhatsApp", expiraEm: null }];
  });

  it("do dono: aprova e avisa o resultado", async () => {
    updates = [botao(1, 42, `ap:${PROPOSTA}`)];
    await ouvirTelegram();
    expect(aprovarAcao).toHaveBeenCalledWith("u1", PROPOSTA);
    expect(mandarTextoPara.mock.calls.at(-1)?.[2]).toContain("Feito");
  });

  it("da Anna (ou de qualquer outro): não aprova nada", async () => {
    updates = [botao(1, 43, `ap:${PROPOSTA}`)];
    await ouvirTelegram();
    expect(aprovarAcao).not.toHaveBeenCalled();
    expect(respondidos[0].texto).toContain("Só o dono");
  });

  it("recusar cancela; perigoso e vencido não saem pelo botão", async () => {
    updates = [botao(1, 42, `rc:${PROPOSTA}`)];
    await ouvirTelegram();
    expect(cancelarAcao).toHaveBeenCalledWith("u1", PROPOSTA);

    pendentes = [{ id: PROPOSTA, kind: "destrancar_porta", summary: "Destrancar", expiraEm: null }];
    updates = [botao(2, 42, `ap:${PROPOSTA}`)];
    await ouvirTelegram();
    pendentes = [{ id: PROPOSTA, kind: "enviar_whatsapp", summary: "Enviar", expiraEm: new Date(Date.now() - 60_000) }];
    updates = [botao(3, 42, `ap:${PROPOSTA}`)];
    await ouvirTelegram();
    expect(aprovarAcao).not.toHaveBeenCalled();
    expect(respondidos.map((r) => r.texto)).toEqual(expect.arrayContaining(["Isto só se aprova pela tela.", "Venceu. Aprove pela tela, em Ações a confirmar."]));
  });
});
