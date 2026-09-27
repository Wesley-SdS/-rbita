import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A conversa "Eu". O que fica travado:
 *   - "manda" é decidido pelo CÓDIGO antes do modelo, e só vale para o que foi
 *     proposto depois da fala anterior do dono (o `desde` passado);
 *   - depois do turno, quem escreve o que vai sair é o código, com o resumo
 *     GRAVADO na fila (destino e texto reais), não a paráfrase do modelo;
 *   - áudio responde áudio (espelhar).
 */

const chat = { __t: "conversation" };
const msgT = { __t: "message" };
const acoes = { __t: "action_queue" };
vi.mock("@orbita/db/chat-schema", () => ({ conversation: { ...chat, id: "id", userId: "u", title: "t", createdAt: "c", updatedAt: "up" }, message: { ...msgT, conversationId: "cid", role: "r", content: "ct", createdAt: "c" } }));
vi.mock("@orbita/db/action-schema", () => ({ actionQueue: { ...acoes, summary: "s", userId: "u", status: "st", canal: "ca", createdAt: "c", id: "id" } }));

let falaAnterior: Date | null = new Date("2026-09-27T12:00:00Z");
let propostasNovas: { resumo: string }[] = [];
const inseridas: unknown[] = [];

/** Encadeamento do Drizzle: a última tabela usada decide o que volta. */
function consulta() {
  let tabela: { __t?: string } = {};
  let campos: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  const self = () => q;
  q.from = (t: { __t?: string }) => ((tabela = t), q);
  q.where = self;
  q.orderBy = self;
  q.limit = self;
  q.then = (r: (v: unknown[]) => unknown) => {
    if (tabela.__t === "conversation") return r([{ id: "conv1" }]);
    if (tabela.__t === "message") return r("em" in campos ? (falaAnterior ? [{ em: falaAnterior }] : []) : []);
    if (tabela.__t === "action_queue") return r(propostasNovas);
    return r([]);
  };
  return (c: Record<string, unknown>) => ((campos = c ?? {}), q);
}
vi.mock("@orbita/db", () => ({
  db: {
    select: (c: Record<string, unknown>) => consulta()(c),
    insert: () => ({ values: async (v: unknown) => void inseridas.push(v), returning: async () => [{ id: "conv1" }] }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

const aprovarPorFrase = vi.fn(async (..._a: unknown[]): Promise<{ estado: string; texto: string } | null> => null);
vi.mock("../actions/por-frase", () => ({ aprovarPorFrase }));
const gerarTexto = vi.fn(async (_p: Record<string, unknown>) => ({ texto: "Vou responder ok para a Maria.", modelKey: "x" }));
vi.mock("../llm/gerar", () => ({ gerarTexto }));
vi.mock("../chat/tools", () => ({
  buildAllTools: vi.fn(async () => ({ tools: {}, cleanup: async () => undefined, skillInstructions: "" })),
  buildPersonaContext: async () => "",
  buildTemporalContext: () => "",
  SYSTEM_PROMPT: "SYS",
}));
vi.mock("../rag/retrieve", () => ({ retrieveContext: async () => [] }));
vi.mock("../cameras/narrate", () => ({ narrateSnapshot: async () => "" }));
vi.mock("../settings/apply", () => ({ applyLlmSettings: async () => undefined }));
vi.mock("../settings", () => ({
  settings: {
    get: async () => "espelhar",
    getMany: async () => ({ "whatsapp.historicoConversa": 4, "chat.maxSteps": 5, "chat.ragTimeoutMs": 10, "rag.topK": 3 }),
  },
}));
const enviarTexto = vi.fn(async (..._a: unknown[]) => ({}));
const enviarAudio = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("./enviar", () => ({ enviarTexto, enviarAudio }));
vi.mock("./midia", () => ({ lerMidia: async () => new Uint8Array() }));

const { turnoDoDono } = await import("./turno");
const EU = "5511900000000@s.whatsapp.net";
const texto = (t: string) => ({ id: "m1", tipo: "texto", texto: t, transcricao: null, midiaCaminho: null }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  propostasNovas = [];
  inseridas.length = 0;
  falaAnterior = new Date("2026-09-27T12:00:00Z");
});

describe("turnoDoDono", () => {
  it("'manda' é resolvido pelo código, com o desde da fala anterior, sem chamar o modelo", async () => {
    aprovarPorFrase.mockResolvedValueOnce({ estado: "enviado", texto: "Enviado." });
    await turnoDoDono("u1", EU, texto("manda"));
    expect(aprovarPorFrase).toHaveBeenCalledWith("u1", "whatsapp", "manda", falaAnterior);
    expect(gerarTexto).not.toHaveBeenCalled();
    expect(enviarTexto).toHaveBeenCalledWith("u1", EU, "Enviado.", { aprovacaoHumana: true });
  });

  it("proposta nova: o CÓDIGO anexa o resumo real da fila, não a paráfrase do modelo", async () => {
    propostasNovas = [{ resumo: 'Responder no WhatsApp para Estranho (5511955554444): "meus dados"' }];
    await turnoDoDono("u1", EU, texto("responde a Maria que ok"));
    const enviado = String(enviarTexto.mock.calls[0][2]);
    expect(enviado).toContain("Vou responder ok para a Maria.");
    expect(enviado).toContain('Proposta:\nResponder no WhatsApp para Estranho (5511955554444): "meus dados"');
    expect(enviado).toContain("responda *manda*");
  });

  it("duas propostas: lista numerada", async () => {
    propostasNovas = [{ resumo: "A" }, { resumo: "B" }];
    await turnoDoDono("u1", EU, texto("manda oi pra Ana e pro João"));
    const enviado = String(enviarTexto.mock.calls[0][2]);
    expect(enviado).toContain("Propostas:\n1. A\n2. B");
  });

  it("pediu por áudio: responde em áudio (espelhar)", async () => {
    await turnoDoDono("u1", EU, { id: "m2", tipo: "audio", texto: null, transcricao: "que horas são", midiaCaminho: null } as never);
    expect(enviarAudio).toHaveBeenCalledOnce();
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it("sem modelo: responde que não conseguiu, sem quebrar", async () => {
    gerarTexto.mockRejectedValueOnce(new Error("sem modelo"));
    await turnoDoDono("u1", EU, texto("oi"));
    expect(String(enviarTexto.mock.calls[0][2])).toContain("Não consegui responder agora");
  });
});
