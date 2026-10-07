import { describe, expect, it, vi } from "vitest";

/**
 * O trabalho consolidado (CLAUDE.md §5.7). Travado: a consulta junta Jira,
 * GitHub e Slack no formato que vira o cartão com uma aba por serviço
 * CONECTADO, e sem nada conectado ela ensina a conectar.
 */

let conectados = { jira: 2, github: 1, slack: 0 };
const enfileirados: unknown[] = [];

vi.mock("../../trabalho/servico", () => ({
  trabalhoDe: async () => ({
    conectados,
    jira: [
      { chave: "ORB-1", titulo: "Revisar", status: "Em andamento", prioridade: "Alta", vencimento: "2026-10-01", site: "empresa", link: "https://empresa.atlassian.net/browse/ORB-1" },
      { chave: "CLI-2", titulo: "Deploy", status: "A fazer", prioridade: null, vencimento: null, site: "cliente", link: "https://cliente.atlassian.net/browse/CLI-2" },
    ],
    jiraFalhas: [],
    github: [{ tipo: "review", contexto: "org/app#42: Corrige o login", autor: "ana", estado: "CHANGES_REQUESTED", trecho: "Falta teste", quando: new Date("2026-10-06T11:00:00Z"), url: "https://github.com/org/app/pull/42#r1" }],
    slack: [],
  }),
}));
vi.mock("../../jobs/queue", () => ({
  enqueueJob: async (_u: string, j: unknown) => {
    enfileirados.push(j);
    return { job: { id: "j" }, jaExistia: false };
  },
}));

const { toToolSet, getTool } = await import("../registry");
await import("./trabalho");
const { cartoesDoResultado } = await import("../../chat/cartoes-da-tela");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a" }) } as unknown as Parameters<typeof toToolSet>[2];
const executar = (nome: string) => (toToolSet([getTool(nome)!], ctx, gate)[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({}, { toolCallId: "c", messages: [] }) as Promise<Record<string, unknown>>;

describe("meu trabalho", () => {
  it("dois Jiras e o GitHub, num cartão com uma aba por serviço conectado", async () => {
    const r = await executar("meu_trabalho");
    expect((r.github as { acao: string }[])[0]!.acao).toBe("pediu mudanças");
    const [c] = cartoesDoResultado("meu_trabalho", r, {}, new Date("2026-10-06T12:00:00Z"));
    expect(c!.grupos).toEqual([{ id: "jira", rotulo: "Jira", total: 2 }, { id: "github", rotulo: "GitHub", total: 1 }]);
    expect(c!.itens.find((i) => i.titulo.startsWith("ORB-1"))).toMatchObject({ detalhe: "Em andamento · empresa", marca: "atrasado", url: "https://empresa.atlassian.net/browse/ORB-1" });
    expect(c!.itens.find((i) => i.grupo === "github")).toMatchObject({ titulo: "#42: Corrige o login", detalhe: "ana · pediu mudanças", marca: "importante" });
  });

  it("sem nada conectado, ensina a conectar; atualizar enfileira uma vez", async () => {
    conectados = { jira: 0, github: 0, slack: 0 };
    expect(String((await executar("meu_trabalho")).erro)).toContain("por token em Conexões");
    await executar("atualizar_meu_trabalho");
    expect(enfileirados).toEqual([{ kind: "trabalho.vigiar", payload: {}, dedupKey: "trabalho-agora:u1" }]);
  });
});
