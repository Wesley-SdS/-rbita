import { describe, expect, it, vi } from "vitest";

/**
 * O Jira consolidado (CLAUDE.md §5.7). O dono conecta dois Jiras e quer UMA
 * lista de pendências. Travado aqui: todos os sites de todas as contas são
 * lidos, o site que os dois logins enxergam não duplica, o link usa a URL do
 * site certo e um site fora do ar não derruba os outros.
 */

const conexoes = [
  { conexao: { id: "c1", externalId: "s-empresa" }, token: "t1", rotulo: "Empresa" },
  { conexao: { id: "c2", externalId: "s-cliente" }, token: "t2", rotulo: "Cliente" },
];

vi.mock("../../connectors/multi", () => ({
  contaParaEscrever: async () => ({ erro: "não usado" }),
  lerDeTodasAsContas: async (_cid: string, _u: string, ler: (t: string, c: unknown) => Promise<unknown[]>) => {
    const itens: unknown[] = [];
    for (const c of conexoes) for (const x of await ler(c.token, c.conexao)) itens.push({ ...(x as object), conta: c.rotulo });
    return { itens, falhas: [], contas: conexoes.length };
  },
}));

vi.mock("../../connectors/jira", async (original) => {
  const real = await original<typeof import("../../connectors/jira")>();
  const SITES: Record<string, { cloudId: string; nome: string; url: string }[]> = {
    t1: [{ cloudId: "s-empresa", nome: "Empresa", url: "https://empresa.atlassian.net" }, { cloudId: "s-compartilhado", nome: "Compartilhado", url: "https://comp.atlassian.net" }],
    t2: [{ cloudId: "s-cliente", nome: "Cliente", url: "https://cliente.atlassian.net" }, { cloudId: "s-compartilhado", nome: "Compartilhado", url: "https://comp.atlassian.net" }],
  };
  return {
    ...real,
    sitesDoToken: async (t: string) => SITES[t] ?? [],
    minhasIssues: async (_t: string, cloudId: string, _max: number, url: string) => {
      if (cloudId === "s-cliente") throw new Error("Jira 503");
      return [{ chave: `${cloudId.toUpperCase()}-1`, titulo: "Revisar", status: "Em andamento", tipo: "Task", prioridade: null, responsavel: "Wesley", projeto: "P", vencimento: null, atualizadaEm: "", link: `${url}/browse/${cloudId.toUpperCase()}-1` }];
    },
  };
});

const { toToolSet, getTool } = await import("../registry");
await import("./jira");
const { cartoesDoResultado } = await import("../../chat/cartoes-da-tela");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a" }) } as unknown as Parameters<typeof toToolSet>[2];
function executar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  return (set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "c", messages: [] }) as Promise<Record<string, unknown>>;
}

describe("Jira consolidado", () => {
  it("dois logins, três sites: o compartilhado entra uma vez, cada issue com o link do seu site", async () => {
    const r = await executar("jira_minhas_tarefas", { quantidade: 10 });
    const issues = r.issues as { chave: string; site: string; link: string }[];
    expect(issues.map((i) => i.chave).sort()).toEqual(["S-COMPARTILHADO-1", "S-EMPRESA-1"]);
    expect(issues.find((i) => i.site === "Empresa")!.link).toBe("https://empresa.atlassian.net/browse/S-EMPRESA-1");
    expect(r.workspaces_lidos).toBe(3);
    // o site do cliente falhou e é DITO, em vez de sumir calado
    expect(r.workspaces_que_falharam).toEqual(["Cliente"]);
  });

  it("o cartão leva o link e diz de qual site é cada issue", async () => {
    const [c] = cartoesDoResultado("jira_minhas_tarefas", await executar("jira_minhas_tarefas", { quantidade: 10 }));
    expect(c!.itens.find((i) => i.titulo.startsWith("S-EMPRESA-1"))).toMatchObject({ url: "https://empresa.atlassian.net/browse/S-EMPRESA-1", detalhe: "Em andamento · Empresa" });
  });
});
