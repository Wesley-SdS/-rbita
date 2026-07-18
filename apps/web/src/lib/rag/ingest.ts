import { embedTexts } from "@orbita/llm";
import { db } from "@/lib/db";
import { document, chunk } from "@/lib/db/knowledge-schema";
import { chunkText } from "@/lib/rag/chunk";

/** Indexa um texto: chunk + embeddings + persistência (usado por /api/ingest e /api/upload). */
export async function ingestDocument(userId: string, title: string, content: string, source = "text") {
  const chunks = chunkText(content);
  if (!chunks.length) return { documentId: null, chunks: 0 };

  const embeddings = await embedTexts(chunks);
  const [doc] = await db.insert(document).values({ userId, title, source }).returning();
  if (!doc) throw new Error("Falha ao criar documento");

  await db.insert(chunk).values(
    chunks.map((c, i) => ({ documentId: doc.id, userId, content: c, idx: i, embedding: embeddings[i]! })),
  );
  return { documentId: doc.id, chunks: chunks.length };
}
