import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O gate humano num lugar só: botão, frase e voz passam por aqui. O que fica
 * travado: a troca pending → done é condicional (dois "manda" não enviam duas
 * vezes), a proposta editada é validada ANTES de executar e gravada, e a
 * falha marca a linha como falhou.
 */

let linhaPendente: Record<string, unknown> | null = null;
const updates: Record<string, unknown>[] = [];
const executeAction = vi.fn(async (..._a: unknown[]) => "WhatsApp enviado");
const validarPropostaEditada = vi.fn((_k: string, p: unknown) => (p && (p as { texto?: string }).texto ? { ok: true as const, dados: p as Record<string, unknown> } : { ok: false as const, erro: "texto: obrigatório" }));
const emit = vi.fn(async () => undefined);

vi.mock("@orbita/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (linhaPendente ? [{ kind: linhaPendente.kind, payload: linhaPendente.payload }] : []) }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        const where = () => {
          // a primeira troca "consome" a pendente, como o WHERE status = 'pending' faria
          const consumida = v.status === "done" && linhaPendente ? { ...linhaPendente, ...(v.payload ? { payload: v.payload } : {}) } : null;
          if (v.status === "done") linhaPendente = null;
          return Object.assign(Promise.resolve(), { returning: async () => (consumida ? [consumida] : []) });
        };
        return { where };
      },
    }),
  },
}));
vi.mock("../connectors/execute", () => ({ executeAction, validarPropostaEditada }));
vi.mock("../events/index", () => ({ events: { emit } }));

const { aprovarAcao } = await import("./aprovar");
// a mesclagem da edição consulta o registro: as tools deste teste, como o catálogo as declararia
const { registerTools } = await import("../tools/registry");
const { z } = await import("zod");
registerTools([
  { name: "responder_whatsapp", domain: "teste", description: "x", risk: "efeito_externo", inputSchema: z.object({ para: z.string(), texto: z.string() }), run: async () => "ok" },
  {
    name: "navegador_teste",
    domain: "teste",
    description: "x",
    risk: "efeito_externo",
    camposEditaveis: ["texto"],
    inputSchema: z.object({ acao: z.string(), texto: z.string().nullish(), fixado: z.object({ alvo: z.object({ ref: z.string(), nome: z.string() }) }).nullish() }),
    run: async () => "ok",
  },
]);

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  linhaPendente = { id: "a1", kind: "responder_whatsapp", summary: "Responder mãe", payload: { para: "mãe", texto: "oi" }, canal: "whatsapp" };
});

describe("aprovarAcao", () => {
  it("executa, grava o resultado e emite o evento", async () => {
    expect(await aprovarAcao("u1", "a1")).toEqual({ ok: true, resultado: "WhatsApp enviado" });
    // o id da proposta vai junto: a trilha do controle do PC continua o passo que esperava na fila
    expect(executeAction).toHaveBeenCalledWith("u1", "responder_whatsapp", { para: "mãe", texto: "oi" }, "a1");
    expect(emit).toHaveBeenCalledWith("action.executed", expect.objectContaining({ kind: "responder_whatsapp" }), { userId: "u1" });
  });

  it("o segundo 'manda' não envia de novo", async () => {
    await aprovarAcao("u1", "a1");
    expect(await aprovarAcao("u1", "a1")).toMatchObject({ ok: false, status: 404 });
    expect(executeAction).toHaveBeenCalledOnce();
  });

  it("proposta editada: validada antes e é ELA que sai", async () => {
    expect(await aprovarAcao("u1", "a1", { texto: "" })).toEqual({ ok: false, status: 400, erro: "texto: obrigatório" });
    expect(executeAction).not.toHaveBeenCalled();
    await aprovarAcao("u1", "a1", { para: "mãe", texto: "chego 8h15" });
    expect(executeAction).toHaveBeenCalledWith("u1", "responder_whatsapp", { para: "mãe", texto: "chego 8h15" }, "a1");
  });

  it("B1: a edição com o alvo forjado é recusada e nada executa; editar o texto sai com o alvo GRAVADO", async () => {
    const fixado = { alvo: { ref: "ref_9", nome: "Ver mais" } };
    linhaPendente = { id: "a2", kind: "navegador_teste", summary: "Digitar", payload: { acao: "digitar", texto: "oi", fixado, risco: "efeito_externo", camposFixados: ["fixado"] }, canal: "tela" };
    // o que o cartão antigo mandava: a entrada crua do modelo, com outro alvo
    expect(await aprovarAcao("u1", "a2", { acao: "digitar", texto: "oi", fixado: { alvo: { ref: "ref_666", nome: "Pagar" } } })).toMatchObject({ ok: false, status: 400 });
    expect(executeAction).not.toHaveBeenCalled();
    expect(await aprovarAcao("u1", "a2", { texto: "olá" })).toMatchObject({ ok: true });
    expect(executeAction).toHaveBeenCalledWith("u1", "navegador_teste", { acao: "digitar", texto: "olá", fixado, risco: "efeito_externo", camposFixados: ["fixado"] }, "a2");
  });

  it("falha do envio marca a linha como falhou", async () => {
    executeAction.mockRejectedValueOnce(new Error("ponte fora do ar"));
    expect(await aprovarAcao("u1", "a1")).toEqual({ ok: false, status: 502, erro: "ponte fora do ar" });
    expect(updates.at(-1)).toEqual({ status: "failed", result: "ponte fora do ar" });
  });
});
