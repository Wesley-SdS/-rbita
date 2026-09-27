import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TODA saída de WhatsApp passa por `enviar.ts`. O que fica travado:
 *   - a linha da saída nasce ANTES do envio (é por ela que o eco é reconhecido)
 *     e é confirmada com o id, ou desfeita se o envio falhou;
 *   - timeout depois de a ponte aceitar NÃO desfaz a linha (EnvioIncerto);
 *   - abordagem fria só com aprovação humana; a conversa "Eu" nunca é fria;
 *   - sem sessão conectada, nada sai pelo número pessoal.
 */

const ordem: string[] = [];
let sessao: { deviceId: string; status: string; jid: string | null } | null = { deviceId: "dev1", status: "conectado", jid: "5511900000000@s.whatsapp.net" };
let contato = { id: "c1", jid: "5511922222222@s.whatsapp.net", escreveuAlgumaVez: true };
let enviadas = 0;

class PonteError extends Error {
  constructor(m: string, public motivo: string) {
    super(m);
  }
}
const enviarTextoPonte = vi.fn(async (..._a: unknown[]) => {
  ordem.push("ponte");
  return "WAID";
});
const enviarMidiaPonte = vi.fn(async (..._a: unknown[]) => "WAMID");

vi.mock("./gowa/client", () => ({ PonteError, enviarTexto: enviarTextoPonte, enviarMidia: enviarMidiaPonte }));
vi.mock("./sessao", () => ({ sessaoDe: async () => sessao, pessoalConectado: async () => sessao?.status === "conectado" }));
vi.mock("../connectors/whatsapp", () => ({ sendWhatsApp: vi.fn(async () => ({ id: "CLOUD" })), whatsappConfigured: async () => false }));
vi.mock("../settings", () => ({
  settings: {
    get: async (k: string) => (k === "whatsapp.provedor" ? "auto" : 0),
    getMany: async () => ({ "whatsapp.envioPorMinuto": 20, "whatsapp.envioPorDia": 300 }),
  },
}));
vi.mock("../voice/sintetizar", () => ({
  sintetizarFala: async () => ({ bytes: new Uint8Array([1]), mime: "audio/mpeg" }),
  paraNotaDeVoz: vi.fn(async () => ({ bytes: new Uint8Array([2]), mime: "audio/ogg; codecs=opus" })),
}));
vi.mock("./midia", () => ({ salvarMidia: async () => ({ caminho: "aa/x.ogg", sha256: "x" }), lerMidia: async () => new Uint8Array([3]) }));
const store = {
  contatoPorJid: vi.fn(async (..._a: unknown[]) => contato),
  garantirContato: vi.fn(async (..._a: unknown[]) => ({ ...contato, escreveuAlgumaVez: false })),
  enviadasDesde: vi.fn(async (..._a: unknown[]) => enviadas),
  registrarSaida: vi.fn(async (..._a: unknown[]) => {
    ordem.push("registrar");
    return "linha1";
  }),
  confirmarSaida: vi.fn(async (..._a: unknown[]) => {
    ordem.push("confirmar");
  }),
  desfazerSaida: vi.fn(async (..._a: unknown[]) => {
    ordem.push("desfazer");
  }),
  atualizarMensagemPorId: vi.fn(async () => undefined),
  mensagemPorId: vi.fn(async () => ({ id: "img1", tipo: "imagem", midiaCaminho: "bb/y.jpg", midiaMime: "image/jpeg" })),
};
vi.mock("./store", () => store);
vi.mock("@orbita/db", () => ({ db: {} }));

const { enviarTexto, enviarAudio, EnvioIncerto, EnvioRecusado } = await import("./enviar");

beforeEach(() => {
  vi.clearAllMocks();
  ordem.length = 0;
  sessao = { deviceId: "dev1", status: "conectado", jid: "5511900000000@s.whatsapp.net" };
  contato = { id: "c1", jid: "5511922222222@s.whatsapp.net", escreveuAlgumaVez: true };
  enviadas = 0;
});

describe("enviarTexto pelo número pessoal", () => {
  it("grava a saída ANTES de mandar e confirma com o id depois", async () => {
    const r = await enviarTexto("u1", "5511922222222", "chego às 8", { aprovacaoHumana: true });
    expect(r).toEqual({ provedor: "pessoal", id: "WAID", para: "5511922222222@s.whatsapp.net" });
    expect(ordem).toEqual(["registrar", "ponte", "confirmar"]);
    expect(store.confirmarSaida).toHaveBeenCalledWith("u1", "linha1", "WAID");
  });

  it("falha do envio desfaz a linha e sobe o erro", async () => {
    enviarTextoPonte.mockRejectedValueOnce(new PonteError("recusou", "recusado"));
    await expect(enviarTexto("u1", "5511922222222", "x", { aprovacaoHumana: true })).rejects.toThrow("recusou");
    expect(ordem).toEqual(["registrar", "desfazer"]);
  });

  it("timeout depois de a ponte aceitar: EnvioIncerto e a linha FICA (o eco ainda casa com ela)", async () => {
    enviarTextoPonte.mockRejectedValueOnce(new PonteError("demorou", "tempo"));
    await expect(enviarTexto("u1", "5511922222222", "x", { aprovacaoHumana: true })).rejects.toBeInstanceOf(EnvioIncerto);
    expect(store.desfazerSaida).not.toHaveBeenCalled();
  });

  it("contato novo (nunca escreveu) só com aprovação humana", async () => {
    store.contatoPorJid.mockResolvedValueOnce(null as never);
    await expect(enviarTexto("u1", "5511977776666", "oi", { aprovacaoHumana: false, automatica: true })).rejects.toBeInstanceOf(EnvioRecusado);
    expect(enviarTextoPonte).not.toHaveBeenCalled();
    store.contatoPorJid.mockResolvedValueOnce(null as never);
    await expect(enviarTexto("u1", "5511977776666", "oi", { aprovacaoHumana: true })).resolves.toMatchObject({ id: "WAID" });
  });

  it("a conversa 'Eu' nunca é abordagem fria", async () => {
    store.contatoPorJid.mockResolvedValueOnce({ ...contato, jid: "5511900000000@s.whatsapp.net", escreveuAlgumaVez: false });
    await expect(enviarTexto("u1", "5511900000000@s.whatsapp.net", "resposta", { aprovacaoHumana: false })).resolves.toMatchObject({ id: "WAID" });
  });

  it("teto por minuto vale até com aprovação", async () => {
    enviadas = 20;
    await expect(enviarTexto("u1", "5511922222222", "x", { aprovacaoHumana: true })).rejects.toThrow("por minuto");
    expect(store.registrarSaida).not.toHaveBeenCalled();
  });

  it("sessão desconectada: nenhum provedor, nada sai", async () => {
    sessao = { deviceId: "dev1", status: "desconectado", jid: null };
    await expect(enviarTexto("u1", "5511922222222", "x", { aprovacaoHumana: true })).rejects.toBeInstanceOf(EnvioRecusado);
    expect(enviarTextoPonte).not.toHaveBeenCalled();
  });
});

describe("enviarAudio", () => {
  it("sai como nota de voz OGG e guarda o que foi DITO na transcrição", async () => {
    await enviarAudio("u1", "5511922222222", "já saí", { aprovacaoHumana: true });
    expect(enviarMidiaPonte).toHaveBeenCalledWith("dev1", "5511922222222@s.whatsapp.net", "audio", expect.any(Uint8Array), "audio/ogg", "orbita.ogg");
    expect(store.atualizarMensagemPorId).toHaveBeenCalledWith("u1", "linha1", { transcricao: "já saí" });
  });
});
