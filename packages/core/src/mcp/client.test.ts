import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MCP conectado só quando é preciso (pedido do dono). O cenário que importa:
 * o MCP do Jira caiu. Montar o chat NÃO tenta reconectar; pedir algo do Jira
 * reconecta. E numa ação com efeito externo a chamada nunca é repetida, porque
 * a primeira pode ter executado.
 */

type Srv = { id: string; userId: string; name: string; url: string; headers: unknown; enabled: boolean; risk: string; toolsCatalog: unknown; toolRisks?: Record<string, string> | null; catalogAt: Date | null; lastError: null; lastErrorAt: null; createdAt: Date };
let servidores: Srv[] = [];
let conexoes = 0;
let falharConexao = false;
let falharChamadas = 0;
let falharPing = false;
const chamadas: string[] = [];
const inseridos: Record<string, unknown>[] = [];
const cabecalhosEnviados: unknown[] = [];
let maxPorTurno = 15;

vi.mock("@orbita/db", () => {
  const cadeia = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "from", "where", "update", "set", "insert", "returning"]) p[k] = () => p;
    p.values = (v: Record<string, unknown>) => (inseridos.push(v), p);
    p.limit = async () => servidores.slice(0, 1);
    p.then = (ok: (v: unknown) => void) => ok(servidores);
    p.catch = () => Promise.resolve();
    return p;
  };
  return { db: cadeia() };
});
vi.mock("../settings", () => ({
  settings: {
    get: async (k: string) =>
      ({ "mcp.connectTimeoutMs": 100, "mcp.callTimeoutMs": 100, "mcp.idleMinutes": 15, "mcp.catalogRefreshHours": 24, "mcp.retryAfterSeconds": 60, "mcp.maxPerTurn": maxPorTurno })[k],
  },
}));
vi.mock("../net/ssrf", () => ({ assertPublicUrl: async () => undefined }));
vi.mock("../events/index", () => ({ events: { emit: async () => undefined } }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, o: { requestInit?: { headers?: unknown } }) {
      cabecalhosEnviados.push(o.requestInit?.headers);
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {
      if (falharConexao) throw new Error("ECONNREFUSED");
      conexoes++;
    }
    async close() {}
    async ping() {
      if (falharPing) throw new Error("sessão expirada");
    }
    async listTools() {
      return { tools: [{ name: "buscar_ticket", description: "busca ticket", inputSchema: { type: "object", properties: {} } }] };
    }
    async callTool(a: { name: string }) {
      chamadas.push(a.name);
      if (falharChamadas > 0) {
        falharChamadas--;
        throw new Error("fetch failed");
      }
      return { content: [{ type: "text", text: "ok" }] };
    }
  },
}));

import { buildMcpTools, callMcpTool, forgetMcpServer } from "./client";
import { guardarCabecalhos } from "./cabecalhos";

const jira = (over: Partial<Srv> = {}): Srv => ({
  id: "jira", userId: "dono", name: "jira", url: "https://jira.exemplo.com/mcp", headers: null, enabled: true, risk: "leitura",
  toolsCatalog: [{ name: "buscar_ticket", description: "busca ticket" }], catalogAt: new Date(), lastError: null, lastErrorAt: null, createdAt: new Date(), ...over,
});

const executar = async (tools: Record<string, unknown>, nome: string) =>
  (tools[nome] as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, { toolCallId: "1", messages: [] });

/** Servidor como o de tickets da Adalink: marca as leituras, não marca o que altera. */
const tickets = (over: Partial<Srv> = {}): Srv =>
  jira({
    id: "jira", name: "tickets", risk: "efeito_externo",
    toolsCatalog: [{ name: "tickets_list", description: "Lista chamados", somenteLeitura: true }, { name: "tickets_create", description: "Abre um chamado", somenteLeitura: false }],
    ...over,
  });

beforeEach(async () => {
  await forgetMcpServer("jira");
  conexoes = 0;
  falharConexao = false;
  falharChamadas = 0;
  falharPing = false;
  chamadas.length = 0;
  inseridos.length = 0;
  cabecalhosEnviados.length = 0;
  maxPorTurno = 15;
  servidores = [jira()];
});

describe("montar o chat não conecta em nada", () => {
  it("com o catálogo guardado, as tools aparecem sem nenhuma conexão", async () => {
    const { tools } = await buildMcpTools("dono");
    expect(Object.keys(tools)).toEqual(["jira__buscar_ticket"]);
    expect(conexoes).toBe(0);
  });

  it("servidor fora do ar com catálogo: as tools continuam visíveis", async () => {
    falharConexao = true;
    const { tools } = await buildMcpTools("dono");
    expect(Object.keys(tools)).toEqual(["jira__buscar_ticket"]);
  });

  it("sem catálogo, busca uma vez; se falhar, não tenta de novo na próxima mensagem", async () => {
    servidores = [jira({ toolsCatalog: null, catalogAt: null })];
    falharConexao = true;
    expect(Object.keys((await buildMcpTools("dono")).tools)).toEqual([]);
    falharConexao = false;
    // dentro da espera configurada: nem tenta
    expect(Object.keys((await buildMcpTools("dono")).tools)).toEqual([]);
    expect(conexoes).toBe(0);
  });
});

describe("pediu algo do Jira: aí conecta", () => {
  it("a primeira chamada abre a conexão, a segunda reaproveita", async () => {
    const { tools } = await buildMcpTools("dono");
    await executar(tools, "jira__buscar_ticket");
    await executar(tools, "jira__buscar_ticket");
    expect(conexoes).toBe(1);
  });

  it("conexão caiu no meio: leitura reconecta e tenta de novo uma vez", async () => {
    const { tools } = await buildMcpTools("dono");
    await executar(tools, "jira__buscar_ticket");
    falharChamadas = 1;
    const r = await executar(tools, "jira__buscar_ticket");
    expect(r).toEqual([{ type: "text", text: "ok" }]);
    expect(conexoes).toBe(2);
  });

  it("servidor continua fora: responde o motivo ao modelo em vez de derrubar o turno", async () => {
    const { tools } = await buildMcpTools("dono");
    falharConexao = true;
    const r = (await executar(tools, "jira__buscar_ticket")) as { erro: string };
    expect(r.erro).toMatch(/não respondeu/);
  });
});

describe("efeito externo nunca é repetido", () => {
  it("ação aprovada: testa a conexão antes e chama uma vez só", async () => {
    servidores = [jira({ risk: "efeito_externo" })];
    await callMcpTool("dono", { serverId: "jira", tool: "buscar_ticket", args: {} });
    falharPing = true; // a conexão viva morreu
    await callMcpTool("dono", { serverId: "jira", tool: "buscar_ticket", args: {} });
    expect(conexoes).toBe(2); // reconectou por causa do ping
    expect(chamadas).toHaveLength(2); // uma chamada por ação, nunca duas
  });

  it("se a chamada falhar depois do ping, NÃO repete", async () => {
    servidores = [jira({ risk: "efeito_externo" })];
    falharChamadas = 1;
    await expect(callMcpTool("dono", { serverId: "jira", tool: "buscar_ticket", args: {} })).rejects.toThrow();
    expect(chamadas).toHaveLength(1);
  });
});

describe("risco por ferramenta", () => {
  it("a leitura que o servidor declara executa direto; a que altera vira proposta do MESMO canal", async () => {
    servidores = [tickets()];
    const { tools } = await buildMcpTools("dono", { canal: "whatsapp" });
    await executar(tools, "tickets__tickets_list");
    expect(chamadas).toEqual(["tickets_list"]);

    const r = (await executar(tools, "tickets__tickets_create")) as { proposta_enfileirada?: boolean };
    expect(r.proposta_enfileirada).toBe(true);
    expect(chamadas).toEqual(["tickets_list"]); // não chamou o servidor
    // o canal é o que deixa o "manda" do WhatsApp achar a proposta; o risco
    // gravado é o que o por-frase confere (tool MCP não está no registro)
    expect(inseridos[0]).toMatchObject({ kind: "mcp_call", canal: "whatsapp", payload: { tool: "tickets_create", risco: "efeito_externo" } });
  });

  it("a escolha do dono vence a marcação do servidor, para os dois lados", async () => {
    servidores = [tickets({ toolRisks: { tickets_create: "leitura", tickets_list: "perigoso" } })];
    const { tools } = await buildMcpTools("dono");
    await executar(tools, "tickets__tickets_create");
    expect(chamadas).toEqual(["tickets_create"]);
    await executar(tools, "tickets__tickets_list");
    expect(inseridos[0]).toMatchObject({ canal: "tela", payload: { risco: "perigoso" } });
  });

  it("servidor sem marcação nenhuma (como o gestão): tudo pede aprovação até o dono escolher", async () => {
    servidores = [tickets({ toolsCatalog: [{ name: "get_my_day", description: "meu dia" }] })];
    const { tools } = await buildMcpTools("dono");
    await executar(tools, "tickets__get_my_day");
    expect(chamadas).toEqual([]);
    expect(inseridos).toHaveLength(1);
  });
});

describe("cabeçalho cifrado no banco, decifrado só na conexão", () => {
  it("o token chega ao servidor como foi digitado", async () => {
    process.env.CONNECTORS_ENC_KEY ??= "chave-de-teste-com-tamanho-suficiente-123";
    const guardado = guardarCabecalhos({ "x-ada-token": "ada_segredo" });
    expect(JSON.stringify(guardado)).not.toContain("ada_segredo");
    servidores = [jira({ headers: guardado })];
    await executar((await buildMcpTools("dono")).tools, "jira__buscar_ticket");
    expect(cabecalhosEnviados).toEqual([{ "x-ada-token": "ada_segredo" }]);
  });
});

describe("seleção por relevância", () => {
  it("com o pedido, só as ferramentas ligadas a ele vão ao modelo, até o teto", async () => {
    maxPorTurno = 1;
    servidores = [tickets()];
    expect(Object.keys((await buildMcpTools("dono", { query: "abre um chamado novo" })).tools)).toEqual(["tickets__tickets_create"]);
    // a busca da voz lê a lista: a mais ligada ao pedido vem primeiro
    const { escolherFerramentasMcp, ferramentasMcpDoDono } = await import("./client");
    maxPorTurno = 15;
    expect((escolherFerramentasMcp(await ferramentasMcpDoDono("dono"), "abre um chamado novo", 2, true))[0]!.tool).toBe("tickets_create");
    // sem pedido (conversa "Eu", que quer todas): vão todas, quem corta é o teto geral
    expect(Object.keys((await buildMcpTools("dono")).tools)).toHaveLength(2);
  });
});

describe("leitura por código (painel e laço)", () => {
  it("ferramenta de leitura devolve o conteúdo da resposta (texto, quando não é JSON)", async () => {
    const { lerFerramentaMcp } = await import("./client");
    servidores = [tickets()];
    expect(await lerFerramentaMcp("dono", "tickets", "tickets_list")).toBe("ok");
    expect(chamadas).toEqual(["tickets_list"]);
  });

  it("ferramenta marcada para pedir aprovação não é lida por fora, e nada é chamado", async () => {
    const { lerFerramentaMcp } = await import("./client");
    servidores = [tickets({ toolRisks: { tickets_list: "efeito_externo" } })];
    await expect(lerFerramentaMcp("dono", "tickets", "tickets_list")).rejects.toThrow(/aprovação/);
    await expect(lerFerramentaMcp("dono", "tickets", "nao_existe")).rejects.toThrow(/não tem a ferramenta/);
    expect(chamadas).toEqual([]);
  });
});

describe("automação ligada pelo dono (comentário de recebi)", () => {
  it("chama a ferramenta que escreve uma vez só, mesmo que ela peça aprovação no chat", async () => {
    const { chamarFerramentaMcpPorAutomacao } = await import("./client");
    servidores = [tickets()];
    await chamarFerramentaMcpPorAutomacao("dono", "tickets", "tickets_create", { titulo: "x" });
    expect(chamadas).toEqual(["tickets_create"]);
  });

  it("ferramenta marcada como perigosa nunca roda por automação", async () => {
    const { chamarFerramentaMcpPorAutomacao } = await import("./client");
    servidores = [tickets({ toolRisks: { tickets_create: "perigoso" } })];
    await expect(chamarFerramentaMcpPorAutomacao("dono", "tickets", "tickets_create", {})).rejects.toThrow(/perigosa/);
    expect(chamadas).toEqual([]);
  });
});
