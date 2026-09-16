import { getTool } from "../tools/index";
import { MCP_ACTION_KIND, callMcpTool } from "../mcp/client";

/**
 * Executa uma ação da fila (após aprovação humana). O `kind` é o nome da tool
 * no registro (ou `mcp_call` para tools de servidores MCP); o payload são os
 * argumentos que o modelo propôs. Só é invocado pelo endpoint /api/actions
 * (confirmação do usuário), nunca pelo LLM.
 *
 * Antes era um `switch` de 4 casos; agora qualquer tool com gate entra sozinha
 * (B3.9): o registro resolve, valida a entrada de novo (zod) e chama o `run`.
 */
export async function executeAction(userId: string, kind: string, payload: Record<string, unknown>): Promise<string> {
  if (kind === MCP_ACTION_KIND) return callMcpTool(userId, payload);

  const def = getTool(kind);
  if (!def) throw new Error(`Ação desconhecida: ${kind}`);
  const parsed = def.inputSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`Proposta inválida para ${kind}`);
  const result = await def.run(parsed.data, { userId });
  return typeof result === "string" ? result : JSON.stringify(result).slice(0, 2000);
}
