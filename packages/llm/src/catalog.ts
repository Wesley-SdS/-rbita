export type ProviderId = "local" | "gateway" | "claude";

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

/** Catálogo de modelos. Local é verificável já; Gateway/Claude ligam com env. */
export const CATALOG: ModelInfo[] = [
  { key: "local/qwen2.5:14b", provider: "local", id: "qwen2.5:14b", label: "Qwen 2.5 14B · local", tier: "large", billing: "free", costPer1k: 0 },
  { key: "local/qwen2.5:7b", provider: "local", id: "qwen2.5:7b", label: "Qwen 2.5 7B · local", tier: "medium", billing: "free", costPer1k: 0 },
  { key: "local/llama3.2:1b", provider: "local", id: "llama3.2:1b", label: "Llama 3.2 1B · local", tier: "small", billing: "free", costPer1k: 0 },
  { key: "claude/claude-opus-4-8", provider: "claude", id: "claude-opus-4-8", label: "Claude Opus 4.8 · Max", tier: "large", billing: "subscription", costPer1k: 0 },
  { key: "gateway/openai/gpt-5", provider: "gateway", id: "openai/gpt-5", label: "GPT-5 · Gateway", tier: "large", billing: "paid", costPer1k: 0.05 },
  { key: "gateway/google/gemini-2.5-flash", provider: "gateway", id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash · Gateway", tier: "medium", billing: "paid", costPer1k: 0.01 },
];

export const DEFAULT_MODEL_KEY = "local/qwen2.5:7b";

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
export function availableModels(env: { gateway: boolean; claude: boolean }): ModelInfo[] {
  const list = CATALOG.filter((m) => {
    if (m.provider === "gateway") return env.gateway;
    if (m.provider === "claude") return env.claude;
    return true; // local sempre
  });
  return [AUTO_MODEL, ...list];
}

/**
 * Auto-router: escolhe um modelo concreto por heurística de complexidade.
 * Simples → local pequeno; complexo → local grande, ou Max/Gateway se configurados.
 */
export function routeModelKey(content: string, env: { gateway: boolean; claude: boolean }): string {
  const complex =
    content.length > 600 ||
    /```|\b(fun[çc][ãa]o|c[óo]digo|code|algoritmo|refator\w*|arquitetura|demonstre|prove|equa[çc][ãa]o|matem[áa]tic\w*|debug\w*)\b/i.test(content);
  if (complex && env.claude) return "claude/claude-opus-4-8";
  if (complex && env.gateway) return "gateway/openai/gpt-5";
  if (complex) return "local/qwen2.5:14b";
  return "local/qwen2.5:7b";
}
