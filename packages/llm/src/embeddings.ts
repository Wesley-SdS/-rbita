export const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
export const EMBED_DIMS = 768;

/**
 * O nomic-embed-text foi treinado com prefixos de tarefa e depende deles para o
 * recall assimétrico query↔documento. Sem os prefixos, a busca perde qualidade.
 * `query` = texto de busca; `document` = conteúdo indexado.
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

export async function embedText(value: string, kind: EmbedKind = "query"): Promise<number[]> {
  const key = `${kind}:${value}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const [emb] = await ollamaEmbed([PREFIX[kind] + value]);
  cacheSet(key, emb);
  return emb;
}

export async function embedTexts(values: string[], kind: EmbedKind = "document"): Promise<number[][]> {
  if (!values.length) return [];
  return ollamaEmbed(values.map((v) => PREFIX[kind] + v));
}

/** Aquece o modelo de embedding (chamar no boot evita o cold-start no 1º uso). */
export async function warmupEmbedding(): Promise<void> {
  try { await embedText("warmup", "query"); } catch { /* best-effort */ }
}
