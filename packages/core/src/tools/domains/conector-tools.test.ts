import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools de Notion, Slack e Teams (CLAUDE.md §5.7: tool sem teste de
 * `execute` não está pronta). Elas existiam desde as primeiras ondas e nunca
 * tiveram teste, o que significa que ninguém provou o que mais importa nelas:
 *
 *   - postar em canal e em chat é `efeito_externo` e NÃO executa sozinho;
 *   - conector desconectado responde explicando, em vez de estourar.
 *
 * A execução passa pelo `toToolSet`, e não pelo `run` direto, porque é o
 * registro que deriva o gate a partir do risco.
 */

let token: string | null = "tok";
const chamadas: string[] = [];

vi.mock("../../connectors/store", () => ({
  getAccessToken: async () => token,
}));

vi.mock("../../connectors/notion", () => ({
  searchNotion: async () => {
    chamadas.push("searchNotion");
    return [{ id: "p1", title: "Plano", url: "http://n/p1" }];
  },
  readNotionPage: async () => {
    chamadas.push("readNotionPage");
    return { title: "Plano", text: "conteúdo" };
  },
}));

vi.mock("../../connectors/slack", () => ({
  listChannels: async () => {
    chamadas.push("slack.listChannels");
    return [{ id: "C1", name: "geral" }];
  },
  postMessage: async () => {
    chamadas.push("slack.postMessage");
    return { ts: "1" };
  },
}));

vi.mock("../../connectors/microsoft", () => ({
  listJoinedTeams: async () => {
    chamadas.push("listJoinedTeams");
    return [{ id: "T1", name: "Engenharia" }];
  },
  listChannels: async () => {
    chamadas.push("teams.listChannels");
    return [{ id: "C1", name: "geral" }];
  },
  listChats: async () => {
    chamadas.push("listChats");
    return [{ id: "X1", topic: "Wesley" }];
  },
  postChannelMessage: async () => {
    chamadas.push("postChannelMessage");
    return { id: "m1" };
  },
  postChatMessage: async () => {
    chamadas.push("postChatMessage");
    return { id: "m2" };
  },
}));

const { _resetRegistry, toToolSet, getTool } = await import("../registry");
await import("./notion");
await import("./slack");
await import("./teams");

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
  token = "tok";
  chamadas.length = 0;
  propostas.length = 0;
});

describe("Notion", () => {
  it("buscar e ler chegam ao conector", async () => {
    await executar("buscar_notion", { consulta: "plano" });
    await executar("ler_pagina_notion", { pagina_id: "p1" });
    expect(chamadas).toEqual(["searchNotion", "readNotionPage"]);
  });

  it("sem conectar, explica em vez de estourar", async () => {
    token = null;
    const r = (await executar("buscar_notion", { consulta: "x" })) as { erro?: string };
    expect(r.erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("ler página também é leitura: roda na hora, sem gate", async () => {
    await executar("ler_pagina_notion", { pagina_id: "p1" });
    expect(propostas).toEqual([]);
  });
});

describe("Slack", () => {
  it("listar canais é leitura", async () => {
    const r = (await executar("listar_canais_slack")) as { canais?: unknown[] };
    expect(chamadas).toEqual(["slack.listChannels"]);
    expect(r.canais).toHaveLength(1);
  });

  it("POSTAR não executa sozinho", async () => {
    await executar("enviar_slack", { canal: "geral", texto: "oi" });
    expect(propostas).toEqual(["enviar_slack"]);
    expect(chamadas).toEqual([]);
  });

  it("sem conectar, listar explica", async () => {
    token = null;
    const r = (await executar("listar_canais_slack")) as { erro?: string };
    expect(r.erro).toBeTruthy();
  });
});

describe("Teams", () => {
  it("as três leituras chegam ao Graph", async () => {
    await executar("listar_equipes_teams");
    await executar("listar_canais_teams", { equipeId: "T1" });
    await executar("listar_conversas_teams");
    expect(chamadas).toEqual(["listJoinedTeams", "teams.listChannels", "listChats"]);
  });

  it("POSTAR em canal e em chat vai para o gate", async () => {
    await executar("enviar_teams_canal", { equipeId: "T1", canalId: "C1", texto: "oi" });
    await executar("enviar_teams_chat", { chatId: "X1", texto: "oi" });
    expect(propostas).toEqual(["enviar_teams_canal", "enviar_teams_chat"]);
    // nada saiu de verdade enquanto não houver aprovação
    expect(chamadas).toEqual([]);
  });

  it("sem conectar, nenhuma leitura estoura", async () => {
    token = null;
    for (const n of ["listar_equipes_teams", "listar_conversas_teams"]) {
      const r = (await executar(n)) as { erro?: string };
      expect(r.erro, n).toBeTruthy();
    }
  });
});

afterAll(() => _resetRegistry());
