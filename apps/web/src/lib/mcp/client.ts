import { tool, jsonSchema, type ToolSet } from "ai";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServer } from "@/lib/db/extension-schema";
import { log } from "@/lib/observability/logger";
import { assertPublicUrl } from "@/lib/net/ssrf";

type McpClient = { close: () => Promise<void> };

/**
 * Carrega as ferramentas dos servidores MCP habilitados do usuário e as converte
 * em tools do AI SDK. Retorna as tools + um cleanup que fecha as conexões.
 * Cada servidor é isolado: se um falhar (offline/erro), os demais seguem.
 */
export async function buildMcpTools(userId: string): Promise<{ tools: ToolSet; cleanup: () => Promise<void> }> {
  const servers = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.userId, userId), eq(mcpServer.enabled, true)));
  if (servers.length === 0) return { tools: {}, cleanup: async () => {} };

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  const tools: ToolSet = {};
  const clients: McpClient[] = [];

  await Promise.all(
    servers.map(async (s) => {
      try {
        // defesa SSRF: um MCP do usuário não pode apontar para a rede interna
        await assertPublicUrl(s.url);
        const transport = new StreamableHTTPClientTransport(new URL(s.url), {
          requestInit: { headers: (s.headers as Record<string, string>) ?? undefined },
        });
        const client = new Client({ name: "orbita", version: "1.0.0" });
        await client.connect(transport);
        clients.push(client);

        const { tools: mcpTools } = await client.listTools();
        for (const t of mcpTools) {
          // prefixa com o nome do servidor p/ evitar colisão entre MCPs
          const key = `${s.name}__${t.name}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
          tools[key] = tool({
            description: (t.description ?? t.name).slice(0, 400),
            inputSchema: jsonSchema((t.inputSchema as object) ?? { type: "object", properties: {} }),
            execute: async (args) => {
              const res = await client.callTool({ name: t.name, arguments: args as Record<string, unknown> });
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
