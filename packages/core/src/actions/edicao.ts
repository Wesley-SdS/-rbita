import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
// o registro puro: quem chama (aprovar.ts, pela execute.ts) já carregou os domínios
import { camposDaOrbita, getTool } from "../tools/registry";
import { ehToolSensivel } from "../controle/dominios";
import { MCP_ACTION_KIND } from "../mcp/pool-rules";
import { validarPropostaEditada } from "../connectors/execute";

/**
 * EDITAR A PROPOSTA ANTES DE APROVAR (B1 da revisão de 11/10/2026).
 *
 * O cartão da conversa deixa o dono corrigir a ação ("o ideal é aparecer um
 * wizard mostrando como ficou, eu podendo alterar e confirmar"). O furo: o
 * cartão recebia a entrada CRUA do modelo, e o objeto inteiro que voltava
 * SUBSTITUÍA o payload da fila, inclusive o que o código tinha fixado no
 * `preparar` (o alvo conferido na página, o destino resolvido, o hash do
 * arquivo), que o cartão nem mostrava.
 *
 * Agora quem decide o que se edita é o servidor, olhando o payload GRAVADO:
 *   - só campo simples (texto, número, sim/não, vazio) do topo do payload;
 *   - nunca um campo que o código fixou (`camposFixados`, gravado pelo
 *     registro) nem um dos nomes reservados abaixo;
 *   - nunca um campo que o SCHEMA marca como da Órbita ("Preenchido pela
 *     Órbita"), mesmo numa proposta gravada antes de `camposFixados` saber disso;
 *   - se a tool declara `camposEditaveis`, só esses; tool SENSÍVEL (terminal,
 *     arquivos, computador, navegador, controle) que não declara não edita
 *     nada: trocar o conteúdo de um arquivo ou o comando deixava o diff e o
 *     resumo aprovados diferentes do que rodaria (M18);
 *   - a edição é MESCLADA em cima do gravado: o que não é editável volta
 *     sempre do gravado, e um campo fixado com valor diferente é recusado.
 */

/** Nomes que nunca se editam, mesmo numa tool que esqueça de declarar: são o que o código fixa. */
const NUNCA_EDITAVEIS = new Set(["risco", "camposFixados", "fixado", "pedidoLiteral", "pedidoOriginal", "canal", "maquina", "sha256", "perfil", "origem", "sessaoId", "acaoId", "urlEsperada"]);

type Simples = string | number | boolean | null;
const ehSimples = (v: unknown): v is Simples => v === null || ["string", "number", "boolean"].includes(typeof v);

/** Mesmo valor, com as chaves em qualquer ordem. Puro. */
function igual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => igual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Onde moram os campos editáveis: na tool de servidor MCP são os argumentos
 * (`args`); `serverId` e `tool` são o que o dono aprovou e não se trocam. Puro.
 */
function base(kind: string, gravado: Record<string, unknown>): Record<string, unknown> {
  return kind === MCP_ACTION_KIND ? objeto(gravado.args) : gravado;
}

/** Os campos que o dono pode corrigir nesta proposta, com o valor gravado. Puro (lê só o registro). */
export function vistaEditavel(kind: string, gravado: Record<string, unknown>): Record<string, Simples> {
  const campos = base(kind, gravado);
  if (kind === MCP_ACTION_KIND) return Object.fromEntries(Object.entries(campos).filter(([, v]) => ehSimples(v))) as Record<string, Simples>;
  const def = getTool(kind);
  if (!def) return {};
  if (ehToolSensivel(def) && !def.camposEditaveis) return {};
  const fixados = new Set([...(Array.isArray(gravado.camposFixados) ? (gravado.camposFixados as unknown[]).map(String) : []), ...camposDaOrbita(def)]);
  const permitidos = def.camposEditaveis ? new Set(def.camposEditaveis) : null;
  const out: Record<string, Simples> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (!ehSimples(v) || NUNCA_EDITAVEIS.has(k) || fixados.has(k)) continue;
    if (permitidos && !permitidos.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * A proposta corrigida: o payload GRAVADO com só os campos editáveis trocados.
 * Campo não editável que veio IGUAL ao gravado é ignorado (o cartão antigo
 * mandava o objeto inteiro); com valor diferente, é recusado com a frase.
 */
export function mesclarEdicao(kind: string, gravado: Record<string, unknown>, editado: Record<string, unknown>): { ok: true; payload: Record<string, unknown> } | { ok: false; erro: string } {
  const vista = vistaEditavel(kind, gravado);
  const atual = base(kind, gravado);
  const mudou: Record<string, Simples> = {};
  for (const [k, v] of Object.entries(editado ?? {})) {
    if (k in vista) {
      if (!ehSimples(v)) return { ok: false, erro: `${k}: valor inválido.` };
      if (v !== vista[k]) mudou[k] = v;
    } else if (!igual(v, k in atual ? atual[k] : gravado[k])) {
      return { ok: false, erro: `O campo "${k}" foi fixado pela Órbita e não se altera aqui. Descarte e peça de novo se precisar mudar.` };
    }
  }
  const payload = kind === MCP_ACTION_KIND ? { ...gravado, args: { ...atual, ...mudou } } : { ...gravado, ...mudou };
  const v = validarPropostaEditada(kind, payload);
  if (!v.ok) return v;
  return { ok: true, payload };
}

/** O que o cartão da conversa mostra e deixa editar, lido da FILA (nunca a entrada crua do modelo). */
export async function vistaDaProposta(userId: string, id: string): Promise<Record<string, Simples>> {
  const [linha] = await db
    .select({ kind: actionQueue.kind, payload: actionQueue.payload })
    .from(actionQueue)
    .where(and(eq(actionQueue.id, id), eq(actionQueue.userId, userId)))
    .limit(1);
  return linha ? vistaEditavel(linha.kind, objeto(linha.payload)) : {};
}
