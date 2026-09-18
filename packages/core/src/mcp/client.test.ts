import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MCP conectado só quando é preciso (pedido do dono). O cenário que importa:
 * o MCP do Jira caiu. Montar o chat NÃO tenta reconectar; pedir algo do Jira
 * reconecta. E numa ação com efeito externo a chamada nunca é repetida, porque
 * a primeira pode ter executado.
 */

type Srv = { id: string; userId: string; name: string; url: string; headers: null; enabled: boolean; risk: string; toolsCatalog: unknown; catalogAt: Date | null; lastError: null; lastErrorAt: null; createdAt: Date };
let servidores: Srv[] = [];
let conexoes = 0;
let falharConexao = false;
let falharChamadas = 0;
let falharPing = false;
const chamadas: string[] = [];

vi.mock("@orbita/db", () => {
  const cadeia = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "from", "where", "update", "set", "insert", "values", "returning"]) p[k] = () => p;
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
      ({ "mcp.connectTimeoutMs": 100, "mcp.callTimeoutMs": 100, "mcp.idleMinutes": 15, "mcp.catalogRefreshHours": 24, "mcp.retryAfterSeconds": 60 })[k],
  },
}));
vi.mock("../net/ssrf", () => ({ assertPublicUrl: async () => undefined }));
vi.mock("../events/index", () => ({ events: { emit: async () => undefined } }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class {} }));
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

const jira = (over: Partial<Srv> = {}): Srv => ({
  id: "jira", userId: "dono", name: "jira", url: "https://jira.exemplo.com/mcp", headers: null, enabled: true, risk: "leitura",
  toolsCatalog: [{ name: "buscar_ticket", description: "busca ticket" }], catalogAt: new Date(), lastError: null, lastErrorAt: null, createdAt: new Date(), ...over,
});

const executar = async (tools: Record<string, unknown>, nome: string) =>
  (tools[nome] as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, { toolCallId: "1", messages: [] });

beforeEach(async () => {
  await forgetMcpServer("jira");
  conexoes = 0;
  falharConexao = false;
  falharChamadas = 0;
  falharPing = false;
  chamadas.length = 0;
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
