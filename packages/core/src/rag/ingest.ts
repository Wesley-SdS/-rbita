import { embedTexts } from "@orbita/llm";
import { db } from "@orbita/db";
import { document, chunk } from "@orbita/db/knowledge-schema";
import { chunkText } from "./chunk";
import { settings } from "../settings";

/** Indexa um texto: chunk + embeddings + persistência (usado por /api/ingest e /api/upload). */
export async function ingestDocument(userId: string, title: string, content: string, source = "text") {
  const cfg = await settings.getMany(["rag.chunkSize", "rag.chunkOverlap"]);
  const chunks = chunkText(content, cfg["rag.chunkSize"], Math.min(cfg["rag.chunkOverlap"], cfg["rag.chunkSize"] - 1));
  if (!chunks.length) return { documentId: null, chunks: 0 };

  const embeddings = await embedTexts(chunks);
  // consistência: um embedding por chunk (senão inseriríamos vetor undefined/corrompido)
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embeddings inconsistentes: ${embeddings.length} para ${chunks.length} chunks`);
  }
  const [doc] = await db.insert(document).values({ userId, title, source }).returning();
  if (!doc) throw new Error("Falha ao criar documento");

  await db.insert(chunk).values(
    chunks.map((c, i) => ({ documentId: doc.id, userId, content: c, idx: i, embedding: embeddings[i]! })),
  );
  return { documentId: doc.id, chunks: chunks.length };
}
