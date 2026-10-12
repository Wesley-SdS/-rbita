import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  _resetRegistry, availableFor, effectiveRisk, getTool, isEnabled, listRegisteredTools, needsApproval, registerTools,
  requesterNote, selectRelevant, summaryFor, toToolSet, type Requester, type ToolDef, type ToolOverride,
  comVisao, executarChamada, maiorRisco, riscoDaChamada, type GuardaSensivel, type ToolRisk,
} from "./registry";
import { comImagem } from "../controle/imagem";

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

// ── PRD-COMPUTADOR-E-NAVEGADOR F1: risco que sobe pela entrada ──────────────
describe("risco pelo alvo (elevarRisco)", () => {
  const execOpts = { toolCallId: "t", messages: [], context: {} } as never;
  const fila = () => vi.fn(async (_d: unknown, _i: unknown, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, id: "p1", resumo }));
  const comando = (elevar: ToolDef<z.ZodObject<{ comando: z.ZodString }>>["elevarRisco"]): ToolDef<z.ZodObject<{ comando: z.ZodString }>> => ({
    name: "rodar_coisa", domain: "teste", description: "Roda um comando.", risk: "leitura",
    inputSchema: z.object({ comando: z.string() }),
    summarize: ({ comando: c }, risco) => `Comando (${risco}): ${c}`,
    elevarRisco: elevar,
    run: async ({ comando: c }) => ({ rodou: c }),
  });

  it("sobe de leitura para perigoso e manda para a fila, com o risco efetivo no payload e no resumo", async () => {
    const t = comando(async ({ comando: c }) => (c.includes("rm -r") ? "perigoso" : "leitura"));
    const runSpy = vi.spyOn(t, "run");
    const enqueue = fila();
    const set = toToolSet([t], { userId: "u1" }, { enqueue });
    expect(await set.rodar_coisa!.execute!({ comando: "git status" }, execOpts)).toEqual({ rodou: "git status" });
    const r = await set.rodar_coisa!.execute!({ comando: "rm -r /" }, execOpts);
    expect(r).toMatchObject({ proposta_enfileirada: true });
    expect(runSpy).toHaveBeenCalledTimes(1); // só o git status
    // o "manda" e o botão do Telegram leem o risco DESTA chamada no payload
    expect(enqueue.mock.calls[0]![1]).toEqual({ comando: "rm -r /", risco: "perigoso" });
    expect(enqueue.mock.calls[0]![2]).toBe("Comando (perigoso): rm -r / (só se aprova pela tela)");
  });

  it("nunca desce: elevarRisco dizendo leitura não tira o gate de uma tool efeito_externo", async () => {
    const t = { ...enviar, elevarRisco: async () => "leitura" as const };
    const runSpy = vi.spyOn(t, "run");
    const enqueue = fila();
    await toToolSet([t], { userId: "u1" }, { enqueue }).enviar_coisa!.execute!({ para: "x" }, execOpts);
    expect(runSpy).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0]![1]).toEqual({ para: "x", risco: "efeito_externo" });
    expect(await riscoDaChamada(t, { para: "x" }, { userId: "u1" })).toBe("efeito_externo");
  });

  it("exceção ou lixo dentro de elevarRisco é perigoso (falha fechada)", async () => {
    const quebra = comando(async () => {
      throw new Error("parser caiu");
    });
    const runSpy = vi.spyOn(quebra, "run");
    const enqueue = fila();
    await toToolSet([quebra], { userId: "u1" }, { enqueue }).rodar_coisa!.execute!({ comando: "ls" }, execOpts);
    expect(runSpy).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0]![1]).toMatchObject({ risco: "perigoso" });
    expect(await riscoDaChamada(comando(async () => "talvez" as ToolRisk), { comando: "x" }, { userId: "u1" })).toBe("perigoso");
  });

  it("o override da tela também conta: o maior dos três vence", async () => {
    const t = comando(async () => "escrita");
    const overrides = new Map<string, ToolOverride>([["rodar_coisa", { enabled: true, riskOverride: "efeito_externo" }]]);
    expect(await riscoDaChamada(t, {}, { userId: "u1" }, overrides)).toBe("efeito_externo");
    expect(await riscoDaChamada(t, {}, { userId: "u1" })).toBe("escrita");
    expect(maiorRisco("leitura", "perigoso", "escrita")).toBe("perigoso");
  });

  it("elevarRisco olha a entrada JÁ FIXADA pelo preparar", async () => {
    const t = { ...comando(async ({ comando: c }) => (c === "FIXADO" ? "efeito_externo" : "leitura")), preparar: async () => ({ comando: "FIXADO" }) };
    const enqueue = fila();
    await toToolSet([t], { userId: "u1" }, { enqueue }).rodar_coisa!.execute!({ comando: "qualquer" }, execOpts);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("campo de entrada chamado risco é recusado no registro (o payload.risco é do código)", () => {
    expect(() => registerTools([{ ...ler, name: "com_risco", inputSchema: z.object({ risco: z.string() }) }])).toThrow(/reservado/);
  });
});

describe("tools sensíveis passam pela guarda (controle do PC)", () => {
  const anna: Requester = { personId: "a", name: "Anna", role: "morador", via: "voz", confidence: 0.914 };
  const execOpts = { toolCallId: "t", messages: [], context: {} } as never;
  const guarda = () => {
    const g = {
      executar: vi.fn(async (c: { run: () => Promise<unknown> }) => c.run()),
      enfileirada: vi.fn(async (..._a: unknown[]) => undefined),
      recusada: vi.fn(async (..._a: unknown[]) => undefined),
    };
    return g as typeof g & GuardaSensivel;
  };
  const term: ToolDef<z.ZodObject<{ comando: z.ZodString }>> = {
    name: "terminal_x", domain: "terminal", description: "Roda.", risk: "leitura", inputSchema: z.object({ comando: z.string() }),
    run: async ({ comando: c }) => ({ ok: c }),
  };

  it("sem guarda, a tool sensível é recusada e nunca roda", async () => {
    const runSpy = vi.spyOn(term, "run");
    const r = await executarChamada(term, { comando: "ls" }, { userId: "u1" }, { enqueue: vi.fn() });
    expect(r).toMatchObject({ permitido: false });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("execução direta vai pela guarda; proposta avisa a guarda; recusa também", async () => {
    const g = guarda();
    expect(await toToolSet([term], { userId: "u1" }, { enqueue: vi.fn(), guarda: g }).terminal_x!.execute!({ comando: "ls" }, execOpts)).toEqual({ ok: "ls" });
    expect(g.executar).toHaveBeenCalledTimes(1);

    const enqueue = vi.fn(async (_d: unknown, _i: unknown, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, id: "a9", resumo }));
    await executarChamada({ ...term, risk: "efeito_externo" }, { comando: "pnpm i" }, { userId: "u1" }, { enqueue, guarda: g });
    expect(g.enfileirada).toHaveBeenCalledWith(expect.objectContaining({ acaoId: "a9", risco: "efeito_externo" }));

    await executarChamada({ ...term, authorize: async () => "fora da pasta" }, { comando: "ls" }, { userId: "u1" }, { enqueue, guarda: g });
    expect(g.recusada).toHaveBeenCalledWith(expect.objectContaining({ motivo: "fora da pasta" }));
  });

  it("quem não é o dono (voz reconhecida de outra pessoa) é recusado antes de tudo", async () => {
    const g = guarda();
    const enqueue = vi.fn();
    const r = await executarChamada(term, { comando: "ls" }, { userId: "u1", requester: async () => anna }, { enqueue, guarda: g });
    expect(r).toMatchObject({ permitido: false });
    expect(g.executar).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(g.recusada).toHaveBeenCalledTimes(1);
  });

  it("domínio de fora com requires.dono também é sensível", async () => {
    const t = { ...ler, name: "ler_dono", requires: { dono: true } };
    expect(await executarChamada(t, { q: "x" }, { userId: "u1" }, { enqueue: vi.fn() })).toMatchObject({ permitido: false });
  });
});

describe("imagem para o modelo (F5)", () => {
  const foto: ToolDef<z.ZodObject<Record<string, never>>> = {
    name: "ver_algo", domain: "teste", description: "Vê.", risk: "leitura", inputSchema: z.object({}),
    run: async () => comImagem({ janela: "VS Code" }, { base64: "AAAA", mediaType: "image/png", alternativa: { tipo: "arvore", texto: "[1] botão Executar" } }),
  };
  type ComSaida = { toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => unknown };

  it("sem visão, o modelo recebe a alternativa e sabe qual foi usada; com visão, recebe a imagem", async () => {
    const set = toToolSet([foto, ler], { userId: "u1" }, { enqueue: vi.fn() });
    const saida = await set.ver_algo!.execute!({}, { toolCallId: "t", messages: [], context: {} } as never);
    const cego = (set.ver_algo as unknown as ComSaida).toModelOutput({ toolCallId: "t", input: {}, output: saida });
    expect(cego).toEqual({ type: "json", value: { janela: "VS Code", visao_usada: "arvore", arvore: "[1] botão Executar" } });
    const comOlhos = (comVisao(set, true).ver_algo as unknown as ComSaida).toModelOutput({ toolCallId: "t", input: {}, output: saida }) as { type: string; value: { type: string }[] };
    expect(comOlhos.type).toBe("content");
    expect(comOlhos.value.map((v) => v.type)).toEqual(["text", "file"]);
    // tool sem imagem: igual ao que o AI SDK faria sozinho
    expect((comVisao(set, true).ler_coisa as unknown as ComSaida).toModelOutput({ toolCallId: "t", input: {}, output: { lido: "x" } })).toEqual({ type: "json", value: { lido: "x" } });
    expect((set.ler_coisa as unknown as ComSaida).toModelOutput({ toolCallId: "t", input: {}, output: "texto" })).toEqual({ type: "text", value: "texto" });
  });

  it("tool de fora do registro (MCP, busca nativa) fica como veio", () => {
    const externa = { description: "mcp", execute: async () => "x" };
    expect(comVisao({ mcp__x: externa } as never, true).mcp__x).toBe(externa);
  });
});
