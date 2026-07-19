import { eq } from "drizzle-orm";
import { embedTexts } from "@orbita/llm";
import { db } from "@/lib/db";
import { chunk, memory } from "@/lib/db/knowledge-schema";
import { getSession } from "@/lib/session";
import { rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Recalcula os embeddings dos documentos e memórias do usuário com os prefixos
 * de tarefa corretos (search_document). Necessário uma vez após introduzir os
 * prefixos — vetores antigos foram gerados sem prefixo. Também serve de
 * manutenção se o modelo de embedding mudar.
 */
async function reembedInBatches<T extends { id: string; content: string }>(
  rows: T[],
  update: (id: string, emb: number[]) => Promise<unknown>,
  batchSize = 32,
): Promise<number> {
  let done = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const embs = await embedTexts(batch.map((r) => r.content), "document");
    await Promise.all(batch.map((r, j) => update(r.id, embs[j])));
    done += batch.length;
  }
  return done;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const rl = rateLimit(`reindex:${uid}`, 3, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const [chunks, mems] = await Promise.all([
    db.select({ id: chunk.id, content: chunk.content }).from(chunk).where(eq(chunk.userId, uid)),
    db.select({ id: memory.id, content: memory.content }).from(memory).where(eq(memory.userId, uid)),
  ]);

  const reChunks = await reembedInBatches(chunks, (id, emb) =>
    db.update(chunk).set({ embedding: emb }).where(eq(chunk.id, id)),
  );
  const reMems = await reembedInBatches(mems, (id, emb) =>
    db.update(memory).set({ embedding: emb }).where(eq(memory.id, id)),
  );

  return Response.json({ ok: true, chunks: reChunks, memorias: reMems });
}
