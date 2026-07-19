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
      // Fetch customizado força EXATAMENTE os headers OAuth que a API aceita: o SDK
      // sobrescreve/mescla `anthropic-beta` com betas próprios (tools/caching), o que
      // faz a API OAuth rejeitar (429 rate_limit_error mascarado). Aqui garantimos o
      // beta OAuth e a auth por Bearer, removendo o x-api-key.
      const IDENT = "You are Claude Code, Anthropic's official CLI for Claude.";
      const oauthFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${token}`);
        headers.set("anthropic-beta", "oauth-2025-04-20");
        headers.delete("x-api-key");
        let body = init?.body;
        // A API OAuth EXIGE que o 1º bloco de system seja EXATAMENTE a identidade
        // do Claude Code (senão rejeita com 429 mascarado). O AI SDK manda o system
        // como string única — reescrevemos para [identidade, resto] em blocos.
        if (typeof body === "string") {
          try {
            const j = JSON.parse(body);
            const restStr = typeof j.system === "string"
              ? (j.system.startsWith(IDENT) ? j.system.slice(IDENT.length).trim() : j.system)
              : null;
            if (typeof j.system === "string") {
              j.system = [{ type: "text", text: IDENT }, ...(restStr ? [{ type: "text", text: restStr }] : [])];
            } else if (Array.isArray(j.system)) {
              if (j.system[0]?.text !== IDENT) j.system = [{ type: "text", text: IDENT }, ...j.system];
            } else {
              j.system = [{ type: "text", text: IDENT }];
            }
            body = JSON.stringify(j);
          } catch { /* mantém o body original */ }
        }
        return fetch(input, { ...init, headers, body });
      };
      const anthropic = createAnthropic({ apiKey: "placeholder", fetch: oauthFetch });
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
