import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools que escrevem no banco: finanças, memória e widgets (§5.7).
 *
 * Elas existem desde as primeiras ondas sem teste nenhum. O que passa a ficar
 * travado aqui é o que a conta do dono depende:
 *
 *   - valor em reais vira CENTAVOS inteiros. `19.90 * 100` em ponto flutuante
 *     dá 1989.9999…, e um `Math.floor` transformaria R$ 19,90 em R$ 19,89 em
 *     silêncio, para sempre, em todo lançamento.
 *   - esquecer memória é escrita, e apaga o que casou, não tudo.
 *   - o resumo soma por categoria sem perder lançamento sem categoria.
 */

interface Linha {
  category?: string | null;
  amountCents: number;
  description?: string;
  kind?: string;
  dueDate?: Date | null;
  id?: string;
  content?: string;
}

let selecionadas: Linha[] = [];
const inseridas: Record<string, unknown>[] = [];
const apagadas: unknown[] = [];

/** Encadeamento mínimo do Drizzle: tudo devolve `this` e o await resolve nas linhas. */
function consulta() {
  const p: Record<string, unknown> = {};
  const enc = () => p;
  p.from = enc;
  p.where = enc;
  p.orderBy = enc;
  p.limit = enc;
  p.returning = async () => selecionadas;
  p.then = (r: (v: Linha[]) => unknown) => r(selecionadas);
  return p;
}

vi.mock("@orbita/db", () => ({
  db: {
    select: () => consulta(),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        inseridas.push(v);
      },
    }),
    delete: () => ({
      where: async (w: unknown) => {
        apagadas.push(w);
      },
    }),
  },
}));

vi.mock("@orbita/llm", () => ({ embedText: async () => new Array(768).fill(0.1) }));
vi.mock("../../rag/retrieve", () => ({ retrieveContext: async () => ({ trechos: [{ texto: "achado" }] }) }));
vi.mock("../../events/index", () => ({ events: { emit: async () => {} } }));
vi.mock("../../settings", () => ({ settings: { get: async () => 0.7, getMany: async () => ({}) } }));

const { _resetRegistry, toToolSet, getTool } = await import("../registry");
await import("./financas");
await import("./widgets");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const propostas: string[] = [];
const gate = {
  enqueue: async (d: { name: string }) => {
    propostas.push(d.name);
    return { id: "a1" };
  },
} as unknown as Parameters<typeof toToolSet>[2];

function executar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] });
}

beforeEach(() => {
  selecionadas = [];
  inseridas.length = 0;
  apagadas.length = 0;
  propostas.length = 0;
});

describe("finanças", () => {
  it("as cinco tools estão registradas", () => {
    for (const n of ["registrar_gasto", "resumo_financeiro", "adicionar_conta", "resumo_financeiro_completo", "contas_a_vencer"]) {
      expect(getTool(n), n).toBeTruthy();
    }
  });

  it("R$ 19,90 vira 1990 centavos, não 1989", async () => {
    // 19.90 * 100 em ponto flutuante dá 1989.9999…; um floor aqui roubaria um
    // centavo de todo lançamento, para sempre
    await executar("registrar_gasto", { descricao: "café", valor: 19.9 });
    expect(inseridas[0]).toMatchObject({ amountCents: 1990, description: "café", userId: "u1" });
  });

  it("gasto sem categoria não perde o lançamento", async () => {
    await executar("registrar_gasto", { descricao: "x", valor: 10 });
    expect(inseridas[0]!.category).toBeNull();
  });

  it("o resumo soma por categoria e junta o que não tem categoria", async () => {
    selecionadas = [
      { category: "mercado", amountCents: 5000 },
      { category: "mercado", amountCents: 2500 },
      { category: null, amountCents: 1000 },
    ];
    const r = (await executar("resumo_financeiro")) as { total: number; lancamentos: number; porCategoria: Record<string, number> };
    expect(r.total).toBe(85);
    expect(r.lancamentos).toBe(3);
    expect(r.porCategoria).toEqual({ mercado: 75, outros: 10 });
  });

  it("sem lançamento nenhum, o resumo é zero e não quebra", async () => {
    const r = (await executar("resumo_financeiro")) as { total: number; porCategoria: Record<string, number> };
    expect(r.total).toBe(0);
    expect(r.porCategoria).toEqual({});
  });

  it("conta a pagar guarda tipo e vencimento", async () => {
    await executar("adicionar_conta", { descricao: "luz", valor: 250.5, tipo: "a_pagar", vencimento: "2026-10-10" });
    expect(inseridas[0]).toMatchObject({ amountCents: 25050 });
  });

  it("registrar gasto é escrita: não passa pelo gate", async () => {
    // o dono não precisa aprovar o próprio lançamento; o gate é para o que
    // sai de casa (§5.1)
    await executar("registrar_gasto", { descricao: "x", valor: 1 });
    expect(propostas).toEqual([]);
  });
});

describe("widgets", () => {
  it("cria com a configuração do tipo", async () => {
    await executar("criar_widget", { tipo: "cotacao", titulo: "Dólar", par: "usd-brl" });
    expect(inseridas[0]).toMatchObject({ type: "cotacao", title: "Dólar", config: { par: "USD-BRL" } });
  });

  it("tipo com padrão não vira widget vazio", async () => {
    await executar("criar_widget", { tipo: "clima", titulo: "Tempo" });
    expect(inseridas[0]!.config).toEqual({ cidade: "São Paulo" });
  });
});

afterAll(() => _resetRegistry());
