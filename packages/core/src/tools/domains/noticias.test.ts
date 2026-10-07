import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools de notícias (CLAUDE.md §5.7). O que fica travado: a consulta
 * devolve `resultados` no formato que vira a pilha de cards de fonte, seguir
 * um tema já enfileira a primeira busca, e nome de tema é achado sem acento.
 */

const tema = (id: string, nome: string, noticias: { titulo: string; url: string; resumo: string; lida?: boolean }[] = []) => ({
  id, userId: "u1", tema: nome, ativo: true, ultimoDia: null, ultimaBuscaEm: null, criadoEm: new Date(),
  noticias: noticias.map((n, i) => ({ id: `${id}-${i}`, userId: "u1", temaId: id, site: new URL(n.url).hostname, encontradaEm: new Date(), lida: false, ...n })),
});

let temas = [tema("t1", "Inteligência artificial", [{ titulo: "IA aprova remédio", url: "https://g1.globo.com/a", resumo: "Um remédio foi aprovado." }, { titulo: "Lida", url: "https://b.com/x", resumo: "", lida: true }])];
const enfileirados: unknown[] = [];
const apagados: string[] = [];

vi.mock("../../noticias/servico", () => {
  class TemaInvalido extends Error {}
  return {
    TemaInvalido,
    noticiasDe: async () => ({ temas }),
    temasDe: async () => temas,
    seguirTema: async (_u: string, nome: string) => {
      if (nome.length > 70) throw new TemaInvalido("O tema precisa ter entre 2 e 80 letras.");
      return { id: "novo", tema: nome };
    },
    deixarDeSeguir: async (_u: string, id: string) => {
      apagados.push(id);
      return true;
    },
  };
});
vi.mock("../../jobs/queue", () => ({
  enqueueJob: async (_u: string, j: unknown) => {
    enfileirados.push(j);
    return { job: { id: "j1" }, jaExistia: false };
  },
}));

const { toToolSet, getTool } = await import("../registry");
await import("./noticias");
const { fontesDoResultado } = await import("../../chat/cartoes");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a" }) } as unknown as Parameters<typeof toToolSet>[2];
function executar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  return (set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "c", messages: [] }) as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  enfileirados.length = 0;
  apagados.length = 0;
});

describe("tools de notícias", () => {
  it("a consulta devolve as notícias e o formato que vira a pilha de cards", async () => {
    const r = await executar("noticias_dos_meus_temas", { tema: "inteligencia" });
    expect((r.temas as { noticias: unknown[] }[])[0]!.noticias).toHaveLength(2);
    expect(fontesDoResultado(r).map((f) => f.site)).toEqual(["g1.globo.com", "b.com"]);
    const naoLidas = await executar("noticias_dos_meus_temas", { apenas_nao_lidas: true });
    expect((naoLidas.temas as { noticias: unknown[] }[])[0]!.noticias).toHaveLength(1);
  });

  it("tema que não segue lista os que existem; sem tema nenhum, ensina a seguir", async () => {
    expect((await executar("noticias_dos_meus_temas", { tema: "futebol" })).temas).toEqual(["Inteligência artificial"]);
    const antes = temas;
    temas = [];
    expect(String((await executar("noticias_dos_meus_temas")).erro)).toContain("passa a acompanhar");
    temas = antes;
  });

  it("seguir um tema já enfileira a primeira busca dele; tema inválido volta como erro", async () => {
    const r = await executar("seguir_tema_de_noticias", { tema: "Bolsa de valores" });
    expect(String(r.mensagem)).toContain("Bolsa de valores");
    expect(enfileirados).toEqual([{ kind: "noticias.buscar", payload: { temaId: "novo", tema: "Bolsa de valores" }, dedupKey: "noticias-tema:novo" }]);
    expect((await executar("seguir_tema_de_noticias", { tema: "x".repeat(75) })).erro).toBeTruthy();
  });

  it("deixar de seguir acha o tema sem acento", async () => {
    await executar("deixar_de_seguir_tema", { tema: "inteligencia artificial" });
    expect(apagados).toEqual(["t1"]);
  });

  it("buscar agora enfileira uma busca só (dedup) e todas são escrita ou leitura, sem gate", async () => {
    await executar("buscar_noticias_agora");
    expect(enfileirados).toEqual([{ kind: "noticias.buscar", payload: {}, dedupKey: "noticias-agora:u1" }]);
    for (const n of ["noticias_dos_meus_temas", "seguir_tema_de_noticias", "deixar_de_seguir_tema", "buscar_noticias_agora"]) {
      expect(["leitura", "escrita"]).toContain(getTool(n)!.risk);
    }
  });
});
