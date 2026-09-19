import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway } from "@ai-sdk/gateway";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { getModelInfo } from "./catalog";

/**
 * Marcador que separa a parte ESTÁVEL do system (cacheável) da VOLÁTIL. O chat
 * insere isto entre o SYSTEM_PROMPT e o contexto que muda a cada turno; o
 * oauthFetch do Claude usa para aplicar cache_control só no bloco estável.
 */
export const CACHE_BREAK = "\u0000ORBITA_CACHE_BREAK\u0000";

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
    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error("GROQ_API_KEY não configurada");
      // Groq expõe uma API OpenAI-compatible (LPU, muito rápido, tier grátis).
      // Mesmo padrão do Ollama/OpenAI — só muda baseURL + chave.
      const groq = createOpenAICompatible({
        name: "groq",
        baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
        apiKey,
      });
      return groq.chatModel(info.id);
    }
    case "google": {
      const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
      // Gemini via endpoint OpenAI-compatible do Google AI Studio.
      const google = createOpenAICompatible({
        name: "google",
        baseURL: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey,
      });
      return google.chatModel(info.id);
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");
      // OpenAI direto (mesma chave usada na visão/realtime).
      const openai = createOpenAICompatible({
        name: "openai",
        baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey,
      });
      return openai.chatModel(info.id);
    }
    case "cohere": {
      const apiKey = process.env.COHERE_API_KEY;
      if (!apiKey) throw new Error("COHERE_API_KEY não configurada");
      // Cohere via Compatibility API (OpenAI SDK apontando p/ o endpoint deles).
      const cohere = createOpenAICompatible({
        name: "cohere",
        baseURL: process.env.COHERE_BASE_URL ?? "https://api.cohere.ai/compatibility/v1",
        apiKey,
      });
      return cohere.chatModel(info.id);
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
        // como string única — reescrevemos em blocos: [identidade, ESTÁVEL(cache),
        // VOLÁTIL]. O bloco estável (SYSTEM_PROMPT) leva cache_control ephemeral
        // (prompt caching GA — campo no body, sem beta de header), reduzindo custo
        // e TTFT; o volátil (temporal/persona/skills/RAG) fica sem cache pois muda.
        if (typeof body === "string") {
          try {
            const j = JSON.parse(body);
            if (typeof j.system === "string") {
              let s = j.system;
              if (s.startsWith(IDENT)) s = s.slice(IDENT.length).replace(/^\s+/, "");
              const [stable, volatilePart] = s.includes(CACHE_BREAK) ? s.split(CACHE_BREAK) : [s, ""];
              const blocks: Array<Record<string, unknown>> = [{ type: "text", text: IDENT }];
              if (stable.trim()) blocks.push({ type: "text", text: stable.trim(), cache_control: { type: "ephemeral" } });
              if (volatilePart.trim()) blocks.push({ type: "text", text: volatilePart.trim() });
              j.system = blocks;
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
 * Modelo de visão para "ver a tela", narrar câmera e LER PÁGINA DE DOCUMENTO
 * que o OCR leu mal.
 *
 * A nuvem é escolhida pela chave que existe, nesta ordem: OpenAI, Gemini,
 * Vercel AI Gateway. Antes só a OpenAI era considerada, então numa casa com
 * chave do Gemini a "leitura na nuvem" caía calada para o modelo local, que em
 * CPU leva minutos por página. Cada provedor tem um default sensato no código,
 * sobrescrevível pela config (`vision.cloudModel`) ou pelo ambiente.
 *
 * `localOnly` é a regra 2 de privacidade da Fase 2 (PRD §4.2):
 * câmera com identificação ligada NUNCA manda o recorte para a nuvem, mesmo
 * havendo chave configurada. `preferLocal` é a mesma ideia vinda da config do
 * dono (ler documento só em casa).
 */
export type VisionCloudProvider = "auto" | "openai" | "gemini" | "gateway";

/** Qual provedor de nuvem atende a visão, dada a preferência e as chaves. Puro. */
export function escolherProvedorDeVisao(preferencia: VisionCloudProvider, chaves: { openai: boolean; gemini: boolean; gateway: boolean }): "openai" | "gemini" | "gateway" | null {
  if (preferencia !== "auto") return chaves[preferencia] ? preferencia : null;
  if (chaves.openai) return "openai";
  if (chaves.gemini) return "gemini";
  if (chaves.gateway) return "gateway";
  return null;
}

export function resolveVisionModel(opts: { localOnly?: boolean; preferLocal?: boolean; local?: string; cloud?: string; cloudProvider?: VisionCloudProvider } = {}): LanguageModel {
  const gemini = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const escolhido =
    opts.localOnly || opts.preferLocal
      ? null
      : escolherProvedorDeVisao(opts.cloudProvider ?? "auto", {
          openai: Boolean(process.env.OPENAI_API_KEY),
          gemini: Boolean(gemini),
          gateway: Boolean(process.env.AI_GATEWAY_API_KEY),
        });
  const modeloPedido = opts.cloud?.trim();

  if (escolhido === "openai") {
    const openai = createOpenAICompatible({ name: "openai", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY! });
    return openai.chatModel(modeloPedido || process.env.VISION_MODEL_OPENAI || "gpt-4o");
  }
  if (escolhido === "gemini") {
    const google = createOpenAICompatible({
      name: "gemini",
      baseURL: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: gemini!,
    });
    // modelo da OpenAI configurado não serve aqui: cada provedor tem o seu
    const pedido = modeloPedido && !/^gpt-/i.test(modeloPedido) ? modeloPedido : "";
    return google.chatModel(pedido || process.env.VISION_MODEL_GEMINI || "gemini-2.5-flash");
  }
  if (escolhido === "gateway") {
    const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY! });
    return gateway(modeloPedido?.includes("/") ? modeloPedido : process.env.VISION_MODEL_GATEWAY || "openai/gpt-4o");
  }
  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  });
  return ollama.chatModel(opts.local?.trim() || process.env.VISION_MODEL || "moondream");
}

/** Flags de ambiente para saber quais provedores estão configurados. */
export function providerEnv() {
  return {
    gateway: Boolean(process.env.AI_GATEWAY_API_KEY),
    claude: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    groq: Boolean(process.env.GROQ_API_KEY),
    google: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    cohere: Boolean(process.env.COHERE_API_KEY),
  };
}
