import { describe, it, expect } from "vitest";
import { escolherProvedorRealtime } from "./provider";
import { limparSchemaParaGemini, montarSetupGemini, urlSessaoGemini } from "./gemini";

describe("escolha do provedor de voz em tempo real", () => {
  it("no automático prefere o Gemini, que custa uma fração do minuto", () => {
    expect(escolherProvedorRealtime("auto", { openai: true, gemini: true })).toBe("gemini");
  });

  it("no automático usa a OpenAI quando é a única chave", () => {
    expect(escolherProvedorRealtime("auto", { openai: true, gemini: false })).toBe("openai");
  });

  it("sem chave nenhuma o modo fica indisponível", () => {
    expect(escolherProvedorRealtime("auto", { openai: false, gemini: false })).toBeNull();
  });

  it("respeita a escolha explícita do dono", () => {
    expect(escolherProvedorRealtime("openai", { openai: true, gemini: true })).toBe("openai");
    expect(escolherProvedorRealtime("gemini", { openai: true, gemini: true })).toBe("gemini");
  });

  it("escolha explícita sem a chave NÃO cai no outro provedor", () => {
    // cair calado na OpenAI seria a surpresa na fatura que a escolha evita
    expect(escolherProvedorRealtime("gemini", { openai: true, gemini: false })).toBeNull();
    expect(escolherProvedorRealtime("openai", { openai: false, gemini: true })).toBeNull();
  });
});

describe("esquema de função para o Gemini", () => {
  it("tira o que a API recusa e mantém o que descreve o parâmetro", () => {
    const limpo = limparSchemaParaGemini({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      type: "object",
      description: "Contas a vencer",
      properties: {
        dias: { type: "integer", description: "Janela", exclusiveMinimum: 0 },
      },
      required: ["dias"],
    });
    expect(limpo.$schema).toBeUndefined();
    expect(limpo.additionalProperties).toBeUndefined();
    expect((limpo.properties as Record<string, Record<string, unknown>>).dias.exclusiveMinimum).toBeUndefined();
    expect((limpo.properties as Record<string, Record<string, unknown>>).dias.description).toBe("Janela");
    expect(limpo.required).toEqual(["dias"]);
  });

  it("converte o opcional do zod (type com null) em nullable", () => {
    const limpo = limparSchemaParaGemini({ type: ["string", "null"], description: "cômodo" });
    expect(limpo.type).toBe("string");
    expect(limpo.nullable).toBe(true);
  });

  it("converte const em enum de um, que é o que o Gemini entende", () => {
    const limpo = limparSchemaParaGemini({ const: "sala" });
    expect(limpo.enum).toEqual(["sala"]);
    expect(limpo.type).toBe("string");
  });

  it("limpa em profundidade: dentro de items e de anyOf", () => {
    const limpo = limparSchemaParaGemini({
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { n: { type: "number", format: "double" } } },
      anyOf: [{ type: "string", $schema: "x" }],
    });
    const item = limpo.items as Record<string, unknown>;
    expect(item.additionalProperties).toBeUndefined();
    expect((item.properties as Record<string, Record<string, unknown>>).n.format).toBeUndefined();
    expect((limpo.anyOf as Record<string, unknown>[])[0].$schema).toBeUndefined();
  });

  it("lixo não derruba a montagem", () => {
    expect(limparSchemaParaGemini(null)).toEqual({});
    expect(limparSchemaParaGemini("texto")).toEqual({});
  });
});

describe("mensagem de setup do Gemini Live", () => {
  const base = {
    modelo: "gemini-3.8-live",
    voz: "Zephyr",
    instrucoes: "Você é a Órbita.",
    funcoes: [{ name: "contas_a_vencer", description: "Lista contas.", parameters: { type: "object", $schema: "x", properties: {} } }],
  };

  it("prefixa o modelo com models/ e não duplica quando já vem prefixado", () => {
    expect(montarSetupGemini(base).model).toBe("models/gemini-3.8-live");
    expect(montarSetupGemini({ ...base, modelo: "models/gemini-3.8-live" }).model).toBe("models/gemini-3.8-live");
  });

  it("pede áudio, fixa a voz e liga as duas transcrições", () => {
    const s = montarSetupGemini(base);
    const gen = s.generationConfig as Record<string, unknown>;
    expect(gen.responseModalities).toEqual(["AUDIO"]);
    expect(JSON.stringify(gen.speechConfig)).toContain("Zephyr");
    // sem isto a conversa por voz não deixaria rastro nenhum na tela
    expect(s.inputAudioTranscription).toEqual({});
    expect(s.outputAudioTranscription).toEqual({});
  });

  it("declara as funções com o esquema já peneirado", () => {
    const s = montarSetupGemini(base);
    const tools = s.tools as Array<{ functionDeclarations: Array<{ name: string; parameters: Record<string, unknown> }> }>;
    expect(tools[0].functionDeclarations[0].name).toBe("contas_a_vencer");
    expect(tools[0].functionDeclarations[0].parameters.$schema).toBeUndefined();
  });

  it("sem tool nenhuma não manda o campo tools, que a API recusa vazio", () => {
    expect(montarSetupGemini({ ...base, funcoes: [] }).tools).toBeUndefined();
  });

  it("o token vai na query, porque o WebSocket do navegador não manda header", () => {
    const url = urlSessaoGemini("auth_tokens/abc def");
    expect(url).toContain("BidiGenerateContentConstrained");
    expect(url).toContain("access_token=auth_tokens%2Fabc%20def");
  });
});
