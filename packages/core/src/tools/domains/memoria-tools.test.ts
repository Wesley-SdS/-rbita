import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools de memória (§5.7). Três coisas que só se veem executando:
 *
 *   1. salvar NÃO duplica: uma memória quase idêntica já gravada é recusada,
 *      senão "o Wesley não come glúten" vira cinco linhas iguais e o contexto
 *      do chat gasta orçamento repetindo a mesma frase.
 *   2. esquecer apaga o QUE CASOU, e não apaga nada quando não casa: apagar o
 *      fato errado é irreversível e silencioso.
 *   3. buscar devolve a página junto, que é o que deixa a resposta dizer onde
 *      conferir.
 */

interface MemoriaFalsa {
  id: string;
  content: string;
  sim?: number;
}

let encontrada: MemoriaFalsa | null = null;
const inseridas: Record<string, unknown>[] = [];
let apagou = 0;
let trechos: { source: string; content: string; pageStart: number | null; pageEnd: number | null }[] = [];
const eventos: string[] = [];

function consulta() {
  const p: Record<string, unknown> = {};
  const enc = () => p;
  p.from = enc;
  p.where = enc;
  p.orderBy = enc;
  p.limit = enc;
  p.then = (r: (v: MemoriaFalsa[]) => unknown) => r(encontrada ? [encontrada] : []);
  return p;
}

vi.mock("@orbita/db", () => ({
  db: {
    select: () => consulta(),
    insert: () => ({ values: async (v: Record<string, unknown>) => void inseridas.push(v) }),
    delete: () => ({ where: async () => void apagou++ }),
  },
}));

vi.mock("@orbita/llm", () => ({ embedText: async () => new Array(768).fill(0.1) }));
vi.mock("../../rag/retrieve", () => ({ retrieveContext: async () => trechos }));
vi.mock("../../events/index", () => ({ events: { emit: async (nome: string) => void eventos.push(nome) } }));
vi.mock("../../settings", () => ({ settings: { get: async () => 0.9, getMany: async () => ({}) } }));

const { _resetRegistry, toToolSet, getTool } = await import("../registry");
await import("./memoria");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a1" }) } as unknown as Parameters<typeof toToolSet>[2];

function executar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] });
}

beforeEach(() => {
  encontrada = null;
  inseridas.length = 0;
  apagou = 0;
  trechos = [];
  eventos.length = 0;
});

describe("salvar memória", () => {
  it("grava quando é fato novo", async () => {
    const r = (await executar("salvar_memoria", { fato: "não como glúten" })) as { salvo: boolean };
    expect(r.salvo).toBe(true);
    expect(inseridas[0]).toMatchObject({ userId: "u1", content: "não como glúten" });
    expect(eventos).toContain("memory.saved");
  });

  it("NÃO duplica um fato quase idêntico", async () => {
    encontrada = { id: "m1", content: "não como glúten", sim: 0.98 };
    const r = (await executar("salvar_memoria", { fato: "eu não como glúten" })) as { salvo: boolean; motivo?: string };
    expect(r.salvo).toBe(false);
    expect(r.motivo).toBeTruthy();
    expect(inseridas).toEqual([]);
  });
});

describe("esquecer memória", () => {
  it("apaga a que casou e diz qual foi", async () => {
    encontrada = { id: "m1", content: "não como glúten" };
    const r = (await executar("esquecer_memoria", { descricao: "glúten" })) as { esquecido: boolean; memoria?: string };
    expect(r.esquecido).toBe(true);
    expect(r.memoria).toBe("não como glúten");
    expect(apagou).toBe(1);
    expect(eventos).toContain("memory.forgotten");
  });

  it("sem nada parecido, NÃO apaga nada", async () => {
    // apagar o fato errado é irreversível e silencioso: melhor não apagar
    const r = (await executar("esquecer_memoria", { descricao: "algo que não existe" })) as { esquecido: boolean };
    expect(r.esquecido).toBe(false);
    expect(apagou).toBe(0);
  });
});

describe("buscar conhecimento", () => {
  it("devolve a página junto do trecho", async () => {
    trechos = [{ source: "contrato.pdf", content: "cláusula 4", pageStart: 3, pageEnd: 3 }];
    const r = (await executar("buscar_conhecimento", { consulta: "cláusula" })) as { resultados: { fonte: string; pagina?: string }[] };
    expect(r.resultados[0]).toMatchObject({ fonte: "contrato.pdf", pagina: "3" });
  });

  it("trecho que atravessa páginas mostra o intervalo", async () => {
    trechos = [{ source: "a.pdf", content: "x", pageStart: 3, pageEnd: 5 }];
    const r = (await executar("buscar_conhecimento", { consulta: "x" })) as { resultados: { pagina?: string }[] };
    expect(r.resultados[0]!.pagina).toBe("3-5");
  });

  it("fonte sem página não inventa número", async () => {
    trechos = [{ source: "conversa", content: "x", pageStart: null, pageEnd: null }];
    const r = (await executar("buscar_conhecimento", { consulta: "x" })) as { resultados: { pagina?: string }[] };
    expect(r.resultados[0]!.pagina).toBeUndefined();
  });

  it("sem achar nada, devolve lista vazia em vez de erro", async () => {
    const r = (await executar("buscar_conhecimento", { consulta: "nada" })) as { resultados: unknown[] };
    expect(r.resultados).toEqual([]);
  });
});

afterAll(() => _resetRegistry());
