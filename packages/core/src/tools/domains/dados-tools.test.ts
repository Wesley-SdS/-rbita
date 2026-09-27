import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools que escrevem no banco: memória e widgets (§5.7).
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

// As tools de finanças saíram daqui quando o financeiro virou o executor de
// comandos (set/2026): as mesmas garantias (centavos exatos, lançamento sem
// categoria, conta a pagar, escrita sem gate) moram em `financas.test.ts`.

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
