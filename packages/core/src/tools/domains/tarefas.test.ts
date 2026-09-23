import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As cinco tools de tarefa (CLAUDE.md §5.7: tool sem teste de `execute` não
 * está pronta). Duas coisas precisam valer aqui:
 *
 *   1. apagar é irreversível, então `remover_tarefa` nasce com risco
 *      `perigoso` e NUNCA executa sozinha: o gate é derivado do risco pelo
 *      registro, e o teste passa pelo `toToolSet` por isso. Testar só o `run`
 *      provaria menos do que o caminho real.
 *   2. concluir uma tarefa não pode apagar o vencimento dela: a edição manda
 *      só o campo que mudou.
 */

interface LinhaFalsa {
  id: string;
  text: string;
  done: boolean;
  dueDate: Date | null;
  notes: string | null;
  paraQuem: string | null;
  origemTipo: string | null;
  origemTitulo: string | null;
  origemTrecho: string | null;
}

let linhas: LinhaFalsa[] = [];
const criadas: unknown[] = [];
const edicoes: { id: string; edicao: unknown }[] = [];
let removeu = true;

const linha = (over: Partial<LinhaFalsa> = {}): LinhaFalsa => ({
  id: "t1",
  text: "assinar a carta do Cauã",
  done: false,
  dueDate: null,
  notes: null,
  paraQuem: null,
  origemTipo: null,
  origemTitulo: null,
  origemTrecho: null,
  ...over,
});

vi.mock("../../tarefas/store", () => ({
  listarTarefas: async () => linhas,
  criarTarefa: async (_u: string, nova: unknown) => {
    criadas.push(nova);
    return linha({ id: "novo" });
  },
  editarTarefa: async (_u: string, id: string, edicao: Record<string, unknown>) => {
    edicoes.push({ id, edicao });
    const atual = linhas.find((l) => l.id === id);
    if (!atual) return null;
    return { ...atual, done: edicao.concluida === undefined ? atual.done : Boolean(edicao.concluida) };
  },
  removerTarefa: async () => removeu,
}));

const { _resetRegistry, toToolSet, getTool } = await import("../registry");
const mod = await import("./tarefas");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const semGate = { enqueue: async () => ({ id: "acao-1" }) } as unknown as Parameters<typeof toToolSet>[2];

function executar(nome: string, input: unknown, enqueue?: Parameters<typeof toToolSet>[2]) {
  const set = toToolSet([getTool(nome)!], ctx, enqueue ?? semGate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] });
}

beforeEach(() => {
  linhas = [linha()];
  criadas.length = 0;
  edicoes.length = 0;
  removeu = true;
});

describe("as tools de tarefa", () => {
  it("as cinco estão registradas", () => {
    for (const nome of ["adicionar_tarefa", "listar_tarefas", "editar_tarefa", "concluir_tarefa", "remover_tarefa"]) {
      expect(getTool(nome), nome).toBeTruthy();
    }
  });

  it("adicionar guarda de onde a tarefa veio", async () => {
    await executar("adicionar_tarefa", {
      texto: "revisar o contrato",
      para_quem: "Madalena",
      origem: { tipo: "reuniao", titulo: "Reunião com o fornecedor", trecho: "você ficou de revisar até sexta" },
    });
    expect(criadas[0]).toMatchObject({
      texto: "revisar o contrato",
      paraQuem: "Madalena",
      origem: { tipo: "reuniao", titulo: "Reunião com o fornecedor" },
    });
  });

  it("listar devolve o porquê junto com a tarefa", async () => {
    linhas = [linha({ origemTipo: "reuniao", origemTitulo: "Semanal", origemTrecho: "ficou de assinar" })];
    const r = (await executar("listar_tarefas", {})) as { tarefas: { origem: { titulo: string } | null }[] };
    expect(r.tarefas[0]!.origem).toMatchObject({ tipo: "reuniao", titulo: "Semanal", trecho: "ficou de assinar" });
  });

  it("listar esconde as concluídas por padrão", async () => {
    linhas = [linha({ id: "a" }), linha({ id: "b", done: true })];
    const aberta = (await executar("listar_tarefas", {})) as { tarefas: unknown[] };
    const todas = (await executar("listar_tarefas", { incluir_concluidas: true })) as { tarefas: unknown[] };
    expect(aberta.tarefas).toHaveLength(1);
    expect(todas.tarefas).toHaveLength(2);
  });

  it("concluir manda só o que mudou (não apaga o vencimento)", async () => {
    await executar("concluir_tarefa", { id: "t1" });
    expect(edicoes[0]!.edicao).toEqual({ concluida: true });
  });

  it("reabrir é a mesma tool ao contrário", async () => {
    await executar("concluir_tarefa", { id: "t1", reabrir: true });
    expect(edicoes[0]!.edicao).toEqual({ concluida: false });
  });

  it("editar passa null adiante para limpar o campo", async () => {
    await executar("editar_tarefa", { id: "t1", vencimento: null });
    expect((edicoes[0]!.edicao as { vencimento: unknown }).vencimento).toBeNull();
  });

  it("tarefa que não é do dono não é editada em silêncio", async () => {
    linhas = [];
    const r = (await executar("editar_tarefa", { id: "de-outro" })) as { erro?: string };
    expect(r.erro).toBeTruthy();
  });

  it("APAGAR não executa sozinha: vai para o gate humano", async () => {
    // é a defesa estrutural do §5.1, derivada do risco `perigoso` pelo registro
    expect(mod.remover_tarefa.risk).toBe("perigoso");
    const propostas: string[] = [];
    const comGate = { enqueue: async (d: { name: string }) => { propostas.push(d.name); return { id: "acao-1" }; } } as unknown as Parameters<typeof toToolSet>[2];
    const r = (await executar("remover_tarefa", { id: "t1" }, comGate)) as Record<string, unknown>;
    expect(propostas).toEqual(["remover_tarefa"]);
    expect(r.removida).toBeUndefined();
  });

  it("concluir não passa pelo gate: é desfazível", async () => {
    const propostas: string[] = [];
    const comGate = { enqueue: async (d: { name: string }) => { propostas.push(d.name); return { id: "a" }; } } as unknown as Parameters<typeof toToolSet>[2];
    await executar("concluir_tarefa", { id: "t1" }, comGate);
    expect(propostas).toEqual([]);
  });
});

// o registro é global: não deixar sujeira para os outros arquivos de teste
afterAll(() => _resetRegistry());
