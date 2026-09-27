import { beforeEach, describe, expect, it, vi } from "vitest";

/** Trabalho pedido pelo WhatsApp avisa quando termina (quem pediu não olha a tela de trabalhos). */
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../routines/run", () => ({ notifyUser }));
vi.mock("../finance/documents", () => ({
  lerDataUrl: () => null,
  DocumentoIlegivelError: class extends Error {},
  importReceipt: async () => ({ id: "l1", lancamento: { descricao: "Padaria", valor: 42.5, categoria: "Alimentação", tipo: "expense", vencimento: null }, ocrText: "" }),
  importStatement: async () => ({ importados: 7, lancamentos: [] }),
}));
vi.mock("../rag/files", () => ({ indexFile: async () => ({}) }));
vi.mock("../rag/ingest", () => ({ ingestDocument: async () => ({ chunks: 3, documentId: "d1" }) }));
vi.mock("@orbita/db", () => ({ db: {} }));

const { jobDef } = await import("./registry");
await import("./handlers");
const ctx = (kind: string, payload: Record<string, unknown>) => ({ userId: "u1", jobId: "j", kind, payload, input: "data:x", progresso: async () => ({ cancelado: false }) }) as never;

beforeEach(() => vi.clearAllMocks());

describe("aviso ao terminar", () => {
  it("cupom pedido pelo WhatsApp avisa o que foi lançado", async () => {
    await jobDef("financas.cupom")!.run(ctx("financas.cupom", { avisar: true }));
    expect(notifyUser).toHaveBeenCalledWith("u1", "Comprovante lançado", "Padaria, R$ 42,50 (Alimentação).");
  });
  it("extrato, arquivo e texto também", async () => {
    await jobDef("financas.extrato")!.run(ctx("financas.extrato", { avisar: true }));
    await jobDef("rag.indexar_arquivo")!.run(ctx("rag.indexar_arquivo", { avisar: true, nome: "contrato" }));
    await jobDef("rag.indexar_texto")!.run(ctx("rag.indexar_texto", { avisar: true, title: "reunião" }));
    expect(notifyUser.mock.calls.map((c) => c[1])).toEqual(["Extrato importado", "Guardado no conhecimento", "Guardado no conhecimento"]);
  });
  it("pedido pela tela (sem avisar): silêncio, como sempre", async () => {
    await jobDef("financas.cupom")!.run(ctx("financas.cupom", {}));
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
