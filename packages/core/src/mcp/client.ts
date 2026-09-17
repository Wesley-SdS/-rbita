import { tool, jsonSchema, type ToolSet } from "ai";
import { eq, and } from "drizzle-orm";
import { db } from "@orbita/db";
import { mcpServer } from "@orbita/db/extension-schema";
import { actionQueue } from "@orbita/db/action-schema";
import { log } from "../observability/logger";
import { assertPublicUrl } from "../net/ssrf";
import { events } from "../events/index";
import { isToolRisk, needsApproval, type ToolRisk } from "../tools/registry";

type McpClient = { close: () => Promise<void>; callTool: (a: { name: string; arguments?: Record<string, unknown> }) => Promise<{ content: unknown }> };

/** Nome canônico da tool MCP no chat (prefixo do servidor evita colisão). */
export const MCP_ACTION_KIND = "mcp_call";
export function mcpToolKey(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
}

async function connect(url: string, headers: Record<string, string> | null) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  // defesa SSRF: um MCP do usuário não pode apontar para a rede interna
  await assertPublicUrl(url);
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: headers ?? undefined } });
  const client = new Client({ name: "orbita", version: "1.0.0" });
  await client.connect(transport);
  return client as unknown as McpClient & { listTools: () => Promise<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }> };
}

/**
 * Carrega as ferramentas dos servidores MCP habilitados do usuário e as converte
 * em tools do AI SDK. Retorna as tools + um cleanup que fecha as conexões.
 * Cada servidor é isolado: se um falhar (offline/erro), os demais seguem.
 *
 * GATE (decisão da Onda 1): o risco vem da coluna `risk` do servidor
 * ("efeito_externo" por padrão). Com gate, o `execute` só ENFILEIRA a proposta
 * em action_queue (kind `mcp_call`); a chamada real acontece em POST /api/actions
 * via `callMcpTool`. Um MCP desconhecido nunca executa sozinho.
 */
export async function buildMcpTools(userId: string): Promise<{ tools: ToolSet; cleanup: () => Promise<void> }> {
  const servers = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.userId, userId), eq(mcpServer.enabled, true)));
  if (servers.length === 0) return { tools: {}, cleanup: async () => {} };

  const tools: ToolSet = {};
  const clients: McpClient[] = [];

  await Promise.all(
    servers.map(async (s) => {
      try {
        const client = await connect(s.url, s.headers as Record<string, string> | null);
        clients.push(client);
        const risk: ToolRisk = isToolRisk(s.risk) ? s.risk : "efeito_externo";
        const gated = needsApproval(risk);

        const { tools: mcpTools } = await client.listTools();
        for (const t of mcpTools) {
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
                  const res = await client.callTool({ name: t.name, arguments: args as Record<string, unknown> });
                  // B7.2: MCP roda sem o mesmo escrutínio das tools do registro (é
                  // código de fora); mesmo sem gate, a execução deixa rastro.
                  void events.emit("mcp.tool_executed", { server: s.name, tool: t.name }, { userId }).catch(() => {});
                  return res.content;
                },
          });
        }
      } catch (e) {
        log.warn("mcp.connect", { server: s.name, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  return {
    tools,
    cleanup: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
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
  const client = await connect(s.url, s.headers as Record<string, string> | null);
  try {
    const res = await client.callTool({ name: toolName, arguments: args });
    void events.emit("mcp.tool_executed", { server: s.name, tool: toolName, approved: true }, { userId }).catch(() => {});
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content).slice(0, 2000);
  } finally {
    await client.close().catch(() => {});
  }
}
