import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Resumo de conversa cobrindo 100% das mensagens. O que precisa valer sempre:
 * toda mensagem está na parte não resumida (que vai inteira) OU no resumo;
 * nenhuma é dobrada duas vezes; e cair no meio não perde o que já foi feito.
 */

let mensagens: { role: "user" | "assistant"; content: string }[] = [];
let conv = { id: "c1", summary: null as string | null, summaryCount: 0 };
const gravados: { summary: string; summaryCount: number }[] = [];
const prompts: string[] = [];
let falharNaChamada = -1;

vi.mock("@orbita/db", () => {
  const cadeia = (): Record<string, unknown> => {
    const estado = { tabela: "", offset: 0, limite: Infinity, contar: false };
    const p: Record<string, unknown> = {};
    p.select = (campos?: Record<string, unknown>) => {
      estado.contar = Boolean(campos && "total" in campos);
      return p;
    };
    p.from = (t: unknown) => {
      estado.tabela = String((t as Record<symbol, string>)[Symbol.for("drizzle:Name")] ?? "");
      return p;
    };
    for (const k of ["where", "orderBy"]) p[k] = () => p;
    p.offset = (n: number) => ((estado.offset = n), p);
    p.limit = (n: number) => ((estado.limite = n), p);
    p.update = () => p;
    p.set = (v: { summary: string; summaryCount: number }) => {
      gravados.push(v);
      conv = { ...conv, summary: v.summary, summaryCount: v.summaryCount };
      return p;
    };
    p.then = (ok: (v: unknown) => void) => {
      if (estado.contar) return ok([{ total: mensagens.length }]);
      if (estado.tabela === "conversation") return ok([conv]);
      return ok(mensagens.slice(estado.offset, estado.offset + estado.limite));
    };
    return p;
  };
  return { db: { select: (c?: Record<string, unknown>) => (cadeia().select as (c?: unknown) => unknown)(c), update: () => cadeia() } };
});
vi.mock("../settings", () => ({
  settings: { getMany: async () => ({ "chat.historyWindow": 4, "chat.summaryBatch": 3, "chat.summaryMaxChars": 500, "chat.summaryModel": "" }) },
}));
// `modeloDaCasa` passou a montar a CADEIA da casa em vez de resolver uma chave
// solta: sem `buildModelChain` no dobro, o resumo nem chega ao modelo.
vi.mock("@orbita/llm", () => ({
  resolveModel: () => ({}),
  fallbackModelKey: async () => "local/x",
  buildModelChain: (k: string) => [k],
}));
// o registro de consumo é best-effort e não deve exigir banco no teste do resumo
vi.mock("../usage/registrar", () => ({ registrarUso: () => {}, FLUXO: { resumoConversa: "resumo_conversa" } }));
let chamada = 0;
vi.mock("ai", () => ({
  generateText: async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    if (chamada++ === falharNaChamada) throw new Error("modelo fora");
    return { text: `resumo até a chamada ${chamada}` };
  },
}));

import { blocoDoResumo, foldConversation, inicioDoHistorico, quantasDobrar } from "./conversation-summary";

const conversa = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `mensagem ${i + 1}` }));

beforeEach(() => {
  mensagens = [];
  conv = { id: "c1", summary: null, summaryCount: 0 };
  gravados.length = 0;
  prompts.length = 0;
  chamada = 0;
  falharNaChamada = -1;
});

describe("cobertura de 100%", () => {
  it("toda mensagem está no resumo ou no histórico do turno, sem sobra e sem repetir", () => {
    for (const [total, jaResumidas] of [[10, 0], [10, 6], [30, 26], [3, 0]] as const) {
      const { inicio, foraDoTurno } = inicioDoHistorico(total, jaResumidas, 60);
      expect(foraDoTurno).toBe(0);
      // resumo cobre [0, jaResumidas); histórico cobre [inicio, total)
      expect(inicio).toBe(jaResumidas);
    }
  });

  it("conversa antiga enorme: vai o teto mais recente e o resto é contado como pendente de resumo", () => {
    expect(inicioDoHistorico(500, 0, 60)).toEqual({ inicio: 440, foraDoTurno: 440 });
  });

  it("só dobra o que passou da janela", () => {
    expect(quantasDobrar(10, 0, 4)).toBe(6);
    expect(quantasDobrar(10, 6, 4)).toBe(0);
    expect(quantasDobrar(3, 0, 4)).toBe(0);
  });

  it("sem resumo, o bloco do prompt nem aparece", () => {
    expect(blocoDoResumo(null)).toBe("");
    expect(blocoDoResumo("  ")).toBe("");
    expect(blocoDoResumo("pediu relatório na sexta")).toContain("pediu relatório na sexta");
  });
});

describe("dobrar no resumo", () => {
  it("dobra tudo que saiu da janela, em lotes, na ordem, gravando a cada lote", async () => {
    mensagens = conversa(10); // janela 4 → dobra 6, em lotes de 3
    expect(await foldConversation("c1")).toEqual({ dobradas: 6 });
    expect(gravados.map((g) => g.summaryCount)).toEqual([3, 6]);
    expect(prompts[0]).toContain("mensagem 1");
    expect(prompts[0]).not.toContain("mensagem 4");
    // o segundo lote parte do resumo do primeiro, não do zero
    expect(prompts[1]).toContain("resumo até a chamada 1");
    expect(prompts[1]).toContain("mensagem 6");
  });

  it("nunca dobra a mesma mensagem duas vezes", async () => {
    mensagens = conversa(10);
    await foldConversation("c1");
    expect(await foldConversation("c1")).toEqual({ dobradas: 0 });
  });

  it("caiu no meio: o que foi gravado fica, e a próxima tentativa continua de onde parou", async () => {
    mensagens = conversa(10);
    falharNaChamada = 1; // o segundo lote falha
    await expect(foldConversation("c1")).rejects.toThrow();
    expect(conv.summaryCount).toBe(3);
    await foldConversation("c1");
    expect(conv.summaryCount).toBe(6);
  });

  it("conversa que cabe na janela não chama o modelo", async () => {
    mensagens = conversa(3);
    await foldConversation("c1");
    expect(prompts).toEqual([]);
  });
});
