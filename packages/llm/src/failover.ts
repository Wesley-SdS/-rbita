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
  modelosEmPausa.clear();
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
/**
 * Modelo em pausa, sem pausar o provedor: o Opus da assinatura tem cota
 * própria, e um 429 dele fechava o provedor inteiro, levando junto o Sonnet que
 * responde o dia a dia (auditoria de 27/09/2026, com `llm.modeloComplexo`).
 */
const modelosEmPausa = new Map<string, number>();

export function modeloEmPausa(key: string): boolean {
  return (modelosEmPausa.get(key) ?? 0) > Date.now();
}

/** O preferido do dono para este provedor, se for OUTRO modelo que não esta chave. */
function irmaoPreferido(key: string): string | null {
  const p = getModelInfo(key)?.provider;
  if (!p) return null;
  const k = policySnapshot()
    .modelosPreferidos.map((x) => x.trim())
    .find((x) => x !== key && getModelInfo(x)?.provider === p && availableModelsSync().some((m) => m.key === x));
  return k ?? null;
}

export function recordProviderResult(key: string, ok: boolean, status?: number): void {
  const p = getModelInfo(key)?.provider;
  if (!p) return;
  // 429 de um modelo que não é o preferido do provedor: pausa SÓ ele
  if (!ok && status === 429 && irmaoPreferido(key)) {
    modelosEmPausa.set(key, Date.now() + cb.cooldownMs);
    return;
  }
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
  // a POSIÇÃO na lista do dono decide entre dois preferidos do mesmo provedor
  const ordemPreferida = new Map(policySnapshot().modelosPreferidos.map((k, i) => [k.trim(), i] as const).filter(([k]) => k));
  const fixados = new Set<ProviderId>();
  for (const m of availableModelsSync()) {
    if (exceto.includes(m.provider)) continue;
    if (m.supportsTools === false) continue; // a cadeia do chat precisa de tools
    if (m.local && !localAvailable()) continue;
    // o modelo que o dono escolheu para este provedor vence qualquer outro dele;
    // entre dois escolhidos, vale o que vem antes na lista (não o último descoberto)
    if (ordemPreferida.has(m.key)) {
      const atual = porProvedor.get(m.provider);
      const posAtual = atual && fixados.has(m.provider) ? ordemPreferida.get(atual.key)! : Infinity;
      if (ordemPreferida.get(m.key)! < posAtual) porProvedor.set(m.provider, m);
      fixados.add(m.provider);
      continue;
    }
    if (fixados.has(m.provider)) continue;
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
      : ordem === "paga_primeiro"
        ? // a assinatura vem logo atrás: se a nuvem paga falhar, o que já está
          // pago é a próxima escolha mais sensata, e o local fecha a fila
          { paga: 0, semPreco: 1, assinatura: 2, local: 3 }
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
/**
 * A cadeia para uma tarefa DA CASA (resumo, memória, rotina), quando o fluxo
 * não pediu modelo nenhum.
 *
 * Diferente do `buildModelChain`: lá o modelo pedido entra em PRIMEIRO lugar,
 * porque alguém o pediu. Aqui ninguém pediu, então quem manda é a ordem do
 * dono (`llm.failoverOrder`) e nada mais.
 *
 * Era isto que faltava, e o efeito era grande: sem um pedido, o código usava o
 * MODELO RESERVA como se fosse escolha, e o reserva é o bootstrap local. Toda
 * tarefa da casa ia para o `local/qwen2.5:7b` mesmo com a ordem em "assinatura
 * primeiro" — 123 s por resumo de reunião nesta máquina, contra segundos na
 * assinatura que estava ali, de graça.
 */
export function cadeiaDaCasa(): string[] {
  const candidatos = umPorProvedor([]);
  if (!candidatos.length) return [];
  const ordenados = ordenarAlternativas(candidatos, policySnapshot().failoverOrder).map((m) => m.key);
  // mesma regra do `buildModelChain`: pular quem está em cooldown, mas não
  // ficar sem resposta se todos estiverem abertos
  const saudaveis = ordenados.filter((k) => {
    const p = getModelInfo(k)?.provider;
    return p ? !circuitOpen(p) : false;
  });
  return saudaveis.length ? saudaveis : ordenados;
}

/**
 * A chave pode entrar na cadeia? Modelo local sem Ollama alcançável não pode,
 * nem pedido pelo nome nem fixado como reserva: na Render, `local/…` aponta
 * para um localhost vazio, e tentar custa o timeout para falhar do mesmo jeito.
 */
function podeTentar(key: string): boolean {
  const info = getModelInfo(key);
  return Boolean(info) && !(info!.local && !localAvailable());
}

export function buildModelChain(requestedKey: string, _env?: ProviderFlags): string[] {
  const chain: string[] = [];
  if (podeTentar(requestedKey) && !modeloEmPausa(requestedKey)) chain.push(requestedKey);
  // O preferido do MESMO provedor logo atrás: pedido complexo no Opus que falha
  // cai no Sonnet da mesma assinatura, não numa conta paga nem em "sem modelo"
  const irmao = irmaoPreferido(requestedKey);
  if (irmao && podeTentar(irmao) && !chain.includes(irmao)) chain.push(irmao);

  const policy = policySnapshot();
  // o provedor do modelo pedido sai da lista de alternativas: ele já é a
  // primeira tentativa, e repetir a casa dele é repetir a falha dela
  const jaNaCadeia = [requestedKey, ...chain].map((k) => getModelInfo(k)?.provider).filter((p): p is ProviderId => Boolean(p));
  for (const m of ordenarAlternativas(umPorProvedor(jaNaCadeia), policy.failoverOrder)) if (!chain.includes(m.key)) chain.push(m.key);

  // nada descoberto ainda (primeiro boot, cache frio): só o reserva que o dono
  // FIXOU. Sem reserva, a cadeia fica vazia e quem chama diz o que fazer
  // (`SEM_MODELO`); inventar uma chave aqui era tentar um modelo inexistente.
  const reserva = policy.fallbackModel.trim() || BOOTSTRAP_MODEL_KEY;
  if (!chain.length && reserva && podeTentar(reserva)) chain.push(reserva);

  // pula provedores em cooldown; se todos abertos, mantém a cadeia completa
  // (melhor tentar um "aberto" do que ficar sem resposta).
  const saudaveis = chain.filter((k) => {
    const p = getModelInfo(k)?.provider;
    return p ? !circuitOpen(p) : false;
  });
  return saudaveis.length ? saudaveis : chain;
}
