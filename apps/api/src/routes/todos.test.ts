import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lembrete pela rota de tarefas (a tela). O que fica travado: valor ilegível ou
 * no passado é 400 (antes virava "sem lembrete" com 200, apagando o que havia),
 * e a tela recebe o horário já no fuso da CASA.
 */
const criarTarefa = vi.fn(async (..._a: unknown[]) => ({ id: "t1" }));
const editarTarefa = vi.fn(async (..._a: unknown[]) => ({ id: "t1", text: "x", dueDate: null, lembrarEm: new Date("2030-01-01T18:00:00Z"), lembradoEm: null }));
vi.mock("@orbita/core/tarefas/store", () => ({
  criarTarefa,
  editarTarefa,
  listarTarefas: async () => [{ id: "t1", text: "x", dueDate: null, lembrarEm: new Date("2030-01-01T18:00:00Z"), lembradoEm: null }],
  removerTarefa: vi.fn(),
  tarefasDaOrigem: vi.fn(),
}));
vi.mock("@orbita/core/settings/index", () => ({ settings: { get: async () => "America/Sao_Paulo" } }));

const rota = await import("./todos");
const ctx = { params: {}, user: { id: "u1", email: "d@x", name: "Dono" } };
const pedir = (method: string, body: unknown) => new Request("http://x/api/todos", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("/api/todos com lembrete", () => {
  it("formato ilegível: 400, e nada é gravado", async () => {
    const r = await rota.PATCH(pedir("PATCH", { id: "11111111-1111-4111-8111-111111111111", lembrarEm: "amanhã 15h" }), ctx);
    expect(r.status).toBe(400);
    expect(editarTarefa).not.toHaveBeenCalled();
  });

  it("horário que já passou: 400", async () => {
    const r = await rota.POST(pedir("POST", { text: "ligar", lembrarEm: "2020-01-01T09:00" }), ctx);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Esse horário já passou." });
    expect(criarTarefa).not.toHaveBeenCalled();
  });

  it("válido: grava com o fuso da casa; null tira o lembrete", async () => {
    expect((await rota.POST(pedir("POST", { text: "ligar", lembrarEm: "2030-01-01T15:00" }), ctx)).status).toBe(200);
    expect(criarTarefa).toHaveBeenCalledWith("u1", expect.objectContaining({ lembrarEm: "2030-01-01T15:00", fuso: "America/Sao_Paulo" }));
    expect((await rota.PATCH(pedir("PATCH", { id: "11111111-1111-4111-8111-111111111111", lembrarEm: null }), ctx)).status).toBe(200);
  });

  it("a tela recebe o lembrete no horário da CASA, não no do navegador", async () => {
    const r = await rota.GET(new Request("http://x/api/todos"), ctx);
    const { todos } = (await r.json()) as { todos: { lembrarEmLocal: string }[] };
    expect(todos[0].lembrarEmLocal).toBe("2030-01-01T15:00");
  });
});
