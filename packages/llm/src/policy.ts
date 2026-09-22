/**
 * POLÍTICA DE MODELOS: o que o dono decide pela tela e o packages/llm precisa
 * respeitar sem depender do core (o core depende daqui, não o contrário).
 *
 * O core registra FONTES (getters que leem a tabela `setting`); `readPolicy()`
 * resolve todas e guarda o último valor bom. Quem é síncrono (a cadeia de
 * failover) usa `policySnapshot()`, que o chat atualiza no início de cada turno
 * via `applyLlmSettings()`. Sem fonte registrada (testes, script avulso), valem
 * os defaults abaixo, que são os mesmos declarados em settings/defs.ts.
 */

/**
 * Ordem do failover quando o modelo pedido falha antes do primeiro token.
 * Decisão do dono (17/09): assinatura → local → paga. Preço desconhecido nunca
 * conta como custo zero (era o bug do RV.2: a nuvem sem preço passava na frente
 * do modelo local).
 */
// "paga_primeiro" existe porque as outras três todas começam por assinatura
// ou por local. Numa casa com a assinatura no limite e sem GPU, isso obrigava
// a Órbita a tentar dois caminhos ruins antes de chegar no que funciona.
export const FAILOVER_ORDERS = ["assinatura_local_paga", "assinatura_paga_local", "paga_primeiro", "local_primeiro"] as const;
export type FailoverOrder = (typeof FAILOVER_ORDERS)[number];

/** Modelo pré-selecionado na UI: nuvem responde rápido; local mantém tudo em casa. */
export type DefaultPreference = "nuvem" | "local";

export interface ModelPolicy {
  failoverOrder: FailoverOrder;
  defaultPreference: DefaultPreference;
  /** Chave usada quando nada foi descoberto e por rotinas/resumos sem modelo definido. Vazio = bootstrap. */
  fallbackModel: string;
  discoveryTtlMs: number;
  discoveryTimeoutMs: number;
}

/** Último recurso de bootstrap, antes de qualquer config ou descoberta. */
export const BOOTSTRAP_MODEL_KEY = process.env.ORBITA_FALLBACK_MODEL ?? "local/qwen2.5:7b";

type Source<T> = () => T | Promise<T>;
type PolicySources = { [K in keyof ModelPolicy]?: Source<ModelPolicy[K]> };

const current: ModelPolicy = {
  failoverOrder: "assinatura_local_paga",
  defaultPreference: "nuvem",
  fallbackModel: "",
  discoveryTtlMs: Number(process.env.MODEL_DISCOVERY_TTL_MS ?? 5 * 60_000),
  discoveryTimeoutMs: 4000,
};
let sources: PolicySources = {};

/** Registra de onde vem cada valor (chamado uma vez pelo core, no import das settings). */
export function configureModelPolicy(p: PolicySources): void {
  sources = { ...sources, ...p };
}

/** Resolve as fontes; uma fonte que falha mantém o último valor bom (fail-soft). */
export async function readPolicy(): Promise<ModelPolicy> {
  const keys = Object.keys(sources) as (keyof ModelPolicy)[];
  await Promise.all(
    keys.map(async (k) => {
      try {
        const v = await sources[k]!();
        if (v !== undefined && v !== null) (current as unknown as Record<string, unknown>)[k] = v;
      } catch {
        // banco fora: fica o último valor conhecido
      }
    }),
  );
  return { ...current };
}

/** Valor atual sem ir ao banco (para código síncrono). */
export function policySnapshot(): ModelPolicy {
  return { ...current };
}

/** Modelo reserva efetivo: o da config, ou o de bootstrap. */
export async function fallbackModelKey(): Promise<string> {
  const p = await readPolicy();
  return p.fallbackModel.trim() || BOOTSTRAP_MODEL_KEY;
}

/** Só para testes: volta aos defaults e esquece as fontes. */
export function resetModelPolicyForTests(over: Partial<ModelPolicy> = {}): void {
  sources = {};
  Object.assign(current, {
    failoverOrder: "assinatura_local_paga",
    defaultPreference: "nuvem",
    fallbackModel: "",
    discoveryTtlMs: 5 * 60_000,
    discoveryTimeoutMs: 4000,
    ...over,
  });
}
