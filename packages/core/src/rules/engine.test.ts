import { describe, it, expect } from "vitest";
import { RuleInputSchema, cronDue, cronError, evaluateConditions, getPath, matchesEvent, renderTemplate } from "./engine";

describe("regras: validação da entrada", () => {
  it("aceita uma regra evento → notify", () => {
    const r = RuleInputSchema.safeParse({
      name: "Contas",
      trigger: { kind: "event", type: "finance.bill_due" },
      conditions: [{ path: "payload.total", op: "gt", value: 0 }],
      actions: [{ kind: "notify", title: "Contas", body: "{{payload.resumo}}" }],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.enabled).toBe(true);
  });
  it("rejeita ação desconhecida, sem ações e operador inválido", () => {
    expect(RuleInputSchema.safeParse({ name: "x", trigger: { kind: "event", type: "a" }, actions: [{ kind: "explodir" }] }).success).toBe(false);
    expect(RuleInputSchema.safeParse({ name: "x", trigger: { kind: "event", type: "a" }, actions: [] }).success).toBe(false);
    expect(
      RuleInputSchema.safeParse({
        name: "x", trigger: { kind: "cron", expr: "* * * * *" }, conditions: [{ path: "a", op: "like", value: 1 }],
        actions: [{ kind: "prompt", prompt: "oi" }],
      }).success,
    ).toBe(false);
  });
  it("valida expressão cron", () => {
    expect(cronError("0 8 * * *")).toBeNull();
    expect(cronError("isso não é cron")).toMatch(/inválida/);
  });

  it("aceita as ações de canal externo (Onda 4, CH.3): whatsapp, teams_chat, teams_canal", () => {
    const base = { name: "Avisar", trigger: { kind: "event" as const, type: "algo" } };
    expect(RuleInputSchema.safeParse({ ...base, actions: [{ kind: "whatsapp", to: "5511999998888", text: "oi" }] }).success).toBe(true);
    expect(RuleInputSchema.safeParse({ ...base, actions: [{ kind: "teams_chat", chatId: "abc", text: "oi" }] }).success).toBe(true);
    expect(RuleInputSchema.safeParse({ ...base, actions: [{ kind: "teams_canal", equipeId: "e1", canalId: "c1", text: "oi" }] }).success).toBe(true);
  });
  it("ação de canal externo exige os campos certos", () => {
    const base = { name: "x", trigger: { kind: "event" as const, type: "a" } };
    expect(RuleInputSchema.safeParse({ ...base, actions: [{ kind: "whatsapp", to: "", text: "oi" }] }).success).toBe(false);
    expect(RuleInputSchema.safeParse({ ...base, actions: [{ kind: "teams_canal", equipeId: "e1", text: "oi" }] }).success).toBe(false);
  });
});

describe("regras: condições", () => {
  const ctx = { type: "finance.bill_due", payload: { total: 250.5, contas: [{ descricao: "Luz" }], tags: ["casa"], nome: "Conta de Luz" } };
  it("getPath lê caminhos aninhados e devolve undefined fora deles", () => {
    expect(getPath(ctx, "payload.total")).toBe(250.5);
    expect(getPath(ctx, "payload.nada.x")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
  it("operadores numéricos, igualdade, contains e exists", () => {
    expect(evaluateConditions([{ path: "payload.total", op: "gt", value: 100 }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "payload.total", op: "lte", value: 100 }], ctx)).toBe(false);
    expect(evaluateConditions([{ path: "type", op: "eq", value: "finance.bill_due" }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "type", op: "neq", value: "finance.bill_due" }], ctx)).toBe(false);
    expect(evaluateConditions([{ path: "payload.nome", op: "contains", value: "luz" }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "payload.tags", op: "contains", value: "casa" }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "payload.contas", op: "exists" }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "payload.x", op: "not_exists" }], ctx)).toBe(true);
  });
  it("comparação numérica com valor não numérico não casa (sem NaN silencioso)", () => {
    expect(evaluateConditions([{ path: "payload.nome", op: "gt", value: 1 }], ctx)).toBe(false);
  });
  it("sem condições sempre vale; várias condições são E lógico", () => {
    expect(evaluateConditions([], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "payload.total", op: "gt", value: 100 }, { path: "type", op: "eq", value: "outro" }], ctx)).toBe(false);
  });
});

describe("regras: template e cron", () => {
  it("renderTemplate substitui caminhos e ignora ausentes", () => {
    const out = renderTemplate("Total {{payload.total}} de {{ payload.nome }} {{payload.nada}}!", { payload: { total: 2, nome: "Luz" } });
    expect(out).toBe("Total 2 de Luz !");
  });
  it("cronDue detecta disparo entre o último tick e agora, e não repete", () => {
    // expressão por minuto: independe do fuso da máquina (o motor usa o fuso local, o da casa)
    const since = new Date("2026-09-16T07:59:30Z");
    const now = new Date("2026-09-16T08:00:20Z");
    expect(cronDue("* * * * *", since, now)).toBe(true);
    expect(cronDue("* * * * *", now, new Date("2026-09-16T08:00:50Z"))).toBe(false);
    expect(cronDue("inválido", since, now)).toBe(false);
  });
  it("matchesEvent só casa gatilho de evento com o tipo exato", () => {
    expect(matchesEvent({ kind: "event", type: "a.b" }, "a.b")).toBe(true);
    expect(matchesEvent({ kind: "event", type: "a.b" }, "a.c")).toBe(false);
    expect(matchesEvent({ kind: "cron", expr: "* * * * *" }, "a.b")).toBe(false);
  });
});
