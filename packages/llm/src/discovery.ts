import type { ProviderId } from "./catalog";

/**
 * DESCOBERTA DE MODELOS — zero hardcode.
 *
 * O catálogo não é mais um array literal no código: cada provedor é PERGUNTADO
 * quais modelos oferece. Adicionar um modelo passa a ser `ollama pull` ou ligar
 * uma chave no .env, nunca editar código e fazer deploy.
 *
 *   ollama     GET /api/tags                       → nome, parâmetros, contexto, capacidades
 *   anthropic  GET /v1/models (Bearer OAuth)       → os modelos liberados NA CONTA do dono
 *   gateway    getAvailableModels()                → catálogo inteiro da Vercel, COM PREÇO
 *   openai-compat  GET /v1/models                  → groq, google, openai, cohere
 *
 * Tudo que é DESCOBERTO vem do provedor. Tudo que é DERIVADO (tier, se é forte
 * ou leve) é calculado a partir do que foi descoberto e marcado como `derived`,
 * para a camada de config poder sobrescrever sem mexer em código.
 */

export interface DiscoveredModel {
  /** chave única `provider/id` (o id pode conter "/", ex.: gateway/openai/gpt-5) */
  key: string;
  provider: ProviderId;
  /** id do modelo no provedor */
  id: string;
  label: string;
  /**
   * EIXO 1 do roteador: roda na máquina de casa?
   * Decide latência, funcionamento offline e privacidade — mais importante que custo.
   */
  local: boolean;
  /** EIXO 2: porte. Derivado de parâmetros (local) ou de preço (nuvem). */
  tier: "small" | "medium" | "large";
  /** `true` quando o tier foi inferido, não informado pelo provedor. */
  tierDerived: boolean;
  contextWindow?: number;
  /** bilhões de parâmetros (só local, vem do Ollama) */
  paramsB?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  /** USD por 1k tokens (quando o provedor informa) */
  costPer1kInput?: number;
  costPer1kOutput?: number;
  source: "ollama" | "anthropic-oauth" | "gateway" | "openai-compatible";
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** "7.6B" → 7.6 · "137M" → 0.137 */
function parseParams(size: string | undefined): number | undefined {
  if (!size) return undefined;
  const m = size.match(/^([\d.]+)\s*([BMK])$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2].toUpperCase();
  return unit === "B" ? n : unit === "M" ? n / 1000 : n / 1_000_000;
}

/** Porte de um modelo LOCAL, pelo tamanho — o que de fato determina a latência. */
function tierFromParams(paramsB: number | undefined): "small" | "medium" | "large" {
  if (paramsB === undefined) return "medium";
  if (paramsB < 5) return "small";
  if (paramsB < 13) return "medium";
  return "large";
}

/** Porte de um modelo de NUVEM, pelo preço de saída (proxy honesto de capacidade). */
function tierFromPrice(costPer1kOutput: number | undefined): "small" | "medium" | "large" {
  if (costPer1kOutput === undefined) return "medium";
  if (costPer1kOutput < 0.002) return "small";
  if (costPer1kOutput < 0.01) return "medium";
  return "large";
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Toda descoberta é best-effort: provedor fora do ar não derruba os outros. */
async function safe<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    if (process.env.LOG_LEVEL === "debug") {
      console.warn(`[discovery] ${label} falhou:`, e instanceof Error ? e.message : e);
    }
    return [];
  }
}

const TIMEOUT_MS = 4000;

// ── provedores ───────────────────────────────────────────────────────────────

/** Ollama: modelos instalados na máquina. É a fonte dos "dois modelos locais". */
export async function discoverOllama(): Promise<DiscoveredModel[]> {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  const r = await fetch(base + "/api/tags", { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j = (await r.json()) as {
    models?: Array<{
      name: string;
      details?: { parameter_size?: string; context_length?: number };
      capabilities?: string[];
    }>;
  };
  return (j.models ?? [])
    // embedding e visão-pura não servem para conversar; o RAG e a visão têm caminho próprio
    .filter((m) => m.capabilities?.includes("completion"))
    .map((m) => {
      const paramsB = parseParams(m.details?.parameter_size);
      return {
        key: `local/${m.name}`,
        provider: "local" as const,
        id: m.name,
        label: `${m.name}${m.details?.parameter_size ? ` · ${m.details.parameter_size}` : ""} · local`,
        local: true,
        tier: tierFromParams(paramsB),
        tierDerived: true,
        contextWindow: m.details?.context_length,
        paramsB,
        supportsTools: m.capabilities?.includes("tools") ?? false,
        supportsVision: m.capabilities?.includes("vision") ?? false,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        source: "ollama" as const,
      };
    });
}

/**
 * Anthropic pela assinatura Max (token OAuth do Claude Code): devolve exatamente
 * os modelos LIBERADOS NA CONTA do dono — nem mais, nem menos. É o que permite
 * "posso escolher qualquer modelo da Anthropic que está liberado pra mim".
 */
export async function discoverAnthropicOAuth(): Promise<DiscoveredModel[]> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return [];
  const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const j = (await r.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (j.data ?? []).map((m) => ({
    key: `claude/${m.id}`,
    provider: "claude" as const,
    id: m.id,
    label: `${m.display_name ?? m.id} · Max`,
    local: false,
    // assinatura: não há custo por token, e o porte sai do nome da família
    tier: /opus/i.test(m.id) ? ("large" as const) : /haiku/i.test(m.id) ? ("small" as const) : ("medium" as const),
    tierDerived: true,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    source: "anthropic-oauth" as const,
  }));
}

/**
 * Vercel AI Gateway: catálogo completo, com PREÇO por token informado pela
 * própria Vercel. É a listagem "escolho qual eu quero" sem nenhuma curadoria
 * nossa no meio.
 */
export async function discoverGateway(): Promise<DiscoveredModel[]> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return [];
  const { createGateway } = await import("@ai-sdk/gateway");
  const gw = createGateway({ apiKey });
  const { models } = await gw.getAvailableModels();
  return (models ?? [])
    .filter((m) => !m.modelType || m.modelType === "language")
    .map((m) => {
      // a Vercel informa USD por TOKEN; a UI e o painel de custo falam em 1k.
      const inTok = num(m.pricing?.input);
      const outTok = num(m.pricing?.output);
      const costPer1kInput = inTok !== undefined ? inTok * 1000 : undefined;
      const costPer1kOutput = outTok !== undefined ? outTok * 1000 : undefined;
      return {
        key: `gateway/${m.id}`,
        provider: "gateway" as const,
        id: m.id,
        label: `${m.name ?? m.id} · Gateway`,
        local: false,
        tier: tierFromPrice(costPer1kOutput),
        tierDerived: true,
        costPer1kInput,
        costPer1kOutput,
        source: "gateway" as const,
      };
    });
}

/** Provedores diretos OpenAI-compatible: todos expõem `GET /v1/models`. */
const OPENAI_COMPAT: Array<{
  provider: Extract<ProviderId, "groq" | "google" | "openai" | "cohere">;
  envKey: string[];
  baseEnv: string;
  baseDefault: string;
  rotulo: string;
}> = [
  { provider: "groq", envKey: ["GROQ_API_KEY"], baseEnv: "GROQ_BASE_URL", baseDefault: "https://api.groq.com/openai/v1", rotulo: "Groq" },
  { provider: "google", envKey: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], baseEnv: "GEMINI_BASE_URL", baseDefault: "https://generativelanguage.googleapis.com/v1beta/openai/", rotulo: "Google" },
  { provider: "openai", envKey: ["OPENAI_API_KEY"], baseEnv: "OPENAI_BASE_URL", baseDefault: "https://api.openai.com/v1", rotulo: "OpenAI" },
  { provider: "cohere", envKey: ["COHERE_API_KEY"], baseEnv: "COHERE_BASE_URL", baseDefault: "https://api.cohere.ai/compatibility/v1", rotulo: "Cohere" },
];

/**
 * Modelos que NÃO servem para conversar. O `GET /v1/models` devolve o catálogo
 * inteiro da conta, e no Google isso inclui vídeo (veo), música (lyria), imagem
 * (imagen/nano-banana), transcrição, robótica e afins — que quebrariam o chat se
 * aparecessem no seletor.
 *
 * É deny-list e não allow-list de propósito: modelo de chat novo entra sozinho
 * (zero hardcode); só o que sabidamente não conversa precisa ser nomeado.
 */
const NAO_E_CHAT = new RegExp(
  [
    "embed", "rerank", "moderation", "guard", // texto, mas não conversa
    "whisper", "tts", "audio", "transcribe", "speech", // áudio
    "image", "imagen", "dall-e", "nano-banana", "vision-encoder", // imagem
    "veo", "lyria", "video", "music", // vídeo e música
    "robotics", "computer-use", "\\baqa\\b", // agentes especializados
  ].join("|"),
  "i",
);

/**
 * Prefere o alias canônico ao snapshot datado: `claude-opus-5` em vez de
 * `claude-opus-4-5-20251101`. Um id terminado em data é uma versão fixada, e
 * escolher uma dessas como padrão prende o dono a um modelo antigo.
 */
function ehSnapshotDatado(id: string): boolean {
  return /[-_]\d{8}$/.test(id) || /[-_]\d{4}-\d{2}-\d{2}$/.test(id);
}

/**
 * Versão numérica embutida no id, para desempatar modelos do mesmo porte pelo
 * mais novo: `claude-opus-5` → [5] vence `claude-opus-4-8` → [4,8].
 *
 * É genérico de propósito: uma tabela de "qual modelo é mais novo" seria
 * hardcode e envelheceria. Ler os números do próprio id funciona para
 * `opus-5`, `gemini-3.5-flash`, `gpt-5.2` e para o que vier depois.
 */
export function versaoDe(id: string): number[] {
  return (id.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Compara versões: maior primeiro. Sem número, fica por último. */
function comparaVersao(a: string, b: string): number {
  const va = versaoDe(a);
  const vb = versaoDe(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const na = va[i] ?? -1;
    const nb = vb[i] ?? -1;
    if (na !== nb) return nb - na;
  }
  return 0;
}

export async function discoverOpenAICompatible(): Promise<DiscoveredModel[]> {
  const out = await Promise.all(
    OPENAI_COMPAT.map((p) =>
      safe(p.provider, async () => {
        const apiKey = p.envKey.map((k) => process.env[k]).find(Boolean);
        if (!apiKey) return [];
        const base = (process.env[p.baseEnv] ?? p.baseDefault).replace(/\/+$/, "");
        const r = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!r.ok) throw new Error(`${p.provider} ${r.status}`);
        const j = (await r.json()) as { data?: Array<{ id: string }> };
        return (j.data ?? [])
          // O endpoint OpenAI-compatible do Gemini devolve os ids prefixados
          // ("models/gemini-2.5-flash"). O prefixo não é parte do nome do modelo
          // e quebraria a chamada — tiramos aqui, na borda.
          .map((m) => ({ id: (m.id ?? "").replace(/^models\//, "") }))
          .filter((m) => m.id && !NAO_E_CHAT.test(m.id))
          .map((m) => ({
            key: `${p.provider}/${m.id}`,
            provider: p.provider,
            id: m.id,
            label: `${m.id} · ${p.rotulo}`,
            local: false,
            // estes endpoints não informam preço; o tier fica no default e é
            // sobrescrevível pela config (princípio de zero hardcode).
            tier: "medium" as const,
            tierDerived: true,
            source: "openai-compatible" as const,
          }));
      }),
    ),
  );
  return out.flat();
}

// ── agregação + cache ────────────────────────────────────────────────────────

let cache: { at: number; models: DiscoveredModel[] } | null = null;
const CACHE_TTL_MS = Number(process.env.MODEL_DISCOVERY_TTL_MS ?? 5 * 60_000);

/**
 * Todos os modelos disponíveis AGORA, de todos os provedores configurados.
 * Cacheado (5 min por padrão): a lista muda quando o dono instala um modelo ou
 * liga uma chave, não a cada requisição.
 */
export async function discoverModels(opts?: { force?: boolean }): Promise<DiscoveredModel[]> {
  if (!opts?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;

  const groups = await Promise.all([
    safe("ollama", discoverOllama),
    safe("anthropic", discoverAnthropicOAuth),
    safe("gateway", discoverGateway),
    discoverOpenAICompatible(), // já é safe por provedor
  ]);

  const models = groups.flat();
  // dedup por chave, ordenado: local primeiro (eixo 1), depois porte, alias
  // canônico antes de snapshot datado, e por fim nome.
  const porChave = new Map(models.map((m) => [m.key, m]));
  const ordem = { large: 0, medium: 1, small: 2 };
  const lista = [...porChave.values()].sort(
    (a, b) =>
      Number(b.local) - Number(a.local) ||
      ordem[a.tier] - ordem[b.tier] ||
      Number(ehSnapshotDatado(a.id)) - Number(ehSnapshotDatado(b.id)) ||
      comparaVersao(a.id, b.id) ||
      a.key.localeCompare(b.key),
  );

  cache = { at: Date.now(), models: lista };
  return lista;
}

/** Última lista descoberta, sem ir à rede. Vazia se nada foi descoberto ainda. */
export function discoveredSnapshot(): DiscoveredModel[] {
  return cache?.models ?? [];
}

/** Invalida o cache (usar quando o dono mudar chave ou instalar modelo novo). */
export function invalidateDiscovery(): void {
  cache = null;
}
