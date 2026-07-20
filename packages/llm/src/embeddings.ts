export const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
export const EMBED_DIMS = 768;

/**
 * O nomic-embed-text foi treinado com prefixos de tarefa e depende deles para o
 * recall assimétrico query↔documento. Sem os prefixos, a busca perde qualidade.
 * `query` = texto de busca; `document` = conteúdo indexado.
 * ATENÇÃO: os prefixos são específicos do nomic (local); modelos de nuvem não os usam.
 */
export type EmbedKind = "query" | "document";
const PREFIX: Record<EmbedKind, string> = {
  query: "search_query: ",
  document: "search_document: ",
};

// Base nativa do ollama (sem /v1) — a API nativa aceita `keep_alive`, que o
// endpoint OpenAI-compat não expõe.
const OLLAMA = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/v1\/?$/, "");
// Mantém o modelo de embedding RESIDENTE — sem isso o ollama descarrega o nomic
// entre turnos e o próximo embedding paga um cold-start de ~20s (sem GPU).
const KEEP_ALIVE = process.env.OLLAMA_EMBED_KEEP_ALIVE || "60m";

/**
 * Embedding de NUVEM, para deploys sem Ollama (ex.: Vercel). Usa a API
 * OpenAI-compatible de embeddings. Os modelos entregam mais dimensões do que a
 * coluna do banco (768), então SEMPRE pedimos `dimensions: 768`:
 *   - Gemini `gemini-embedding-2` (padrão): GA, grátis no free tier, #1 no MTEB,
 *     8192 tokens de contexto e — importante — NORMALIZA sozinho ao truncar.
 *     O `gemini-embedding-001` exigiria normalização MANUAL abaixo de 3072.
 *   - OpenAI `text-embedding-3-small`: 1536 por padrão, reduzível para 768.
 *
 * ⚠️ Trocar de provedor de embedding INVALIDA os vetores já gravados: modelos
 * diferentes vivem em espaços vetoriais distintos, e a similaridade entre eles
 * não significa nada. Ao migrar um corpus existente, é preciso REINDEXAR.
 */
function cloudConfig(): { baseURL: string; apiKey: string; model: string; dimensions?: number } | null {
  const gemini = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (gemini) {
    return {
      baseURL: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: gemini,
      model: process.env.EMBED_MODEL_CLOUD ?? "gemini-embedding-2",
      dimensions: EMBED_DIMS, // 3072 por padrão; truncamos p/ bater com a coluna
    };
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    return {
      baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: openai,
      model: process.env.EMBED_MODEL_CLOUD ?? "text-embedding-3-small",
      dimensions: EMBED_DIMS,
    };
  }
  return null;
}

/** Qual caminho de embedding está ativo (diagnóstico / health). */
export function embedProvider(): "cloud" | "local" {
  return cloudConfig() ? "cloud" : "local";
}

// Cache LRU em memória: query/doc idênticos = 0 chamadas ao modelo.
const cache = new Map<string, number[]>();
const CACHE_MAX = 1000;
function cacheGet(k: string): number[] | undefined {
  const v = cache.get(k);
  if (v) { cache.delete(k); cache.set(k, v); } // "toca" p/ LRU
  return v;
}
function cacheSet(k: string, v: number[]) {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

async function ollamaEmbed(inputs: string[]): Promise<number[][]> {
  const r = await fetch(OLLAMA + "/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs, keep_alive: KEEP_ALIVE }),
  });
  if (!r.ok) throw new Error(`embed_failed:${r.status}`);
  const j = (await r.json()) as { embeddings?: number[][] };
  if (!j.embeddings?.length) throw new Error("embed_empty");
  return j.embeddings;
}

async function cloudEmbed(inputs: string[], cfg: NonNullable<ReturnType<typeof cloudConfig>>): Promise<number[][]> {
  const url = cfg.baseURL.replace(/\/+$/, "") + "/embeddings";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      input: inputs,
      ...(cfg.dimensions ? { dimensions: cfg.dimensions } : {}),
    }),
  });
  if (!r.ok) throw new Error(`embed_cloud_failed:${r.status}:${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: { embedding: number[]; index: number }[] };
  if (!j.data?.length) throw new Error("embed_cloud_empty");
  return [...j.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Roteia para a nuvem (quando há chave) ou para o Ollama local. */
async function embed(inputs: string[], kind: EmbedKind): Promise<number[][]> {
  const cfg = cloudConfig();
  if (cfg) return cloudEmbed(inputs, cfg); // nuvem: sem prefixo de tarefa
  return ollamaEmbed(inputs.map((v) => PREFIX[kind] + v));
}

export async function embedText(value: string, kind: EmbedKind = "query"): Promise<number[]> {
  const key = `${kind}:${value}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const [emb] = await embed([value], kind);
  cacheSet(key, emb);
  return emb;
}

export async function embedTexts(values: string[], kind: EmbedKind = "document"): Promise<number[][]> {
  if (!values.length) return [];
  return embed(values, kind);
}

/** Aquece o modelo de embedding (chamar no boot evita o cold-start no 1º uso).
 *  Só faz sentido no local: na nuvem não há cold-start de modelo residente. */
export async function warmupEmbedding(): Promise<void> {
  if (embedProvider() === "cloud") return;
  try { await embedText("warmup", "query"); } catch { /* best-effort */ }
}
