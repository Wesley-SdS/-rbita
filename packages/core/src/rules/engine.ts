import { z } from "zod";
import { Cron } from "croner";

/**
 * MOTOR DE REGRAS PROATIVAS — parte pura (sem banco, sem LLM), testável.
 *
 * Uma regra é: gatilho → condições → ações. O gatilho é um evento do bus
 * (`kind: "event"`) ou um horário (`kind: "cron"`). Condições olham o evento
 * (caminho no payload, operador, valor). Ações são executadas em rules/run.ts.
 *
 * Tudo aqui é DADO validado com zod: vem da tela, é entrada não confiável.
 * Novos tipos de gatilho/ação das próximas ondas (agenda, casa, câmera) entram
 * nas uniões abaixo, nunca como caso especial fora do motor.
 */
export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), type: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("cron"), expr: z.string().min(5).max(120) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists", "not_exists"] as const;
export const ConditionSchema = z.object({
  path: z.string().min(1).max(200),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion("kind", [
  // notificação direta, sem LLM: título/corpo com {{caminho}} do evento
  z.object({ kind: z.literal("notify"), title: z.string().min(1).max(200), body: z.string().min(1).max(4000) }),
  // pede ao modelo (com ferramentas) e notifica com a resposta
  z.object({ kind: z.literal("prompt"), prompt: z.string().min(1).max(4000) }),
]);
export type RuleAction = z.infer<typeof ActionSchema>;

export const RuleInputSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger: TriggerSchema,
  conditions: z.array(ConditionSchema).max(20).default([]),
  actions: z.array(ActionSchema).min(1).max(10),
});
export type RuleInput = z.infer<typeof RuleInputSchema>;

/** Valida uma expressão cron; devolve a mensagem de erro em pt-BR ou null. */
export function cronError(expr: string): string | null {
  try {
    new Cron(expr);
    return null;
  } catch {
    return "Expressão cron inválida (formato: minuto hora dia mês dia-da-semana)";
  }
}

/** Lê `a.b.c` de um objeto; `undefined` se não existir. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function compare(op: Condition["op"], actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    case "eq":
      return actual === expected || String(actual) === String(expected);
    case "neq":
      return !(actual === expected || String(actual) === String(expected));
    case "contains":
      if (Array.isArray(actual)) return actual.some((v) => String(v) === String(expected));
      return typeof actual === "string" && actual.toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(expected);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : a <= b;
    }
  }
}

/** Todas as condições precisam valer (E lógico). Sem condições = sempre vale. */
export function evaluateConditions(conditions: Condition[], context: unknown): boolean {
  return conditions.every((c) => compare(c.op, getPath(context, c.path), c.value));
}

/** Substitui `{{caminho}}` pelo valor do contexto (objetos viram JSON curto). */
export function renderTemplate(template: string, context: unknown): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = getPath(context, path);
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return JSON.stringify(v).slice(0, 500);
    return String(v);
  });
}

/**
 * Regra cron está devida? Devida quando existe um disparo programado entre a
 * última execução (ou o último tick) e agora. Tolerante a ticks irregulares:
 * um tick atrasado não perde o disparo, e nunca dispara duas vezes.
 */
export function cronDue(expr: string, since: Date, now: Date): boolean {
  try {
    const next = new Cron(expr).nextRun(since);
    return !!next && next.getTime() <= now.getTime();
  } catch {
    return false;
  }
}

/** O gatilho da regra casa com este evento? */
export function matchesEvent(trigger: Trigger, eventType: string): boolean {
  return trigger.kind === "event" && trigger.type === eventType;
}
