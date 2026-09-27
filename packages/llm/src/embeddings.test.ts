import { describe, expect, it } from "vitest";
import { resolverEmbedding } from "./embeddings";

const comGemini = { GEMINI_API_KEY: "g" };
const comOpenAI = { OPENAI_API_KEY: "o" };
const comAsDuas = { ...comGemini, ...comOpenAI };
const LOCAL = "nomic-embed-text-v2-moe";

describe("resolverEmbedding (E2 do PRD-SEM-OLLAMA)", () => {
  it("automático com chave vai para a nuvem, Gemini primeiro, e a chave diz o modelo", () => {
    expect(resolverEmbedding("auto", LOCAL, comAsDuas).chave).toBe("google/gemini-embedding-2");
    expect(resolverEmbedding("auto", LOCAL, comOpenAI).chave).toBe("openai/text-embedding-3-small");
  });

  it("automático sem chave cai no local, e o local também tem chave de modelo", () => {
    const r = resolverEmbedding("auto", LOCAL, {});
    expect(r.onde).toBe("local");
    expect(r.chave).toBe(`local/${LOCAL}`);
  });

  it("gemini e openai explícitos escolhem aquele provedor mesmo havendo os dois", () => {
    expect(resolverEmbedding("openai", LOCAL, comAsDuas).chave).toBe("openai/text-embedding-3-small");
    expect(resolverEmbedding("gemini", LOCAL, comAsDuas).chave).toBe("google/gemini-embedding-2");
  });

  it("nuvem pedida sem a chave falha dizendo qual falta, e que a assinatura não serve", () => {
    expect(() => resolverEmbedding("gemini", LOCAL, comOpenAI)).toThrow(/GEMINI_API_KEY.*assinatura do Claude/);
    expect(() => resolverEmbedding("cloud", LOCAL, { CLAUDE_CODE_OAUTH_TOKEN: "x" })).toThrow(/não gera embeddings/);
  });

  it("local nunca sai de casa, mesmo com chave de nuvem", () => {
    expect(resolverEmbedding("local", LOCAL, comAsDuas).onde).toBe("local");
  });

  it("o modelo de nuvem pode ser trocado por env, e a chave acompanha", () => {
    expect(resolverEmbedding("gemini", LOCAL, { ...comGemini, EMBED_MODEL_CLOUD: "gemini-embedding-3" }).chave).toBe("google/gemini-embedding-3");
  });
});
