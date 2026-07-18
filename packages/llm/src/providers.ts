import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway } from "@ai-sdk/gateway";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { getModelInfo } from "./catalog";

/**
 * Resolve uma chave do catálogo (`provider/id`) para um LanguageModel do AI SDK.
 * - local   → Ollama (OpenAI-compatible) · grátis, sem credencial
 * - gateway → Vercel AI Gateway (BYOK) · exige AI_GATEWAY_API_KEY
 * - claude  → assinatura Claude Max via token OAuth do Claude Code (não pelo Gateway)
 */
export function resolveModel(key: string): LanguageModel {
  const info = getModelInfo(key);
  if (!info) throw new Error(`Modelo desconhecido: ${key}`);

  switch (info.provider) {
    case "local": {
      const ollama = createOpenAICompatible({
        name: "ollama",
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
      return ollama.chatModel(info.id);
    }
    case "gateway": {
      const apiKey = process.env.AI_GATEWAY_API_KEY;
      if (!apiKey) throw new Error("AI_GATEWAY_API_KEY não configurada");
      const gateway = createGateway({ apiKey });
      return gateway(info.id);
    }
    case "claude": {
      const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      if (!token) throw new Error("CLAUDE_CODE_OAUTH_TOKEN não configurado");
      // Assinatura Max via token OAuth do Claude Code — NÃO via Gateway (ToS Anthropic).
      // `authToken` emite só `Authorization: Bearer` (evita o header x-api-key:"" que
      // vazava junto com apiKey:"" e confundia a autenticação da Anthropic).
      const anthropic = createAnthropic({
        authToken: token,
        headers: { "anthropic-beta": "oauth-2025-04-20" },
      });
      return anthropic(info.id);
    }
  }
}

/**
 * Modelo de visão para "ver a tela": OpenAI gpt-4o se OPENAI_API_KEY estiver
 * configurada; caso contrário, um modelo de visão local do Ollama (VISION_MODEL,
 * ex.: moondream, qwen2.5vl). Retorna o LanguageModel do AI SDK.
 */
export function resolveVisionModel(): LanguageModel {
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAICompatible({
      name: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
    });
    return openai.chatModel(process.env.VISION_MODEL_OPENAI ?? "gpt-4o");
  }
  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  });
  return ollama.chatModel(process.env.VISION_MODEL ?? "moondream");
}

/** Flags de ambiente para saber quais provedores estão configurados. */
export function providerEnv() {
  return {
    gateway: Boolean(process.env.AI_GATEWAY_API_KEY),
    claude: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
  };
}
