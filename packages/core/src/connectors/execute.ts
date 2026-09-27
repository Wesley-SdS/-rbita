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

/**
 * A proposta CORRIGIDA À MÃO ainda é uma proposta válida?
 *
 * O dono passou a poder editar a ação antes de aprovar ("o ideal é aparecer um
 * wizard mostrando como ficou, eu podendo alterar e confirmar"). Editar é dele,
 * e é justamente o gate humano funcionando: quem decide o conteúdo é a pessoa,
 * não o texto que o modelo leu.
 *
 * Validar mesmo assim não é desconfiança de quem edita, é a mesma regra de §6:
 * toda entrada passa por zod. O ganho prático é a mensagem: sem isto, um campo
 * apagado sem querer só apareceria como "Proposta inválida" na hora de executar,
 * depois de a pessoa já ter clicado em confirmar.
 */
export function validarPropostaEditada(
  kind: string,
  payload: unknown,
): { ok: true; dados: Record<string, unknown> } | { ok: false; erro: string } {
  // tool de servidor MCP não tem schema no registro: o próprio servidor valida
  if (kind === MCP_ACTION_KIND) {
    return payload && typeof payload === "object"
      ? { ok: true, dados: payload as Record<string, unknown> }
      : { ok: false, erro: "A proposta precisa ser um objeto." };
  }
  const def = getTool(kind);
  if (!def) return { ok: false, erro: `Ação desconhecida: ${kind}` };
  const parsed = def.inputSchema.safeParse(payload);
  if (parsed.success) return { ok: true, dados: parsed.data as Record<string, unknown> };
  const primeiro = parsed.error.issues[0];
  const campo = primeiro?.path.join(".");
  return { ok: false, erro: campo ? `${campo}: ${primeiro?.message}` : (primeiro?.message ?? "Proposta inválida.") };
}
