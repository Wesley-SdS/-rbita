import { tool, jsonSchema, type ToolSet } from "ai";
import { eq, and } from "drizzle-orm";
import { db } from "@orbita/db";
import { mcpServer, type McpServer } from "@orbita/db/extension-schema";
import { actionQueue } from "@orbita/db/action-schema";
import { log } from "../observability/logger";
import { assertPublicUrl } from "../net/ssrf";
import { events } from "../events/index";
import { settings } from "../settings";
import { isToolRisk, needsApproval, type ToolRisk } from "../tools/registry";
import { conexaoOciosa, impressaoDoServidor, podeRepetirChamada, precisaBuscarCatalogo } from "./pool-rules";

/**
 * Servidores MCP do dono, conectados SÓ QUANDO É PRECISO.
 *
 * Antes: a cada mensagem do chat, conectava em todos os servidores, listava as
 * tools e fechava tudo no fim do turno. Custava latência em todo turno e, com
 * um servidor fora do ar, o timeout dele em toda mensagem.
 *
 * Agora:
 *   - o catálogo de tools de cada servidor fica GUARDADO no banco (da última
 *     conexão boa). O modelo vê as tools por ele, sem conectar em nada;
 *   - a conexão abre quando uma tool é chamada, e fica viva para as próximas;
 *   - se ela tiver caído, a reconexão acontece nessa hora: o MCP do Jira caiu,
 *     você pediu algo do Jira, aí sim a Órbita reconecta;
 *   - conexão parada há muito tempo é fechada pelo processo persistente.
 *
 * GATE (decisão da Onda 1): o risco vem da coluna `risk` do servidor
 * ("efeito_externo" por padrão). Com gate, o `execute` só ENFILEIRA a proposta
 * em action_queue (kind `mcp_call`); a chamada real acontece em POST
 * /api/actions via `callMcpTool`. Um MCP desconhecido nunca executa sozinho.
 */

type McpClient = {
  close: () => Promise<void>;
  ping: (o?: { timeout?: number }) => Promise<unknown>;
  callTool: (a: { name: string; arguments?: Record<string, unknown> }, s?: undefined, o?: { timeout?: number }) => Promise<{ content: unknown; isError?: boolean }>;
  listTools: (p?: undefined, o?: { timeout?: number }) => Promise<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>;
};
type Catalogo = NonNullable<McpServer["toolsCatalog"]>;

/** Nome canônico da tool MCP no chat (prefixo do servidor evita colisão). */
export const MCP_ACTION_KIND = "mcp_call";
export function mcpToolKey(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
}

async function connect(url: string, headers: Record<string, string> | null, timeoutMs: number): Promise<McpClient> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  // defesa SSRF: um MCP do usuário não pode apontar para a rede interna
  await assertPublicUrl(url);
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: headers ?? undefined } });
  const client = new Client({ name: "orbita", version: "1.0.0" });
  await client.connect(transport, { timeout: timeoutMs });
  return client as unknown as McpClient;
}

// ── pool (um por processo; o apps/api é o processo vivo) ────────────────────

interface Conexao {
  client: McpClient;
  impressao: string;
  ultimoUso: number;
}
const pool = new Map<string, Conexao>();
/** duas tools do mesmo servidor chamadas juntas não abrem duas conexões */
const conectando = new Map<string, Promise<McpClient>>();
/** servidor sem catálogo que falhou: até quando não tentar de novo */
const falhouAte = new Map<string, number>();

async function fechar(serverId: string): Promise<void> {
  const c = pool.get(serverId);
  pool.delete(serverId);
  if (c) await c.client.close().catch(() => undefined);
}

async function registrarErro(s: McpServer, e: unknown): Promise<void> {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  log.warn("mcp.conexao_falhou", { server: s.name, error: msg });
  await db.update(mcpServer).set({ lastError: msg, lastErrorAt: new Date() }).where(eq(mcpServer.id, s.id)).catch(() => undefined);
}

/** A conexão viva deste servidor, abrindo se não houver (ou se a configuração mudou). */
async function conexao(s: McpServer): Promise<McpClient> {
  const impressao = impressaoDoServidor(s.url, s.headers);
  const viva = pool.get(s.id);
  if (viva && viva.impressao === impressao) {
    viva.ultimoUso = Date.now();
    return viva.client;
  }
  if (viva) await fechar(s.id);

  const emCurso = conectando.get(s.id);
  if (emCurso) return emCurso;
  const p = (async () => {
    const timeout = await settings.get("mcp.connectTimeoutMs");
    const client = await connect(s.url, s.headers as Record<string, string> | null, timeout);
    pool.set(s.id, { client, impressao, ultimoUso: Date.now() });
    return client;
  })().finally(() => conectando.delete(s.id));
  conectando.set(s.id, p);
  return p;
}

/** Busca o catálogo no servidor e guarda. Falhou: marca, para não tentar em toda mensagem. */
async function atualizarCatalogo(s: McpServer): Promise<Catalogo | null> {
  try {
    const timeout = await settings.get("mcp.connectTimeoutMs");
    const client = await conexao(s);
    const { tools } = await client.listTools(undefined, { timeout });
    const catalogo: Catalogo = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    await db.update(mcpServer).set({ toolsCatalog: catalogo, catalogAt: new Date(), lastError: null, lastErrorAt: null }).where(eq(mcpServer.id, s.id));
    falhouAte.delete(s.id);
    return catalogo;
  } catch (e) {
    await fechar(s.id);
    const esperaS = await settings.get("mcp.retryAfterSeconds");
    falhouAte.set(s.id, Date.now() + esperaS * 1000);
    await registrarErro(s, e);
    return null;
  }
}

/**
 * Chama uma tool do servidor, reconectando SE preciso.
 *
 * Leitura: tenta; se a conexão tinha caído, reconecta e tenta de novo uma vez.
 * Efeito externo: testa a conexão (ping) ANTES e chama uma vez só, porque a
 * primeira tentativa pode ter executado no servidor e só a resposta ter se
 * perdido. Repetir criaria dois tickets.
 */
async function chamar(s: McpServer, toolName: string, args: Record<string, unknown>, somenteLeitura: boolean): Promise<{ content: unknown; isError?: boolean }> {
  const timeout = await settings.get("mcp.callTimeoutMs");
  if (!podeRepetirChamada(somenteLeitura)) {
    let client = await conexao(s);
    try {
      await client.ping({ timeout: Math.min(timeout, 5000) });
    } catch {
      await fechar(s.id);
      client = await conexao(s);
    }
    return client.callTool({ name: toolName, arguments: args }, undefined, { timeout });
  }
  try {
    return await (await conexao(s)).callTool({ name: toolName, arguments: args }, undefined, { timeout });
  } catch (e) {
    log.info("mcp.reconectando", { server: s.name, tool: toolName, motivo: e instanceof Error ? e.message : String(e) });
    await fechar(s.id);
    return (await conexao(s)).callTool({ name: toolName, arguments: args }, undefined, { timeout });
  }
}

/**
 * As tools dos servidores MCP habilitados do dono, montadas pelo CATÁLOGO
 * guardado: nenhuma conexão acontece aqui, a não ser que o catálogo não exista
 * ou tenha vencido. Cada servidor é isolado: um fora do ar não derruba os
 * outros, e as tools dele continuam visíveis se já havia catálogo.
 */
export async function buildMcpTools(userId: string): Promise<{ tools: ToolSet; cleanup: () => Promise<void> }> {
  const servers = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.userId, userId), eq(mcpServer.enabled, true)));
  if (servers.length === 0) return { tools: {}, cleanup: async () => {} };

  const validadeMs = (await settings.get("mcp.catalogRefreshHours")) * 3_600_000;
  const tools: ToolSet = {};
  const agora = Date.now();

  await Promise.all(
    servers.map(async (s) => {
      let catalogo = s.toolsCatalog ?? null;
      if (precisaBuscarCatalogo({ temCatalogo: Boolean(catalogo?.length), catalogoEm: s.catalogAt }, agora, validadeMs, falhouAte.get(s.id))) {
        // catálogo velho continua valendo se a atualização falhar: melhor a
        // tool visível (e reconectar quando for chamada) do que sumir
        catalogo = (await atualizarCatalogo(s)) ?? catalogo;
      }
      if (!catalogo?.length) return;

      const risk: ToolRisk = isToolRisk(s.risk) ? s.risk : "efeito_externo";
      const gated = needsApproval(risk);
      for (const t of catalogo) {
        const key = mcpToolKey(s.name, t.name);
        const description = (t.description ?? t.name).slice(0, 400);
        tools[key] = tool({
          description: gated ? description + " (Não executa direto: enfileira uma proposta para o usuário aprovar.)" : description,
          inputSchema: jsonSchema((t.inputSchema as object) ?? { type: "object", properties: {} }),
          execute: gated
            ? async (args) => {
                const summary = `MCP ${s.name}: ${t.name}(${JSON.stringify(args).slice(0, 80)})`;
                const [row] = await db
                  .insert(actionQueue)
                  .values({ userId, kind: MCP_ACTION_KIND, summary, payload: { serverId: s.id, tool: t.name, args: args ?? {} } })
                  .returning({ id: actionQueue.id });
                return { proposta_enfileirada: true, aguardando_aprovacao: true, id: row?.id, resumo: summary };
              }
            : async (args) => {
                try {
                  const res = await chamar(s, t.name, (args ?? {}) as Record<string, unknown>, risk === "leitura");
                  // B7.2: MCP roda sem o mesmo escrutínio das tools do registro (é
                  // código de fora); mesmo sem gate, a execução deixa rastro.
                  void events.emit("mcp.tool_executed", { server: s.name, tool: t.name }, { userId }).catch(() => {});
                  return res.content;
                } catch (e) {
                  await registrarErro(s, e);
                  // resposta para o modelo, não exceção: ele explica ao dono que o
                  // servidor está fora, em vez de o turno inteiro falhar
                  return { erro: `O servidor ${s.name} não respondeu agora (${e instanceof Error ? e.message : "sem detalhe"}). Tente de novo em instantes.` };
                }
              },
        });
      }
    }),
  );

  // a conexão fica viva para as próximas mensagens; quem fecha é a faxina de
  // conexões ociosas. O `cleanup` continua existindo para quem já o chama.
  return { tools, cleanup: async () => {} };
}

/** Executa uma tool MCP aprovada (chamado só por POST /api/actions). */
export async function callMcpTool(userId: string, payload: Record<string, unknown>): Promise<string> {
  const serverId = String(payload.serverId ?? "");
  const toolName = String(payload.tool ?? "");
  const args = (payload.args && typeof payload.args === "object" ? payload.args : {}) as Record<string, unknown>;
  const [s] = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.id, serverId), eq(mcpServer.userId, userId)))
    .limit(1);
  if (!s) throw new Error("Servidor MCP não encontrado");
  try {
    // aprovado pelo dono = efeito externo: nunca repete a chamada
    const res = await chamar(s, toolName, args, false);
    void events.emit("mcp.tool_executed", { server: s.name, tool: toolName, approved: true }, { userId }).catch(() => {});
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content).slice(0, 2000);
  } catch (e) {
    await registrarErro(s, e);
    throw e;
  }
}

/** Faxina do processo persistente: fecha conexões paradas há muito tempo. */
export async function closeIdleMcpConnections(): Promise<number> {
  const ociosoMs = (await settings.get("mcp.idleMinutes")) * 60_000;
  const agora = Date.now();
  let fechadas = 0;
  for (const [id, c] of pool) {
    if (conexaoOciosa(c.ultimoUso, agora, ociosoMs)) {
      await fechar(id);
      fechadas++;
    }
  }
  return fechadas;
}

/** Servidor apagado ou desligado: fecha a conexão e esquece o que sabia dele. */
export async function forgetMcpServer(serverId: string): Promise<void> {
  falhouAte.delete(serverId);
  await fechar(serverId);
}

/** Só para teste. */
export function _mcpPoolSize(): number {
  return pool.size;
}
