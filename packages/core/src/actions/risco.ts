import { MCP_ACTION_KIND } from "../mcp/pool-rules";
import { effectiveRisk, getTool, isToolRisk, maiorRisco, type ToolOverrides, type ToolRisk } from "../tools/index";

/**
 * O risco de uma PROPOSTA na fila, para quem aprova sem tela (a frase "manda"
 * e o botão do Telegram decidirem se ela é `perigoso`, que só sai pela tela).
 *
 * Desde o risco pelo alvo (PRD-COMPUTADOR-E-NAVEGADOR F1), o risco de uma
 * chamada pode ser MAIOR que o declarado da tool: `pnpm install` e `git status`
 * são a mesma tool. O registro grava o efetivo em `payload.risco` ao propor;
 * aqui vale o maior entre ele e o da tool hoje (o dono pode ter subido o risco
 * na tela depois). Nunca desce, e o que não se sabe é `perigoso`:
 *   - tool que não está mais no registro;
 *   - tool MCP sem risco gravado (proposta antiga): o registro não a conhece.
 *
 * O `risco` do payload é gravado pelo CÓDIGO (registro, `mcp/client.ts`),
 * nunca pelo modelo: o campo é reservado na entrada de tool. Puro.
 */
export function riscoDaProposta(p: { kind: string; payload: unknown }, overrides?: ToolOverrides): ToolRisk {
  const gravado = (p.payload as { risco?: unknown } | null)?.risco;
  if (p.kind === MCP_ACTION_KIND) return gravado === "efeito_externo" ? "efeito_externo" : "perigoso";
  const def = getTool(p.kind);
  if (!def) return "perigoso";
  const daTool = effectiveRisk(def, overrides);
  return isToolRisk(gravado) ? maiorRisco(daTool, gravado) : daTool;
}
