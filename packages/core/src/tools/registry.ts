import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import type { ConnectorId } from "../connectors/registry";

/**
 * REGISTRO DE FERRAMENTAS (CLAUDE.md §5.7).
 *
 * Cada domínio (memória, finanças, web, comunicação…) declara as próprias tools
 * com `registerTools()`; não existe mais um arquivo central de mil linhas.
 * Toda tool declara RISCO, e o gate humano (§5.1) é DERIVADO do risco aqui, no
 * momento de montar o ToolSet: tool de `efeito_externo`/`perigoso` nunca recebe
 * o `run` como execute; recebe um `execute` que só ENFILEIRA a proposta. É
 * impossível registrar uma tool perigosa que "esqueça" a aprovação.
 *
 * Este módulo é PURO (sem banco): testável. Quem liga ao banco é tools/index.ts.
 */
export const TOOL_RISKS = ["leitura", "escrita", "efeito_externo", "perigoso"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

export interface ToolContext {
  userId: string;
}

export interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** pt-BR snake_case, único no catálogo */
  name: string;
  /** domínio dono da tool: "memoria", "financas", "web", "agenda"… */
  domain: string;
  /** quando o modelo deve usá-la (vai para o provedor) */
  description: string;
  /** risco DECLARADO; o efetivo pode ser sobrescrito pela tela */
  risk: ToolRisk;
  inputSchema: I;
  /** palavras que ajudam a seleção por relevância a cada turno */
  keywords?: string[];
  /** só entra no ToolSet se a exigência valer para o usuário */
  requires?: { connector?: ConnectorId; homeAssistant?: boolean; whatsapp?: boolean; available?: () => boolean };
  /** a execução REAL. Para risco com gate, só roda após aprovação (POST /api/actions). */
  run: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
  /** resumo legível da proposta na fila de aprovação */
  summarize?: (input: z.infer<I>) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = ToolDef<any>;

const registry = new Map<string, AnyToolDef>();

/** Registra as tools de um domínio. Nome repetido é erro de programação. */
export function registerTools(defs: AnyToolDef[]): void {
  for (const d of defs) {
    if (registry.has(d.name) && registry.get(d.name) !== d) throw new Error(`Tool duplicada no registro: ${d.name}`);
    registry.set(d.name, d);
  }
}

export function listRegisteredTools(): AnyToolDef[] {
  return [...registry.values()];
}

export function getTool(name: string): AnyToolDef | undefined {
  return registry.get(name);
}

/** Só para testes: zera o registro. */
export function _resetRegistry(): void {
  registry.clear();
}

/** Risco que exige aprovação humana antes de executar. */
export function needsApproval(risk: ToolRisk): boolean {
  return risk === "efeito_externo" || risk === "perigoso";
}

export function isToolRisk(v: unknown): v is ToolRisk {
  return typeof v === "string" && (TOOL_RISKS as readonly string[]).includes(v);
}

/** Configuração por tool vinda da tela (linha ausente = ligada, risco declarado). */
export interface ToolOverride {
  enabled: boolean;
  riskOverride: ToolRisk | null;
}
export type ToolOverrides = ReadonlyMap<string, ToolOverride>;

const RISK_ORDER: Record<ToolRisk, number> = { leitura: 0, escrita: 1, efeito_externo: 2, perigoso: 3 };

/** `a` é pelo menos tão arriscado quanto `b`? */
export function riskAtLeast(a: ToolRisk, b: ToolRisk): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

/**
 * Risco efetivo: o override da tela só pode SUBIR o risco. Rebaixar uma tool
 * declarada com gate (efeito_externo/perigoso) tiraria a aprovação humana por
 * um clique na UI, e a UI não é defesa (achado da revisão da Onda 1). O clamp
 * vale aqui, no montador do ToolSet, não só na validação do endpoint.
 */
export function effectiveRisk(def: AnyToolDef, overrides?: ToolOverrides): ToolRisk {
  const o = overrides?.get(def.name)?.riskOverride;
  if (!o) return def.risk;
  return riskAtLeast(o, def.risk) ? o : def.risk;
}

export function isEnabled(def: AnyToolDef, overrides?: ToolOverrides): boolean {
  return overrides?.get(def.name)?.enabled ?? true;
}

/** Tools que valem para este usuário agora: ligadas e com exigências atendidas. */
export function availableFor(
  defs: AnyToolDef[],
  ctx: { connected: ReadonlySet<ConnectorId>; haConnected?: boolean; whatsappConnected?: boolean; overrides?: ToolOverrides },
): AnyToolDef[] {
  return defs.filter((d) => {
    if (!isEnabled(d, ctx.overrides)) return false;
    if (d.requires?.connector && !ctx.connected.has(d.requires.connector)) return false;
    if (d.requires?.homeAssistant && !ctx.haConnected) return false;
    if (d.requires?.whatsapp && !ctx.whatsappConnected) return false;
    if (d.requires?.available && !d.requires.available()) return false;
    return true;
  });
}

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

/**
 * SELEÇÃO POR RELEVÂNCIA (TL.6): com poucas tools manda todas; acima de `max`,
 * pontua cada uma pela sobreposição entre o pedido e nome/keywords/descrição e
 * fica com as `max` melhores. Sem LLM no caminho quente. Sem pedido (rotinas),
 * devolve as primeiras `max` na ordem de registro (estável).
 */
export function selectRelevant(defs: AnyToolDef[], query: string, max: number): AnyToolDef[] {
  if (defs.length <= max) return defs;
  const q = new Set(tokenize(query));
  if (!q.size) return defs.slice(0, max);
  // radical simples: "manda" casa "mandar", "reuniões" casa "reuniao" (sem stemmer)
  const hit = (list: string[], t: string) => list.some((w) => w === t || (t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))));
  const scored = defs.map((d, i) => {
    const nameT = tokenize(d.name.replace(/_/g, " "));
    const kwT = (d.keywords ?? []).flatMap(tokenize);
    const descT = tokenize(d.description);
    let score = 0;
    for (const t of q) {
      if (hit(nameT, t)) score += 3;
      if (hit(kwT, t)) score += 2;
      if (hit(descT, t)) score += 1;
    }
    return { d, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.d);
}

/** O que a tool devolve ao modelo quando só enfileirou a proposta (formato de sempre). */
export interface EnqueueResult {
  proposta_enfileirada: true;
  aguardando_aprovacao: true;
  id?: string;
  resumo: string;
}
export type Enqueue = (def: AnyToolDef, input: unknown, summary: string) => Promise<EnqueueResult>;

export function summaryFor(def: AnyToolDef, input: unknown): string {
  try {
    if (def.summarize) return def.summarize(input);
  } catch {
    /* cai no genérico */
  }
  return `${def.name}(${JSON.stringify(input).slice(0, 120)})`;
}

/**
 * Converte definições em ToolSet do AI SDK, DERIVANDO o gate: risco com
 * aprovação → `execute` enfileira; senão → `execute` roda de verdade.
 */
export function toToolSet(defs: AnyToolDef[], ctx: ToolContext, opts: { overrides?: ToolOverrides; enqueue: Enqueue }): ToolSet {
  const set: ToolSet = {};
  for (const d of defs) {
    const risk = effectiveRisk(d, opts.overrides);
    set[d.name] = tool({
      description: d.description,
      inputSchema: d.inputSchema,
      execute: needsApproval(risk)
        ? async (input: unknown) => opts.enqueue(d, input, summaryFor(d, input))
        : async (input: unknown) => d.run(input, ctx),
    });
  }
  return set;
}
