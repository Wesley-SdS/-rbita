import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O turno no Telegram. O que fica travado:
 *   - a pessoa da casa (Anna) NÃO recebe o que é do dono: só os domínios
 *     liberados, sem RAG, sem persona, sem memória, e quem pede vai na proposta;
 *   - a proposta nascida no turno dela vai para o DONO, com botão (perigosa, sem);
 *   - o dono aprova com "manda"; a pessoa, não.
 *   - avisos: desligado, sem dono vinculado, silêncio e teto.
 *   - conectar o bot confere o token; as tools só falam com quem está vinculado.
 */

const cfg: Record<string, unknown> = {
  "telegram.historicoConversa": 5,
  "telegram.dominiosDaFamilia": ["casa", "clima"],
  "chat.maxSteps": 4,
  "chat.ragTimeoutMs": 100,
  "rag.topK": 3,
  "memory.extractEnabled": true,
  "meetings.meuNome": "Wesley",
  "telegram.respostaFormato": "espelhar",
  "telegram.avisos": "todos",
  "telegram.avisosSilencio": "",
  "telegram.avisosPorHora": 2,
  "telegram.conviteMinutos": 60,
  "connectors.fusoHorario": "America/Sao_Paulo",
};
vi.mock("../settings", () => ({ settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) } }));
vi.mock("../settings/apply", () => ({ applyLlmSettings: async () => undefined }));

// banco: cada select devolve o próximo resultado da fila; o resto só encadeia
let selects: unknown[][] = [];
const inseridos: unknown[] = [];
const cadeia = (resultado: unknown): unknown =>
  new Proxy(() => undefined, {
    get: (_a, p) => (p === "then" ? (ok: (v: unknown) => void) => ok(resultado) : () => cadeia(resultado)),
    apply: () => cadeia(resultado),
  });
vi.mock("@orbita/db", () => ({
  db: {
    select: () => cadeia(selects.shift() ?? []),
    insert: () => ({
      values: (v: unknown) => {
        inseridos.push(v);
        return cadeia([{ id: "conv-1" }]);
      },
    }),
    update: () => cadeia(undefined),
  },
}));

const buildAllTools = vi.fn(async (..._a: unknown[]) => ({ tools: {}, cleanup: async () => undefined, skillInstructions: "" }));
const retrieveContext = vi.fn(async () => [{ source: "extrato", content: "saldo do Wesley" }]);
const buildPersonaContext = vi.fn(async () => "Wesley gosta de café");
vi.mock("../chat/tools", () => ({ SYSTEM_PROMPT: "SISTEMA", buildAllTools: (...a: unknown[]) => buildAllTools(...a), buildPersonaContext: () => buildPersonaContext(), buildTemporalContext: () => "" }));
vi.mock("../rag/retrieve", () => ({ retrieveContext: () => retrieveContext() }));
const gerarTexto = vi.fn(async (..._a: unknown[]) => ({ texto: "Pronto, pedi para o Wesley aprovar." }));
vi.mock("../llm/gerar", () => ({ gerarTexto: (...a: unknown[]) => gerarTexto(...a) }));
const aprovarPorFrase = vi.fn(async (..._a: unknown[]): Promise<{ texto: string } | null> => null);
vi.mock("../actions/por-frase", () => ({ aprovarPorFrase: (...a: unknown[]) => aprovarPorFrase(...a) }));
vi.mock("../tools/index", () => ({ getTool: (k: string) => ({ name: k }), effectiveRisk: (d: { name: string }) => (d.name === "destrancar_porta" ? "perigoso" : "efeito_externo"), loadToolOverrides: async () => ({}) }));
vi.mock("../identity/people", () => ({ getPerson: async () => ({ id: "p-anna", name: "Anna", role: "morador" }) }));
const enqueueJob = vi.fn(async () => ({}));
vi.mock("../jobs/queue", () => ({ enqueueJob }));
vi.mock("../cameras/narrate", () => ({ narrateSnapshot: vi.fn() }));
vi.mock("../whatsapp/midia", () => ({ lerMidia: vi.fn() }));

const DONO = { id: "c1", telegramId: "42", papel: "dono" as const, personId: null, nome: "Wesley" };
const store = { donoNoTelegram: vi.fn(async () => DONO), marcarAvisado: vi.fn(async () => undefined), botDe: vi.fn(async (): Promise<unknown> => ({ tokenEnc: "x", username: "orbita_bot" })), tokenDo: () => "123:tok", registrarSaida: vi.fn(async () => undefined), criarConvite: vi.fn(async () => ({ codigo: "COD", expiraEm: new Date() })), salvarBot: vi.fn(async () => undefined), listarContatos: vi.fn(async (): Promise<unknown[]> => []), contatoPorId: vi.fn(async (): Promise<unknown> => null) };
vi.mock("./store", () => store);
const api = { mandarTexto: vi.fn(async () => ({ message_id: 1 })), mandarVoz: vi.fn(async () => ({ message_id: 2 })), eu: vi.fn(async (): Promise<unknown> => ({ id: 1, is_bot: true, username: "orbita_bot" })), definirComandos: vi.fn(async () => true) };
vi.mock("./api", async () => ({ ...(await vi.importActual<typeof import("./api")>("./api")), ...api }));
vi.mock("../voice/sintetizar", () => ({ sintetizarFala: async () => ({ bytes: new Uint8Array([1]), mime: "audio/mpeg" }), paraNotaDeVoz: async () => ({ bytes: new Uint8Array([2]), mime: "audio/ogg; codecs=opus" }) }));

const { turnoDoTelegram } = await import("./turno");
const { avisarNoTelegram, _zerarTeto } = await import("./enviar");
const { conectarBot, BotInvalido, criarLinkDeConvite } = await import("./bot");
const { enviar_telegram } = await import("../tools/domains/telegram");

const ANNA = { id: "c2", telegramId: "43", papel: "pessoa" as const, personId: "p-anna", nome: "Anna", username: null, avisadoEm: null, vinculadoEm: null, criadoEm: new Date(), userId: "u1" };
const msg = (texto: string) => ({ id: "m1", tipo: "texto", texto, transcricao: null, midiaCaminho: null, midiaMime: null }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  selects = [];
  inseridos.length = 0;
  _zerarTeto();
});

describe("turno da pessoa da casa", () => {
  it("só os domínios liberados, sem RAG, persona nem memória; quem pede é ela, pelo Telegram", async () => {
    selects = [[], [], []]; // conversa, histórico, propostas novas
    await turnoDoTelegram("u1", ANNA as never, msg("acende a luz da sala"));
    const [, , resolver, , , opts] = buildAllTools.mock.calls[0] as [unknown, unknown, () => Promise<unknown>, unknown, unknown, { canal: string; dominios?: string[] }];
    expect(opts).toMatchObject({ canal: "telegram", dominios: ["casa", "clima"] });
    expect(await resolver()).toMatchObject({ personId: "p-anna", name: "Anna", via: "telegram", role: "morador" });
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(buildPersonaContext).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
    const system = (gerarTexto.mock.calls[0][0] as { system: string }).system;
    expect(system).toContain("NÃO é o dono");
    expect(system).not.toContain("saldo do Wesley");
    expect(aprovarPorFrase).not.toHaveBeenCalled();
  });

  it("proposta nascida no turno dela vai para o DONO com botão; a perigosa, sem botão", async () => {
    selects = [[], [], [{ id: "a1", kind: "enviar_whatsapp", resumo: "Enviar WhatsApp para Maria" }, { id: "a2", kind: "destrancar_porta", resumo: "Destrancar a porta" }]];
    await turnoDoTelegram("u1", ANNA as never, msg("manda um zap pra Maria e abre a porta"));
    // 1ª: a resposta para a Anna; 2ª e 3ª: as propostas para o dono (42)
    const paraDono = api.mandarTexto.mock.calls.filter((c) => (c as unknown[])[1] === "42") as unknown as [string, string, string, unknown][];
    expect(paraDono).toHaveLength(2);
    expect(paraDono[0][2]).toContain("Anna pediu pelo Telegram");
    expect(paraDono[0][3]).toBeDefined(); // botões
    expect(paraDono[1][2]).toContain("só se aprova pela tela");
    expect(paraDono[1][3]).toBeUndefined();
  });
});

describe("turno do dono", () => {
  it("tem tudo: todas as tools, RAG, persona, e a memória aprende", async () => {
    selects = [[], [], []];
    await turnoDoTelegram("u1", { ...DONO, username: null, avisadoEm: null, vinculadoEm: null, criadoEm: new Date(), userId: "u1" } as never, msg("quanto posso gastar hoje?"));
    expect((buildAllTools.mock.calls[0] as unknown[])[5]).toMatchObject({ canal: "telegram", todas: true });
    expect(retrieveContext).toHaveBeenCalled();
    expect(enqueueJob).toHaveBeenCalled();
  });

  it("'manda' aprova pela frase, sem passar pelo modelo", async () => {
    selects = [[]];
    aprovarPorFrase.mockResolvedValueOnce({ texto: "Enviado." });
    await turnoDoTelegram("u1", { ...DONO, username: null, avisadoEm: null, vinculadoEm: null, criadoEm: new Date(), userId: "u1" } as never, msg("manda"));
    expect(aprovarPorFrase).toHaveBeenCalledWith("u1", "telegram", "manda", null);
    expect(gerarTexto).not.toHaveBeenCalled();
  });
});

describe("avisos no Telegram", () => {
  it("manda ao dono; desligado, sem dono vinculado e acima do teto, não", async () => {
    expect(await avisarNoTelegram("u1", "Conta", "Internet vence amanhã")).toBe("enviado");
    expect(api.mandarTexto).toHaveBeenCalledWith("123:tok", "42", "Conta\nInternet vence amanhã", undefined);
    expect(await avisarNoTelegram("u1", "b", "b")).toBe("enviado");
    expect(await avisarNoTelegram("u1", "c", "c")).toBe("teto");
    cfg["telegram.avisos"] = "desligado";
    expect(await avisarNoTelegram("u1", "d", "d")).toBe("desligado");
    cfg["telegram.avisos"] = "todos";
    store.donoNoTelegram.mockResolvedValueOnce(null as never);
    _zerarTeto();
    expect(await avisarNoTelegram("u1", "e", "e")).toBe("sem_telegram");
  });
});

describe("conectar o bot e as tools", () => {
  it("token com cara errada nem vai ao Telegram; recusado vira recado claro", async () => {
    await expect(conectarBot("u1", "abc")).rejects.toBeInstanceOf(BotInvalido);
    expect(api.eu).not.toHaveBeenCalled();
    const { TelegramErro } = await import("./api");
    api.eu.mockRejectedValueOnce(new TelegramErro("Unauthorized", 401));
    await expect(conectarBot("u1", "1234567:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow("recusou");
    expect(await conectarBot("u1", "1234567:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toEqual({ username: "orbita_bot" });
    expect(store.salvarBot).toHaveBeenCalled();
  });

  it("convite: link do bot com o código; pessoa sem escolher, recusa", async () => {
    expect((await criarLinkDeConvite("u1", "dono", null)).link).toBe("https://t.me/orbita_bot?start=COD");
    await expect(criarLinkDeConvite("u1", "pessoa", null)).rejects.toBeInstanceOf(BotInvalido);
  });

  it("enviar_telegram: só para quem está vinculado, e o nome do resumo vem do código", async () => {
    store.listarContatos.mockResolvedValue([{ ...ANNA }]);
    expect(await enviar_telegram.authorize!({ para: "Pedro", texto: "oi" }, { userId: "u1" })).toContain("não está vinculado");
    const fixo = await enviar_telegram.preparar!({ para: "a Anna", para_nome: "Mãe", texto: "chego às 8" }, { userId: "u1" });
    expect(fixo).toMatchObject({ para_id: "c2", para_nome: "Anna" });
    expect(enviar_telegram.risk).toBe("efeito_externo");
    store.contatoPorId.mockResolvedValueOnce({ ...ANNA });
    expect(await enviar_telegram.run(fixo, { userId: "u1" })).toBe("Enviado pelo Telegram.");
    expect(api.mandarTexto).toHaveBeenCalledWith("123:tok", "43", "chego às 8", undefined);
  });
});
