import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A mesma proposta pendente não vira outra linha na fila (27/09/2026: o modelo
 * releu o histórico e deixou três "Cadastrar Ana" esperando aprovação). A que
 * já existe renasce agora e no canal atual, para o "manda" desta conversa
 * valer para ela.
 */

let existente: { id: string } | null = null;
const atualizou: Record<string, unknown>[] = [];
const inseriu: Record<string, unknown>[] = [];
vi.mock("@orbita/db", () => ({
  db: {
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => ({ returning: async () => (existente ? (atualizou.push(v), [{ ...existente, summary: "Cadastrar Ana (morador) (pedido por voz: Wesley)" }]) : []) }) }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => (inseriu.push(v), [{ id: "nova" }]) }) }),
  },
}));
vi.mock("../settings", () => ({ settings: { get: async () => 30, getMany: async () => ({}) } }));

const { enqueueFor } = await import("./index");
const def = { name: "cadastrar_pessoa" } as never;

beforeEach(() => {
  existente = null;
  atualizou.length = 0;
  inseriu.length = 0;
});

describe("fila de aprovação", () => {
  it("proposta nova entra como linha nova", async () => {
    const r = await enqueueFor("u1", "whatsapp")(def, { nome: "Ana" }, "Cadastrar Ana (morador)");
    expect(r).toMatchObject({ proposta_enfileirada: true, id: "nova" });
    expect(inseriu[0]).toMatchObject({ kind: "cadastrar_pessoa", payload: { nome: "Ana" }, canal: "whatsapp" });
  });

  it("a mesma proposta ainda pendente não duplica: renasce agora, no canal atual", async () => {
    existente = { id: "velha" };
    const r = await enqueueFor("u1", "whatsapp")(def, { nome: "Ana" }, "Cadastrar Ana (morador)");
    expect(r).toMatchObject({ ja_estava_na_fila: true, id: "velha" });
    expect(inseriu).toHaveLength(0);
    expect(atualizou[0]).toMatchObject({ createdAt: expect.any(Date) });
    // não troca o canal nem o resumo (a nota de quem pediu fica)
    expect(atualizou[0]).not.toHaveProperty("canal");
    expect(atualizou[0]).not.toHaveProperty("summary");
    expect(r).toMatchObject({ resumo: "Cadastrar Ana (morador) (pedido por voz: Wesley)" });
  });
});
