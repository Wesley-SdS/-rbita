export type ProviderId = "local" | "gateway" | "claude" | "groq" | "google" | "openai" | "cohere";

/** Flags de ambiente: quais provedores estão configurados (chave presente). */
export interface ProviderEnv {
  gateway: boolean;
  claude: boolean;
  groq?: boolean;
  google?: boolean;
  openai?: boolean;
  cohere?: boolean;
}

export interface ModelInfo {
  /** chave única `provider/id` usada pela UI e pelo resolver */
  key: string;
  provider: ProviderId;
  /** id do modelo no provedor */
  id: string;
  label: string;
  tier: "small" | "medium" | "large";
  /** grátis (local) / assinatura (claude max) / pago (gateway) / variável (auto) */
  billing: "free" | "subscription" | "paid" | "variable";
  /** custo aproximado em R$ por 1k tokens de saída (0 = local/assinatura) */
  costPer1k: number;
}

/** Catálogo de modelos. Local é verificável já; Gateway/Claude/Groq ligam com env. */
export const CATALOG: ModelInfo[] = [
  { key: "local/qwen2.5:14b", provider: "local", id: "qwen2.5:14b", label: "Qwen 2.5 14B · local", tier: "large", billing: "free", costPer1k: 0 },
  { key: "local/qwen2.5:7b", provider: "local", id: "qwen2.5:7b", label: "Qwen 2.5 7B · local", tier: "medium", billing: "free", costPer1k: 0 },
  { key: "local/qwen2.5:3b", provider: "local", id: "qwen2.5:3b", label: "Qwen 2.5 3B · local (leve)", tier: "small", billing: "free", costPer1k: 0 },
  { key: "local/llama3.2:1b", provider: "local", id: "llama3.2:1b", label: "Llama 3.2 1B · local (mínimo)", tier: "small", billing: "free", costPer1k: 0 },
  { key: "claude/claude-sonnet-5", provider: "claude", id: "claude-sonnet-5", label: "Claude Sonnet 5 · Max", tier: "large", billing: "subscription", costPer1k: 0 },
  { key: "claude/claude-opus-4-8", provider: "claude", id: "claude-opus-4-8", label: "Claude Opus 4.8 · Max", tier: "large", billing: "subscription", costPer1k: 0 },
  // Provedores online OpenAI-compatible (só encaixe: baseURL + chave). IDs vêm dos docs de cada um.
  // Groq: inferência muito rápida (LPU), tier grátis — console.groq.com.
  { key: "groq/llama-3.3-70b-versatile", provider: "groq", id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B · Groq (rápido)", tier: "large", billing: "paid", costPer1k: 0.004 },
  { key: "groq/llama-3.1-8b-instant", provider: "groq", id: "llama-3.1-8b-instant", label: "Llama 3.1 8B · Groq (grátis/rápido)", tier: "small", billing: "paid", costPer1k: 0.0005 },
  // Google Gemini (direto, tier grátis generoso) — aistudio.google.com/apikey.
  { key: "google/gemini-2.5-flash", provider: "google", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash · Google", tier: "medium", billing: "paid", costPer1k: 0.0015 },
  { key: "google/gemini-2.5-flash-lite", provider: "google", id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite · Google (barato)", tier: "small", billing: "paid", costPer1k: 0.0005 },
  { key: "google/gemini-2.5-pro", provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro · Google", tier: "large", billing: "paid", costPer1k: 0.03 },
  // OpenAI (direto) — reusa OPENAI_API_KEY (mesma da visão/realtime).
  { key: "openai/gpt-5", provider: "openai", id: "gpt-5", label: "GPT-5 · OpenAI", tier: "large", billing: "paid", costPer1k: 0.05 },
  { key: "openai/gpt-5-mini", provider: "openai", id: "gpt-5-mini", label: "GPT-5 mini · OpenAI (barato)", tier: "medium", billing: "paid", costPer1k: 0.01 },
  // Cohere (Compatibility API) — dashboard.cohere.com.
  { key: "cohere/command-a-03-2025", provider: "cohere", id: "command-a-03-2025", label: "Command A · Cohere", tier: "large", billing: "paid", costPer1k: 0.02 },
  { key: "cohere/command-r-plus", provider: "cohere", id: "command-r-plus", label: "Command R+ · Cohere", tier: "medium", billing: "paid", costPer1k: 0.015 },
  { key: "gateway/openai/gpt-5", provider: "gateway", id: "openai/gpt-5", label: "GPT-5 · Gateway", tier: "large", billing: "paid", costPer1k: 0.05 },
  { key: "gateway/google/gemini-2.5-flash", provider: "gateway", id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash · Gateway", tier: "medium", billing: "paid", costPer1k: 0.01 },
];

export const DEFAULT_MODEL_KEY = "local/qwen2.5:7b";

/**
 * Modelo pré-selecionado na UI. Prefere a NUVEM RÁPIDA (Sonnet 5) quando o Claude
 * está configurado, mesmo com local disponível, porque o local sem GPU é lento.
 * Cai para o local só quando não há Claude.
 */
export function defaultModelKey(env: ProviderEnv): string {
  if (env.claude) return "claude/claude-sonnet-5";
  return DEFAULT_MODEL_KEY;
}

/** Pseudo-modelo que roteia automaticamente (local → Max → Gateway). */
export const AUTO_MODEL: ModelInfo = {
  key: "auto",
  provider: "local",
  id: "auto",
  label: "Auto · roteia (local → Max → Gateway)",
  tier: "medium",
  billing: "variable", // pode rotear p/ Max (assinatura) ou Gateway (pago)
  costPer1k: 0,
};

export function getModelInfo(key: string): ModelInfo | undefined {
  if (key === "auto") return AUTO_MODEL;
  return CATALOG.find((m) => m.key === key);
}

/** Modelos disponíveis dado o ambiente (esconde os que exigem env ausente). */
export function availableModels(env: ProviderEnv): ModelInfo[] {
  const list = CATALOG.filter((m) => {
    if (m.provider === "gateway") return env.gateway;
    if (m.provider === "claude") return env.claude;
    if (m.provider === "groq") return Boolean(env.groq);
    if (m.provider === "google") return Boolean(env.google);
    if (m.provider === "openai") return Boolean(env.openai);
    if (m.provider === "cohere") return Boolean(env.cohere);
    return true; // local sempre
  });
  return [AUTO_MODEL, ...list];
}

/**
 * Auto-router: escolhe um modelo concreto por heurística de complexidade.
 * Simples → local pequeno; complexo → local grande, ou Max/Gateway se configurados.
 */
export function routeModelKey(content: string, env: ProviderEnv): string {
  const complex =
    content.length > 600 ||
    /```|\b(fun[çc][ãa]o|c[óo]digo|code|algoritmo|refator\w*|arquitetura|demonstre|prove|equa[çc][ãa]o|matem[áa]tic\w*|debug\w*)\b/i.test(content);
  if (complex && env.claude) return "claude/claude-opus-4-8";
  if (complex && env.gateway) return "gateway/openai/gpt-5";
  if (complex) return "local/qwen2.5:14b";
  return "local/qwen2.5:7b";
}
