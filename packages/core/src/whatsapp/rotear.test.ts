import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pedido do dono não se perde num reinício, e também não é respondido duas
 * vezes (27/09/2026: "manda um áudio para o Lucas" morreu num reinício do
 * `tsx watch`; a primeira correção retomava até o turno que ainda estava
 * rodando). O que fica travado:
 *   - só o que tem TURNO ganha a marca de pendente, e ela sai quando o turno termina;
 *   - a retomada pega só turno começado ANTES da subida, e reivindica atômico;
 *   - turno que já fez efeito, ou um "manda", não volta ao modelo.
 */

const cfg: Record<string, unknown> = { "whatsapp.conversaComigo": true, "whatsapp.retomarMinutos": 15, "whatsapp.frasesConfirmar": ["manda"], "whatsapp.frasesCancelar": ["cancela"] };
vi.mock("../settings", () => ({
  settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) },
}));
vi.mock("./processar", () => ({ quandoGuardar: () => undefined }));
vi.mock("./sessao", () => ({ sessaoDe: async () => ({ jid: "5511900000000@s.whatsapp.net" }) }));
vi.mock("./conversa", () => ({ conversaDoCanal: async () => "conv-1" }));
const enviarTexto = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("./enviar", () => ({ enviarTexto: (...a: unknown[]) => enviarTexto(...a) }));

// o que o banco diz sobre efeito do turno interrompido (resposta ou proposta depois de começar)
let efeito: unknown[] = [];
vi.mock("@orbita/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => efeito }) }) }) } }));

let soltarTurno: () => void = () => undefined;
const turnoDoDono = vi.fn(() => new Promise<void>((r) => (soltarTurno = r)));
vi.mock("./turno", () => ({ turnoDoDono: (...a: unknown[]) => (turnoDoDono as (...x: unknown[]) => Promise<void>)(...a) }));
vi.mock("./automatico", () => ({ talvezResponderSozinha: vi.fn(async () => undefined), donoAssumiu: vi.fn(async () => undefined) }));

const marcarTurnoPendente = vi.fn(async (..._a: unknown[]) => undefined);
const limparTurnoPendente = vi.fn(async (..._a: unknown[]) => undefined);
const turnosInterrompidos = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
let reivindicou = true;
const reivindicarTurno = vi.fn(async (..._a: unknown[]) => reivindicou);
const contato = { id: "c1", modo: "aprovar", grupo: false };
vi.mock("./store", () => ({
  contatoPorId: async () => contato,
  marcarTurnoPendente: (...a: unknown[]) => marcarTurnoPendente(...a),
  limparTurnoPendente: (...a: unknown[]) => limparTurnoPendente(...a),
  turnosInterrompidos: (...a: unknown[]) => turnosInterrompidos(...a),
  reivindicarTurno: (...a: unknown[]) => reivindicarTurno(...a),
}));

const { rotear, retomarTurnosInterrompidos } = await import("./rotear");
const EU = "5511900000000@s.whatsapp.net";
const msg = (over: object = {}) => ({ id: "m1", userId: "u1", contatoId: "c1", chatJid: EU, deMim: true, enviadaPelaOrbita: false, texto: "manda um áudio para a Anna", transcricao: null, turnoPendenteEm: new Date("2026-09-28T00:30:00Z"), ...over }) as never;
const esperar = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  efeito = [];
  reivindicou = true;
});

describe("marca de turno pendente", () => {
  it("a conversa 'Eu' marca ao começar e limpa só quando o turno acaba", async () => {
    await rotear("u1", msg(), { conversaEu: true });
    await esperar();
    expect(marcarTurnoPendente).toHaveBeenCalledWith("u1", "m1");
    expect(limparTurnoPendente).not.toHaveBeenCalled();
    soltarTurno();
    await esperar();
    expect(limparTurnoPendente).toHaveBeenCalledWith("u1", "m1");
  });

  it("turno que falha também termina (senão cada subida repetiria o erro)", async () => {
    turnoDoDono.mockImplementationOnce(() => Promise.reject(new Error("sem modelo")));
    await rotear("u1", msg({ id: "m2" }), { conversaEu: true });
    await esperar();
    expect(limparTurnoPendente).toHaveBeenCalledWith("u1", "m2");
  });

  it("mensagem sem turno (contato comum) nem ganha a marca", async () => {
    await rotear("u1", msg({ id: "m3", chatJid: "5511911111111@s.whatsapp.net", deMim: false }), { conversaEu: false });
    expect(marcarTurnoPendente).not.toHaveBeenCalled();
    expect(turnoDoDono).not.toHaveBeenCalled();
  });
});

describe("retomar ao subir", () => {
  const subida = new Date("2026-09-28T00:35:00Z");
  const agora = new Date("2026-09-28T00:40:00Z");

  it("pede só turno começado ANTES da subida, dentro da janela, e roteia de novo", async () => {
    turnosInterrompidos.mockResolvedValueOnce([msg({ id: "m9" })]);
    expect(await retomarTurnosInterrompidos(agora, subida)).toBe(1);
    const [desde, ate] = turnosInterrompidos.mock.calls[0] as [Date, Date];
    expect(desde.toISOString()).toBe("2026-09-28T00:25:00.000Z");
    expect(ate).toBe(subida);
    await esperar();
    expect(turnoDoDono).toHaveBeenCalledWith("u1", EU, expect.objectContaining({ id: "m9" }));
    soltarTurno();
  });

  it("outro processo já reivindicou: não responde em dobro", async () => {
    turnosInterrompidos.mockResolvedValueOnce([msg()]);
    reivindicou = false;
    expect(await retomarTurnosInterrompidos(agora, subida)).toBe(0);
    expect(turnoDoDono).not.toHaveBeenCalled();
  });

  it("turno que já respondeu ou já propôs: só limpa a marca, não roda de novo", async () => {
    turnosInterrompidos.mockResolvedValueOnce([msg()]);
    efeito = [{ id: "resposta" }];
    expect(await retomarTurnosInterrompidos(agora, subida)).toBe(0);
    expect(turnoDoDono).not.toHaveBeenCalled();
    expect(limparTurnoPendente).toHaveBeenCalledWith("u1", "m1");
  });

  it("'manda' interrompido não volta ao modelo: avisa o dono para conferir", async () => {
    turnosInterrompidos.mockResolvedValueOnce([msg({ texto: "manda" })]);
    expect(await retomarTurnosInterrompidos(agora, subida)).toBe(0);
    expect(turnoDoDono).not.toHaveBeenCalled();
    expect(enviarTexto).toHaveBeenCalledWith("u1", EU, expect.stringContaining("Confira em Ações a confirmar"), { aprovacaoHumana: true });
  });

  it("desligado (0 minutos): não olha nada", async () => {
    cfg["whatsapp.retomarMinutos"] = 0;
    try {
      expect(await retomarTurnosInterrompidos(agora, subida)).toBe(0);
      expect(turnosInterrompidos).not.toHaveBeenCalled();
    } finally {
      cfg["whatsapp.retomarMinutos"] = 15;
    }
  });
});
