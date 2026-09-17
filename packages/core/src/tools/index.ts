import type { ToolSet } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
import { toolConfig } from "@orbita/db/tool-schema";
import { connectedProviders } from "../connectors/store";
import { getHaConnection } from "../home/connection";
import { whatsappConfigured } from "../connectors/whatsapp";
import { settings } from "../settings";
import {
  availableFor, effectiveRisk, requesterNote, type ToolContext, getTool, isEnabled, isToolRisk, listRegisteredTools, needsApproval, selectRelevant, summaryFor, toToolSet,
  type Enqueue, type ToolOverride, type ToolOverrides, type ToolRisk,
} from "./registry";

// Cada domínio se registra ao ser importado. Adicionar um domínio = uma linha
// aqui (o import), nunca uma entrada num arquivo central de tools.
import "./domains/tempo";
import "./domains/memoria";
import "./domains/financas";
import "./domains/tarefas";
import "./domains/widgets";
import "./domains/clima";
import "./domains/web-tools";
import "./domains/google";
import "./domains/notion";
import "./domains/slack";
import "./domains/whatsapp";
import "./domains/casa";
import "./domains/teams";
import "./domains/camera";
import "./domains/identidade";

export * from "./registry";

// ── configuração por tool (tela do catálogo) ────────────────────────────────
// Cache curto por processo, igual ao das settings: mudou na tela, vale em segundos.
const CACHE_MS = Number(process.env.SETTINGS_CACHE_MS ?? 5000);
let cache: { at: number; map: Map<string, ToolOverride> } | null = null;

export async function loadToolOverrides(): Promise<ToolOverrides> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const map = new Map<string, ToolOverride>();
  try {
    for (const r of await db.select().from(toolConfig)) {
      map.set(r.name, { enabled: r.enabled, riskOverride: isToolRisk(r.riskOverride) ? r.riskOverride : null });
    }
  } catch {
    // fail-soft: sem a tabela, todas ligadas com o risco declarado
    if (cache) return cache.map;
  }
  cache = { at: Date.now(), map };
  return map;
}

export async function setToolOverride(name: string, patch: { enabled?: boolean; riskOverride?: ToolRisk | null }): Promise<void> {
  const current = (await loadToolOverrides()).get(name) ?? { enabled: true, riskOverride: null };
  const next: ToolOverride = { enabled: patch.enabled ?? current.enabled, riskOverride: patch.riskOverride === undefined ? current.riskOverride : patch.riskOverride };
  if (next.enabled && next.riskOverride === null) {
    await db.delete(toolConfig).where(eq(toolConfig.name, name)); // volta ao default: linha some
  } else {
    await db
      .insert(toolConfig)
      .values({ name, enabled: next.enabled, riskOverride: next.riskOverride, updatedAt: new Date() })
      .onConflictDoUpdate({ target: toolConfig.name, set: { enabled: next.enabled, riskOverride: next.riskOverride, updatedAt: new Date() } });
  }
  cache = null;
}

/** Catálogo para a tela: tudo que existe, com risco declarado, efetivo e estado. */
export async function toolCatalog(userId: string) {
  const [overrides, connected, haConn, waConnected] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), getHaConnection(userId), whatsappConfigured(userId),
  ]);
  const haConnected = haConn !== null;
  return listRegisteredTools().map((d) => ({
    name: d.name,
    domain: d.domain,
    description: d.description,
    risk: d.risk,
    riskOverride: overrides.get(d.name)?.riskOverride ?? null,
    effectiveRisk: effectiveRisk(d, overrides),
    enabled: isEnabled(d, overrides),
    requires: d.requires?.connector ?? (d.requires?.homeAssistant ? "home_assistant" : d.requires?.whatsapp ? "whatsapp" : d.requires?.available ? "env" : null),
    available: availableFor([d], { connected, haConnected, whatsappConnected: waConnected, overrides }).length === 1,
  }));
}

// ── gate humano derivado do risco ───────────────────────────────────────────
/**
 * Enfileira a PROPOSTA em action_queue (o LLM nunca executa efeito externo).
 * `kind` é o nome da tool: POST /api/actions resolve pelo registro e chama o `run`.
 */
export function enqueueFor(userId: string): Enqueue {
  return async (def, input, summary) => {
    const [row] = await db
      .insert(actionQueue)
      .values({ userId, kind: def.name, summary, payload: (input ?? {}) as Record<string, unknown> })
      .returning({ id: actionQueue.id });
    return { proposta_enfileirada: true, aguardando_aprovacao: true, id: row?.id, resumo: summary };
  };
}

/**
 * ToolSet do turno: tools ligadas, com exigências atendidas para este usuário,
 * selecionadas por relevância ao pedido, com o gate derivado do risco efetivo.
 */
export async function buildToolSet(userId: string, query = "", requester?: ToolContext["requester"], origin?: ToolContext["origin"], voiceRef?: ToolContext["voiceRef"]): Promise<ToolSet> {
  const [overrides, connected, max, haConn, waConnected] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), settings.get("tools.maxPerTurn"), getHaConnection(userId), whatsappConfigured(userId),
  ]);
  const usable = availableFor(listRegisteredTools(), { connected, haConnected: haConn !== null, whatsappConnected: waConnected, overrides });
  const chosen = selectRelevant(usable, query, max);
  return toToolSet(chosen, { userId, requester, origin, voiceRef }, { overrides, enqueue: enqueueFor(userId) });
}

/**
 * Definições cruas (não convertidas em ToolSet do AI SDK) das tools deste
 * usuário agora — usado pela sessão realtime (Onda 6, B7.2): a OpenAI
 * Realtime API quer `{ name, description, parameters }` em JSON Schema, não
 * o wrapper `tool()` do AI SDK. Mesma seleção do chat (ligadas, exigências
 * atendidas, relevância), sem query porque a sessão de voz não tem "o pedido
 * deste turno" com antecedência.
 */
export async function toolDefsForRealtime(userId: string) {
  const [overrides, connected, max, haConn, waConnected] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), settings.get("tools.maxPerTurn"), getHaConnection(userId), whatsappConfigured(userId),
  ]);
  const usable = availableFor(listRegisteredTools(), { connected, haConnected: haConn !== null, whatsappConnected: waConnected, overrides });
  return selectRelevant(usable, "", max);
}

/**
 * Executa (ou enfileira) UMA chamada de função vinda da sessão realtime. O
 * browser nunca fala com o banco: ele repassa nome+argumentos para cá, e o
 * gate é DERIVADO DO RISCO exatamente como em `toToolSet` — uma tool
 * `efeito_externo`/`perigoso` chamada por voz enfileira a proposta em vez de
 * executar (a resposta falada da Órbita então narra "mandei para aprovação",
 * de graça, porque o modelo lê o resultado da função — é o B7.7 do briefing:
 * confirmação falada sem código especial).
 */
export async function runRealtimeTool(userId: string, name: string, rawInput: unknown, requester?: ToolContext["requester"], origin?: ToolContext["origin"]): Promise<unknown> {
  const def = getTool(name);
  if (!def) return { erro: `Ferramenta "${name}" não existe.` };

  const [overrides, connected, haConn, waConnected] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), getHaConnection(userId), whatsappConfigured(userId),
  ]);
  const usable = availableFor([def], { connected, haConnected: haConn !== null, whatsappConnected: waConnected, overrides });
  if (usable.length === 0) return { erro: `Ferramenta "${name}" não está disponível agora.` };

  const parsed = def.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) return { erro: "Entrada inválida para a ferramenta." };

  const ctx: ToolContext = { userId, requester, origin };
  const negado = def.authorize ? await def.authorize(parsed.data, ctx) : null;
  if (negado) return { permitido: false, erro: negado };
  const risk = effectiveRisk(def, overrides);
  if (needsApproval(risk)) {
    const quem = requester ? await requester().catch(() => null) : null;
    const resumo = summaryFor(def, parsed.data);
    const proposta = await enqueueFor(userId)(def, parsed.data, resumo + requesterNote(quem));
    return { ...proposta, resumo };
  }
  return def.run(parsed.data, ctx);
}
