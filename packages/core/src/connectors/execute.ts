import { getTool, isToolRisk, maiorRisco, riscoDaChamada, loadToolOverrides } from "../tools/index";
import { MCP_ACTION_KIND, callMcpTool } from "../mcp/client";
import { ehToolSensivel } from "../controle/dominios";
import { guardaDoControle } from "../controle/guarda";

/**
 * O payload da fila leva `risco` (o efetivo, gravado pelo registro ao propor)
 * e `camposFixados` (o que o código fixou). Não são entrada da tool: saem
 * antes de validar, para um schema estrito não recusar a proposta por causa deles.
 */
function semRisco(payload: Record<string, unknown>): { entrada: Record<string, unknown>; risco: unknown } {
  const { risco, camposFixados: _fixados, ...entrada } = payload ?? {};
  return { entrada, risco };
}

/**
 * Executa uma ação da fila (após aprovação humana). O `kind` é o nome da tool
 * no registro (ou `mcp_call` para tools de servidores MCP); o payload são os
 * argumentos que o modelo propôs. Só é invocado pelo endpoint /api/actions
 * (confirmação do usuário), nunca pelo LLM.
 *
 * Antes era um `switch` de 4 casos; agora qualquer tool com gate entra sozinha
 * (B3.9): o registro resolve, valida a entrada de novo (zod) e chama o `run`.
 */
export async function executeAction(userId: string, kind: string, payload: Record<string, unknown>, acaoId?: string): Promise<string> {
  if (kind === MCP_ACTION_KIND) return callMcpTool(userId, payload);

  const def = getTool(kind);
  if (!def) throw new Error(`Ação desconhecida: ${kind}`);
  const { entrada, risco } = semRisco(payload);
  const parsed = def.inputSchema.safeParse(entrada);
  if (!parsed.success) throw new Error(`Proposta inválida para ${kind}`);
  // o id da aprovação vai junto só quando há um: quem abre sessão o grava (controle_sessao.acao_id)
  const ctx = acaoId ? { userId, acaoId } : { userId };
  // tool do controle do PC: a execução aprovada passa pela MESMA guarda do
  // chat (controle ligado, dono, trilha), continuando o passo que esperava na
  // fila. O risco da trilha é o do que vai rodar AGORA (o dono pode ter editado
  // a proposta na tela), nunca menor que o gravado ao propor
  const sensivel = ehToolSensivel(def);
  const result = sensivel
    ? await guardaDoControle.executar({
        def,
        entrada: parsed.data,
        risco: maiorRisco(await riscoDaChamada(def, parsed.data, ctx, await loadToolOverrides()), isToolRisk(risco) ? risco : def.risk),
        ctx,
        acaoId,
        run: () => def.run(parsed.data, ctx),
      })
    : await def.run(parsed.data, ctx);
  // recusa depois da aprovação não é "feito": lança, e a ação vira `failed` com o motivo (O1 da revisão)
  const recusa = sensivel ? recusaDaExecucao(result) : null;
  if (recusa) throw new Error(recusa);
  return typeof result === "string" ? result : JSON.stringify(result).slice(0, 2000);
}

/**
 * A guarda e as tools do controle do PC recusam DEVOLVENDO (`{ permitido:
 * false, erro }`, `{ vetado, motivo }`, `{ erro }`, `{ bloqueada }`), que é
 * o certo no chat: o modelo lê e explica ao dono. Depois da aprovação, o mesmo
 * objeto virava o resultado de uma ação "feita", e o "manda" respondia
 * "Feito" sobre um clique que nunca aconteceu (a aba tinha mudado, o
 * controle estava desligado). Puro.
 */
export function recusaDaExecucao(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const texto = (v: unknown, padrao: string) => (typeof v === "string" && v.trim() ? v : padrao);
  if (o.permitido === false) return texto(o.erro, "A ação foi recusada.");
  if (o.vetado === true) return texto(o.motivo, "A ação foi vetada pelo crítico.");
  if (o.bloqueada === true) return texto(o.mensagem, "O site está bloqueado para a Órbita.");
  if (typeof o.erro === "string" && o.erro.trim()) return o.erro;
  return null;
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
  const parsed = def.inputSchema.safeParse(payload && typeof payload === "object" ? semRisco(payload as Record<string, unknown>).entrada : payload);
  if (parsed.success) return { ok: true, dados: parsed.data as Record<string, unknown> };
  const primeiro = parsed.error.issues[0];
  const campo = primeiro?.path.join(".");
  return { ok: false, erro: campo ? `${campo}: ${primeiro?.message}` : (primeiro?.message ?? "Proposta inválida.") };
}
