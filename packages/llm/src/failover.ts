import { getModelInfo, DEFAULT_MODEL_KEY, type ProviderId } from "./catalog";

export interface ProviderFlags {
  gateway: boolean;
  claude: boolean;
  groq?: boolean;
  google?: boolean;
  openai?: boolean;
  cohere?: boolean;
}

// ── Circuit breaker por provedor ─────────────────────────────────────────────
// Após N falhas consecutivas, o provedor é "aberto" (pulado) por um cooldown,
// evitando gastar latência tentando um provedor sabidamente fora do ar.
const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 30_000;
const breakers = new Map<ProviderId, { fails: number; openUntil: number }>();

/** Provedor em cooldown (deve ser pulado)? */
export function circuitOpen(provider: ProviderId): boolean {
  const b = breakers.get(provider);
  return !!b && b.openUntil > Date.now();
}

/** Registra o resultado de uma tentativa; abre o disjuntor após 3 falhas seguidas. */
export function recordProviderResult(key: string, ok: boolean): void {
  const p = getModelInfo(key)?.provider;
  if (!p) return;
  const b = breakers.get(p) ?? { fails: 0, openUntil: 0 };
  if (ok) { b.fails = 0; b.openUntil = 0; }
  else { b.fails += 1; if (b.fails >= CB_THRESHOLD) { b.openUntil = Date.now() + CB_COOLDOWN_MS; b.fails = 0; } }
  breakers.set(p, b);
}

/** Ping rápido no Ollama para saber se o provedor local está no ar. */
export async function ollamaUp(): Promise<boolean> {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  try {
    const r = await fetch(base + "/api/tags", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Cadeia de failover: o modelo pedido primeiro, depois os fallbacks disponíveis
 * (local grátis → Claude Max → Gateway). Só inclui provedores configurados —
 * assim, se um provedor cair no meio do caminho, o chat tenta o próximo.
 */
export function buildModelChain(requestedKey: string, env: ProviderFlags): string[] {
  const chain: string[] = [];
  const add = (k: string) => {
    if (getModelInfo(k) && !chain.includes(k)) chain.push(k);
  };
  if (getModelInfo(requestedKey)) add(requestedKey);
  add(DEFAULT_MODEL_KEY);
  if (env.claude) add("claude/claude-opus-4-8");
  if (env.gateway) add("gateway/openai/gpt-5");
  const configured = chain.filter((k) => {
    const p = getModelInfo(k)!.provider;
    if (p === "gateway") return env.gateway;
    if (p === "claude") return env.claude;
    if (p === "groq") return Boolean(env.groq);
    if (p === "google") return Boolean(env.google);
    if (p === "openai") return Boolean(env.openai);
    if (p === "cohere") return Boolean(env.cohere);
    return true; // local
  });
  // pula provedores em cooldown (disjuntor aberto); se todos abertos, mantém a
  // cadeia completa (melhor tentar um "aberto" do que ficar sem resposta).
  const healthy = configured.filter((k) => !circuitOpen(getModelInfo(k)!.provider));
  return healthy.length ? healthy : configured;
}
