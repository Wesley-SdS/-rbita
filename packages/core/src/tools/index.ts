import type { ToolSet } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
import { toolConfig } from "@orbita/db/tool-schema";
import { connectedProviders } from "../connectors/store";
import { settings } from "../settings";
import {
  availableFor, effectiveRisk, isEnabled, isToolRisk, listRegisteredTools, selectRelevant, toToolSet,
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
  const [overrides, connected] = await Promise.all([loadToolOverrides(), connectedProviders(userId)]);
  return listRegisteredTools().map((d) => ({
    name: d.name,
    domain: d.domain,
    description: d.description,
    risk: d.risk,
    riskOverride: overrides.get(d.name)?.riskOverride ?? null,
    effectiveRisk: effectiveRisk(d, overrides),
    enabled: isEnabled(d, overrides),
    requires: d.requires?.connector ?? (d.requires?.available ? "env" : null),
    available: availableFor([d], { connected, overrides }).length === 1,
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
export async function buildToolSet(userId: string, query = ""): Promise<ToolSet> {
  const [overrides, connected, max] = await Promise.all([loadToolOverrides(), connectedProviders(userId), settings.get("tools.maxPerTurn")]);
  const usable = availableFor(listRegisteredTools(), { connected, overrides });
  const chosen = selectRelevant(usable, query, max);
  return toToolSet(chosen, { userId }, { overrides, enqueue: enqueueFor(userId) });
}
