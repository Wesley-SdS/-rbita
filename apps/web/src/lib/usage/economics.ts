import { getModelInfo, type ProviderId } from "@orbita/llm";

/**
 * Economia vs. nuvem + estimativa de energia.
 *
 * Tudo aqui é derivado de dados REAIS já gravados em `message`
 * (modelKey resolvido, tokens de saída, latência). Os únicos valores
 * assumidos são preços de referência e o consumo elétrico — ambos
 * transparentes e configuráveis por env, nunca medições fabricadas.
 */

type Tier = "small" | "medium" | "large";

// Preço de referência da nuvem (R$ por 1k tokens de saída) por porte de modelo.
// Estima quanto uma resposta LOCAL/assinatura TERIA custado pagando por uso.
// Aproximações de jul/2026 (Gemini Flash / GPT-mini / GPT-5·Opus).
const CLOUD_REF_PER_1K: Record<Tier, number> = {
  small: Number(process.env.ORBITA_CLOUD_REF_SMALL ?? 0.006),
  medium: Number(process.env.ORBITA_CLOUD_REF_MEDIUM ?? 0.012),
  large: Number(process.env.ORBITA_CLOUD_REF_LARGE ?? 0.05),
};

// Consumo estimado do computador sob carga de inferência local (W).
// Esta máquina não tem GPU dedicada (Intel UHD) → não há medição por hardware;
// é uma ESTIMATIVA transparente, ajustável por env.
const LOCAL_WATTS = Number(process.env.ORBITA_LOCAL_WATTS ?? 45);
// Tarifa de energia (R$/kWh) — média residencial BR, ajustável por env.
const KWH_PRICE_BRL = Number(process.env.ORBITA_KWH_PRICE ?? 0.95);

export interface UsageRow {
  modelKey: string | null;
  tokens: number | null;
  latencyMs: number | null;
}

export interface UsageSummary {
  /** respostas do assistente contabilizadas */
  requests: number;
  tokensTotal: number;
  localRequests: number;
  cloudRequests: number;
  /** custo de nuvem EVITADO (respostas locais/assinatura) — a "economia" */
  economiaBRL: number;
  /** gasto real em provedores pagos por uso (gateway) */
  cloudSpentBRL: number;
  /** energia estimada consumida pelas respostas locais (Wh) */
  energyWhEstimate: number;
  /** custo estimado dessa energia (R$) */
  energyCostBRL: number;
  /** economia líquida = evitado − energia local (R$) */
  liquidoBRL: number;
}

/** Porte + provedor de um modelKey resolvido. `vision`/desconhecido = local pequeno. */
function classify(modelKey: string | null): { tier: Tier; provider: ProviderId; costPer1k: number } {
  const info = modelKey ? getModelInfo(modelKey) : undefined;
  if (info && info.key !== "auto") return { tier: info.tier, provider: info.provider, costPer1k: info.costPer1k };
  // "vision" (moondream) e qualquer chave não catalogada rodam localmente.
  return { tier: "small", provider: "local", costPer1k: 0 };
}

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  let tokensTotal = 0;
  let localRequests = 0;
  let cloudRequests = 0;
  let economiaBRL = 0;
  let cloudSpentBRL = 0;
  let energyWh = 0;

  for (const r of rows) {
    const tokens = r.tokens ?? 0;
    tokensTotal += tokens;
    const { tier, provider, costPer1k } = classify(r.modelKey);

    if (provider !== "local" && provider !== "claude") {
      // qualquer provedor pago por uso (gateway/groq/google/openai/cohere):
      // conta como gasto real de nuvem.
      cloudRequests += 1;
      cloudSpentBRL += (tokens / 1000) * costPer1k;
      continue;
    }

    // local (grátis) ou claude (assinatura Max): custo de nuvem evitado.
    economiaBRL += (tokens / 1000) * CLOUD_REF_PER_1K[tier];

    if (provider === "local") {
      localRequests += 1;
      // energia só faz sentido para o que roda NESTA máquina.
      const latencyH = (r.latencyMs ?? 0) / 3_600_000;
      energyWh += LOCAL_WATTS * latencyH;
    } else {
      // claude Max roda nos servidores da Anthropic: economia sim, energia local não.
      cloudRequests += 1;
    }
  }

  const energyCostBRL = (energyWh / 1000) * KWH_PRICE_BRL;

  return {
    requests: rows.length,
    tokensTotal,
    localRequests,
    cloudRequests,
    economiaBRL: round(economiaBRL),
    cloudSpentBRL: round(cloudSpentBRL),
    energyWhEstimate: round(energyWh, 3),
    energyCostBRL: round(energyCostBRL),
    liquidoBRL: round(economiaBRL - energyCostBRL),
  };
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Constantes expostas para a UI explicar as premissas (transparência). */
export const USAGE_ASSUMPTIONS = { LOCAL_WATTS, KWH_PRICE_BRL, CLOUD_REF_PER_1K };
