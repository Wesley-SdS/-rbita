import { getModelInfo, localAvailable, availableModelsSync, type ModelInfo, type ProviderId } from "./catalog";
import { BOOTSTRAP_MODEL_KEY, policySnapshot, type FailoverOrder } from "./policy";

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

/** Zera o estado dos disjuntores. Só para teste: em produção o estado é por processo, de propósito. */
export function resetBreakersForTests(): void {
  breakers.clear();
}

/** Provedor em cooldown (deve ser pulado)? */
export function circuitOpen(provider: ProviderId): boolean {
  const b = breakers.get(provider);
  return !!b && b.openUntil > Date.now();
}

/**
 * Falha que é da CONTA, não da rede: chave inválida, sem permissão, limite
 * estourado. Não adianta tentar de novo daqui a um segundo, e não adianta
 * tentar outro modelo do mesmo provedor.
 */
const FALHA_DE_CONTA = new Set([401, 403, 429]);

/**
 * Código HTTP de um erro do AI SDK, quando ele traz um. Puro.
 *
 * Cava as camadas porque o SDK embrulha: o que chega no `onError` do
 * `streamText` costuma ser `{ error: { lastError: { statusCode } } }`, e o
 * que chega num `catch` é o erro direto. Sem cavar, um 429 real vira
 * `undefined` e o disjuntor trata limite de conta como oscilação.
 */
export function statusDoErro(e: unknown, profundidade = 0): number | undefined {
  if (!e || typeof e !== "object" || profundidade > 3) return undefined;
  const o = e as { statusCode?: unknown; status?: unknown; error?: unknown; lastError?: unknown; cause?: unknown };
  const bruto = typeof o.statusCode === "number" ? o.statusCode : typeof o.status === "number" ? o.status : undefined;
  if (bruto !== undefined && bruto >= 100 && bruto < 600) return bruto;
  for (const dentro of [o.error, o.lastError, o.cause]) {
    const achado = statusDoErro(dentro, profundidade + 1);
    if (achado !== undefined) return achado;
  }
  return undefined;
}

/**
 * Registra o resultado de uma tentativa; abre o disjuntor após N falhas
 * seguidas — ou NA HORA, quando a falha é da conta.
 *
 * A contagem de três existe para não punir o provedor por uma oscilação. Um
 * 429 não é oscilação: em 22/09/2026 a conta do Claude estava no limite e
 * cada turno pagava o timeout de novo, porque o contador zerava a cada
 * sucesso de outro provedor e nunca chegava a três.
 */
export function recordProviderResult(key: string, ok: boolean, status?: number): void {
  const p = getModelInfo(key)?.provider;
  if (!p) return;
  const b = breakers.get(p) ?? { fails: 0, openUntil: 0 };
  if (ok) {
    b.fails = 0;
    b.openUntil = 0;
  } else if (status !== undefined && FALHA_DE_CONTA.has(status)) {
    b.openUntil = Date.now() + cb.cooldownMs;
    b.fails = 0;
  } else {
    b.fails += 1;
    if (b.fails >= cb.threshold) { b.openUntil = Date.now() + cb.cooldownMs; b.fails = 0; }
  }
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
 *
 * `exceto` é uma lista de PROVEDORES, não de chaves. Já foi de chaves, e a
 * diferença custou caro: com o Claude no limite da conta, um "oi" pedia o
 * `claude-opus-5`, tomava 429 em 9 s e a cadeia oferecia o `claude-opus-4-8`
 * — outro modelo da MESMA conta, logo outro 429, mais 7,5 s. Medido em
 * 22/09/2026: 16,7 s dos 23,3 s do turno. Limite e credencial são do
 * provedor, então um irmão dele nunca é alternativa.
 */
function umPorProvedor(exceto: readonly ProviderId[]): ModelInfo[] {
  const porProvedor = new Map<ProviderId, ModelInfo>();
  for (const m of availableModelsSync()) {
    if (exceto.includes(m.provider)) continue;
    if (m.supportsTools === false) continue; // a cadeia do chat precisa de tools
    if (m.local && !localAvailable()) continue;
    const atual = porProvedor.get(m.provider);
    // por provedor: o mais forte; empate resolve pelo preço conhecido e mais barato
    const melhorPreco = m.priceKnown !== atual?.priceKnown ? m.priceKnown : m.costPer1k < (atual?.costPer1k ?? Infinity);
    if (!atual || ordemTier[m.tier] < ordemTier[atual.tier] || (m.tier === atual.tier && melhorPreco)) {
      porProvedor.set(m.provider, m);
    }
  }
  return [...porProvedor.values()];
}

/**
 * Posição de um modelo na cadeia, por classe de cobrança. Menor vem primeiro.
 * Nuvem SEM preço informado fica sempre depois da nuvem com preço: custo
 * desconhecido não é custo zero (RV.2).
 */
function classe(m: ModelInfo, ordem: FailoverOrder): number {
  const assinatura = m.billing === "subscription";
  const local = m.local;
  const pagaConhecida = !assinatura && !local && m.priceKnown;
  const rank =
    ordem === "local_primeiro"
      ? { local: 0, assinatura: 1, paga: 2, semPreco: 3 }
      : ordem === "assinatura_paga_local"
        ? { assinatura: 0, paga: 1, semPreco: 2, local: 3 }
        : { assinatura: 0, local: 1, paga: 2, semPreco: 3 };
  if (assinatura) return rank.assinatura;
  if (local) return rank.local;
  return pagaConhecida ? rank.paga : rank.semPreco;
}

/** Ordena as alternativas do failover (puro, testável). */
export function ordenarAlternativas(modelos: ModelInfo[], ordem: FailoverOrder): ModelInfo[] {
  return [...modelos].sort(
    (a, b) =>
      classe(a, ordem) - classe(b, ordem) ||
      // dentro da mesma classe: o mais barato, depois o mais forte
      a.costPer1k - b.costPer1k ||
      ordemTier[a.tier] - ordemTier[b.tier],
  );
}

/**
 * Cadeia de failover: o modelo pedido primeiro, depois um fallback por provedor
 * disponível, na ordem escolhida pelo dono (`llm.failoverOrder`).
 *
 * Os fallbacks NÃO são uma lista fixa de chaves: saem do que a descoberta
 * encontrou. Instalar um modelo novo no Ollama ou ligar uma chave já entra aqui,
 * sem tocar em código.
 */
export function buildModelChain(requestedKey: string, _env?: ProviderFlags): string[] {
  const chain: string[] = [];
  if (getModelInfo(requestedKey)) chain.push(requestedKey);

  const policy = policySnapshot();
  // o provedor do modelo pedido sai da lista de alternativas: ele já é a
  // primeira tentativa, e repetir a casa dele é repetir a falha dela
  const jaNaCadeia = chain.map((k) => getModelInfo(k)?.provider).filter((p): p is ProviderId => Boolean(p));
  for (const m of ordenarAlternativas(umPorProvedor(jaNaCadeia), policy.failoverOrder)) if (!chain.includes(m.key)) chain.push(m.key);

  // nada descoberto ainda (primeiro boot, cache frio): o palpite mínimo.
  if (!chain.length) chain.push(policy.fallbackModel.trim() || BOOTSTRAP_MODEL_KEY);

  // pula provedores em cooldown; se todos abertos, mantém a cadeia completa
  // (melhor tentar um "aberto" do que ficar sem resposta).
  const saudaveis = chain.filter((k) => {
    const p = getModelInfo(k)?.provider;
    return p ? !circuitOpen(p) : false;
  });
  return saudaveis.length ? saudaveis : chain;
}
