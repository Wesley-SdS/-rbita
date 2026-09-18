import { embedTexts } from "@orbita/llm";
import { db } from "@orbita/db";
import { document, chunk } from "@orbita/db/knowledge-schema";
import { chunkText } from "./chunk";
import { settings } from "../settings";

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

/**
 * Indexa um texto: chunk + embeddings + persistência (usado por /api/ingest,
 * /api/upload e pela fila de trabalho).
 *
 * Documento e trechos entram na MESMA transação. Antes eram dois inserts
 * soltos: se o segundo falhasse, sobrava um documento vazio, e a retentativa
 * da fila criaria outro. Agora falhou é como se nunca tivesse começado, e
 * rodar de novo não duplica nada.
 */
export async function ingestDocument(userId: string, title: string, content: string, source = "text", progresso?: Progresso) {
  const cfg = await settings.getMany(["rag.chunkSize", "rag.chunkOverlap"]);
  const chunks = chunkText(content, cfg["rag.chunkSize"], Math.min(cfg["rag.chunkOverlap"], cfg["rag.chunkSize"] - 1));
  if (!chunks.length) return { documentId: null, chunks: 0 };

  await progresso?.(0, 2, `gerando embeddings de ${chunks.length} trecho${chunks.length === 1 ? "" : "s"}`);
  const embeddings = await embedTexts(chunks);
  // consistência: um embedding por chunk (senão inseriríamos vetor undefined/corrompido)
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embeddings inconsistentes: ${embeddings.length} para ${chunks.length} chunks`);
  }

  await progresso?.(1, 2, "guardando na memória");
  const documentId = await db.transaction(async (tx) => {
    const [doc] = await tx.insert(document).values({ userId, title, source }).returning();
    if (!doc) throw new Error("Falha ao criar documento");
    await tx.insert(chunk).values(chunks.map((c, i) => ({ documentId: doc.id, userId, content: c, idx: i, embedding: embeddings[i]! })));
    return doc.id;
  });
  return { documentId, chunks: chunks.length };
}
