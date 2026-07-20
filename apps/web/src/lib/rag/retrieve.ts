import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@/lib/db";
import { chunk, document, memory } from "@/lib/db/knowledge-schema";

export interface RagHit {
  content: string;
  source: string;
  sim: number;
}

// Cortes mínimos de similaridade (nomic com prefixos de tarefa). Abaixo disso o
// conteúdo é ruído — NÃO injetamos no contexto (evita alucinação por RAG).
const CHUNK_MIN_SIM = 0.35;
const MEM_MIN_SIM = 0.4;

// Cache de resultado de busca (60s). Evita re-embedar + re-consultar a MESMA
// query em janela curta: pré-injeção + tool no mesmo turno, retries e failover,
// ou o usuário repetindo/reenviando. Chave por (usuário, k, query normalizada).
const CACHE_TTL = 60_000;
const CACHE_MAX = 200;
const searchCache = new Map<string, { at: number; hits: RagHit[] }>();
const cacheKey = (userId: string, query: string, k: number) => `${userId}:${k}:${query.trim().toLowerCase()}`;
function cacheGet(key: string): RagHit[] | null {
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL) { searchCache.delete(key); return null; }
  return e.hits;
}
function cacheSet(key: string, hits: RagHit[]) {
  if (searchCache.size >= CACHE_MAX) { const oldest = searchCache.keys().next().value; if (oldest) searchCache.delete(oldest); }
  searchCache.set(key, { at: Date.now(), hits });
}

/**
 * Busca semântica em documentos + memória do usuário. Faz oversampling e
 * ranqueia documentos e memórias JUNTOS por similaridade, retornando os top-k
 * (memória e trechos competem de forma justa). Sem fallback de baixa confiança.
 * Resultados são cacheados por 60s (ver `searchCache`).
 */
export async function retrieveContext(userId: string, query: string, k = 4): Promise<RagHit[]> {
  const key = cacheKey(userId, query, k);
  const cached = cacheGet(key);
  if (cached) return cached;

  const q = await embedText(query, "query");

  const chunkSim = sql<number>`1 - (${cosineDistance(chunk.embedding, q)})`;
  const memSim = sql<number>`1 - (${cosineDistance(memory.embedding, q)})`;

  const [chunks, mems] = await Promise.all([
    db
      .select({ content: chunk.content, title: document.title, sim: chunkSim })
      .from(chunk)
      .innerJoin(document, eq(chunk.documentId, document.id))
      .where(and(eq(chunk.userId, userId), gt(chunkSim, CHUNK_MIN_SIM)))
      .orderBy(desc(chunkSim))
      .limit(k * 2), // oversample p/ ranqueamento conjunto
    db
      .select({ content: memory.content, sim: memSim })
      .from(memory)
      .where(and(eq(memory.userId, userId), gt(memSim, MEM_MIN_SIM)))
      .orderBy(desc(memSim))
      .limit(k),
  ]);

  const merged: RagHit[] = [
    ...mems.map((m) => ({ content: m.content, source: "memória", sim: Number(m.sim) })),
    ...chunks.map((c) => ({ content: c.content, source: c.title, sim: Number(c.sim) })),
  ];
  merged.sort((a, b) => b.sim - a.sim);
  const hits = merged.slice(0, k);
  cacheSet(key, hits);
  return hits;
}
