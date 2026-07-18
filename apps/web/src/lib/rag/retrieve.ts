import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@/lib/db";
import { chunk, document, memory } from "@/lib/db/knowledge-schema";

export interface RagHit {
  content: string;
  source: string;
  sim: number;
}

/** Busca semântica em documentos + memória do usuário. */
export async function retrieveContext(userId: string, query: string, k = 4): Promise<RagHit[]> {
  const q = await embedText(query);

  const chunkSim = sql<number>`1 - (${cosineDistance(chunk.embedding, q)})`;
  const chunks = await db
    .select({ content: chunk.content, title: document.title, sim: chunkSim })
    .from(chunk)
    .innerJoin(document, eq(chunk.documentId, document.id))
    .where(and(eq(chunk.userId, userId), gt(chunkSim, 0.35)))
    .orderBy(desc(chunkSim))
    .limit(k);

  const memSim = sql<number>`1 - (${cosineDistance(memory.embedding, q)})`;
  const mems = await db
    .select({ content: memory.content, sim: memSim })
    .from(memory)
    .where(and(eq(memory.userId, userId), gt(memSim, 0.4)))
    .orderBy(desc(memSim))
    .limit(3);

  return [
    ...mems.map((m) => ({ content: m.content, source: "memória", sim: Number(m.sim) })),
    ...chunks.map((c) => ({ content: c.content, source: c.title, sim: Number(c.sim) })),
  ];
}
