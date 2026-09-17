import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  _resetRegistry, availableFor, effectiveRisk, getTool, isEnabled, listRegisteredTools, needsApproval, registerTools,
  requesterNote, selectRelevant, summaryFor, toToolSet, type Requester, type ToolDef, type ToolOverride,
} from "./registry";

const ler: ToolDef<z.ZodObject<{ q: z.ZodString }>> = {
  name: "ler_coisa", domain: "teste", description: "Lê uma coisa do usuário.", risk: "leitura",
  keywords: ["ler", "coisa"], inputSchema: z.object({ q: z.string() }),
  run: async ({ q }) => ({ lido: q }),
};
const enviar: ToolDef<z.ZodObject<{ para: z.ZodString }>> = {
  name: "enviar_coisa", domain: "teste", description: "Envia uma coisa para alguém.", risk: "efeito_externo",
  keywords: ["enviar", "mandar"], inputSchema: z.object({ para: z.string() }),
  summarize: ({ para }) => `Enviar coisa para ${para}`,
  run: async () => "enviado",
};
const google: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "ler_agenda", domain: "agenda", description: "Lê a agenda.", risk: "leitura",
  requires: { connector: "google" }, inputSchema: z.object({}), run: async () => ({ ok: true }),
};
const zap: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "zap", domain: "whatsapp", description: "Manda zap.", risk: "efeito_externo",
  requires: { available: () => false }, inputSchema: z.object({}), run: async () => "x",
};

beforeEach(() => {
  _resetRegistry();
  registerTools([ler, enviar, google, zap]);
});

describe("registro de tools", () => {
  it("registra, lista e recusa nome duplicado com definição diferente", () => {
    expect(listRegisteredTools().map((t) => t.name)).toEqual(["ler_coisa", "enviar_coisa", "ler_agenda", "zap"]);
    expect(getTool("ler_coisa")).toBe(ler);
    registerTools([ler]); // a mesma definição de novo é idempotente
    expect(() => registerTools([{ ...ler }])).toThrow(/duplicada/);
  });

  it("availableFor respeita conector, disponibilidade e tool desligada", () => {
    const semGoogle = availableFor(listRegisteredTools(), { connected: new Set() });
    expect(semGoogle.map((t) => t.name)).toEqual(["ler_coisa", "enviar_coisa"]);
    const comGoogle = availableFor(listRegisteredTools(), { connected: new Set(["google"]) });
    expect(comGoogle.map((t) => t.name)).toContain("ler_agenda");
    const overrides = new Map<string, ToolOverride>([["ler_coisa", { enabled: false, riskOverride: null }]]);
    expect(availableFor(listRegisteredTools(), { connected: new Set(), overrides }).map((t) => t.name)).toEqual(["enviar_coisa"]);
  });

  it("risco efetivo: override da tela vence o declarado", () => {
    const overrides = new Map<string, ToolOverride>([["ler_coisa", { enabled: true, riskOverride: "perigoso" }]]);
    expect(effectiveRisk(ler)).toBe("leitura");
    expect(effectiveRisk(ler, overrides)).toBe("perigoso");
    // rebaixar não vale: uma tool de efeito externo nunca perde o gate por override
    const rebaixa = new Map<string, ToolOverride>([["enviar_coisa", { enabled: true, riskOverride: "leitura" }]]);
    expect(effectiveRisk(enviar, rebaixa)).toBe("efeito_externo");
    expect(isEnabled(ler, overrides)).toBe(true);
    expect(needsApproval("leitura")).toBe(false);
    expect(needsApproval("escrita")).toBe(false);
    expect(needsApproval("efeito_externo")).toBe(true);
    expect(needsApproval("perigoso")).toBe(true);
  });
});

describe("gate derivado do risco", () => {
  it("tool de leitura executa; tool de efeito externo só enfileira e nunca chama run", async () => {
    const runSpy = vi.spyOn(enviar, "run");
    const enqueue = vi.fn(async (_d, _i, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, id: "1", resumo }));
    const set = toToolSet([ler, enviar], { userId: "u1" }, { enqueue });
    const lido = await set.ler_coisa!.execute!({ q: "x" }, { toolCallId: "t", messages: [] });
    expect(lido).toEqual({ lido: "x" });
    const prop = await set.enviar_coisa!.execute!({ para: "ana" }, { toolCallId: "t", messages: [] });
    expect(prop).toMatchObject({ proposta_enfileirada: true, resumo: "Enviar coisa para ana" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("override que tenta rebaixar uma tool com gate é ignorado: continua enfileirando", async () => {
    const runSpy = vi.spyOn(enviar, "run");
    const enqueue = vi.fn(async (_d, _i, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, resumo }));
    const overrides = new Map<string, ToolOverride>([["enviar_coisa", { enabled: true, riskOverride: "leitura" }]]);
    const set = toToolSet([enviar], { userId: "u1" }, { overrides, enqueue });
    await set.enviar_coisa!.execute!({ para: "x" }, { toolCallId: "t", messages: [] });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("override da tela sobe uma tool de leitura para o gate", async () => {
    const enqueue = vi.fn(async (_d, _i, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, resumo }));
    const overrides = new Map<string, ToolOverride>([["ler_coisa", { enabled: true, riskOverride: "efeito_externo" }]]);
    const set = toToolSet([ler], { userId: "u1" }, { overrides, enqueue });
    await set.ler_coisa!.execute!({ q: "x" }, { toolCallId: "t", messages: [] });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("summaryFor usa summarize e cai no genérico quando não há", () => {
    expect(summaryFor(enviar, { para: "b" })).toBe("Enviar coisa para b");
    expect(summaryFor(ler, { q: "x" })).toMatch(/^ler_coisa\(/);
  });
});

describe("seleção por relevância", () => {
  it("com poucas tools manda todas; acima do teto fica com as mais relevantes, na ordem de registro", () => {
    const all = listRegisteredTools();
    expect(selectRelevant(all, "qualquer coisa", 10)).toEqual(all);
    const sel = selectRelevant(all, "manda uma coisa para a Ana", 1);
    expect(sel.map((t) => t.name)).toEqual(["enviar_coisa"]);
    const semQuery = selectRelevant(all, "", 2);
    expect(semQuery.map((t) => t.name)).toEqual(["ler_coisa", "enviar_coisa"]);
  });
  it("ignora acentos e palavras curtas", () => {
    const sel = selectRelevant(listRegisteredTools(), "lê a agenda de amanhã", 1);
    expect(sel.map((t) => t.name)).toEqual(["ler_agenda"]);
  });
});

describe("permissão de quem pede (Onda 9)", () => {
  const exec = { toolCallId: "t", messages: [] };
  const anna: Requester = { personId: "a", name: "Anna", role: "morador", via: "voz", confidence: 0.914 };

  it("authorize recusa ANTES de executar", async () => {
    const run = vi.fn(async () => "feito");
    const t: ToolDef<z.ZodObject<{ x: z.ZodString }>> = { ...ler, name: "acionar", inputSchema: z.object({ x: z.string() }), authorize: async () => "sem permissão", run };
    const set = toToolSet([t], { userId: "u1" }, { enqueue: vi.fn() });
    expect(await set.acionar!.execute!({ x: "1" }, exec)).toEqual({ permitido: false, erro: "sem permissão" });
    expect(run).not.toHaveBeenCalled();
  });

  it("authorize recusa ANTES de enfileirar (tool com gate)", async () => {
    const enqueue = vi.fn();
    const t = { ...enviar, authorize: async () => "Anna não pode" };
    const set = toToolSet([t], { userId: "u1" }, { enqueue });
    expect(await set.enviar_coisa!.execute!({ para: "x" }, exec)).toMatchObject({ permitido: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("proposta enfileirada diz quem pediu por voz; voz nunca executa sozinha", async () => {
    const runSpy = vi.spyOn(enviar, "run");
    const enqueue = vi.fn(async (_d, _i, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, resumo }));
    const set = toToolSet([enviar], { userId: "u1", requester: async () => anna }, { enqueue });
    await set.enviar_coisa!.execute!({ para: "ana" }, exec);
    expect(enqueue.mock.calls[0]![2]).toBe("Enviar coisa para ana (pedido por voz: Anna, 91%)");
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("a nota de quem pediu fica na fila, mas NÃO volta ao modelo", async () => {
    const enqueue = vi.fn(async (_d, _i, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, resumo }));
    const set = toToolSet([enviar], { userId: "u1", requester: async () => anna }, { enqueue });
    const r = await set.enviar_coisa!.execute!({ para: "ana" }, exec);
    expect(enqueue.mock.calls[0]![2]).toMatch(/pedido por voz: Anna/);
    expect(r).toMatchObject({ resumo: "Enviar coisa para ana" });
  });

  it("tool de casa que age sem authorize é recusada no registro", () => {
    const semAuth = { ...enviar, name: "casa_x", requires: { homeAssistant: true } };
    expect(() => registerTools([semAuth])).toThrow(/sem authorize/);
    expect(() => registerTools([{ ...ler, name: "casa_ler", requires: { homeAssistant: true } }])).not.toThrow();
  });

  it("nota de quem pediu só para voz", () => {
    expect(requesterNote({ ...anna, via: "conta" })).toBe("");
    expect(requesterNote(null)).toBe("");
  });
});
