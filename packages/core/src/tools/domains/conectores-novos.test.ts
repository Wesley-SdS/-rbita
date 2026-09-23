import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Outlook e Jira (CLAUDE.md §5.7: tool sem teste de `execute` não está pronta).
 *
 * O que precisa valer, e que nenhum typecheck pega:
 *
 *   1. mandar e-mail, criar issue, comentar e mudar status são `efeito_externo`
 *      e NUNCA executam sozinhos: o gate é derivado do risco pelo registro. Por
 *      isso a execução passa pelo `toToolSet`, não pelo `run` direto.
 *   2. leitura varre TODAS as contas e não esconde a que falhou.
 *   3. o Jira monta a URL da API com o `cloudid`, que mora no `externalId` da
 *      conexão. Passar o id errado aqui chamaria o workspace errado.
 */

let contas: { id: string; accountLabel: string | null; externalId: string }[] = [];
const chamadas: { fn: string; args: unknown[] }[] = [];
let statusPossiveis: string[] = ["Em andamento", "Concluído"];

vi.mock("../../connectors/multi", () => ({
  contaParaEscrever: async (_cid: string, _u: string, pedido?: string) => {
    if (contas.length === 0) return { erro: "Nenhuma conta conectada nesse serviço." };
    if (pedido === "ambiguo") return { erro: "Não sei por qual conta fazer isso.", contas: contas.map((c) => c.accountLabel ?? c.id) };
    const c = contas[0]!;
    return { token: `token-${c.id}`, conexao: c, rotulo: c.accountLabel ?? c.id };
  },
  lerDeTodasAsContas: async (_cid: string, _u: string, ler: (t: string, c: unknown) => Promise<unknown[]>) => {
    const itens: unknown[] = [];
    const falhas: string[] = [];
    for (const c of contas) {
      try {
        for (const i of await ler(`token-${c.id}`, c)) itens.push({ ...(i as object), conta: c.accountLabel });
      } catch {
        falhas.push(c.accountLabel ?? c.id);
      }
    }
    return { itens, falhas, contas: contas.length };
  },
}));

vi.mock("../../connectors/microsoft", () => ({
  listRecentMessages: async (token: string) => {
    chamadas.push({ fn: "listRecentMessages", args: [token] });
    if (token === "token-quebrada") throw new Error("401");
    return [{ id: "m1", subject: "assunto" }];
  },
  createDraftMail: async (...args: unknown[]) => {
    chamadas.push({ fn: "createDraftMail", args });
    return { id: "d1" };
  },
  sendMail: async (...args: unknown[]) => {
    chamadas.push({ fn: "sendMail", args });
    return { id: "enviado" };
  },
  listUpcomingEvents: async () => [{ id: "e1", summary: "reunião" }],
  createCalendarEvent: async (...args: unknown[]) => {
    chamadas.push({ fn: "createCalendarEvent", args });
    return { id: "e2", summary: "x", start: "", end: "", link: "https://outlook/e2" };
  },
}));

vi.mock("../../connectors/jira", () => ({
  minhasIssues: async (token: string, cloudId: string) => {
    chamadas.push({ fn: "minhasIssues", args: [token, cloudId] });
    return [{ chave: "ORB-1", titulo: "fazer" }];
  },
  buscarIssues: async (token: string, cloudId: string, jql: string) => {
    chamadas.push({ fn: "buscarIssues", args: [token, cloudId, jql] });
    return [{ chave: "ORB-2", titulo: "outra" }];
  },
  criarIssue: async (...args: unknown[]) => {
    chamadas.push({ fn: "criarIssue", args });
    return { chave: "ORB-9" };
  },
  comentarIssue: async (...args: unknown[]) => {
    chamadas.push({ fn: "comentarIssue", args });
    return { id: "c1" };
  },
  mudarStatus: async (_t: string, _c: string, chave: string, desejado: string) => {
    chamadas.push({ fn: "mudarStatus", args: [chave, desejado] });
    if (statusPossiveis.includes(desejado)) return { ok: true as const };
    return { erro: `"${desejado}" não é um status possível para ${chave} agora.`, opcoes: statusPossiveis };
  },
}));

const { _resetRegistry, toToolSet, getTool } = await import("../registry");
await import("./outlook");
await import("./jira");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const propostas: string[] = [];
const comGate = {
  enqueue: async (d: { name: string }) => {
    propostas.push(d.name);
    return { id: "acao-1" };
  },
} as unknown as Parameters<typeof toToolSet>[2];

function executar(nome: string, input: unknown) {
  const set = toToolSet([getTool(nome)!], ctx, comGate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] });
}

/** Executa ignorando o gate, para testar o `run` das tools de efeito externo. */
function executarDireto(nome: string, input: unknown) {
  const def = getTool(nome)!;
  return (def.run as (i: unknown, c: unknown) => Promise<unknown>)(def.inputSchema.parse(input), ctx);
}

beforeEach(() => {
  contas = [{ id: "a", accountLabel: "trabalho", externalId: "cloud-1" }];
  chamadas.length = 0;
  propostas.length = 0;
  statusPossiveis = ["Em andamento", "Concluído"];
});

describe("Outlook", () => {
  it("as cinco tools estão registradas", () => {
    for (const n of ["outlook_ler_emails", "outlook_rascunhar_email", "outlook_enviar_email", "outlook_listar_eventos", "outlook_criar_evento"]) {
      expect(getTool(n), n).toBeTruthy();
    }
  });

  it("ler varre todas as contas e marca a origem", async () => {
    contas = [
      { id: "a", accountLabel: "pessoal", externalId: "" },
      { id: "b", accountLabel: "trabalho", externalId: "" },
    ];
    const r = (await executar("outlook_ler_emails", {})) as { emails: { conta: string }[]; contas_lidas: number };
    expect(r.contas_lidas).toBe(2);
    expect(r.emails.map((e) => e.conta)).toEqual(["pessoal", "trabalho"]);
  });

  it("uma conta com problema não esconde as outras", async () => {
    contas = [
      { id: "a", accountLabel: "boa", externalId: "" },
      { id: "quebrada", accountLabel: "ruim", externalId: "" },
    ];
    const r = (await executar("outlook_ler_emails", {})) as { emails: unknown[]; contas_que_falharam: string[] };
    expect(r.emails).toHaveLength(1);
    expect(r.contas_que_falharam).toEqual(["ruim"]);
  });

  it("ENVIAR não executa sozinho: vai para o gate", async () => {
    const r = (await executar("outlook_enviar_email", { para: "x@y.com", assunto: "oi", corpo: "tudo bem?" })) as unknown;
    expect(propostas).toEqual(["outlook_enviar_email"]);
    // nada foi enviado de verdade
    expect(chamadas.find((c) => c.fn === "sendMail")).toBeUndefined();
    expect(String(r)).not.toContain("enviado pelo Outlook");
  });

  it("rascunhar é escrita, não efeito externo: roda na hora", async () => {
    const r = (await executar("outlook_rascunhar_email", { para: "x@y.com", assunto: "oi", corpo: "z" })) as { conta: string };
    expect(propostas).toEqual([]);
    expect(r.conta).toBe("trabalho");
  });

  it("sem conta conectada, a escrita explica em vez de quebrar", async () => {
    contas = [];
    await expect(executarDireto("outlook_enviar_email", { para: "x@y.com", assunto: "a", corpo: "b" })).rejects.toThrow(/Nenhuma conta/);
  });

  it("pedido ambíguo devolve as opções em vez de chutar", async () => {
    contas = [
      { id: "a", accountLabel: "wesley@a.com", externalId: "" },
      { id: "b", accountLabel: "wesley@b.com", externalId: "" },
    ];
    await expect(executarDireto("outlook_enviar_email", { para: "x@y.com", assunto: "a", corpo: "b", conta: "ambiguo" })).rejects.toThrow(
      /wesley@a\.com/,
    );
  });
});

describe("Jira", () => {
  it("as cinco tools estão registradas", () => {
    for (const n of ["jira_minhas_tarefas", "jira_buscar", "jira_criar_tarefa", "jira_comentar", "jira_mudar_status"]) {
      expect(getTool(n), n).toBeTruthy();
    }
  });

  it("a chamada usa o cloudid da conexão, não o id da linha", async () => {
    // o `externalId` é o que monta a URL da API: passar o id errado chamaria
    // o workspace errado, e a resposta pareceria só "vazia"
    await executar("jira_minhas_tarefas", {});
    expect(chamadas[0]).toEqual({ fn: "minhasIssues", args: ["token-a", "cloud-1"] });
  });

  it("buscar repassa o JQL como veio", async () => {
    await executar("jira_buscar", { jql: "project = ORB AND status = Done" });
    expect(chamadas[0]!.args[2]).toBe("project = ORB AND status = Done");
  });

  it("CRIAR, COMENTAR e MUDAR STATUS passam pelo gate", async () => {
    await executar("jira_criar_tarefa", { projeto: "ORB", titulo: "algo" });
    await executar("jira_comentar", { chave: "ORB-1", texto: "oi" });
    await executar("jira_mudar_status", { chave: "ORB-1", status: "Concluído" });
    expect(propostas).toEqual(["jira_criar_tarefa", "jira_comentar", "jira_mudar_status"]);
    expect(chamadas).toEqual([]);
  });

  it("status impossível devolve o que dá para fazer, não um erro seco", async () => {
    const r = (await executarDireto("jira_mudar_status", { chave: "ORB-1", status: "Arquivado" })) as string;
    expect(r).toContain("Em andamento");
    expect(r).toContain("Concluído");
  });

  it("status válido confirma com o workspace", async () => {
    const r = (await executarDireto("jira_mudar_status", { chave: "ORB-1", status: "Concluído" })) as string;
    expect(r).toContain("ORB-1");
    expect(r).toContain("trabalho");
  });
});

afterAll(() => _resetRegistry());
