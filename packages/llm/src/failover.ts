import { getModelInfo, localAvailable, availableModelsSync, DEFAULT_MODEL_KEY, type ModelInfo, type ProviderId } from "./catalog";

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
//
// Os números vêm da config (`resilience.*`, tela de ajustes) via
// `configureFailover`; o env é só o bootstrap. O estado continua por processo:
// cada processo tem a sua visão do disjuntor (registrado, não é regressão).
const cb = {
  threshold: Number(process.env.ORBITA_CB_THRESHOLD ?? 3),
  cooldownMs: Number(process.env.ORBITA_CB_COOLDOWN_MS ?? 30_000),
};
/** Ajusta o disjuntor em tempo de execução (chamado com os valores da config). */
export function configureFailover(p: { threshold?: number; cooldownMs?: number }): void {
  if (p.threshold && p.threshold > 0) cb.threshold = p.threshold;
  if (p.cooldownMs && p.cooldownMs > 0) cb.cooldownMs = p.cooldownMs;
}
const breakers = new Map<ProviderId, { fails: number; openUntil: number }>();

/** Provedor em cooldown (deve ser pulado)? */
export function circuitOpen(provider: ProviderId): boolean {
  const b = breakers.get(provider);
  return !!b && b.openUntil > Date.now();
}

/** Registra o resultado de uma tentativa; abre o disjuntor após N falhas seguidas. */
export function recordProviderResult(key: string, ok: boolean): void {
  const p = getModelInfo(key)?.provider;
  if (!p) return;
  const b = breakers.get(p) ?? { fails: 0, openUntil: 0 };
  if (ok) { b.fails = 0; b.openUntil = 0; }
  else { b.fails += 1; if (b.fails >= cb.threshold) { b.openUntil = Date.now() + cb.cooldownMs; b.fails = 0; } }
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

const ordemTier = { large: 0, medium: 1, small: 2 } as const;

/**
 * Melhor candidato de cada PROVEDOR descoberto, para dar diversidade à cadeia:
 * se a Anthropic cair, o próximo da fila é de outra casa, não outro modelo dela.
 */
function umPorProvedor(exceto: string[]): ModelInfo[] {
  const porProvedor = new Map<ProviderId, ModelInfo>();
  for (const m of availableModelsSync()) {
    if (exceto.includes(m.key)) continue;
    if (m.supportsTools === false) continue; // a cadeia do chat precisa de tools
    if (m.local && !localAvailable()) continue;
    const atual = porProvedor.get(m.provider);
    // por provedor: o mais forte; empate resolve pelo mais barato
    if (!atual || ordemTier[m.tier] < ordemTier[atual.tier] || (m.tier === atual.tier && m.costPer1k < atual.costPer1k)) {
      porProvedor.set(m.provider, m);
    }
  }
  return [...porProvedor.values()];
}

/**
 * Cadeia de failover: o modelo pedido primeiro, depois um fallback por provedor
 * disponível — assinatura antes de pago, local antes de nuvem quando empata.
 *
 * Os fallbacks NÃO são mais uma lista fixa de chaves: saem do que a descoberta
 * encontrou. Instalar um modelo novo no Ollama ou ligar uma chave já entra aqui,
 * sem tocar em código.
 */
export function buildModelChain(requestedKey: string, _env?: ProviderFlags): string[] {
  const chain: string[] = [];
  if (getModelInfo(requestedKey)) chain.push(requestedKey);

  const alternativas = umPorProvedor(chain).sort(
    (a, b) =>
      // assinatura já paga primeiro, depois o mais barato, depois o mais forte
      Number(b.billing === "subscription") - Number(a.billing === "subscription") ||
      a.costPer1k - b.costPer1k ||
      ordemTier[a.tier] - ordemTier[b.tier],
  );
  for (const m of alternativas) if (!chain.includes(m.key)) chain.push(m.key);

  // nada descoberto ainda (primeiro boot, cache frio): o palpite mínimo.
  if (!chain.length) chain.push(DEFAULT_MODEL_KEY);

  // pula provedores em cooldown; se todos abertos, mantém a cadeia completa
  // (melhor tentar um "aberto" do que ficar sem resposta).
  const saudaveis = chain.filter((k) => {
    const p = getModelInfo(k)?.provider;
    return p ? !circuitOpen(p) : false;
  });
  return saudaveis.length ? saudaveis : chain;
}
