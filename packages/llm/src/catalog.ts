import { discoverModels, discoveredSnapshot, type DiscoveredModel } from "./discovery";

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
  /** grátis (local) / assinatura (claude max) / pago (nuvem) / variável (auto) */
  billing: "free" | "subscription" | "paid" | "variable";
  /** custo aproximado por 1k tokens de saída (0 = local/assinatura) */
  costPer1k: number;
  /** EIXO 1 do roteador: roda na máquina de casa? */
  local: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  contextWindow?: number;
}

const PROVIDERS: readonly ProviderId[] = ["local", "gateway", "claude", "groq", "google", "openai", "cohere"];

/**
 * Quebra `provider/id` na PRIMEIRA barra — o id pode conter barras
 * (`gateway/openai/gpt-5` → provider `gateway`, id `openai/gpt-5`).
 */
export function parseModelKey(key: string): { provider: ProviderId; id: string } | null {
  const i = key.indexOf("/");
  if (i <= 0) return null;
  const provider = key.slice(0, i) as ProviderId;
  const id = key.slice(i + 1);
  if (!id || !PROVIDERS.includes(provider)) return null;
  return { provider, id };
}

function billingDe(provider: ProviderId): ModelInfo["billing"] {
  if (provider === "local") return "free";
  if (provider === "claude") return "subscription";
  return "paid";
}

function paraModelInfo(m: DiscoveredModel): ModelInfo {
  return {
    key: m.key,
    provider: m.provider,
    id: m.id,
    label: m.label,
    tier: m.tier,
    billing: billingDe(m.provider),
    costPer1k: m.costPer1kOutput ?? 0,
    local: m.local,
    supportsTools: m.supportsTools,
    supportsVision: m.supportsVision,
    contextWindow: m.contextWindow,
  };
}

/** Pseudo-modelo que roteia automaticamente (ver `routeModelKey`). */
export const AUTO_MODEL: ModelInfo = {
  key: "auto",
  provider: "local",
  id: "auto",
  label: "Auto · escolhe o melhor modelo disponível",
  tier: "medium",
  billing: "variable",
  costPer1k: 0,
  local: false,
};

/**
 * Último recurso quando NADA foi descoberto ainda. Não é um catálogo: é o palpite
 * mínimo para o app não nascer com um modelo vazio no primeiro boot, antes da
 * primeira descoberta. Assim que `discoverModels()` roda, isto deixa de importar.
 */
export const DEFAULT_MODEL_KEY = process.env.ORBITA_FALLBACK_MODEL ?? "local/qwen2.5:7b";

/**
 * Metadados de um modelo, SEM ir à rede.
 *
 * Usa o último snapshot da descoberta; se o modelo não estiver lá (cache frio ou
 * modelo recém-instalado), deriva o que dá da própria chave. Nunca devolve
 * `undefined` para uma chave bem formada — rejeitar um modelo por não estar num
 * catálogo estático era justamente o comportamento hardcoded que saiu daqui.
 */
export function getModelInfo(key: string): ModelInfo | undefined {
  if (key === "auto") return AUTO_MODEL;
  const achado = discoveredSnapshot().find((m) => m.key === key);
  if (achado) return paraModelInfo(achado);

  const parsed = parseModelKey(key);
  if (!parsed) return undefined;
  return {
    key,
    provider: parsed.provider,
    id: parsed.id,
    label: parsed.id,
    tier: "medium",
    billing: billingDe(parsed.provider),
    costPer1k: 0,
    local: parsed.provider === "local",
  };
}

/**
 * O Ollama local é alcançável? Em serverless (Vercel) com `OLLAMA_BASE_URL`
 * apontando para localhost não existe Ollama nenhum, então os modelos locais
 * seriam escolhas quebradas: escondemos. Self-host (ou Ollama remoto) mantém.
 */
export function localAvailable(): boolean {
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const pointsToLocalhost = /localhost|127\.0\.0\.1|host\.docker\.internal/.test(base);
  return !(process.env.VERCEL && pointsToLocalhost);
}

/** Modelos disponíveis agora (vai à rede na primeira vez; depois, cache). */
export async function availableModels(_env?: ProviderEnv): Promise<ModelInfo[]> {
  const found = await discoverModels();
  return [AUTO_MODEL, ...found.map(paraModelInfo)];
}

/** Snapshot síncrono dos modelos já descobertos (sem rede). */
export function availableModelsSync(): ModelInfo[] {
  return discoveredSnapshot().map(paraModelInfo);
}

// ── escolha de modelo ────────────────────────────────────────────────────────

const ordemTier = { large: 0, medium: 1, small: 2 } as const;

/** Melhor modelo local que sabe usar ferramentas, do mais forte ao mais leve. */
function melhorLocal(lista: ModelInfo[], tier?: ModelInfo["tier"]): ModelInfo | undefined {
  const locais = lista.filter((m) => m.local && m.supportsTools !== false);
  if (tier) return locais.find((m) => m.tier === tier);
  return locais.sort((a, b) => ordemTier[a.tier] - ordemTier[b.tier])[0];
}

/** Melhor modelo de nuvem: assinatura primeiro (já paga), depois porte. */
function melhorNuvem(lista: ModelInfo[], tier?: ModelInfo["tier"]): ModelInfo | undefined {
  const nuvem = lista.filter((m) => !m.local);
  const candidatos = tier ? nuvem.filter((m) => m.tier === tier) : nuvem;
  return candidatos.sort(
    (a, b) =>
      Number(b.billing === "subscription") - Number(a.billing === "subscription") ||
      ordemTier[a.tier] - ordemTier[b.tier] ||
      a.costPer1k - b.costPer1k,
  )[0];
}

/**
 * Modelo pré-selecionado na UI: o melhor de nuvem quando há (responde rápido),
 * senão o melhor local. Derivado da descoberta, não de uma lista fixa.
 */
export async function defaultModelKey(_env?: ProviderEnv): Promise<string> {
  const lista = (await availableModels()).filter((m) => m.key !== "auto");
  const escolha = melhorNuvem(lista) ?? melhorLocal(lista) ?? lista[0];
  return escolha?.key ?? DEFAULT_MODEL_KEY;
}

/**
 * Classifica a complexidade do pedido.
 *
 * ⚠️ PROVISÓRIO: é a última heurística fixa que sobrou do roteador antigo. Na
 * Onda 1 vira regra editável pela UI (princípio de zero hardcode) e ganha o
 * prefilter portado do Adalink, incluindo o caso `home_command` — comando
 * doméstico deve ir para o modelo local pequeno sem passar por classificador.
 */
export function classificarComplexidade(content: string): boolean {
  return (
    content.length > 600 ||
    /```|\b(fun[çc][ãa]o|c[óo]digo|code|algoritmo|refator\w*|arquitetura|demonstre|prove|equa[çc][ãa]o|matem[áa]tic\w*|debug\w*)\b/i.test(content)
  );
}

/**
 * Escolhe um modelo de uma lista — núcleo PURO do roteador, sem rede e sem
 * catálogo fixo, para poder ser testado e, na Onda 1, substituído pelo roteador
 * de dois eixos (local/nuvem × porte).
 *
 * Simples → local pequeno (latência é o que importa; é o caminho do comando de
 * casa). Complexo → o mais forte disponível, preferindo nuvem.
 */
export function escolherModelo(lista: ModelInfo[], opts: { complexo: boolean }): ModelInfo | undefined {
  const uteis = lista.filter((m) => m.key !== "auto");
  if (!uteis.length) return undefined;
  return opts.complexo
    ? melhorNuvem(uteis, "large") ?? melhorNuvem(uteis) ?? melhorLocal(uteis, "large") ?? melhorLocal(uteis)
    : melhorLocal(uteis, "small") ?? melhorLocal(uteis) ?? melhorNuvem(uteis, "small") ?? melhorNuvem(uteis);
}

/** Auto-router: aplica `escolherModelo` sobre o que a descoberta já encontrou. */
export function routeModelKey(content: string, _env?: ProviderEnv): string {
  const escolha = escolherModelo(availableModelsSync(), { complexo: classificarComplexidade(content) });
  return escolha?.key ?? DEFAULT_MODEL_KEY;
}
